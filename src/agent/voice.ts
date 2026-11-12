import type { Vector3 } from '@iwsdk/core';
import { audioContext, audioOutput, audioPaused } from '../audio/sound.js';

/**
 * Worker voices. With a cloud voice set up on the server (/api/tts), each
 * robot gets its own natural voice that plays from where it stands (HRTF, like
 * every other sound) and moves its mouth with the real loudness of the audio.
 * Without one, the browser's best built-in voice speaks instead, again varied
 * per robot.
 *
 * Long answers are split at sentences: the first is requested on its own so
 * speech starts quickly, the rest in parallel, and all play back to back.
 */

const CLOUD_VOICES = ['coral', 'ash', 'sage', 'verse', 'ballad', 'echo', 'shimmer', 'fable'];
const CHUNK_CHARS = 300;

/** Roughly how long a line takes to say, for pacing when there is no voice. */
export const speakingSeconds = (text: string): number => Math.max(1.2, text.length / 15);

/** Longest wait for one piece of speech before the browser voice takes over. */
const TTS_TIMEOUT_MS = 8000;
const CHECK_TIMEOUT_MS = 4000;
const RETRY_CHECK_MS = 30000;

let cloud: Promise<boolean> | null = null;
/**
 * Whether the server has a cloud voice. A clear answer is kept; a failed
 * check (offline, a slow start) is asked again half a minute later, so one
 * bad moment does not cost the natural voices for the whole visit.
 */
function cloudAvailable(): Promise<boolean> {
  cloud ??= fetch('/api/tts', { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`tts check ${r.status}`);
      return Boolean(((await r.json()) as { enabled?: boolean }).enabled);
    })
    .catch(() => {
      setTimeout(() => {
        cloud = null;
      }, RETRY_CHECK_MS);
      return false;
    });
  return cloud;
}

/** Asks early, so the first line a robot says does not wait for the answer. */
export function warmVoice(): void {
  void cloudAvailable();
}

let generation = 0;
let sources: AudioBufferSourceNode[] = [];
let analyser: AnalyserNode | null = null;
const samples = new Float32Array(512);

function stopAll(): void {
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      // already stopped
    }
  }
  sources = [];
  analyser = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/**
 * How loud the cloud voice is right now, 0-1, to drive the mouth. Negative
 * when no cloud voice is playing (the robot then animates its mouth itself).
 */
export function voiceLevel(): number {
  if (!analyser) return -1;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 6);
}

/**
 * Called once, when the voice actually starts, with how fast it speaks in
 * characters per second, so on-screen text can keep pace with it.
 */
export type OnVoiceStart = (charsPerSecond: number) => void;

/**
 * Says a line and resolves when it is finished. `seed` picks the robot's
 * voice; `at` is where its head is, so the voice comes from there.
 */
export async function speak(text: string, seed = 0, at?: Vector3, onStart?: OnVoiceStart): Promise<void> {
  const gen = ++generation;
  stopAll();
  let started = false;
  const begin: OnVoiceStart = (rate) => {
    if (started || gen !== generation) return;
    started = true;
    onStart?.(rate);
  };
  if (audioPaused()) return; // nobody is listening: the headset is off or the menu is up
  let rest = text;
  if ((await cloudAvailable()) && audioContext() && gen === generation) {
    // Whatever the cloud voice could not say (network or service trouble),
    // the browser voice says after it, never over it.
    rest = await speakCloud(text, CLOUD_VOICES[seed % CLOUD_VOICES.length], at, gen, begin);
  }
  if (!rest || gen !== generation) return;
  return speakBrowser(rest, seed, begin);
}

export function stopSpeaking(): void {
  generation += 1;
  stopAll();
}

/** Splits at sentence ends: the first sentence alone, then chunks up to CHUNK_CHARS. */
function chunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const last = out.length > 1 ? out.length - 1 : -1; // never grow the first chunk
    if (last >= 1 && out[last].length + s.length + 1 <= CHUNK_CHARS) out[last] += ` ${s}`;
    else out.push(s.slice(0, 400));
  }
  return out;
}

/** Plays the line with the cloud voice and returns the part it could not say ('' when it said it all). */
async function speakCloud(
  text: string,
  voice: string,
  at: Vector3 | undefined,
  gen: number,
  onStart: OnVoiceStart,
): Promise<string> {
  const c = audioContext()!;
  const out = audioOutput(at, 1.6);
  if (!out) return text;
  const meter = c.createAnalyser();
  meter.fftSize = 512;
  meter.connect(out);
  analyser = meter;

  const parts = chunks(text);
  const requests = parts.map((part) =>
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: part, voice }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    }).then((r) => {
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return r.arrayBuffer();
    }),
  );
  // A request that fails after an earlier one already ended the loop is expected.
  for (const request of requests) request.catch(() => undefined);

  let endAt = 0;
  let rest = '';
  let last: AudioBufferSourceNode | null = null;
  for (let i = 0; i < requests.length; i += 1) {
    let audio: AudioBuffer;
    try {
      audio = await c.decodeAudioData(await requests[i]);
    } catch {
      rest = parts.slice(i).join(' ');
      break;
    }
    if (gen !== generation) return '';
    const source = c.createBufferSource();
    source.buffer = audio;
    source.connect(meter);
    const start = Math.max(c.currentTime + 0.02, endAt);
    source.start(start);
    if (i === 0) {
      const rate = parts[0].length / Math.max(audio.duration, 0.3);
      setTimeout(() => onStart(rate), Math.max(0, (start - c.currentTime) * 1000));
    }
    endAt = start + audio.duration;
    sources.push(source);
    last = source;
  }
  if (!last) {
    if (gen === generation) analyser = null;
    return rest;
  }
  const final = last;
  await new Promise<void>((resolve) => {
    final.onended = () => resolve();
    // Stopped early (another line, or the conversation ended).
    const check = setInterval(() => {
      if (gen !== generation) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    final.addEventListener('ended', () => clearInterval(check));
  });
  if (gen === generation) analyser = null;
  return rest;
}

/** The most natural-sounding English voices this browser has, best first. */
function bestVoices(): SpeechSynthesisVoice[] {
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural/i.test(v.name) ? 5 : 0) +
    (/online|google/i.test(v.name) ? 3 : 0) +
    (/enhanced|premium/i.test(v.name) ? 2 : 0) +
    (/^en-US/i.test(v.lang) ? 1 : 0);
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^en/i.test(v.lang))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 4);
}

function speakBrowser(text: string, seed: number, onStart: OnVoiceStart): Promise<void> {
  const estimate = speakingSeconds(text) * 1000;
  const paced = text.length / speakingSeconds(text);
  if (!('speechSynthesis' in window)) {
    onStart(paced);
    return new Promise((r) => setTimeout(r, estimate));
  }
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = bestVoices();
    if (voices.length) utterance.voice = voices[seed % voices.length];
    utterance.rate = 1.04;
    // A little pitch variety so robots sharing a voice still differ.
    utterance.pitch = 0.95 + (seed % 3) * 0.08;
    // Some engines never fire onend; never wait much longer than the estimate.
    const fallback = setTimeout(resolve, estimate + 2500);
    const done = () => {
      clearTimeout(fallback);
      resolve();
    };
    utterance.onstart = () => onStart(paced * 1.04);
    // A browser with no voices never starts: show the text anyway.
    setTimeout(() => onStart(paced), 1500);
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}
