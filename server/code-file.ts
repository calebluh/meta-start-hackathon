import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { projectDirFor } from './notes-file.js';

/**
 * The text of one file of a mapped project, for the code cards.
 *
 * A map made from a project on this computer shows that project's code as it
 * is on disk now, with no upload and no GitHub (only the local dev server has
 * this; the hosted site reads public code from GitHub). The card reads the
 * file from here, and so does the robot asked about it (code-context.ts):
 * the lines a question is about then go, with the question, to whichever
 * model answers for the robots. Nothing but files the map itself lists is
 * served, only from inside the folder the map was built from, and they are
 * never run.
 */

/** Files larger than this are not code anyone reads on a card. */
const MAX_BYTES = 2_000_000;

export async function readProjectFile(viewerDir: string, mapId: string, path: string): Promise<string | null> {
  // The map id becomes a file name: plain names only, never a path.
  if (!/^[\w-]{1,40}$/.test(mapId) || !path || path.length > 400) return null;
  const project = projectDirFor(viewerDir, mapId);
  if (!project) return null;
  try {
    const map = JSON.parse(await readFile(join(viewerDir, 'src', 'maps', 'custom', `${mapId}.json`), 'utf8')) as { files?: { p?: unknown }[] };
    if (!map.files?.some((f) => f.p === path)) return null;
    // Even a listed path must stay inside the project once links are followed.
    const root = await realpath(project);
    const file = await realpath(resolve(root, path));
    if (!file.startsWith(root + sep)) return null;
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return null;
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}
