#!/usr/bin/env node
/**
 * Keeps the two copies of the mapping skill in step.
 *
 *   node scripts/sync-skills.mjs          write skills/walkthrough/
 *   node scripts/sync-skills.mjs --check  fail if it is out of date
 *
 * The skill is written once, in plugins/codebase-diorama/skills/map/. That is
 * where plugin systems find it (Claude Code, Codex and ChatGPT, Cursor), and
 * they put the plugin's name in front of it: /walkthrough:map.
 *
 * Agents that install bare skills (Gemini CLI extensions, `npx skills add`
 * for Antigravity, GitHub Copilot, OpenCode and the rest) have no plugin name
 * to put in front, and a skill called just "map" would say nothing. For them
 * this script writes the same skill to skills/walkthrough/, with its
 * `name` changed to match that folder as the Agent Skills format requires.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'plugins', 'codebase-diorama', 'skills', 'map');
const TARGET = path.join(ROOT, 'skills', 'walkthrough');
const NAME = 'walkthrough';

/** Every file under `dir`, as '/'-separated paths relative to it. */
function list(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...list(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** The file as it should be in the bare-skill copy. */
function render(rel) {
  const data = fs.readFileSync(path.join(SOURCE, rel));
  if (rel !== 'SKILL.md') return data;
  const text = data.toString('utf8');
  // Tolerates Windows line endings, which git may write on checkout.
  const renamed = text.replace(/^name: map(\r?)$/m, `name: ${NAME}$1`);
  if (renamed === text) throw new Error('SKILL.md has no "name: map" line to rename');
  return Buffer.from(renamed, 'utf8');
}

const files = list(SOURCE);
const check = process.argv.includes('--check');

if (check) {
  const problems = [];
  const existing = fs.existsSync(TARGET) ? list(TARGET) : [];
  for (const rel of files) {
    const target = path.join(TARGET, rel);
    if (!fs.existsSync(target)) problems.push(`missing: ${rel}`);
    else if (!render(rel).equals(fs.readFileSync(target))) problems.push(`differs: ${rel}`);
  }
  for (const rel of existing) if (!files.includes(rel)) problems.push(`left over: ${rel}`);
  if (problems.length) {
    console.error(`skills/${NAME} is out of date:\n  ${problems.join('\n  ')}\nRun: node scripts/sync-skills.mjs`);
    process.exit(1);
  }
  console.log(`skills/${NAME} matches the plugin's skill (${files.length} files)`);
} else {
  fs.rmSync(TARGET, { recursive: true, force: true });
  for (const rel of files) {
    const target = path.join(TARGET, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, render(rel));
  }
  console.log(`Wrote skills/${NAME} (${files.length} files)`);
}
