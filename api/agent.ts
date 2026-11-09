import { handleAgent } from '../server/agent-core.js';

/**
 * Vercel Function: POST /api/agent. Set MODEL_API_KEY (and optionally
 * MODEL_NAME) in the Vercel project's environment variables.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  const { status, json } = await handleAgent(body, process.env.MODEL_API_KEY ?? process.env.LLAMA_API_KEY, process.env.MODEL_NAME);
  return Response.json(json, { status });
}
