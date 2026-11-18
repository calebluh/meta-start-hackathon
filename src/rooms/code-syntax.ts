/**
 * Colours for code on a card: splits each line into tokens by what they are
 * (a keyword, a string, a comment, the name of a function). One small
 * tokenizer per family of languages, not a parser: it only has to make real
 * code easy on the eye. A string or a comment may run on to the next line;
 * nothing else is remembered between lines.
 */

export type TokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'key' | 'punct' | 'meta';

export interface Token {
  text: string;
  kind: TokenKind;
}

export type Language = 'js' | 'python' | 'yaml' | 'json' | 'sql' | 'shell' | 'docker' | 'markup' | 'css' | 'clike' | 'ruby' | 'config' | 'text';

const EXTENSIONS: Record<string, [Language, string]> = {
  js: ['js', 'JavaScript'],
  jsx: ['js', 'JavaScript'],
  mjs: ['js', 'JavaScript'],
  cjs: ['js', 'JavaScript'],
  ts: ['js', 'TypeScript'],
  tsx: ['js', 'TypeScript'],
  mts: ['js', 'TypeScript'],
  cts: ['js', 'TypeScript'],
  py: ['python', 'Python'],
  pyi: ['python', 'Python'],
  yml: ['yaml', 'YAML'],
  yaml: ['yaml', 'YAML'],
  json: ['json', 'JSON'],
  jsonc: ['json', 'JSON'],
  sql: ['sql', 'SQL'],
  sh: ['shell', 'Shell'],
  bash: ['shell', 'Shell'],
  zsh: ['shell', 'Shell'],
  html: ['markup', 'HTML'],
  htm: ['markup', 'HTML'],
  xml: ['markup', 'XML'],
  svg: ['markup', 'SVG'],
  vue: ['markup', 'Vue'],
  svelte: ['markup', 'Svelte'],
  astro: ['markup', 'Astro'],
  uikitml: ['markup', 'UIKitML'],
  css: ['css', 'CSS'],
  scss: ['css', 'SCSS'],
  less: ['css', 'Less'],
  go: ['clike', 'Go'],
  rs: ['clike', 'Rust'],
  java: ['clike', 'Java'],
  kt: ['clike', 'Kotlin'],
  kts: ['clike', 'Kotlin'],
  c: ['clike', 'C'],
  h: ['clike', 'C'],
  cc: ['clike', 'C++'],
  cpp: ['clike', 'C++'],
  hpp: ['clike', 'C++'],
  cs: ['clike', 'C#'],
  swift: ['clike', 'Swift'],
  php: ['clike', 'PHP'],
  dart: ['clike', 'Dart'],
  scala: ['clike', 'Scala'],
  rb: ['ruby', 'Ruby'],
  toml: ['config', 'TOML'],
  ini: ['config', 'INI'],
  env: ['config', 'Env'],
  cfg: ['config', 'Config'],
  conf: ['config', 'Config'],
  properties: ['config', 'Config'],
  md: ['text', 'Markdown'],
  txt: ['text', 'Text'],
};

/** The family of languages a file is written in, and the name to show for it, from its path. */
export function languageOf(path: string): { language: Language; name: string } {
  const base = path.split('/').pop() ?? path;
  if (/^Dockerfile(\..+)?$/i.test(base) || /\.dockerfile$/i.test(base)) return { language: 'docker', name: 'Dockerfile' };
  if (/^Makefile$/i.test(base)) return { language: 'shell', name: 'Makefile' };
  const ext = /\.([A-Za-z0-9]+)$/.exec(base)?.[1].toLowerCase() ?? '';
  const known = EXTENSIONS[ext];
  return known ? { language: known[0], name: known[1] } : { language: 'text', name: ext ? ext.toUpperCase() : 'Text' };
}

const words = (list: string): Set<string> => new Set(list.split(' '));

const SINGLE = "'";
const DOUBLE = '"';
const BACKTICK = '`';

