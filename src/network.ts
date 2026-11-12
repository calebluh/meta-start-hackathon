import { resolveRef } from './layout.js';
import type { GraphData } from './maps/types.js';

/**
 * What one step of a flow costs, in the terms that matter when following a
 * request: does it cross the network, touch stored data, or is it the code
 * doing its own work in memory?
 *
 * - `entry`: the request arriving from outside (a browser, a phone, another
 *   system) at the first part that handles it.
 * - `network`: an HTTP or RPC call, a queue or event, or a call out to an
 *   outside service.
 * - `storage`: reading or writing a database or other stored data.
 * - `local`: one part of the code calling another, inside the same program.
 *
 * Worked out from the map: the kinds of the two parts and the kinds of the
 * links between them.
 */
export type HopKind = 'entry' | 'network' | 'storage' | 'local';

const NETWORK_LINKS = new Set(['http', 'rpc', 'queue', 'event']);
const CLIENT_KINDS = new Set(['ui']);
const SERVER_KINDS = new Set(['service', 'worker', 'feature']);

export const HOP_COLORS: Record<HopKind, string> = {
  entry: '#5ce1ff',
  network: '#5ce1ff',
  storage: '#ffc74d',
  local: '#ffffff',
};

/** Short tag for the step card. */
export const HOP_TAGS: Record<HopKind, string> = {
  entry: 'FROM THE WEB',
  network: 'NETWORK',
  storage: 'STORED DATA',
  local: 'IN THE CODE',
};

export function classifyHop(graph: GraphData, fromId: string | null, toId: string): { kind: HopKind; detail: string } {
  const to = graph.nodes.find((n) => n.id === toId);
  if (!fromId) {
    if (to && (CLIENT_KINDS.has(to.kind) || SERVER_KINDS.has(to.kind)))
      return { kind: 'entry', detail: 'The request arrives over the internet.' };
    return { kind: 'local', detail: 'The work starts here, inside the code.' };
  }
  const from = graph.nodes.find((n) => n.id === fromId);
  const links = new Set<string>();
  for (const l of graph.links) {
    const a = resolveRef(graph, l.a);
    const b = resolveRef(graph, l.b);
    if ((a === fromId && b === toId) || (a === toId && b === fromId)) links.add(l.k);
  }
  const kinds = [from?.kind, to?.kind];
  if (kinds.includes('external')) {
    const name = (from?.kind === 'external' ? from : to)?.label ?? 'an outside service';
    return { kind: 'network', detail: `Leaves the app over the network to ${name}.` };
  }
  const net = [...links].find((k) => NETWORK_LINKS.has(k));
  if (net) {
    const how = net === 'http' ? 'an HTTP request' : net === 'rpc' ? 'a remote call' : net === 'queue' ? 'a message on a queue' : 'an event';
    return { kind: 'network', detail: `Crosses the network as ${how}.` };
  }
  // Screens talk to servers over the network even when the map does not say how.
  if ((from && CLIENT_KINDS.has(from.kind) && to && !CLIENT_KINDS.has(to.kind)) || (to && CLIENT_KINDS.has(to.kind) && from && !CLIENT_KINDS.has(from.kind)))
    return { kind: 'network', detail: 'Crosses the network between the browser and the server.' };
  if (kinds.includes('data') || links.has('data'))
    return { kind: 'storage', detail: 'Reads or writes stored data.' };
  return { kind: 'local', detail: 'Stays inside the code: one part calls another, no network.' };
}
