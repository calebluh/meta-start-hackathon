import { transcribe } from './recorder.js';

/**
 * Open-mic conversation. While talking to a worker the microphone stays on;
 * you just speak, and each finished sentence becomes a question.
 *
 * Preferred path: stream 16 kHz PCM to the server's /api/asr relay, which
 * forwards it to Meta's realtime transcription with turn detection
 * (ENDPOINTING). Words appear live as you speak, and a turn completes about
 * half a second after you stop.
 *
 * Fallback path (relay unreachable): detect speech locally by loudness,
 * record each utterance, and send it to /api/transcribe when you pause.
 *
 * While the worker is talking the mic is muted: silence is streamed instead
 * so the service keeps its real-time pacing, and the worker's own voice is
 * never transcribed as a question.
 */

const RATE = 16000;
const FRAME = 1280; // 80 ms at 16 kHz

export interface LiveMicEvents {
  /** The service (or local detector) heard speech begin. */
  onSpeechStart?: () => void;
  /** Words so far in the current sentence (live path only). */
  onPartial?: (text: string) => void;
  /** A finished sentence. */
  onTurn?: (text: string) => void;
  /** `live` (streaming), `fallback` (local detection) or `off`. */
  onMode?: (mode: 'live' | 'fallback' | 'off') => void;
}

export class LiveMic {
  /** When true, silence is sent instead of the microphone. */
  muted = false;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private socket: WebSocket | null = null;
  private mode: 'live' | 'fallback' | 'off' = 'off';
  private run = 0;
  private starting = false;
  private frame = new Int16Array(FRAME);
  private frameFill = 0;
  private resampleCarry = 0;

  // Fallback voice-activity detection.
  private noiseFloor = 0.01;
  private loudFrames = 0;
  private quietFrames = 0;
  private utterance: Int16Array[] = [];
  private inUtterance = false;

  constructor(private events: LiveMicEvents) {}

  /** True while the microphone is open or being opened. */
  get active(): boolean {
    return this.starting || this.mode !== 'off';
  }

  /**
   * Opening the microphone takes a moment (a permission prompt, then the
   * relay). `stop()` may arrive in the middle, so each start carries a number
   * and gives up, releasing the microphone, if a stop has happened since.
   */
  async start(keywords: string[]): Promise<void> {
    if (this.active) return;
    const run = ++this.run;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (run !== this.run) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.context = new AudioContext();
      const source = this.context.createMediaStreamSource(stream);
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
      source.connect(this.processor);
      this.processor.connect(this.context.destination);
      const live = await this.connect(keywords);
      if (run !== this.run) return; // stopped while connecting; stop() already cleaned up
      this.setMode(live ? 'live' : 'fallback');
    } finally {
      if (run === this.run) this.starting = false;
    }
  }

  stop(): void {
    this.run += 1;
    this.starting = false;
    this.socket?.close();
    this.socket = null;
    this.processor?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.context = null;
    this.stream = null;
    this.processor = null;
    this.utterance = [];
    this.inUtterance = false;
    this.setMode('off');
  }

  private setMode(mode: 'live' | 'fallback' | 'off'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.events.onMode?.(mode);
  }

  /** Opens the relay; resolves true once the service is ready, false on failure. */
  private connect(keywords: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => settle(false), 5000);
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${scheme}://${location.host}/api/asr`);
      } catch {
        settle(false);
        return;
      }
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ keywords }));
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg: { type?: string; transcript?: string; final?: boolean };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'ready') settle(true);
        else if (msg.type === 'speechStart' && !this.muted) this.events.onSpeechStart?.();
        else if (msg.type === 'transcript' && msg.transcript && !this.muted) this.events.onPartial?.(msg.transcript);
        else if (msg.type === 'speechComplete' && msg.transcript?.trim() && !this.muted) this.events.onTurn?.(msg.transcript.trim());
        else if (msg.type === 'error') settle(false);
      };
      socket.onerror = () => settle(false);
      socket.onclose = () => {
        settle(false);
        // Lost mid-conversation: keep listening the slower way.
        if (this.socket === socket && this.mode === 'live') {
          this.socket = null;
          this.setMode('fallback');
        }
      };
    });
  }

  /** Downsamples microphone audio to 16 kHz frames and routes each frame. */
  private onAudio(input: Float32Array): void {
    if (!this.context) return;
    const ratio = this.context.sampleRate / RATE;
    let i = this.resampleCarry;
    for (; i < input.length; i += ratio) {
      const sample = this.muted ? 0 : input[Math.floor(i)];
      this.frame[this.frameFill++] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
      if (this.frameFill === FRAME) {
        this.onFrame(this.frame);
        this.frame = new Int16Array(FRAME);
        this.frameFill = 0;
      }
    }
    this.resampleCarry = i - input.length;
  }

  private onFrame(frame: Int16Array): void {
    if (this.mode === 'live' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame.buffer);
      return;
    }
    if (this.mode === 'fallback') this.detect(frame);
  }

  /** Local speech detection by loudness, used only without the relay. */
  private detect(frame: Int16Array): void {
    if (this.muted) {
      this.loudFrames = 0;
      if (!this.inUtterance) return;
    }
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += (frame[i] / 0x7fff) ** 2;
    const rms = Math.sqrt(sum / frame.length);
    const threshold = Math.max(0.02, this.noiseFloor * 3);
    if (!this.inUtterance) {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      this.loudFrames = rms > threshold ? this.loudFrames + 1 : 0;
      this.utterance.push(frame);
      if (this.utterance.length > 4) this.utterance.shift(); // keep a little lead-in
      if (this.loudFrames >= 3) {
        this.inUtterance = true;
        this.quietFrames = 0;
        this.events.onSpeechStart?.();
      }
      return;
    }
    this.utterance.push(frame);
    this.quietFrames = rms > threshold ? 0 : this.quietFrames + 1;
    // ~0.8 s of quiet ends the sentence; 12 s is the longest question.
    if (this.quietFrames >= 10 || this.utterance.length >= 150) {
      const frames = this.utterance;
      this.utterance = [];
      this.inUtterance = false;
      this.loudFrames = 0;
      void transcribe(toWav(frames)).then((text) => {
        if (text?.trim()) this.events.onTurn?.(text.trim());
      });
    }
  }
}

function toWav(frames: Int16Array[]): Uint8Array<ArrayBuffer> {
  const samples = frames.reduce((n, f) => n + f.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 1, offset += 2) view.setInt16(offset, f[i], true);
  }
  return new Uint8Array(buffer);
}