interface Rules {
  keywords: Set<string>;
  types?: Set<string>;
  /** Markers that start a comment running to the end of the line. */
  line: string[];
  block?: [string, string];
  /** Quotes of strings that end on their own line, and of strings that may run on to the next. */
  quotes: string[];
  long?: string[];
  /** Keywords are matched whatever their case (SQL). */
  caseless?: boolean;
  /** Names may hold dashes, and a name before a colon is a property (CSS). */
  dashes?: boolean;
  /** "@name" is a decorator or an at-rule. */
  at?: boolean;
  /** "$NAME" is a variable (shell). */
  dollar?: boolean;
  /** A "/" where a value is expected starts a regular expression (JavaScript). */
  regex?: boolean;
}

const RULES: Partial<Record<Language, Rules>> = {
  js: {
    keywords: words(
      'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface is keyof let namespace new of private protected public readonly return satisfies set static super switch this throw try type typeof var void while yield',
    ),
    line: ['//'],
    block: ['/*', '*/'],
    quotes: [SINGLE, DOUBLE],
    long: [BACKTICK],
    at: true,
    regex: true,
  },
  python: {
    keywords: words(
      'and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield',
    ),
    line: ['#'],
    quotes: [SINGLE, DOUBLE],
    long: [DOUBLE.repeat(3), SINGLE.repeat(3)],
    at: true,
  },
  clike: {
    keywords: words(
      'abstract as async await break case catch class const continue default defer do else enum export extends final finally fn for func fun go goto if impl implements import in interface internal let loop match mod mut namespace new override package private protected pub public return static struct super switch this throw throws trait try type typeof use using val var virtual void where while yield',
    ),
    types: words('bool boolean byte char double float int long short string uint usize isize i32 i64 u8 u32 u64 f32 f64'),
    line: ['//'],
    block: ['/*', '*/'],
    quotes: [SINGLE, DOUBLE],
    long: [BACKTICK],
    at: true,
  },
  ruby: {
    keywords: words(
      'alias and begin break case class def do else elsif end ensure for if in module next not or redo require rescue retry return self super then unless until when while yield',
    ),
    line: ['#'],
    quotes: [SINGLE, DOUBLE],
    at: true,
  },
  sql: {
    keywords: words(
      'ADD ALTER AND AS ASC BEGIN BETWEEN BY CASCADE CASE CHECK COLUMN COMMIT CONSTRAINT CREATE CROSS DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FOREIGN FROM FULL GROUP HAVING IF IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT ON OR ORDER OUTER PRIMARY REFERENCES RETURNING RIGHT ROLLBACK SELECT SET TABLE THEN UNION UNIQUE UPDATE VALUES VIEW WHEN WHERE WITH',
    ),
    types: words('BIGINT BOOLEAN DATE DECIMAL INT INTEGER JSON JSONB NUMERIC SERIAL SMALLINT TEXT TIME TIMESTAMP TIMESTAMPTZ UUID VARCHAR'),
    line: ['--'],
    block: ['/*', '*/'],
    quotes: [SINGLE, DOUBLE],
    caseless: true,
  },
  shell: {
    keywords: words('case cd do done echo elif else esac exit export fi for function if in local readonly return set source then unset until while'),
    line: ['#'],
    quotes: [SINGLE, DOUBLE],
    dollar: true,
  },
  docker: {
    keywords: words('ADD ARG AS CMD COPY ENTRYPOINT ENV EXPOSE FROM HEALTHCHECK LABEL ONBUILD RUN SHELL STOPSIGNAL USER VOLUME WORKDIR'),
    line: ['#'],
    quotes: [SINGLE, DOUBLE],
    dollar: true,
  },
  css: {
    keywords: words('important'),
    line: [],
    block: ['/*', '*/'],
    quotes: [SINGLE, DOUBLE],
    dashes: true,
    at: true,
  },
  json: { keywords: new Set(), line: ['//'], block: ['/*', '*/'], quotes: [DOUBLE] },
};

