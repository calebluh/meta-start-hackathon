import type { GraphData } from '../src/maps/types.js';

/**
 * "Review this project": the note taker goes through what the map knows
 * (warnings, very long files, the part everything leans on, missing tests)
 * and writes a short work order, most urgent first, each item naming a file
 * and line a coding agent can act on.
 *
 * The findings are worked out here from the map alone. The model only puts
 * them in order and words them as tasks; it picks from numbered findings and
 * cannot add files of its own. If it is slow or says something odd, the
 * findings stand as written here.
 *
 * Pure (no network): server/agent-core.ts makes the model call.
 */

export interface Finding {
  /** What to do, as a task, when the model's wording is not used. */
  task: string;
  /** The fact behind it, for the model. */
  fact: string;
  /** "path:line" (or just the path), appended to a task that does not name it. */
  where: string;
  /** The part of the project it belongs to (its label). */
  part?: string;
  /** Higher is more urgent. */
  weight: number;
}

export interface ReviewReply {
  /** What the note taker says once the list is up. */
  say: string;
  /** The work order, most urgent first. */
  items: { text: string; part?: string }[];
}

const MAX_ITEMS = 5;
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s);

/** What the map itself shows needs doing. */
export function findings(graph: GraphData): Finding[] {
  const out: Finding[] = [];
  const partOf = (path: string) => {
    const id = graph.files.find((f) => f.p === path)?.n;
    return graph.nodes.find((n) => n.id === id)?.label;
  };
  const severity = { high: 90, medium: 70, low: 45 } as const;

  for (const issue of graph.health?.issues ?? []) {
    const loc = issue.locations?.[0];
    const where = loc ? (loc.line ? `${loc.file}:${loc.line}` : loc.file) : '';
    const file = loc ? graph.files.find((f) => f.p === loc.file) : undefined;
    const names = (file?.exports ?? []).slice(0, 4).join(', ');
    out.push({
      task: cut(`${issue.title}. ${issue.detail ?? ''}`.trim(), 300),
      fact: `Warning (${issue.severity}): ${issue.title}. ${cut(issue.detail ?? '', 260)}${where ? ` At ${where}.` : ''}${names ? ` Functions there: ${names}.` : ''}`,
      where,
      part: loc ? partOf(loc.file) : undefined,
      weight: severity[issue.severity] ?? 50,
    });
  }

  const flagged = new Set((graph.health?.issues ?? []).flatMap((i) => i.locations?.map((l) => l.file) ?? []));
  const isTest = (path: string) => {
    const kind = graph.nodes.find((n) => n.id === graph.files.find((f) => f.p === path)?.n)?.kind;
    return kind === 'test' || kind === 'misc' || /(^|\/)(tests?|__tests__|docs?|examples?)\//i.test(path) || /\.(test|spec)\.\w+$/.test(path);
  };

  // The longest file of real code that no warning already covers.
  const longest = [...graph.files].filter((f) => !flagged.has(f.p) && !isTest(f.p)).sort((a, b) => b.loc - a.loc)[0];
  if (longest && longest.loc >= 500) {
    const names = (longest.exports ?? []).slice(0, 5).join(', ');
    out.push({
      task: `Split ${longest.p} (${longest.loc.toLocaleString('en-US')} lines) into smaller files by job${names ? `, starting around ${names}` : ''}.`,
      fact: `${longest.p} is the longest file not already flagged: ${longest.loc} lines.${names ? ` Functions there: ${names}.` : ''}`,
      where: longest.p,
      part: partOf(longest.p),
      weight: longest.loc >= 1500 ? 60 : 40,
    });
  }

  // The part most others lean on: a change there ripples.
  const leaning = new Map<string, Set<string>>();
  const nodeOf = (ref: string) => (ref.startsWith('n:') ? ref.slice(2) : graph.files.find((f) => f.p === ref.replace(/^f:/, ''))?.n);
  for (const link of graph.links) {
    const a = nodeOf(link.a);
    const b = nodeOf(link.b);
    if (!a || !b || a === b) continue;
    const set = leaning.get(b) ?? new Set<string>();
    set.add(a);
    leaning.set(b, set);
  }
  const hub = [...leaning.entries()]
    .map(([id, set]) => ({ node: graph.nodes.find((n) => n.id === id), count: set.size }))
    .filter((h) => h.node && h.node.kind !== 'external' && h.node.kind !== 'test')
    .sort((a, b) => b.count - a.count)[0];
  if (hub?.node && hub.count >= 3) {
    const file = [...graph.files].filter((f) => f.n === hub.node!.id).sort((a, b) => b.loc - a.loc)[0];
    out.push({
      task: `${hub.count} other parts depend on ${hub.node.label}. Before changing it, write down what it promises them${file ? ` (start with ${file.p})` : ''} and cover that with tests.`,
      fact: `${hub.count} other parts depend on "${hub.node.label}"${file ? `, whose biggest file is ${file.p}` : ''}. A change there ripples widely.`,
      where: file?.p ?? '',
      part: hub.node.label,
      weight: 50,
    });
  }

  // No tests anywhere on the map.
  const hasTests = graph.nodes.some((n) => n.kind === 'test') || graph.files.some((f) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.\w+$|(^|\/)test_/i.test(f.p));
  if (!hasTests) {
    const core = [...graph.files].filter((f) => !isTest(f.p)).sort((a, b) => b.loc - a.loc)[0];
    out.push({
      task: `No tests were found. Add a first test around ${core ? core.p : 'the main code path'}, so later changes can be checked.`,
      fact: `The map shows no test files at all.${core ? ` The biggest code file is ${core.p}.` : ''}`,
      where: core?.p ?? '',
      part: core ? partOf(core.p) : undefined,
      weight: 55,
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 7);
}

/** The work order with no model: the findings as written above. */
export function plainReview(graph: GraphData, found: Finding[]): ReviewReply {
  const items = found.slice(0, MAX_ITEMS).map((f) => ({ text: withWhere(f.task, f.where), part: f.part }));
  return { say: spokenSummary(graph, items.length, found[0]), items };
}

function spokenSummary(graph: GraphData, count: number, first: Finding | undefined): string {
  if (count === 0) return `I went through ${graph.project.name} and found nothing that needs doing right now. It looks tidy.`;
  const lead = count === 1 ? 'I found one thing worth doing' : `I found ${count} things worth doing, most urgent first`;
  return `${lead}. ${first?.part ? `Start in ${first.part}. ` : ''}They are on the wall, and waiting on the page when you take the headset off.`;
}

function withWhere(task: string, where: string): string {
  const file = where.split(':')[0];
  return cut(!where || task.includes(file) ? task : `${task.replace(/\s+$/, '')} (${where})`, 400);
}

export function reviewPrompt(graph: GraphData, found: Finding[]): { system: string; user: string } {
  return {
    system:
      'You are a senior engineer reviewing a codebase for a newcomer who will hand your list to a coding agent. ' +
      'You are given numbered findings. Choose the 3 to 5 that matter most, most urgent first, and word each as one task. ' +
      'Reply with JSON only, no prose: {"say": "<two short spoken sentences: how many things, and which to do first and why>", ' +
      '"items": [{"finding": <number>, "task": "<one or two plain imperative sentences: what to change and why, naming the file, and the line or function when the finding gives one>"}]}. ' +
      'Use only the findings given. Never invent files, lines or functions. No markdown, no code.',
    user: [`Project: ${graph.project.name}. ${cut(graph.project.summary, 300)}`, 'Findings:', ...found.map((f, i) => `${i + 1}. ${f.fact}`)].join('\n'),
  };
}

/**
 * Reads the model's ordering and wording; anything off falls back to the
 * findings as written. The quick model sometimes breaks its own JSON (one
 * object with several "task" keys), so the tasks are read by pattern, in
 * order, and each is matched to the finding whose file it names.
 */
export function parseReview(graph: GraphData, found: Finding[], text: string): ReviewReply {
  const plain = plainReview(graph, found);
  const tidy = (v: string, max: number) => cut(v.replace(/[*`#]+/g, '').replace(/\s+/g, ' ').trim(), max);
  const unquote = (raw: string): string => {
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw.replace(/\\"/g, '"').replace(/\\n/g, ' ');
    }
  };
  const tasks = [...text.matchAll(/"task"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => tidy(unquote(m[1]), 340));
  const numbers = [...text.matchAll(/"finding"\s*:\s*"?(\d+)/g)].map((m) => Number(m[1]) - 1);
  const used = new Set<number>();
  const items: ReviewReply['items'] = [];
  tasks.forEach((task, i) => {
    if (task.length < 20 || items.length >= MAX_ITEMS) return;
    // The finding it was numbered with, when the numbers line up; else the one whose file it names; else the next.
    const candidates = [
      numbers.length === tasks.length ? numbers[i] : -1,
      found.findIndex((f, n) => !used.has(n) && f.where && task.includes(f.where.split(':')[0])),
      found.findIndex((_, n) => !used.has(n)),
    ];
    const n = candidates.find((c) => c >= 0 && c < found.length && !used.has(c));
    if (n === undefined) return;
    used.add(n);
    items.push({ text: withWhere(task, found[n].where), part: found[n].part });
  });
  if (items.length < Math.min(2, found.length)) return plain;
  const said = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  const say = said ? tidy(unquote(said[1]), 320) : '';
  return { say: say.length > 20 ? `${say} They are on the wall, and waiting on the page when you take the headset off.` : plain.say, items };
}
