import type { GraphData, GraphFile, HealthIssue } from '../maps/types.js';
import type { CodeView } from './code-card.js';
import { languageOf } from './code-syntax.js';
import { type Chunk, enclosing, findDefinition, fit, isDefinition, unitAt, unitEnd, unitName } from './code-unit.js';
import { warningTalkedAbout } from './worker.js';

/**
 * The code for a card: which lines of a file to show, and where to get them.
 *
 * The lines come from wherever the map's code can be read:
 * - a project on this computer (the dev server reads the file the map was built from);
 * - a sample project shipped with the app (one text file of excerpts, see `GraphData.code`);
 * - GitHub, at the commit the map was made from (raw.githubusercontent.com allows this from any page);
 * - failing those, the few lines the map itself kept around a warning.
 *
 * What is shown is a whole unit, chosen from what was asked and what the robot
 * answered: the function or class named, the lines round a line number or a
 * warning, or the file's main function. The code is only ever shown on the
 * card. The robots' prompts never see it, so code from someone else's
 * repository cannot talk to the model.
 */

/** The most rows and characters a card holds; longer units fold, longer lines wrap. */
const MAX_ROWS = 22;
const MAX_COLS = 70;
/** Files longer than this are not searched for names (a generated bundle, a data file). */
const MAX_LINES = 20000;

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

const toLines = (text: string): string[] => text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n');