/** Values written as words. */
const CONSTANTS = words('true false null undefined None True False NaN Infinity nil TRUE FALSE NULL');
/** After one of these, a "/" starts a regular expression rather than dividing. */
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const WORDS_BEFORE_REGEX = words('return typeof case in of delete void throw');
/** A name being given a function: "name = (a, b) =>", "name = async function", "name: Handler = (x) =>". */
const ASSIGNED_FUNCTION = /^\s*(?::[^=;(]+)?=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>)/;

/** What is still open at the end of a line: a comment or a string that runs on, or which part of a page we are in. */
interface Carry {
  open: { end: string; kind: TokenKind } | null;
  /** Pages only: inside a tag's angle brackets. */
  tag: boolean;
  /** Pages only: the part of the page this line is in. */
  section: 'markup' | 'js' | 'css';
}

function add(out: Token[], text: string, kind: TokenKind): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

/** Where a quoted string that starts at the front of `rest` ends (one past its closing quote, or the end of the line). */
function quotedLength(rest: string): number {
  let j = 1;
  while (j < rest.length && rest[j] !== rest[0]) j += rest[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, rest.length);
}

/** One line of a language with keywords, strings and comments. */
function scan(line: string, rules: Rules, carry: Carry): Token[] {
  const out: Token[] = [];
  // The last character and keyword that were not spaces, to tell a property from a keyword and a regex from a division.
  let before = '';
  let beforeWord = '';
  let i = 0;
  const take = (text: string, kind: TokenKind) => {
    add(out, text, kind);
    i += text.length;
    before = text[text.length - 1];
    beforeWord = kind === 'keyword' ? text : '';
  };
  while (i < line.length) {
    if (carry.open) {
      const at = line.indexOf(carry.open.end, i);
      if (at < 0) {
        add(out, line.slice(i), carry.open.kind);
        return out;
      }
      take(line.slice(i, at + carry.open.end.length), carry.open.kind);
      carry.open = null;
      continue;
    }
    const rest = line.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      add(out, space[0], 'plain');
      i += space[0].length;
      continue;
    }
    if (rules.block && rest.startsWith(rules.block[0])) {
      carry.open = { end: rules.block[1], kind: 'comment' };
      add(out, rules.block[0], 'comment');
      i += rules.block[0].length;
      continue;
    }
    if (before !== '\\' && rules.line.some((m) => rest.startsWith(m))) {
      add(out, rest, 'comment');
      return out;
    }
    const long = rules.long?.find((q) => rest.startsWith(q));
    if (long) {
      carry.open = { end: long, kind: 'string' };
      add(out, long, 'string');
      i += long.length;
      before = long;
      continue;
    }
    if (rules.quotes.includes(rest[0])) {
      take(rest.slice(0, quotedLength(rest)), 'string');
      continue;
    }
    if (rules.regex && rest[0] === '/' && (BEFORE_REGEX.has(before) || WORDS_BEFORE_REGEX.has(beforeWord))) {
      const regex = /^\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+\/[dgimsuvy]*/.exec(rest);
      if (regex) {
        take(regex[0], 'string');
        continue;
      }
    }
    if (rules.at && rest[0] === '@') {
      const at = /^@[A-Za-z_][\w.-]*/.exec(rest);
      if (at) {
        take(at[0], 'meta');
        continue;
      }
    }
    if (rules.dollar && rest[0] === '$') {
      const variable = /^\$(?:\{[^}]*\}|[\w@#?*!]+)/.exec(rest);
      if (variable) {
        take(variable[0], 'meta');
        continue;
      }
    }
    const word = (rules.dashes ? /^-{0,2}[A-Za-z_][\w-]*/ : /^[A-Za-z_$][\w$]*/).exec(rest);
    if (word) {
      const text = word[0];
      const after = rest.slice(text.length);
      const next = /^\s*(.)/.exec(after)?.[1] ?? '';
      const key = rules.caseless ? text.toUpperCase() : text;
      let kind: TokenKind = 'plain';
      if (before !== '.' && rules.keywords.has(key)) kind = 'keyword';
      else if (rules.types?.has(key)) kind = 'type';
      else if (CONSTANTS.has(text)) kind = 'number';
      else if (rules.dashes) kind = /^\s*:\s/.test(after) ? 'key' : 'plain';
      else if (next === '(' || (rules.regex && ASSIGNED_FUNCTION.test(after))) kind = /^[A-Z]/.test(text) && /[a-z]/.test(text) ? 'type' : 'function';
      else if (/^[A-Z][A-Z0-9_]+$/.test(text)) kind = 'number';
      else if (/^[A-Z]/.test(text)) kind = 'type';
      take(text, kind);
      continue;
    }
    const number = /^(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[A-Za-z%]*/.exec(rest);
    if (number) {
      take(number[0], 'number');
      continue;
    }
    take(rest[0], 'punct');
  }
  return out;
}

/** A value on its own: quoted, a number or a word like "true", or plain text (which in YAML is a string). */
function scalar(out: Token[], text: string): void {
  let rest = text;
  while (rest) {
    const space = /^\s+/.exec(rest);
    if (space) {
      add(out, space[0], 'plain');
      rest = rest.slice(space[0].length);
      continue;
    }
    if (rest[0] === '#') {
      add(out, rest, 'comment');
      return;
    }
    if (rest[0] === DOUBLE || rest[0] === SINGLE) {
      const length = quotedLength(rest);
      add(out, rest.slice(0, length), 'string');
      rest = rest.slice(length);
      continue;
    }
    // Up to a comment, which needs a space before its "#".
    const end = /\s#/.exec(rest)?.index ?? rest.length;
    const value = rest.slice(0, end);
    const trimmed = value.trim();
    let kind: TokenKind = 'string';
    if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(trimmed) || /^-?\d[\d_.]*(?:[eE][+-]?\d+)?$/.test(trimmed)) kind = 'number';
    else if (/^[|>][+-]?\d*$/.test(trimmed) || /^[[\]{},]+$/.test(trimmed)) kind = 'punct';
    else if (/^[&*!][\w-]+$/.test(trimmed)) kind = 'meta';
    add(out, value, kind);
    rest = rest.slice(end);
  }
}

