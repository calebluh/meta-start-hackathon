import { handleTts, ttsStatus } from '../server/tts-core.js';

/** Vercel Function: GET /api/tts reports whether a voice is set up; POST {text, voice} returns MP3. */
export function GET(): Response {
  const { status, json } = ttsStatus(process.env.OPENAI_API_KEY);
  return Response.json(json, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // handleTts reports the bad body
  }
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const result = await handleTts(body, process.env.OPENAI_API_KEY, address);
  if (result.audio) {
    return new Response(result.audio.buffer as ArrayBuffer, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  }
  return Response.json(result.json, { status: result.status });
}