function rawUrl(graph: GraphData, path: string): string | null {
  const m = /github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(graph.source?.repo ?? '');
  const commit = graph.source?.commit;
  if (!m || !commit || !/^[0-9a-f]{7,40}$|^HEAD$/.test(commit)) return null;
  const safe = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${commit}/${safe}`;
}

/**
 * A sample project's code, from its one text file: "=== path" starts a file
 * and "@@ 24" starts a run of lines at line 24 (a file may hold several runs,
 * with the lines between them left out).
 */
export function parseBundle(text: string): Map<string, Chunk[]> {
  const files = new Map<string, Chunk[]>();
  let chunks: Chunk[] | null = null;
  let chunk: Chunk | null = null;
  for (const line of toLines(text)) {
    const file = /^=== (\S.*)$/.exec(line);
    const run = /^@@ (\d+)\s*$/.exec(line);
    if (file) {
      chunks = [];
      chunk = null;
      files.set(file[1].trim(), chunks);
    } else if (run && chunks) {
      chunk = { first: Number(run[1]), lines: [] };
      chunks.push(chunk);
    } else if (chunks) {
      if (!chunk) {
        chunk = { first: 1, lines: [] };
        chunks.push(chunk);
      }
      chunk.lines.push(line);
    }
  }
  for (const list of files.values()) {
    for (const c of list) while (c.lines.length && !c.lines[c.lines.length - 1].trim()) c.lines.pop();
  }
  return files;
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

/** The lines a map kept around its warnings on this file ("  41 code", the flagged line ">43 code"). */
function excerptChunks(issues: HealthIssue[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const issue of issues) {
    const rows = (issue.excerpt ?? '')
      .split('\n')
      .map((l) => /^[ >]\s*(\d+) ?(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null);
    if (rows.length) chunks.push({ first: Number(rows[0][1]), lines: rows.map((m) => m[2].replace(/\t/g, '  ')) });
  }
  return chunks;
}

export interface CodeSource {
  /** The map's id, and whether it was built from a project on this computer. */
  mapId: string;
  local: boolean;
  /** Where the site is served from, for a sample project's code file. */
  base: string;
}

/** The file's lines, from the first place that has them. */
async function chunksOf(graph: GraphData, file: GraphFile, source: CodeSource, issues: HealthIssue[]): Promise<Chunk[]> {
  const whole = (text: string | null): Chunk[] | null => {
    const lines = text === null ? null : toLines(text);
    return lines && lines.length && lines.length <= MAX_LINES ? [{ first: 1, lines }] : null;
  };
  if (source.local) {
    const here = whole(await fetchText(`/api/code?map=${encodeURIComponent(source.mapId)}&path=${encodeURIComponent(file.p)}`));
    if (here) return here;
  }
  if (graph.code) {
    const sample = (await bundle(`${source.base}${graph.code}`))?.get(file.p);
    if (sample?.length) return sample;
  }
  const url = rawUrl(graph, file.p);
  const there = url ? whole(await fetchText(url)) : null;
  return there ?? excerptChunks(issues);
}

/** "runBilling" as it is said aloud: "run billing". */
const spoken = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words for a piece of code, said before or after its name: "the send function", "class Plan". */
const CODE_NOUN = '(?:function|method|class|def|handler|table|key|block|section|component|hook|type|interface|route|endpoint|job|test|service|step)';

/**
 * Where in `lower` a definition's name is mentioned, or -1. A name that is
 * plainly code ("runBilling", "create_app") counts wherever it appears, said
 * aloud too ("run billing"). An everyday word ("send", "start") only counts
 * when it is called a function, a class and so on.
 */
function mentionAt(lower: string, name: string): number {
  const forms = [name.toLowerCase()];
  const aloud = spoken(name);
  if (aloud !== forms[0]) forms.push(aloud);
  const plainlyCode = /[a-z0-9][A-Z]|_|\d/.test(name) || name.length >= 9;
  for (const form of forms) {
    const f = escapeRegex(form);
    if (plainlyCode) {
      const m = new RegExp(`(?<![\\w$])${f}(?![\\w$])`).exec(lower);
      if (m) return m.index;
    } else {
      const m = new RegExp(`\\b${CODE_NOUN}\\s+(?:called\\s+|named\\s+)?${f}(?![\\w$])|(?<![\\w$])${f}(?:\\(\\)|\\s+${CODE_NOUN}\\b)`).exec(lower);
      if (m) return m.index;
    }
  }
  return -1;
}

interface Named {
  name: string;
  /** The line number in the file. */
  line: number;
}

/** Every function, class and key the file's lines define, with the map's own list first. */
function definitions(file: GraphFile, chunks: Chunk[], language: ReturnType<typeof languageOf>['language']): Named[] {
  const found: Named[] = [];
  const seen = new Set<string>();
  const keep = (name: string, line: number) => {
    if (name.length < 3 || seen.has(name)) return;
    seen.add(name);
    found.push({ name, line });
  };
  for (const e of file.exports ?? []) {
    const m = /^(.+) L(\d+)$/.exec(e);
    if (m) keep(m[1], Number(m[2]));
  }
  for (const chunk of chunks) {
    chunk.lines.forEach((line, i) => {
      if (found.length > 400 || !isDefinition(line, language)) return;
      const name = /^(?:(?:class|interface|enum|struct|trait|namespace|module|impl|type|table|view|index|function)\s+)?([A-Za-z_$][\w$.-]*)(?:\(\))?$/.exec(unitName(line, language))?.[1];
      if (name) keep(name, chunk.first + i);
    });
  }
  return found;
}

/** The first definition mentioned in `text`, if any. */
function namedIn(text: string, names: Named[]): Named | null {
  const lower = text.toLowerCase();
  let best: { at: number; named: Named } | null = null;
  for (const named of names) {
    const at = mentionAt(lower, named.name);
    if (at >= 0 && (!best || at < best.at)) best = { at, named };
  }
  return best?.named ?? null;
}

/** The chunk holding line `line` of the file, and the line's index in it. */
function locate(chunks: Chunk[], line: number): { chunk: Chunk; index: number } | null {
  for (const chunk of chunks) {
    if (line >= chunk.first && line < chunk.first + chunk.lines.length) return { chunk, index: line - chunk.first };
  }
  return null;
}

export interface CodeRequest {
  /** What the visitor asked, and what the robot answered. */
  asked: string;
  said: string;
  /** "Show me more": carry on after this line of the file, where the last card stopped. */
  after?: number;
}

interface Pick {
  chunk: Chunk;
  start: number;
  end: number;
  /** A line number to light up. */
  mark?: number;
  /** Lines to read straight through, never folded: the next part of something already begun. */
  plain?: boolean;
}

/** A unit whose shape matters more than any one body: shown as an outline when it is too long. */
const CONTAINER = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:pub\s+)?(?:class|interface|enum|struct|trait|impl|namespace|module)\b/;

/** Which lines to show: see the note at the top of this file. */
function choose(file: GraphFile, chunks: Chunk[], request: CodeRequest, issues: HealthIssue[]): Pick | null {
  const { language } = languageOf(file.p);
  const names = definitions(file, chunks, language);
  /** Where a name is defined: on the line the map gave or, when the file has moved on since, wherever its definition is now. */
  const whereIs = (found: Named): { chunk: Chunk; index: number } | null => {
    const at = locate(chunks, found.line);
    if (at && at.chunk.lines[at.index].includes(found.name) && isDefinition(at.chunk.lines[at.index], language)) return at;
    for (const chunk of chunks) {
      const index = findDefinition(chunk.lines, found.name);
      if (index >= 0) return { chunk, index };
    }
    return null;
  };
  const named = (found: Named | null): Pick | null => {
    const at = found ? whereIs(found) : null;
    return at ? { chunk: at.chunk, ...unitAt(at.chunk.lines, at.index, language) } : null;
  };
  const around = (line: number): Pick | null => {
    const at = locate(chunks, line);
    return at ? { chunk: at.chunk, ...enclosing(at.chunk.lines, at.index, language), mark: line } : null;
  };
  const lineIn = (text: string): number | null => {
    const m = /\blines? (\d{1,6})\b/i.exec(text);
    return m ? Number(m[1]) : null;
  };

  // 0. More of what is already up: the lines after the last one shown.
  if (request.after) {
    const next = locate(chunks, request.after + 1);
    const later = chunks.find((c) => c.first > request.after!);
    if (next) return { chunk: next.chunk, start: next.index, end: next.chunk.lines.length - 1, plain: true };
    if (later) return { chunk: later, start: 0, end: later.lines.length - 1, plain: true };
  }
  // 1. What the visitor asked for by line or by name.
  const askedLine = lineIn(request.asked);
  let pick = (askedLine && around(askedLine)) || named(namedIn(request.asked, names));
  if (pick) return pick;
  // 2. A warning on this file: the one being talked about, its line lit.
  const issue = warningTalkedAbout(issues, `${request.asked} ${request.said}`);
  const issueLine = issue?.locations?.[0]?.line;
  if (issueLine && (pick = around(issueLine))) return pick;
  // 3. What the robot named in its answer.
  const saidLine = lineIn(request.said);
  pick = named(namedIn(request.said, names)) || (saidLine ? around(saidLine) : null);
  if (pick) return pick;
  // 4. "Show me the class": the file's first class.
  if (/\bclass\b/i.test(request.asked)) {
    for (const chunk of chunks) {
      const index = chunk.lines.findIndex((l) => /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+\w/.test(l));
      if (index >= 0) return { chunk, ...unitAt(chunk.lines, index, language) };
    }
  }
  // 5. The file's main function or class: the longest one it offers to the rest of the code.
  const wholeFile = /\b(?:whole|entire|full|all of the|top of the|start of the)\s+(?:\w+\s+)?file\b|\bimports\b/i.test(request.asked);
  const codeLike = language === 'js' || language === 'python' || language === 'clike' || language === 'ruby' || language === 'shell';
  if (!wholeFile && codeLike) {
    let main: { named: Named; size: number; offered: boolean } | null = null;
    for (const candidate of names.slice(0, 80)) {
      const at = whereIs(candidate);
      if (!at) continue;
      const size = unitEnd(at.chunk.lines, at.index, language) - at.index;
      // In JavaScript and its kin, what a file exports is what it is for.
      const offered = language !== 'js' || /^\s*export\b/.test(at.chunk.lines[at.index]);
      if (!main || (offered && !main.offered) || (offered === main.offered && size > main.size)) main = { named: candidate, size, offered };
    }
    if ((pick = named(main?.named ?? names[0] ?? null))) return pick;
  }
  // 6. The file from its top.
  const first = chunks[0];
  return first ? { chunk: first, start: 0, end: first.lines.length - 1, plain: true } : null;
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
