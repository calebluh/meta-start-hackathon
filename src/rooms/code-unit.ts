import { highlight, type Language, sectionAt, type Token } from './code-syntax.js';

/**
 * Finding the piece of a file worth showing, and making it fit a card.
 *
 * A card shows a whole unit of code, never a slice cut at an arbitrary line:
 * the function, class or statement that was asked for, from its first line to
 * its last. Units are found by indentation (a unit is its first line plus
 * everything set in further beneath it, and the line that closes it), which
 * holds for any formatted code and needs no parser for each language. A unit
 * too long for the card is folded like in an editor: its inner blocks close
 * up, deepest first, each leaving a line that says how much it hides.
 *
 * Nothing here runs or evaluates the code: it is only ever read as text.
 */

/** Consecutive lines of a file. `first` is the line number of `lines[0]`. */
export interface Chunk {
  first: number;
  lines: string[];
}

/** One row on a code card. */
export interface CodeRow {
  /** The line's number in its file; null on a row that continues a long line or stands for folded lines. */
  no: number | null;
  tokens: Token[];
  kind: 'code' | 'wrap' | 'fold';
  /** The line being talked about. */
  marked?: boolean;
}

/** Infinity for a blank line, so it never counts as set further out than its neighbours. */
const indentOf = (line: string): number => (line.trim() ? /^ */.exec(line)![0].length : Infinity);

