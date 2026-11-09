/**
 * Push-to-talk microphone capture that produces a 16 kHz mono 16-bit WAV, the
 * format Meta's transcription model accepts. Works in the Quest browser, which
 * has a microphone but no built-in speech recognition.
 */

const TARGET_RATE = 16000;
const MAX_SECONDS = 12;

export const canRecord = (): boolean => !!navigator.mediaDevices?.getUserMedia && 'AudioContext' in window;

export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Called if recording stops on its own after MAX_SECONDS. */
  onAutoStop: (() => void) | null = null;

  get recording(): boolean {
    return this.context !== null;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but universally available and fine for a
    // few seconds of push-to-talk audio.
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(this.processor);
    this.processor.connect(this.context.destination);
    this.timer = setTimeout(() => this.onAutoStop?.(), MAX_SECONDS * 1000);
  }

  /** Stops and returns the recording as WAV bytes (null if nothing was captured). */
  async stop(): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!this.context) return null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const rate = this.context.sampleRate;
    this.processor?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.context.close();
    this.context = null;
    this.stream = null;
    this.processor = null;

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (total < rate * 0.3) return null; // under 0.3 s: treat as an accidental tap
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    return encodeWav(downsample(merged, rate, TARGET_RATE), TARGET_RATE);
  }
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    // Average the source samples that fall in this output sample.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** Sends a WAV recording to the server; returns the transcript, or null. */
export async function transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string | null> {
  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const json = (await response.json()) as { transcript?: string; error?: string };
    if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
    return json.transcript || null;
  } catch (e) {
    console.warn('[agent] transcription failed:', (e as Error).message);
    return null;
  }
}