function yamlLine(line: string): Token[] {
  const out: Token[] = [];
  const lead = /^\s*(?:-\s+)*(?:-$)?/.exec(line)![0];
  add(out, lead, 'punct');
  let rest = line.slice(lead.length);
  const key = /^("[^"]*"|'[^']*'|[^\s#:,[\]{}&*!|>'"%@`][^:#]*?)(\s*:)(?=\s|$)/.exec(rest);
  if (key) {
    add(out, key[1], 'key');
    add(out, key[2], 'punct');
    rest = rest.slice(key[0].length);
  }
  scalar(out, rest);
  return out;
}

function configLine(line: string): Token[] {
  if (/^\s*[#;]/.test(line)) return [{ text: line, kind: 'comment' }];
  if (/^\s*\[.*\]\s*$/.test(line)) return [{ text: line, kind: 'type' }];
  const pair = /^(\s*(?:export\s+)?)([\w.-]+)(\s*[=:]\s*)(.*)$/.exec(line);
  if (!pair) return [{ text: line, kind: 'plain' }];
  const out: Token[] = [];
  add(out, pair[1], 'keyword');
  add(out, pair[2], 'key');
  add(out, pair[3], 'punct');
  scalar(out, pair[4]);
  return out;
}

function textLine(line: string): Token[] {
  if (/^\s*#{1,6}\s/.test(line)) return [{ text: line, kind: 'keyword' }];
  const bullet = /^(\s*(?:[-*+]|\d+\.)\s)(.*)$/.exec(line);
  return bullet
    ? [
        { text: bullet[1], kind: 'punct' },
        { text: bullet[2], kind: 'plain' },
      ]
    : [{ text: line, kind: 'plain' }];
}

/** A line of a page: tags, their attributes and the text between; script and style parts in their own colours. */
function markupLine(line: string, carry: Carry): Token[] {
  if (carry.section !== 'markup') {
    // A script or style block runs until its closing tag.
    if (carry.open || !/^\s*<\/(script|style)\b/i.test(line)) return scan(line, RULES[carry.section]!, carry);
    carry.section = 'markup';
  }
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (carry.open) {
      const at = rest.indexOf(carry.open.end);
      const text = at < 0 ? rest : rest.slice(0, at + carry.open.end.length);
      add(out, text, carry.open.kind);
      i += text.length;
      if (at >= 0) carry.open = null;
      continue;
    }
    if (carry.tag) {
      const space = /^\s+/.exec(rest);
      const end = /^\/?>/.exec(rest);
      const name = /^[^\s=>/"']+/.exec(rest);
      let length = 1;
      if (space) {
        add(out, space[0], 'plain');
        length = space[0].length;
      } else if (end) {
        add(out, end[0], 'punct');
        length = end[0].length;
        carry.tag = false;
      } else if (rest[0] === DOUBLE || rest[0] === SINGLE) {
        const close = rest.indexOf(rest[0], 1);
        length = close < 0 ? rest.length : close + 1;
        add(out, rest.slice(0, length), 'string');
      } else if (name) {
        add(out, name[0], 'number');
        length = name[0].length;
      } else add(out, rest[0], 'punct');
      i += length;
      continue;
    }
    if (rest.startsWith('<!--')) {
      carry.open = { end: '-->', kind: 'comment' };
      continue;
    }
    const tag = /^(<\/?)([A-Za-z][\w:.-]*)/.exec(rest);
    if (tag) {
      add(out, tag[1], 'punct');
      add(out, tag[2], 'key');
      i += tag[0].length;
      carry.tag = true;
      // What follows an opening script or style tag is code, from the next line on.
      if (tag[1] === '<' && /^(script|style)$/i.test(tag[2])) carry.section = tag[2].toLowerCase() === 'script' ? 'js' : 'css';
      continue;
    }
    const text = /^[^<]+/.exec(rest)?.[0] ?? rest[0];
    add(out, text, 'plain');
    i += text.length;
  }
  return out;
}

/** In a page (HTML, Vue), which part the line at `index` is in: its markup, a script or a style block. */
export function sectionAt(lines: string[], index: number): 'markup' | 'js' | 'css' {
  for (let i = Math.min(index, lines.length) - 1; i >= 0; i -= 1) {
    const m = /^\s*<(\/?)(script|style|template)\b/i.exec(lines[i]);
    if (!m) continue;
    if (m[1] || m[2].toLowerCase() === 'template') return 'markup';
    return m[2].toLowerCase() === 'script' ? 'js' : 'css';
  }
  return 'markup';
}

/**
 * The tokens of each line, in order. `section` says where in a page the first
 * line is (see sectionAt); other languages ignore it.
 */
export function highlight(lines: string[], language: Language, section: 'markup' | 'js' | 'css' = 'markup'): Token[][] {
  const carry: Carry = { open: null, tag: false, section };
  const rules = RULES[language];
  return lines.map((line) => {
    let tokens: Token[];
    if (language === 'yaml') tokens = yamlLine(line);
    else if (language === 'config') tokens = configLine(line);
    else if (language === 'markup') tokens = markupLine(line, carry);
    else if (rules) tokens = scan(line, rules, carry);
    else tokens = textLine(line);
    // In JSON a string before a colon is a key.
    if (language === 'json') {
      tokens.forEach((t, i) => {
        if (t.kind !== 'string') return;
        const after = tokens
          .slice(i + 1)
          .map((n) => n.text)
          .join('');
        if (/^\s*:/.test(after)) t.kind = 'key';
      });
    }
    return tokens.length ? tokens : [{ text: '', kind: 'plain' as TokenKind }];
  });
}
