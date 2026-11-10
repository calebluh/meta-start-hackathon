import type { Vector3 } from '@iwsdk/core';
import { audioContext, audioOutput } from '../audio/sound.js';

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

let cloud: Promise<boolean> | null = null;
function cloudAvailable(): Promise<boolean> {
  cloud ??= fetch('/api/tts')
    .then((r): Promise<{ enabled?: boolean }> | { enabled?: boolean } => (r.ok ? r.json() : {}))
    .then((j) => Boolean(j.enabled))
    .catch(() => false);
  return cloud;
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
 * Says a line and resolves when it is finished. `seed` picks the robot's
 * voice; `at` is where its head is, so the voice comes from there.
 */
export async function speak(text: string, seed = 0, at?: Vector3): Promise<void> {
  const gen = ++generation;
  stopAll();
  if ((await cloudAvailable()) && audioContext() && gen === generation) {
    try {
      await speakCloud(text, CLOUD_VOICES[seed % CLOUD_VOICES.length], at, gen);
      return;
    } catch {
      // Network or service trouble: the browser voice takes over.
    }
  }
  if (gen !== generation) return;
  return speakBrowser(text, seed);
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

async function speakCloud(text: string, voice: string, at: Vector3 | undefined, gen: number): Promise<void> {
  const c = audioContext()!;
  const out = audioOutput(at, 1.6);
  if (!out) throw new Error('audio not running');
  const meter = c.createAnalyser();
  meter.fftSize = 512;
  meter.connect(out);
  analyser = meter;

  const requests = chunks(text).map((part) =>
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: part, voice }),
    }).then((r) => {
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return r.arrayBuffer();
    }),
  );

  let endAt = 0;
  let last: AudioBufferSourceNode | null = null;
  for (const request of requests) {
    const audio = await c.decodeAudioData(await request);
    if (gen !== generation) return;
    const source = c.createBufferSource();
    source.buffer = audio;
    source.connect(meter);
    const start = Math.max(c.currentTime + 0.02, endAt);
    source.start(start);
    endAt = start + audio.duration;
    sources.push(source);
    last = source;
  }
  if (!last) return;
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

function speakBrowser(text: string, seed: number): Promise<void> {
  const estimate = speakingSeconds(text) * 1000;
  if (!('speechSynthesis' in window)) return new Promise((r) => setTimeout(r, estimate));
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
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}
