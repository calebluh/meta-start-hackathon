#!/usr/bin/env node
// Checks a built Codebase Diorama map (src/maps/custom/<id>.json) for the
// mistakes the viewer would otherwise hide: flow steps that point at nothing,
// parts or files without descriptions, empty rooms, and maps too small or too
// big to tour. Prints each problem, then "ok" or a count.
//
// usage: node check-map.mjs <map.json>

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node check-map.mjs <map.json>');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const problems = [];
const warn = (msg) => problems.push(msg);

const ids = new Set(g.nodes.map((n) => n.id));
const paths = new Set(g.files.map((f) => f.p));
const parents = new Set(g.nodes.map((n) => n.parent).filter(Boolean));
const leaves = g.nodes.filter((n) => !parents.has(n.id) && n.kind !== 'external');

if (!g.project?.name) warn('project has no name');
if (!g.project?.summary) warn('project has no summary (arch.json projectSummary)');
for (const n of g.nodes) {
  if (n.parent && !ids.has(n.parent)) warn(`node ${n.id}: parent "${n.parent}" does not exist`);
  if (!n.summary) warn(`node ${n.id}: no summary (arch.json nodeSummaries)`);
}
for (const n of leaves) if (!n.stats?.files) warn(`node ${n.id}: owns no files, so its room would be empty`);
if (leaves.length < 4) warn(`only ${leaves.length} parts with code; aim for 6-20`);
if (leaves.length > 30) warn(`${leaves.length} parts with code; above ~20 the desk gets crowded`);

const undescribed = g.files.filter((f) => !f.d);
if (undescribed.length) warn(`${undescribed.length} file(s) without a description, e.g. ${undescribed.slice(0, 5).map((f) => f.p).join(', ')}`);

const resolves = (ref) => (ref.startsWith('f:') ? paths.has(ref.slice(2)) : ref.startsWith('n:') ? ids.has(ref.slice(2)) : false);
if (!g.flows?.length) warn('no flows; add 2-4 journeys so packets have somewhere to go');
for (const flow of g.flows ?? []) {
  if (!flow.steps?.length) warn(`flow ${flow.id}: no steps`);
  for (const [i, s] of (flow.steps ?? []).entries()) {
    if (!resolves(s.ref)) warn(`flow ${flow.id} step ${i + 1}: "${s.ref}" is not an included file (f:) or node id (n:)`);
    if (!s.note) warn(`flow ${flow.id} step ${i + 1}: no note`);
  }
}
for (const issue of g.health?.issues ?? []) {
  for (const loc of issue.locations ?? []) if (loc.file && !paths.has(loc.file)) warn(`health ${issue.id}: file "${loc.file}" is not an included file`);
}

for (const p of problems) console.log(`- ${p}`);
console.log(problems.length ? `${problems.length} problem(s)` : `ok: ${leaves.length} rooms, ${g.files.length} files, ${g.flows.length} flows`);
process.exit(problems.length ? 1 : 0);
