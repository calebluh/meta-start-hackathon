import { MAPS } from './index.js';
import type { GraphData } from './types.js';

/**
 * A city built on the server from a public GitHub repository (see
 * server/repo-map.ts). The map comes back as JSON text with the server's
 * signature; questions to its robots send both back, so the server knows the
 * map is one it made. The last one built is kept in the browser, so a reload
 * (or a link with ?map=<id>) still finds it.
 */

const KEY = 'diorama.repoMap';
const signed = new Map<string, { map: string; sig: string }>();

function looksLikeMap(value: unknown): value is GraphData {
  const g = value as GraphData;
  return !!g && Array.isArray(g.nodes) && Array.isArray(g.files) && Array.isArray(g.links) && Array.isArray(g.flows) && !!g.project;
}

/** Adds a signed repo map to the maps this page knows. Returns its graph, or null if it is not one. */
export function registerRepoMap(id: string, map: string, sig: string): GraphData | null {
  if (!/^gh-[0-9a-f]{16}$/.test(id)) return null;
  let graph: unknown;
  try {
    graph = JSON.parse(map);
  } catch {
    return null;
  }
  if (!looksLikeMap(graph)) return null;
  MAPS[id] = graph;
  signed.set(id, { map, sig });
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, map, sig }));
  } catch {
    // Not kept for next time; this visit still has it.
  }
  return graph;
}

/** Brings back the last repo map built in this browser. Returns its id. */
export function restoreRepoMap(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id?: string; map?: string; sig?: string } | null;
    if (!saved?.id || !saved.map || !saved.sig) return null;
    return registerRepoMap(saved.id, saved.map, saved.sig) ? saved.id : null;
  } catch {
    return null;
  }
}

/** The last repo city built in this browser, without loading it: its id and project name. */
export function lastRepoMap(): { id: string; name: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id?: string; map?: string } | null;
    if (!saved?.id || !saved.map) return null;
    const name = (JSON.parse(saved.map) as GraphData).project?.name;
    return typeof name === 'string' ? { id: saved.id, name } : null;
  } catch {
    return null;
  }
}

/** Extra fields for a question about `mapId`: the signed map, when it is a repo map. */
export function repoMapFields(mapId: string): { repoMap?: string; repoSig?: string } {
  const s = signed.get(mapId);
  return s ? { repoMap: s.map, repoSig: s.sig } : {};
}

/** Asks the server to build a city from a GitHub repository. */
export async function buildRepoCity(repo: string): Promise<{ id: string; graph: GraphData } | { error: string }> {
  try {
    const response = await fetch('/api/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
      signal: AbortSignal.timeout(65_000),
    });
    const json = (await response.json()) as { id?: string; map?: string; sig?: string; error?: string };
    if (!response.ok || !json.id || !json.map || !json.sig) return { error: json.error ?? `The server answered ${response.status}` };
    const graph = registerRepoMap(json.id, json.map, json.sig);
    return graph ? { id: json.id, graph } : { error: 'The map that came back could not be read' };
  } catch (e) {
    return { error: (e as Error)?.name === 'TimeoutError' ? 'That took too long; try a smaller repository' : 'Could not reach the server' };
  }
}
