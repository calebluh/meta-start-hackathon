// Reads the sample project's code (public/maps/larder/code.txt) and writes what
// the Larder map carries about it: each file's function and class names with
// their lines, and the lines round each warning (src/maps/larder-code.json);
// and the code itself as runs of lines for the server (server/larder-source.json).
// The same facts scripts/build-map.mjs reads from a real repository.
//
//   node scripts/larder-code.mjs          refresh the JSON
//   node scripts/larder-code.mjs --check  fail if it is out of date or the code breaks a rule
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = path.join(root, 'public', 'maps', 'larder', 'code.txt');
const MAP = path.join(root, 'src', 'maps', 'larder.ts');
const OUT = path.join(root, 'src', 'maps', 'larder-code.json');
/** The same code as runs of lines, for the server: a robot asked about a file is given its lines to read (server/code-context.ts). */
const SOURCE = path.join(root, 'server', 'larder-source.json');
/** Lines longer than this wrap on a code card. */
const WIDE = 70;
const EXCERPT_RADIUS = 10;

const DEFINITIONS = [
  /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
  /^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /^class\s+([A-Za-z_$][\w$]*)/,
];

/** "=== path" starts a file; "@@ 24" starts a run of lines at line 24. */
function parse(text) {
  const files = new Map();
  let chunks = null;
  let chunk = null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
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
  for (const list of files.values()) for (const c of list) while (c.lines.length && !c.lines[c.lines.length - 1].trim()) c.lines.pop();
  return files;
}

const files = parse(readFileSync(CODE, 'utf8'));
const map = readFileSync(MAP, 'utf8');
// [path, owner, name, description, lines] rows of the map.
const loc = new Map([...map.matchAll(/^\s*\['([^']+)', '[^']+', '[^']+', (?:'(?:[^'\\]|\\.)*'|"[^"]*"), (\d+)\],$/gm)].map((m) => [m[1], Number(m[2])]));
// Warnings: { file: '...', line: 12 }.
const warnings = [...map.matchAll(/locations: \[\{ file: '([^']+)', line: (\d+) \}\]/g)].map((m) => ({ file: m[1], line: Number(m[2]) }));

const problems = [];
const exportsOf = {};
for (const [p, chunks] of files) {
  if (!loc.has(p)) problems.push(`${p}: not a file of the map`);
  const names = [];
  let end = 0;
  for (const chunk of chunks) {
    if (chunk.first <= end) problems.push(`${p}: the run at line ${chunk.first} overlaps the one before it`);
    end = chunk.first + chunk.lines.length - 1;
    if (loc.has(p) && end > loc.get(p)) problems.push(`${p}: runs to line ${end}, but the map says the file has ${loc.get(p)} lines`);
    chunk.lines.forEach((line, i) => {
      if (line.length > WIDE) problems.push(`${p}:${chunk.first + i} is ${line.length} characters wide (over ${WIDE})`);
      for (const re of DEFINITIONS) {
        const m = re.exec(line);
        if (m && !names.some((n) => n.startsWith(`${m[1]} L`))) {
          names.push(`${m[1]} L${chunk.first + i}`);
          break;
        }
      }
    });
  }
  if (names.length) exportsOf[p] = names;
}
for (const p of loc.keys()) if (!files.has(p)) problems.push(`${p}: the map lists it, but it has no code`);

/** The lines round a warning, numbered, the flagged one marked ">". */
const excerpts = {};
for (const { file, line } of warnings) {
  const chunk = (files.get(file) ?? []).find((c) => line >= c.first && line < c.first + c.lines.length);
  if (!chunk) {
    problems.push(`${file}: no code at line ${line}, where its warning is`);
    continue;
  }
  const from = Math.max(chunk.first, line - EXCERPT_RADIUS);
  const to = Math.min(chunk.first + chunk.lines.length - 1, line + EXCERPT_RADIUS);
  const width = String(to).length;
  excerpts[`${file}:${line}`] = chunk.lines
    .slice(from - chunk.first, to - chunk.first + 1)
    .map((l, i) => `${from + i === line ? '>' : ' '}${String(from + i).padStart(width)} ${l}`.trimEnd())
    .join('\n');
}

const out = `${JSON.stringify({ exports: exportsOf, excerpts }, null, 2)}\n`;
const source = `${JSON.stringify(Object.fromEntries(files), null, 1)}\n`;
const lines = [...files.values()].flat().reduce((n, c) => n + c.lines.length, 0);
console.log(`${files.size} files, ${lines} lines of sample code, ${Object.values(exportsOf).flat().length} names, ${Object.keys(excerpts).length} warning excerpts`);
for (const problem of problems) console.error(`problem: ${problem}`);
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8').replace(/\r/g, '');
  } catch {
    // no file yet
  }
  let currentSource = '';
  try {
    currentSource = readFileSync(SOURCE, 'utf8').replace(/\r/g, '');
  } catch {
    // no file yet
  }
  if (current !== out || currentSource !== source) {
    console.error('src/maps/larder-code.json or server/larder-source.json is out of date: run node scripts/larder-code.mjs');
    process.exit(1);
  }
  process.exit(problems.length ? 1 : 0);
}
writeFileSync(OUT, out);
writeFileSync(SOURCE, source);
console.log(`wrote ${path.relative(root, OUT)} and ${path.relative(root, SOURCE)}`);
process.exit(problems.length ? 1 : 0);
