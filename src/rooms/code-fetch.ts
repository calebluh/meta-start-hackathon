import type { GraphData, GraphFile, HealthIssue } from '../maps/types.js';
import type { CodeView } from './code-card.js';
import { languageOf } from './code-syntax.js';
import { choose, type CodeRequest, CONTAINER, excerptChunks, parseBundle, rawUrl, wholeFile } from './code-pick.js';
import { type Chunk, fit, unitName } from './code-unit.js';

/**
 * The code for a card: which lines of a file to show, and where to get them.
 *
 * The lines come from wherever the map's code can be read:
 * - a project on this computer (the dev server reads the file the map was built from);
 * - a sample project shipped with the app (one text file of excerpts, see `GraphData.code`);
 * - GitHub, at the commit the map was made from (raw.githubusercontent.com allows this from any page);
 * - failing those, the few lines the map itself kept around a warning.
 *
 * What is shown is a whole unit: the lines the robot was given to read for
 * this question (the server chooses them and says which, see
 * server/code-context.ts), or, when it gave none, a choice made here the
 * same way (code-pick.ts): the function or class named, the lines round a
 * line number or a warning, or the file's main function.
 */

/** The most rows and characters a card holds; longer units fold, longer lines wrap. */
const MAX_ROWS = 22;
const MAX_COLS = 70;

const cache = new Map<string, Promise<string | null>>();

function fetchText(url: string): Promise<string | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetch(url, { signal: AbortSignal.timeout(6000) })
      .then(async (r) => (r.ok ? await r.text() : null))
      .catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

const bundles = new Map<string, Promise<Map<string, Chunk[]> | null>>();

function bundle(url: string): Promise<Map<string, Chunk[]> | null> {
  let hit = bundles.get(url);
  if (!hit) {
    hit = fetchText(url).then((text) => (text ? parseBundle(text) : null));
    bundles.set(url, hit);
  }
  return hit;
}

export type { CodeRequest };

export interface CodeSource {
  /** The map's id, and whether it was built from a project on this computer. */
  mapId: string;
  local: boolean;
  /** Where the site is served from, for a sample project's code file. */
  base: string;
}

/** The file's lines, from the first place that has them. */
async function chunksOf(graph: GraphData, file: GraphFile, source: CodeSource, issues: HealthIssue[]): Promise<Chunk[]> {
  if (source.local) {
    const here = wholeFile(await fetchText(`/api/code?map=${encodeURIComponent(source.mapId)}&path=${encodeURIComponent(file.p)}`));
    if (here) return here;
  }
  if (graph.code) {
    const sample = (await bundle(`${source.base}${graph.code}`))?.get(file.p);
    if (sample?.length) return sample;
  }
  const url = rawUrl(graph, file.p);
  const there = url ? wholeFile(await fetchText(url)) : null;
  return there ?? excerptChunks(issues);
}

/**
 * The card for `file`: the unit of code that was asked for, coloured and
 * fitted, or null when its lines cannot be had.
 */
export async function findCode(graph: GraphData, file: GraphFile, request: CodeRequest, source: CodeSource): Promise<CodeView | null> {
  const issues = (graph.health?.issues ?? []).filter((i) => i.locations?.[0]?.file === file.p);
  const chunks = (await chunksOf(graph, file, source, issues)).filter((c) => c.lines.length);
  if (chunks.length === 0) return null;
  const pick = choose(file, chunks, request, issues);
  if (!pick) return null;
  const { language, name } = languageOf(file.p);
  const head = pick.chunk.lines.slice(pick.start, pick.end + 1).find((l) => l.trim() && !/^\s*(?:\/\/|\/\*|\*|#|--|@)/.test(l)) ?? '';
  const outline = !pick.plain && CONTAINER.test(head);
  const limits = { maxRows: MAX_ROWS, maxCols: MAX_COLS, mark: pick.mark, outline, fold: !pick.plain };
  let fitted = fit(pick.chunk, pick.start, pick.end, language, limits);
  // If only the comment above it keeps the code from fitting whole, the code matters more.
  let lead = pick.start;
  while (lead < pick.end && /^\s*(?:\/\/|\/\*|\*|#|--)/.test(pick.chunk.lines[lead])) lead += 1;
  if (fitted.shortened && lead > pick.start && !pick.mark) {
    const bare = fit(pick.chunk, lead, pick.end, language, limits);
    if (!bare.shortened) {
      fitted = bare;
      pick.start = lead;
    }
  }
  // Cut off at the foot: say how to see the rest.
  const foot = fitted.rows[fitted.rows.length - 1];
  if (foot?.kind === 'fold' && / more$/.test(foot.tokens[0].text)) {
    foot.tokens[0].text += ' · say "show me more"';
    fitted.cols = Math.max(fitted.cols, foot.tokens[0].text.length);
  }
  const from = pick.chunk.first + pick.start;
  const to = pick.chunk.first + pick.end;
  const all = from === 1 && to >= file.loc - 1;
  const base = file.p.split('/').pop() ?? file.p;
  return {
    eyebrow: `${file.name} · ${name}`,
    title: (all || pick.plain ? '' : unitName(head, language)) || base,
    where: all ? `${file.p} · ${file.loc} lines` : `${file.p} · lines ${from}-${to} of ${Math.max(file.loc, to)}`,
    rows: fitted.rows,
    cols: fitted.cols,
    path: file.p,
    shownTo: Math.max(from, ...fitted.rows.map((r) => r.no ?? 0)),
    more: fitted.shortened,
  };
}
