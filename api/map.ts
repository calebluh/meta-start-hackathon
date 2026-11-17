import { callerAddress } from '../server/rate-limit.js';
import { handleRepoMap } from '../server/repo-map.js';

/**
 * Vercel Function: POST /api/map with { repo: "owner/name" }. Builds a city
 * from a public GitHub repository and returns it signed (see server/repo-map.ts).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  const { status, json } = await handleRepoMap(
    body,
    process.env.MODEL_API_KEY ?? process.env.LLAMA_API_KEY,
    process.env.MODEL_NAME,
    callerAddress(request.headers.get('x-forwarded-for')),
  );
  return Response.json(json, { status, headers: { 'Cache-Control': 'no-store' } });
}
