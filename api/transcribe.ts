import { handleTranscribe } from '../server/transcribe-core.js';

/** Vercel Function: POST /api/transcribe with an audio/wav body. Uses MODEL_API_KEY. */
export async function POST(request: Request): Promise<Response> {
  const wav = new Uint8Array(await request.arrayBuffer());
  const { status, json } = await handleTranscribe(wav, process.env.MODEL_API_KEY ?? process.env.LLAMA_API_KEY);
  return Response.json(json, { status });
}
