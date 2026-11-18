import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

/**
 * Where a map's notes are kept on this computer, and how the file is written.
 *
 * A map made from someone's own repository keeps everything in that
 * repository, in a `walkthrough/` folder: the map's sources, the built map
 * and `notes.md`, the list of what was said and suggested in VR. The folder
 * ignores itself in git, so nothing has to be committed or cleaned up.
 * `scripts/build-map.mjs` records which repository each map came from
 * (`maps-src/targets.json` in the viewer); a map with no recorded repository
 * (the bundled demos) keeps its notes in the viewer's own `notes/` folder.
 *
 * The file is a merge. The headset sends its whole list each time; a coding
 * agent or the user ticks lines off in the file (`- [x]`), and another device
 * may have written lines of its own. Ticks and other devices' lines are kept;
 * only lines this device took back are dropped.
 */

/** The folder kept in a mapped repository. */
export const PROJECT_FOLDER = 'walkthrough';

const IGNORE = '# Made by Walkthrough: the map of this repository and your notes from VR.\n# Nothing in this folder needs committing, so the folder ignores itself.\n*\n';

/** The repository a map was built from, when build-map recorded it and the folder is still there. */
export function projectDirFor(viewerDir: string, mapId: string): string | null {
  try {
    const targets = JSON.parse(readFileSync(join(viewerDir, 'maps-src', 'targets.json'), 'utf8')) as Record<string, unknown>;
    const dir = targets[mapId];
    return typeof dir === 'string' && isAbsolute(dir) && statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** The repository's walkthrough/ folder, made if missing, kept out of git without touching the repository's own .gitignore. */
export async function projectFolder(projectDir: string): Promise<string> {
  const folder = join(projectDir, PROJECT_FOLDER);
  await mkdir(folder, { recursive: true });
  const ignore = join(folder, '.gitignore');
  if (!existsSync(ignore)) await writeFile(ignore, IGNORE, 'utf8');
  return folder;
}

interface Entry {
  done: boolean;
  /** The note and its tags, as written after the checkbox: `text _(Part, talked over, 2026-11-17 02:14)_`. */
  rest: string;
}

const CHECK = /^- \[([ xX])\] (.*)$/;
const TAGS = / _\((.*)\)_$/;
/** A note's words without its tags: what two copies of the same note share. */
const textOf = (rest: string): string => rest.replace(TAGS, '').trim();

/** The part of the code a note is about: the tags before "talked over" or "word for word". */
function partOf(rest: string): string | null {
  const tags = TAGS.exec(rest)?.[1].split(', ') ?? [];
  const how = tags.findIndex((t) => t === 'talked over' || t === 'word for word');
  return how > 0 ? tags.slice(0, how).join(', ') : null;
}

/** The notes as a file that is quick to scan: a count, what is still to do grouped by part, then what is done. */
export function formatNotes(name: string, entries: Entry[], now: Date): string {
  const open = entries.filter((e) => !e.done);
  const done = entries.filter((e) => e.done);
  const lines = [
    `# Walkthrough notes: ${name}`,
    '',
    `**${open.length} to do, ${done.length} done.** Updated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    'From your walk through this code in VR: ideas you talked over, fixes the robots suggested and the note taker\'s review.',
    'Tick a box (`- [x]`) when a note is dealt with; the headset keeps your ticks.',
    'To have them done for you, ask your coding agent to "work through my walkthrough notes".',
    '',
    '## To do',
    '',
  ];
  if (open.length === 0) lines.push('Nothing open.', '');
  // By the part of the code each note is about, in the order the parts first come up.
  const groups = new Map<string, Entry[]>();
  for (const entry of open) {
    const part = partOf(entry.rest) ?? 'General';
    const list = groups.get(part) ?? [];
    list.push(entry);
    groups.set(part, list);
  }
  for (const [part, list] of groups) lines.push(`### ${part}`, '', ...list.map((e) => `- [ ] ${e.rest}`), '');
  if (done.length) lines.push('## Done', '', ...done.map((e) => `- [x] ${e.rest}`), '');
  return lines.join('\n');
}

/**
 * Writes one map's notes. `markdown` is the headset's list (a `# Notes: <project>`
 * heading and `- [ ]` lines); `removed` are notes this device took back.
 * Returns the path to show the visitor.
 */
export async function writeNotes(viewerDir: string, mapId: string, markdown: string, removed: string[]): Promise<string> {
  const project = projectDirFor(viewerDir, mapId);
  const viewerFile = join(viewerDir, 'notes', `${mapId}.md`);
  let file = viewerFile;
  let shown = `notes/${mapId}.md`;
  if (project) {
    file = join(await projectFolder(project), 'notes.md');
    shown = `${basename(project)}/${PROJECT_FOLDER}/notes.md`;
  } else {
    await mkdir(join(viewerDir, 'notes'), { recursive: true });
  }

  let name = mapId;
  const incoming: Entry[] = [];
  const mine = new Set<string>();
  for (const line of markdown.split('\n')) {
    const title = /^# Notes: (.+)$/.exec(line.trim());
    if (title) name = title[1].trim();
    const match = CHECK.exec(line);
    if (!match) continue;
    incoming.push({ done: false, rest: match[2] });
    mine.add(textOf(match[2]));
  }
  const taken = new Set(removed.map((r) => r.replace(/\s+/g, ' ').trim()));

  // What the file already holds: ticks to keep, and lines this device does not have.
  // A map whose notes used to live in the viewer brings them along the first time.
  const done = new Set<string>();
  const older: Entry[] = [];
  const before = existsSync(file) ? file : existsSync(viewerFile) ? viewerFile : null;
  if (before) {
    for (const line of (await readFile(before, 'utf8')).split(/\r?\n/)) {
      const match = CHECK.exec(line);
      if (!match) continue;
      const text = textOf(match[2]);
      if (match[1] !== ' ') done.add(text);
      if (!mine.has(text) && !taken.has(text)) older.push({ done: match[1] !== ' ', rest: match[2] });
    }
  }
  const entries = [...older, ...incoming.map((e) => ({ ...e, done: done.has(textOf(e.rest)) }))];
  await writeFile(file, formatNotes(name, entries, new Date()), 'utf8');
  return shown;
}
