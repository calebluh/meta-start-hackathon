/**
 * Text to speech for the workers, shared by the Vite dev middleware and the
 * Vercel function. The Meta Model API has no speech output, so this uses
 * OpenAI's gpt-4o-mini-tts when OPENAI_API_KEY is set; without a key the page
 * falls back to the browser's own voices.
 *
 * Guard rails, since this spends the owner's credits: short lines only, a
 * fixed list of voices, a fixed speaking style (the page cannot send its
 * own instructions), and a per-address rate limit.
 */

export const TTS_VOICES = ['ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'sage', 'shimmer', 'verse', 'alloy', 'nova'] as const;
const MAX_CHARS = 420;
const PER_MINUTE = 40;

const STYLE =
  'You are a friendly little robot who works inside a software system, showing a visitor around your workplace. ' +
  'Speak warmly and clearly with a lively, upbeat pace and a hint of playful curiosity, like a proud coworker giving a quick tour. ' +
  'Keep it natural and conversational, never robotic or monotone.';

const recent = new Map<string, number[]>();

function allowed(address: string): boolean {
  const now = Date.now();
  const times = (recent.get(address) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) return false;
  times.push(now);
  recent.set(address, times);
  if (recent.size > 5000) recent.clear(); // never grow without bound
  return true;
}

export interface TtsResult {
  status: number;
  audio?: Uint8Array;
  json?: unknown;
}

/** GET: whether a cloud voice is configured, so the page knows what to use. */
export function ttsStatus(apiKey: string | undefined): TtsResult {
  return { status: 200, json: { enabled: Boolean(apiKey) } };
}

export async function handleTts(body: unknown, apiKey: string | undefined, address: string): Promise<TtsResult> {
  if (!apiKey) return { status: 503, json: { error: 'No voice configured' } };
  const b = body as { text?: unknown; voice?: unknown } | null;
  const text = typeof b?.text === 'string' ? b.text.trim() : '';
  const voice = typeof b?.voice === 'string' && (TTS_VOICES as readonly string[]).includes(b.voice) ? b.voice : 'coral';
  if (!text || text.length > MAX_CHARS) return { status: 400, json: { error: `text must be 1-${MAX_CHARS} characters` } };
  if (!allowed(address)) return { status: 429, json: { error: 'Too many requests' } };

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: STYLE, response_format: 'mp3' }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    return { status: 502, json: { error: `Voice service error ${response.status}`, detail } };
  }
  return { status: 200, audio: new Uint8Array(await response.arrayBuffer()) };
}
