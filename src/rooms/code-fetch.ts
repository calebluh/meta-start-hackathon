import type { GraphData, GraphFile } from '../maps/types.js';
import type { CodeBlock } from './worker.js';

/**
 * Real lines of a file, for the code card: fetched from GitHub at the commit
 * the map was made from (raw.githubusercontent.com allows this from any page).
 * Only shown on the card; the robots' prompts never see it, so code from
 * someone else's repository cannot talk to the model.
 */

const LINES = 9;
const NO_FONT = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]+/g;
const cache = new Map<string, Promise<string[] | null>>();

function rawUrl(graph: GraphData, path: string): string | null {
  const m = /github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(graph.source?.repo ?? '');
  const commit = graph.source?.commit;
  if (!m || !commit || !/^[0-9a-f]{7,40}$|^HEAD$/.test(commit)) return null;
  const safe = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${commit}/${safe}`;
}

function fileLines(url: string): Promise<string[] | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetch(url, { signal: AbortSignal.timeout(6000) })
      .then(async (r) => (r.ok ? (await r.text()).split('\n') : null))
      .catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

/** Which line the robot's words point at: a function it named, a "line 120", or the file's first definition. */
function targetLine(file: GraphFile, said: string): number {
  // Whatever the robot mentioned first: a function or class it named, or "line 194".
  const text = said.toLowerCase();
  let best: { at: number; line: number } | null = null;
  for (const e of file.exports ?? []) {
    const m = /^(.+) L(\d+)$/.exec(e);
    if (!m || m[1].length <= 2) continue;
    const at = text.indexOf(m[1].toLowerCase());
    if (at >= 0 && (!best || at < best.at)) best = { at, line: Number(m[2]) };
  }
  const n = /\blines? (\d{1,6})\b/.exec(text);
  if (n && (!best || n.index < best.at)) best = { at: n.index, line: Number(n[1]) };
  if (best) return best.line;
  const first = /L(\d+)$/.exec(file.exports?.[0] ?? '');
  return first ? Number(first[1]) : 1;
}

/** A window of the file around the line being talked about, or null when it cannot be fetched. */
export async function fetchCodeWindow(graph: GraphData, file: GraphFile, said: string): Promise<{ code: CodeBlock; line: number } | null> {
  const url = rawUrl(graph, file.p);
  if (!url) return null;
  const all = await fileLines(url);
  if (!all || all.length === 0) return null;
  const line = Math.min(Math.max(1, targetLine(file, said)), all.length);
  const from = Math.max(0, Math.min(line - 1 - Math.floor(LINES / 2), all.length - LINES));
  const window = all.slice(from, from + LINES).map((l) => l.replace(/\t/g, '  ').replace(/\r$/, ''));
  const indent = Math.min(...window.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return {
    code: {
      lines: window.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).slice(0, 90).replace(NO_FONT, '…')),
      numbers: window.map((_, i) => String(from + i + 1)),
      mark: line - 1 - from,
    },
    line,
  };
}