/** A line that closes what a line above opened: a bracket, a closing tag, or a word like "end". */
const CLOSER = /^\s*(?:[)\]}]|<\/|(?:end|fi|done|esac)\b)/;
/** A line that leaves something open for the lines below it. */
const OPENS = /(?:[({[]|=>|:|>|\b(?:do|then))\s*(?:(?:\/\/|#).*)?$/;
/** A line at the same depth that carries a statement on: "else:", "except ...:", "catch". */
const CARRIES_ON = /^\s*(?:else|elif|elsif|except|finally|catch|rescue|ensure|when)\b/;
/** Statements that look like a call with a block, but define nothing. */
const CONTROL = /^(?:if|for|while|switch|catch|else|do|try|with|return|await|yield|throw|typeof|new|super|case)\b/;

/** A block with no name of its own is shown whole round one of its lines only if it is shorter than this. */
const BLOCK_LINES = 60;

/** How many times `mark` appears in `line`. */
function count(line: string, mark: string): number {
  return line.split(mark).length - 1;
}

/**
 * The index of the last line of the unit that starts at `start`: every line
 * set in further than it, plus the line that closes it ("}", ");", "end").
 */
export function unitEnd(lines: string[], start: number, language: Language): number {
  const base = indentOf(lines[start]);
  let end = start;
  if (language === 'sql') {
    // A statement runs to its semicolon; a blank line ends it only outside its brackets.
    let depth = 0;
    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim() && depth <= 0) break;
      if (line.trim()) end = i;
      depth += count(line, '(') - count(line, ')');
      if (depth <= 0 && /;\s*(?:--.*)?$/.test(line)) break;
    }
    return end;
  }
  // A string that runs over several lines keeps its own indentation: stay inside it.
  const long = language === 'python' ? ['"""', "'''"] : language === 'js' || language === 'clike' ? ['`'] : [];
  let inside = long.some((q) => count(lines[start], q) % 2 === 1);
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const toggles = long.some((q) => count(line, q) % 2 === 1);
    if (inside) {
      end = i;
      if (toggles) inside = false;
      continue;
    }
    if (toggles) inside = true;
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (indent > base) {
      end = i;
      continue;
    }
    if (indent < base) break;
    if (CLOSER.test(line)) {
      end = i;
      // "} else {" and ") {" close one part and open the next.
      if (OPENS.test(line) && !/^\s*<\//.test(line)) continue;
      break;
    }
    // "else:", or a brace on a line of its own under the signature.
    if (CARRIES_ON.test(line) || (/^\s*\{/.test(line) && end === start)) {
      end = i;
      continue;
    }
    break;
  }
  return end;
}

/** Whether a line starts something with a name or a body of its own: a function, a class, a route, a key with children. */
export function isDefinition(line: string, language: Language): boolean {
  const text = line.trim();
  if (!text) return false;
  switch (language) {
    case 'python':
      return /^(?:async\s+)?(?:def|class)\s+\w+/.test(text);
    case 'ruby':
      return /^(?:def|class|module)\s+\S+/.test(text);
    case 'yaml':
      return /^(?:-\s+)?[^\s#:][^:#]*:\s*(?:#.*|[|>][+-]?)?$/.test(text);
    case 'json':
      return /^"[^"]+"\s*:\s*[{[]\s*$/.test(text);
    case 'sql':
      return /^(?:create|alter|insert|select|update|delete|with|drop)\b/i.test(text);
    case 'css':
      return /\{\s*$/.test(text);
    case 'config':
      return /^\[.*\]$/.test(text);
    case 'text':
      return /^#{1,6}\s/.test(text);
    default:
      break;
  }
  if (language === 'markup' && /^<[A-Za-z]/.test(text)) return true;
  if (language === 'shell' && /^(?:function\s+[\w-]+|[\w-]+\s*\(\))/.test(text)) return true;
  if (CONTROL.test(text)) return false;
  return (
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:function\b|class\b|interface\b|type\s+[\w$]|enum\b|namespace\b|struct\b|trait\b|impl\b|fn\b|func\b|fun\b|mod\b)/.test(text) ||
    /^(?:export\s+)?(?:const|let|var|val)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>|<)/.test(text) ||
    // A named value that opens a block of its own: a settings object, a table, a list.
    /^(?:export\s+)?(?:const|let|var|val)\s+[\w$]+\b[^;]*[{[(]$/.test(text) ||
    /^(?:(?:public|private|protected|internal|static|readonly|async|override|abstract|final|virtual|suspend|get|set)\s+)*[\w$<>[\],.?*&]+\s*(?:<[^>]*>)?\s*\(.*[{(]\s*$/.test(text)
  );
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The index of the line where `name` is defined (a function, class, method, key or table of that name), or -1. */
export function findDefinition(lines: string[], name: string): number {
  const n = escapeRegex(name);
  const patterns = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|interface|type|enum|namespace|def|func|fn|fun|struct|trait|impl|module|const|let|var|val)\\s+${n}(?![\\w$])`),
    new RegExp(`^\\s*func\\s+\\([^)]*\\)\\s+${n}(?![\\w$])`),
    new RegExp(`^\\s*(?:(?:public|private|protected|internal|static|readonly|async|override|abstract|get|set)\\s+)*${n}\\s*(?:<[^>]*>)?\\s*\\(.*(?:[{(:]|=>)\\s*$`),
    new RegExp(`\\b(?:table|view|index|function)\\s+(?:if\\s+not\\s+exists\\s+)?["\`]?${n}(?![\\w$])`, 'i'),
    new RegExp(`^\\s*(?:-\\s+)?["']?${n}["']?\\s*[:=]`),
  ];
  for (const pattern of patterns) {
    const at = lines.findIndex((line) => pattern.test(line));
    if (at >= 0) return at;
  }
  return -1;
}

/** A comment this long or shorter, right above a unit, is shown with it. */
const LEAD_LINES = 4;

/**
 * What sits on the lines just above a unit and belongs with it: its
 * decorators, and a short comment saying what it is for.
 */
function withLead(lines: string[], start: number): number {
  const indent = indentOf(lines[start]);
  let at = start;
  while (at > 0 && /^\s*@[\w.]+/.test(lines[at - 1]) && indentOf(lines[at - 1]) === indent) at -= 1;
  let top = at;
  if (top > 0 && /\*\/\s*$/.test(lines[top - 1])) {
    // A block comment: up to the line that opens it.
    top -= 1;
    while (top > 0 && !/^\s*\/\*/.test(lines[top])) top -= 1;
    if (!/^\s*\/\*/.test(lines[top])) top = at;
  } else {
    while (top > 0 && /^\s*(?:\/\/|#(?!!)|--)/.test(lines[top - 1]) && indentOf(lines[top - 1]) === indent) top -= 1;
  }
  return at - top <= LEAD_LINES ? top : at;
}

/** The unit (first and last index) that starts at `at`. */
export function unitAt(lines: string[], at: number, language: Language): { start: number; end: number } {
  return { start: withLead(lines, at), end: unitEnd(lines, at, language) };
}

/**
 * The smallest named unit that holds line `at`: the function it is in, else
 * the class, else the statement it belongs to.
 */
export function enclosing(lines: string[], at: number, language: Language): { start: number; end: number } {
  let own = indentOf(lines[at]);
  // A blank line belongs with what follows it.
  for (let i = at + 1; own === Infinity && i < lines.length; i += 1) own = indentOf(lines[i]);
  if (own === Infinity) own = 0;
  for (let i = at; i >= 0; i -= 1) {
    const indent = indentOf(lines[i]);
    // A line set in further than everything since cannot hold this one.
    if (indent > own) continue;
    own = indent;
    if (!isDefinition(lines[i], language)) continue;
    const end = unitEnd(lines, i, language);
    if (end >= at) return { start: withLead(lines, i), end };
  }
  // No named unit: the block the line sits in, if it is short enough to take in.
  const depth = indentOf(lines[at]);
  for (let i = at - 1; i >= 0 && Number.isFinite(depth); i -= 1) {
    if (indentOf(lines[i]) >= depth) continue;
    const end = unitEnd(lines, i, language);
    if (end >= at && end - i < BLOCK_LINES) return { start: withLead(lines, i), end };
    break;
  }
  // Else the statement it is part of, or failing that the lines round it.
  let start = at;
  while (start > 0 && (CLOSER.test(lines[start]) || !lines[start].trim())) start -= 1;
  const end = unitEnd(lines, start, language);
  if (end >= at && end > start) return { start, end };
  return { start: Math.max(0, at - 5), end: Math.min(lines.length - 1, at + 9) };
}

/** A short name for the unit that starts with `line`, for the card's title: "runBilling()", "class Bubble", "services". */
export function unitName(line: string, language: Language): string {
  const text = line.trim();
  let m: RegExpExecArray | null;
  if (language === 'yaml' || language === 'json' || language === 'config') {
    m = /^(?:-\s+)?\[?["']?([^"':\]=]+)["']?\]?\s*[:=\]]?/.exec(text);
    return m ? m[1].trim() : '';
  }
  if (language === 'sql') {
    m = /\b(table|view|index|function)\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)/i.exec(text);
    return m ? `${m[1].toLowerCase()} ${m[2]}` : (/^\w+/.exec(text)?.[0].toUpperCase() ?? '');
  }
  if (language === 'markup' && (m = /^<([A-Za-z][\w:.-]*)/.exec(text))) return `<${m[1]}>`;
  if ((m = /\b(class|interface|enum|struct|trait|namespace|module|impl)\s+([A-Za-z_$][\w$]*)/.exec(text))) return `${m[1]} ${m[2]}`;
  if ((m = /\btype\s+([A-Za-z_$][\w$]*)/.exec(text))) return `type ${m[1]}`;
  if ((m = /\b(?:function\s*\*?|def|fn|fun|func(?:\s+\([^)]*\))?)\s+([A-Za-z_$][\w$]*)/.exec(text))) return `${m[1]}()`;
  if ((m = /\b(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/.exec(text))) return `${m[1]}()`;
  if ((m = /\b(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/.exec(text))) return m[1];
  // A call with a name in quotes and a block: a route or a test.
  if ((m = /^([\w$.]+)\(\s*(['"`])([^'"`]{1,40})\2/.exec(text))) return `${m[1]}(${m[2]}${m[3]}${m[2]})`;
  if (!CONTROL.test(text) && (m = /^(?:(?:public|private|protected|internal|static|readonly|async|override|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(text))) return `${m[1]}()`;
  return '';
}

/** Splits a line's tokens into rows no wider than `width`, breaking after a space or a separator where one is near. */
function wrap(tokens: Token[], width: number, hang: number): Token[][] {
  const text = tokens.map((t) => t.text).join('');
  if (text.length <= width) return [tokens];
  // Where each row ends, as an index into the line's text.
  const cuts: number[] = [];
  let from = 0;
  let room = width;
  while (text.length - from > room) {
    let cut = from + room;
    for (let i = cut; i > from + room - 24 && i > from + 8; i -= 1) {
      if (/[\s,;(|&]/.test(text[i - 1])) {
        cut = i;
        break;
      }
    }
    cuts.push(cut);
    from = cut;
    room = Math.max(16, width - hang);
  }
  const rows: Token[][] = [[]];
  let at = 0;
  for (const token of tokens) {
    let rest = token.text;
    while (rest) {
      const limit = cuts[rows.length - 1] ?? Infinity;
      const take = Math.min(rest.length, limit - at);
      if (take <= 0) {
        rows.push([{ text: ' '.repeat(hang), kind: 'plain' }]);
        continue;
      }
      rows[rows.length - 1].push({ text: rest.slice(0, take), kind: token.kind });
      rest = rest.slice(take);
      at += take;
    }
  }
  return rows;
}

/**
 * Where to cut rows that will not all fit: after at most `limit` of them,
 * and between two statements, never through the middle of one. It looks for
 * the last statement that starts within the limit, at the shallowest depth
 * that still keeps most of the rows; a comment goes with the statement
 * under it. Only when one statement alone outruns the card is it cut inside,
 * and then between its lines.
 */
function statementCut(rows: CodeRow[], limit: number): number {
  const text = (row: CodeRow): string => row.tokens.map((t) => t.text).join('');
  const depthOf = (row: CodeRow): number => /^ */.exec(text(row))![0].length;
  const starts = (row: CodeRow): boolean => row.kind === 'code' && text(row).trim() !== '' && !CLOSER.test(text(row)) && !CARRIES_ON.test(text(row));
  const comment = (row: CodeRow): boolean => /^\s*(?:\/\/|\/\*|\*|#|--)/.test(text(row));
  const least = Math.ceil(limit * 0.6);
  const depths = [...new Set(rows.slice(1, limit + 1).filter(starts).map(depthOf))].sort((a, b) => a - b);
  for (const depth of depths) {
    for (let i = Math.min(limit, rows.length - 1); i >= least; i -= 1) {
      if (!starts(rows[i]) || depthOf(rows[i]) > depth || comment(rows[i])) continue;
      // The comment above a statement, and the blank row above that, go with it.
      let cut = i;
      while (cut > 1) {
        let above = cut - 1;
        while (above > 0 && rows[above].kind === 'wrap') above -= 1;
        if (!comment(rows[above]) && text(rows[above]).trim()) break;
        cut = above;
      }
      if (cut >= least) return cut;
    }
  }
  let cut = Math.min(limit, rows.length);
  while (cut > 1 && rows[cut]?.kind === 'wrap') cut -= 1;
  return cut;
}

export interface Fitted {
  rows: CodeRow[];
  /** The widest row, in characters. */
  cols: number;
  /** Inner blocks were closed up, or the end was cut off, to fit. */
  shortened: boolean;
}

const lineWord = (n: number): string => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** Code is folded to fit only while no more than this share of its lines is hidden. */
const FOLD_MOST = 0.4;

/**
 * The rows for lines `start` to `end` of a chunk: coloured, set flush left,
 * long lines wrapped, and no more than `maxRows` of them. `mark` is the
 * number of a line to light up and never fold away. `outline` is for a class
 * or the like, where the shape matters more than any one body: its inner
 * blocks close up as far as it takes.
 */
export function fit(
  chunk: Chunk,
  start: number,
  end: number,
  language: Language,
  limits: { maxRows: number; maxCols: number; mark?: number; outline?: boolean; fold?: boolean },
): Fitted {
  let last = end;
  while (last > start && !chunk.lines[last].trim()) last -= 1;
  // Read straight through, only the top is ever shown: a long file's other lines need no colouring.
  const until = limits.fold === false ? Math.min(last, start + limits.maxRows + 1) : last;
  const source = chunk.lines.slice(start, until + 1);
  const base = Math.min(...source.map(indentOf));
  const lines = source.map((l) => (l.trim() ? l.slice(Number.isFinite(base) ? base : 0) : ''));
  const tokens = highlight(lines, language, language === 'markup' ? sectionAt(chunk.lines, start) : 'markup');
  const indents = lines.map(indentOf);
  const markAt = limits.mark === undefined ? -1 : limits.mark - chunk.first - start;

  // Lines the folding must leave alone: the marked one, a little either side, and the lines it sits inside.
  const kept = new Set<number>();
  if (markAt >= 0 && markAt < lines.length) {
    for (let i = Math.max(0, markAt - 2); i <= Math.min(lines.length - 1, markAt + 2); i += 1) kept.add(i);
    let depth = indents[markAt];
    for (let i = markAt; i >= 0; i -= 1) {
      if (indents[i] < depth) {
        depth = indents[i];
        kept.add(i);
      }
    }
  }

  /** The rows with every line set in further than `depth` folded away, and how many lines that hides. */
  const build = (depth: number): { rows: CodeRow[]; shortened: boolean; hidden: number } => {
    const rows: CodeRow[] = [];
    let shortened = false;
    let blank = false;
    let hiddenLines = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i]) {
        // One blank row between parts is enough.
        if (!blank && rows.length) rows.push({ no: chunk.first + start + i, tokens: [{ text: '', kind: 'plain' }], kind: 'code' });
        blank = true;
        continue;
      }
      blank = false;
      if (indents[i] > depth && !kept.has(i)) {
        // A run of deeper lines closes up into one row, unless it is a single line.
        let to = i;
        while (to + 1 < lines.length && (!lines[to + 1] || indents[to + 1] > depth) && !kept.has(to + 1)) to += 1;
        while (to > i && !lines[to]) to -= 1;
        const hidden = lines.slice(i, to + 1).filter(Boolean).length;
        // Closing up two lines saves one row and hides two: not worth a fold.
        if (hidden > 2) {
          rows.push({ no: null, tokens: [{ text: `${' '.repeat(indents[i])}… ${lineWord(hidden)}`, kind: 'comment' }], kind: 'fold' });
          shortened = true;
          hiddenLines += hidden;
          i = to;
          continue;
        }
      }
      const wrapped = wrap(tokens[i], limits.maxCols, Math.min(indents[i] + 4, limits.maxCols - 16));
      wrapped.forEach((row, r) => rows.push({ no: r === 0 ? chunk.first + start + i : null, tokens: row, kind: r === 0 ? 'code' : 'wrap', marked: i === markAt }));
    }
    return { rows, shortened, hidden: hiddenLines };
  };

  // Whole if it fits. If not, close up its inner blocks, deepest first, until
  // it does: always for an outline (a class shows its members), but for code
  // only while most of it stays in view. Past that, folding hides what was
  // asked for, and the top of it with a count of the rest reads better.
  const depths = [...new Set(indents.filter(Number.isFinite))].sort((a, b) => b - a);
  const total = lines.filter(Boolean).length;
  let built = build(Infinity);
  // (`fold: false` is for reading straight through: the top of a file, or the next part of one.)
  if (built.rows.length > limits.maxRows && limits.fold !== false) {
    for (const depth of depths.slice(1, -1)) {
      const folded = build(depth);
      if (!limits.outline && folded.hidden > total * FOLD_MOST) break;
      if (limits.outline) built = folded;
      if (folded.rows.length <= limits.maxRows) {
        built = folded;
        break;
      }
    }
  }
  let { rows } = built;
  let { shortened } = built;
  if (rows.length > limits.maxRows || until < last) {
    // Still too long: keep the top, or the first line and then the part round the marked line.
    shortened = true;
    const all = rows;
    const fold = (text: string): CodeRow => ({ no: null, tokens: [{ text, kind: 'comment' }], kind: 'fold' });
    /** The number of the last line shown in `list`. */
    const lastShown = (list: CodeRow[]): number => Math.max(chunk.first + start, ...list.map((r) => r.no ?? 0));
    const finalLine = chunk.first + last;
    const markRow = all.findIndex((r) => r.marked);
    if (markRow < limits.maxRows - 2) {
      rows = all.slice(0, statementCut(all, Math.min(limits.maxRows - 1, all.length)));
      rows.push(fold(`… ${lineWord(finalLine - lastShown(rows))} more`));
    } else {
      const room = limits.maxRows - 3;
      const from = Math.min(Math.max(1, markRow - Math.floor(room / 2)), all.length - room);
      const window = all.slice(from, from + room);
      const firstShown = window.find((r) => r.no !== null)?.no ?? finalLine;
      rows = [all[0], fold(`… ${lineWord(firstShown - (all[0].no ?? firstShown) - 1)}`), ...window];
      if (finalLine > lastShown(window)) rows.push(fold(`… ${lineWord(finalLine - lastShown(window))} more`));
    }
  }
  const cols = Math.max(...rows.map((r) => r.tokens.reduce((n, t) => n + t.text.length, 0)));
  return { rows, cols, shortened };
}
