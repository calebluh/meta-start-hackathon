import type { Vector3 } from '@iwsdk/core';
import type { ThemeId } from '../rooms/themes.js';

/**
 * Procedural sound: everything is synthesized with Web Audio, so there are no
 * audio files to download or license. Sounds are spatial (HRTF panning) and
 * the listener follows the viewer's head, so a register ding comes from the
 * register and a packet whooshes past from the tube it came out of.
 *
 * Browsers only allow audio after a user gesture; `unlock()` is called on the
 * first pointer press and on entering VR.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: { stop: () => void } | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  if (!('AudioContext' in window)) return null;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  return ctx;
}

let paused = false;

export function unlock(): void {
  if (paused) return;
  const c = context();
  // `interrupted` (the system took the audio away) also needs a resume.
  if (c && c.state !== 'running' && c.state !== 'closed') void c.resume().catch(() => undefined);
}

/** Silences everything at once: the headset came off or the system menu is up. */
export function pauseAudio(): void {
  paused = true;
  if (ctx?.state === 'running') void ctx.suspend().catch(() => undefined);
}

export function resumeAudio(): void {
  paused = false;
  unlock();
}

export const audioPaused = (): boolean => paused;

/** Moves the listener to the viewer's head every frame. */
export function setListener(position: Vector3, forward: Vector3, up: Vector3): void {
  const c = ctx;
  if (!c || c.state !== 'running') return;
  const l = c.listener;
  if (l.positionX) {
    // Plain assignment: scheduling an event every frame would grow each
    // parameter's timeline for as long as the app runs.
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  }
}

/** The running audio context, or null before the first gesture. */
export function audioContext(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** An output for one sound: panned at a world position, or straight to the ears. */
export function audioOutput(at?: Vector3, volume = 1): GainNode | null {
  return output(at, volume);
}

function output(at?: Vector3, volume = 1): GainNode | null {
  const c = ctx;
  if (!c || !master || c.state !== 'running') return null;
  const gain = c.createGain();
  gain.gain.value = volume;
  if (at) {
    const panner = new PannerNode(c, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      rolloffFactor: 1.2,
      positionX: at.x,
      positionY: at.y,
      positionZ: at.z,
    });
    gain.connect(panner).connect(master);
  } else gain.connect(master);
  return gain;
}

function tone(freq: number, start: number, length: number, out: AudioNode, type: OscillatorType = 'sine', level = 0.3): void {
  const c = ctx!;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(level, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(start: number, length: number, out: AudioNode, filterFrom: number, filterTo: number, level = 0.3, q = 1): void {
  const c = ctx!;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterFrom, start);
  filter.frequency.exponentialRampToValueAtTime(filterTo, start + length);
  const env = c.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(level, start + length * 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  src.connect(filter).connect(env).connect(out);
  src.start(start);
  src.stop(start + length + 0.05);
}

// ------------------------------------------------------------- effects

/** A packet leaving or entering a tube. */
export function whoosh(at?: Vector3): void {
  const out = output(at, 0.9);
  if (!out) return;
  noise(ctx!.currentTime, 0.7, out, 300, 2400, 0.5, 0.8);
}

/** A packet landing in a worker's hands. */
export function pop(at?: Vector3): void {
  const out = output(at, 0.6);
  if (!out) return;
  const t = ctx!.currentTime;
  tone(520, t, 0.12, out, 'triangle', 0.4);
  tone(780, t + 0.05, 0.16, out, 'sine', 0.25);
}

/** A worker starts talking: a friendly two-note blip. */
export function blip(at?: Vector3): void {
  const out = output(at, 0.4);
  if (!out) return;
  const t = ctx!.currentTime;
  tone(660, t, 0.09, out, 'sine', 0.3);
  tone(990, t + 0.07, 0.12, out, 'sine', 0.25);
}

/** A soft click for panel buttons and selections. */
export function click(): void {
  const out = output(undefined, 0.35);
  if (!out) return;
  tone(1400, ctx!.currentTime, 0.04, out, 'square', 0.15);
}

/** Entering a room: a short rising chord. */
export function arrive(): void {
  const out = output(undefined, 0.35);
  if (!out) return;
  const t = ctx!.currentTime;
  [392, 494, 587].forEach((f, i) => tone(f, t + i * 0.06, 0.6, out, 'sine', 0.18));
}

/** The room's signature sound, played now and then from a station. */
function signature(theme: ThemeId, at: Vector3): void {
  const out = output(at, 0.5);
  if (!out) return;
  const t = ctx!.currentTime;
  switch (theme) {
    case 'finance': // cash register ding
      tone(1318, t, 0.9, out, 'sine', 0.3);
      tone(1760, t + 0.02, 0.7, out, 'sine', 0.15);
      break;
    case 'warehouse':
    case 'storefront': // barcode scanner beep
      tone(2200, t, 0.08, out, 'square', 0.12);
      break;
    case 'postoffice': // rubber stamp thump
    case 'archive':
      noise(t, 0.12, out, 180, 90, 0.6, 0.7);
      break;
    case 'switchboard':
    case 'radio':
    case 'controlroom': // data chirps
      [0, 0.08, 0.16].forEach((d, i) => tone(1200 + i * 300, t + d, 0.05, out, 'square', 0.08));
      break;
    case 'factory':
    case 'workshop': // machine clank
      noise(t, 0.25, out, 900, 300, 0.5, 3);
      tone(110, t, 0.2, out, 'triangle', 0.25);
      break;
    case 'lab':
    case 'thinktank': // soft bubbling
      [0, 0.12, 0.2].forEach((d) => tone(500 + Math.random() * 400, t + d, 0.1, out, 'sine', 0.12));
      break;
    default: // keyboard clicks
      for (let i = 0; i < 5; i += 1) noise(t + i * 0.07 + Math.random() * 0.03, 0.04, out, 3000, 2500, 0.25, 2);
  }
}

/**
 * Room tone: a quiet filtered hum, plus the room's signature sound from one
 * of the stations every few seconds.
 */
export function startAmbience(theme: ThemeId, stations: Vector3[]): void {
  stopAmbience();
  const c = ctx;
  if (!c || !master || c.state !== 'running') return;
  const hum = c.createOscillator();
  const humGain = c.createGain();
  const filter = c.createBiquadFilter();
  hum.type = 'sawtooth';
  hum.frequency.value = theme === 'factory' ? 70 : 55;
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  humGain.gain.value = 0.025;
  hum.connect(filter).connect(humGain).connect(master);
  hum.start();
  const timer = setInterval(() => {
    if (stations.length) signature(theme, stations[Math.floor(Math.random() * stations.length)]);
  }, 4200 + Math.random() * 2000);
  ambience = {
    stop: () => {
      clearInterval(timer);
      humGain.gain.setTargetAtTime(0, c.currentTime, 0.2);
      hum.stop(c.currentTime + 0.6);
    },
  };
}

export function stopAmbience(): void {
  ambience?.stop();
  ambience = null;
}
