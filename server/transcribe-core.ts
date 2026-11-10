import { MODEL_API_BASE } from './agent-core.js';
import { createLimiter } from './rate-limit.js';

/**
 * Turns a short spoken question (16-bit WAV from the headset) into text with
 * Meta's Muse Voice Transcribe model. Shared by api/transcribe.ts and the dev
 * server. Capped at about a minute of audio so it stays a question, not a
 * general transcription service.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const perMinute = createLimiter(20, 60_000);
const everyone = createLimiter(4000, 24 * 60 * 60_000);

export async function handleTranscribe(
  wav: Uint8Array,
  apiKey: string | undefined,
  address = 'local',
): Promise<{ status: number; json: unknown }> {
  if (!apiKey) return { status: 503, json: { error: 'MODEL_API_KEY is not set on the server' } };
  const header = new TextDecoder().decode(wav.subarray(0, 12));
  if (wav.length < 44 || !header.startsWith('RIFF') || !header.endsWith('WAVE')) {
    return { status: 400, json: { error: 'Expected a WAV recording' } };
  }
  if (wav.length > MAX_BYTES) return { status: 413, json: { error: 'Recording is too long' } };
  if (!(perMinute.allow(address) && everyone.allow('all'))) return { status: 429, json: { error: 'Too many requests' } };

  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], {
      type: 'application/json',
    }),
  );
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'question.wav');
  try {
    const response = await fetch(`${MODEL_API_BASE}/asr/transcribe`, {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      body: form,
    });
    if (!response.ok) {
      return { status: 502, json: { error: `Transcription ${response.status}: ${(await response.text()).slice(0, 200)}` } };
    }
    const data = (await response.json()) as { transcript?: string };
    return { status: 200, json: { transcript: (data.transcript ?? '').trim() } };
  } catch {
    return { status: 502, json: { error: 'Transcription service unreachable' } };
  }
}
