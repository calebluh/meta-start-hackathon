#!/usr/bin/env node
/**
 * Writes the public Codebase Diorama viewer (github.com/calebluh/codebase-diorama)
 * from this hackathon repository into a checkout of the public repo.
 *
 *   node scripts/export-personal.mjs ../codebase-diorama
 *
 * The public edition is this app without the hackathon parts: no MiroFish
 * demo, no start menu, and it opens on the user's own maps. It works by:
 *   1. copying every file git tracks (or would track) here, minus DROP;
 *   2. copying editions/personal/ over the top (whole-file replacements);
 *   3. a few small edits (EDITS), each of which must find its target, so a
 *      refactor here fails the export loudly instead of shipping something
 *      broken.
 * Finally it checks that the word MiroFish appears nowhere in the output.
 *
 * Everything in the destination except .git is replaced, so files deleted
 * here also disappear there. Review the result with `git status` there, then
 * commit and push.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAY = 'editions/personal';

/** Hackathon-only files and folders (relative paths, '/' separated). */
const DROP = [
  'editions/',
  'scripts/export-personal.mjs',
  'scripts/maps/mirofish.mjs',
  'src/maps/mirofish.ts',
  'src/maps/mirofish.json',
  'scripts/maps/self.mjs',
  'scripts/maps/self.arch.json',
  'src/maps/self.ts',
  'src/maps/self.json',
  'public/maps/mirofish/',
  'src/menu.ts',
  'public/ui/menu.uikitml',
];

/** Text edits: [file, transform]. A transform throws if its target is gone. */
const EDITS = [
  ['src/assets.ts', (t) => removeLines(t, /^\s*menu: uikitml\(/, 1)],
  ['src/index.ts', (t) => removeLines(removeLines(t, /^import \{ MenuSystem \}/, 1), /registerSystem\(MenuSystem\)/, 1)],
  ['public/scenes/main.iwsdk.scene.json', (t) => `${JSON.stringify(removeNode(JSON.parse(t), 'menu-panel'), null, 2)}\n`],
  ['package.json', (t) => replaceOnce(t, '"name": "meta-start-hackathon"', '"name": "codebase-diorama"')],
];

function removeLines(text, pattern, expected) {
  const lines = text.split('\n');
  const kept = lines.filter((line) => !pattern.test(line));
  if (lines.length - kept.length !== expected) throw new Error(`expected ${expected} line(s) matching ${pattern}`);
  return kept.join('\n');
}

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`expected exactly one "${from}"`);
  return text.replace(from, to);
}

function removeNode(scene, id) {
  let removed = 0;
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return nodes;
    const kept = nodes.filter((n) => n.id !== id || (removed++, false));
    for (const n of kept) if (n.children) n.children = walk(n.children);
    return kept;
  };
  scene.nodes = walk(scene.nodes);
  if (removed !== 1) throw new Error(`expected one scene node "${id}", found ${removed}`);
  return scene;
}

const dest = process.argv[2] && path.resolve(process.argv[2]);
if (!dest) {
  console.error('usage: node scripts/export-personal.mjs <checkout of codebase-diorama>');
  process.exit(1);
}
if (dest === ROOT || dest.startsWith(ROOT + path.sep)) {
  console.error('The destination must be outside this repository.');
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .filter((f) => !DROP.some((d) => (d.endsWith('/') ? f.startsWith(d) : f === d)));

// Clear the destination, keeping its git history.
for (const entry of fs.readdirSync(dest)) {
  if (entry !== '.git') fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
}

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
for (const f of files) copy(path.join(ROOT, f), path.join(dest, f));

const overlayRoot = path.join(ROOT, OVERLAY);
const overlaid = [];
const walkOverlay = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkOverlay(full);
    else {
      const rel = path.relative(overlayRoot, full).split(path.sep).join('/');
      copy(full, path.join(dest, rel));
      overlaid.push(rel);
    }
  }
};
walkOverlay(overlayRoot);

for (const [file, transform] of EDITS) {
  const full = path.join(dest, file);
  const text = fs.readFileSync(full, 'utf8');
  try {
    fs.writeFileSync(full, transform(text));
  } catch (error) {
    console.error(`Edit of ${file} failed: ${error.message}. Update EDITS in scripts/export-personal.mjs.`);
    process.exit(1);
  }
}

// Nothing hackathon-only may leak into the public edition.
const TEXT = /\.(ts|mjs|js|json|md|uikitml|html|css|txt|ya?ml|toml)$/i;
const leaks = [];
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (TEXT.test(entry.name) && /mirofish/i.test(fs.readFileSync(full, 'utf8'))) leaks.push(path.relative(dest, full));
  }
};
scan(dest);
if (leaks.length) {
  console.error(`MiroFish is still mentioned in:\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}

console.log(`Exported ${files.length} files (${overlaid.length} replaced, ${EDITS.length} edited) to ${dest}`);
