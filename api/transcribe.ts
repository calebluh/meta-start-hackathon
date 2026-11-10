import { callerAddress } from '../server/rate-limit.js';
import { handleTranscribe } from '../server/transcribe-core.js';

/** Vercel Function: POST /api/transcribe with an audio/wav body. Uses MODEL_API_KEY. */
export async function POST(request: Request): Promise<Response> {
  // Refuse oversized uploads before reading them (handleTranscribe checks the real size too).
  if (Number(request.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) {
    return Response.json({ error: 'Recording is too long' }, { status: 413 });
  }
  const wav = new Uint8Array(await request.arrayBuffer());
  const { status, json } = await handleTranscribe(
    wav,
    process.env.MODEL_API_KEY ?? process.env.LLAMA_API_KEY,
    callerAddress(request.headers.get('x-forwarded-for')),
  );
  return Response.json(json, { status, headers: { 'Cache-Control': 'no-store' } });
}
