#!/usr/bin/env node
// Builds a Floorplan-style graph (floorplan/graph@1) for a codebase snapshot,
// for maps we author ourselves instead of running the Floorplan plugin.
//
// It only READS the snapshot: lists code files, counts lines, extracts
// Python and JS/Vue imports, links outside services by the packages imported,
// and matches frontend HTTP calls to backend routes. Names, descriptions,
// part summaries, flows and health notes come from a hand-written
// architecture file (see --arch).
//
// usage: node scripts/build-map.mjs <repo dir> --arch <arch.json> --map <config.mjs> --out <graph.json>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const repo = path.resolve(args[0]);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const arch = JSON.parse(fs.readFileSync(opt('arch'), 'utf8'));
const config = (await import(pathToFileURL(path.resolve(opt('map'))).href)).default;
const out = path.resolve(opt('out'));

// ------------------------------------------------------------- files

const posix = (p) => p.split(path.sep).join('/');
function walk(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else list.push(posix(path.relative(repo, full)));
  }
  return list;
}
const globToRegex = (glob) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        // Placeholders first, so a converted ** isn't converted again as *.
        .replace(/\*\*\//g, '\u0001')
        .replace(/\*\*/g, '\u0002')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0001/g, '(?:.*/)?')
        .replace(/\u0002/g, '.*') +
      '$',
  );
const include = config.include.map(globToRegex);
const files = walk(repo).filter((p) => include.some((re) => re.test(p))).sort();
const text = new Map(files.map((p) => [p, fs.readFileSync(path.join(repo, p), 'utf8')]));
const loc = (p) => text.get(p).split('\n').filter((l) => l.trim()).length;

// Each file goes to the first node whose globs match (list specific parts first).
const owner = new Map();
for (const p of files) {
  const node = config.nodes.find((n) => (n.paths ?? []).some((g) => globToRegex(g).test(p)));
  if (!node) throw new Error(`no node claims ${p}`);
  owner.set(p, node.id);
}

// ----------------------------------------------------------- imports

const links = new Map();
const addLink = (a, b, k, label) => {
  if (a === b) return;
  const key = `${a}|${b}|${k}`;
  const l = links.get(key) ?? { a, b, k, w: 0 };
  l.w += 1;
  if (label) {
    l.labels = l.labels ?? [];
    if (!l.labels.includes(label)) l.labels.push(label);
  }
  links.set(key, l);
};
const fileSet = new Set(files);

function resolvePython(from, module, level) {
  const root = config.python.root; // e.g. 'backend'
  let base;
  if (level > 0) {
    base = path.posix.dirname(from);
    for (let i = 1; i < level; i += 1) base = path.posix.dirname(base);
  } else base = root;
  const rel = module ? module.split('.').join('/') : '';
  const stem = rel ? `${base}/${rel}` : base;
  for (const cand of [`${stem}.py`, `${stem}/__init__.py`]) if (fileSet.has(cand)) return cand;
  return null;
}

for (const p of files) {
  const src = text.get(p);
  if (p.endsWith('.py')) {
    const lines = src.split('\n');
    for (const line of lines) {
      let m = line.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)/);
      if (m) {
        const level = m[1].length;
        const target = resolvePython(p, m[2], level);
        // "from . import x" or "from .pkg import mod": the imported names may be modules.
        const names = m[3].replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
        let linked = false;
        for (const name of names) {
          const sub = resolvePython(p, m[2] ? `${m[2]}.${name}` : name, level);
          if (sub) {
            addLink(`f:${p}`, `f:${sub}`, 'import');
            linked = true;
          }
        }
        if (!linked && target) addLink(`f:${p}`, `f:${target}`, 'import');
        if (!linked && !target && level === 0) {
          const ext = config.packages.find((x) => x.match.test(m[2]));
          if (ext) addLink(`f:${p}`, `n:${ext.node}`, 'import');
        }
        continue;
      }
      m = line.match(/^\s*import\s+([\w.]+)/);
      if (m) {
        const target = resolvePython(p, m[1], 0);
        if (target) addLink(`f:${p}`, `f:${target}`, 'import');
        else {
          const ext = config.packages.find((x) => x.match.test(m[1]));
          if (ext) addLink(`f:${p}`, `n:${ext.node}`, 'import');
        }
      }
    }
  } else {
    for (const m of src.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      let base = null;
      if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(p), spec);
      else if (spec.startsWith('@/')) base = `${config.js.alias}/${spec.slice(2)}`;
      if (base) {
        const cand = [base, `${base}.js`, `${base}.ts`, `${base}.vue`, `${base}/index.js`, `${base}/index.ts`].find((c) => fileSet.has(c));
        if (cand) addLink(`f:${p}`, `f:${cand}`, 'import');
      } else {
        const ext = config.packages.find((x) => x.match.test(spec));
        if (ext) addLink(`f:${p}`, `n:${ext.node}`, 'import');
      }
    }
  }
}

// ---------------------------------------------- frontend -> backend HTTP

const normalize = (p) =>
  p
    .replace(/\$\{[^}]+\}/g, ':x')
    .replace(/<[^>]+>/g, ':x')
    .replace(/:\w+/g, ':x')
    .replace(/\/+$/, '');
const routes = (arch.routes ?? []).map((r) => ({ ...r, key: `${r.method.toUpperCase()} ${normalize(r.path)}` }));
let matched = 0;
for (const call of arch.frontendCalls ?? []) {
  const key = `${call.method.toUpperCase()} ${normalize(call.path)}`;
  const route = routes.find((r) => r.key === key);
  if (!route || !fileSet.has(call.file) || !fileSet.has(route.file)) continue;
  addLink(`f:${call.file}`, `f:${route.file}`, 'http', `${route.method.toUpperCase()} ${route.path}`);
  matched += 1;
}

// Connections the code can't show (calls to services through config or IPC).
for (const e of config.extraLinks ?? []) addLink(e.from, e.to, e.kind, e.label);

// ------------------------------------------------------------- output

const describe = arch.files ?? {};
const missing = files.filter((p) => !describe[p]);
const stats = new Map(config.nodes.map((n) => [n.id, { files: 0, loc: 0 }]));
for (const p of files) {
  const s = stats.get(owner.get(p));
  s.files += 1;
  s.loc += loc(p);
}

const graph = {
  schema: 'floorplan/graph@1',
  project: { name: config.name, summary: arch.projectSummary ?? config.summary, logo: config.logo },
  source: config.source,
  nodes: config.nodes.map((n) => ({
    id: n.id,
    parent: n.parent ?? null,
    label: n.label,
    kind: n.kind,
    summary: arch.nodeSummaries?.[n.id] ?? n.summary ?? '',
    stats: stats.get(n.id),
  })),
  files: files.map((p) => ({
    p,
    n: owner.get(p),
    name: describe[p]?.name ?? path.posix.basename(p),
    d: describe[p]?.d ?? '',
    loc: loc(p),
  })),
  links: [...links.values()],
  flows: arch.flows ?? [],
  health: { issues: (arch.health ?? []).map((h) => ({ id: h.id, kind: h.kind ?? 'review', severity: h.severity, title: h.title, detail: h.detail, locations: [{ file: h.file, line: h.line }] })) },
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(graph, null, 1));
console.log(`${files.length} files, ${graph.links.length} links (${matched} frontend calls matched to routes), ${graph.flows.length} flows, ${graph.health.issues.length} health notes`);
if (missing.length) console.log(`no description for ${missing.length} file(s): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' ...' : ''}`);
const unowned = config.nodes.filter((n) => n.kind !== 'external' && !stats.get(n.id).files && !config.nodes.some((c) => c.parent === n.id));
if (unowned.length) console.log(`parts with no files: ${unowned.map((n) => n.id).join(', ')}`);
