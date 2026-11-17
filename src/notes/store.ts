import type { Persona } from '../agent/prompt.js';
import type { GraphData } from '../maps/types.js';
import { notesMarkdown, partNamed, type ChatTurn, type Note, type NoteMode, type ScribeReply } from './scribe.js';

/**
 * Where notes live. They are kept in the browser (so they are still there the
 * next time the headset opens the page) and, when the viewer runs on the
 * owner's own computer, written to `notes/<map>.md` in its folder as well.
 * The hosted site has nowhere to write a file: there the notes stay on the
 * device.
 */

const key = (mapId: string): string => `diorama.notes.${mapId}`;
const MODE_KEY = 'diorama.notes.mode';
const MAX_NOTES = 200;

export function loadNotes(mapId: string): Note[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(mapId)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((n): n is Note => !!n && typeof (n as Note).text === 'string' && typeof (n as Note).at === 'number');
  } catch {
    return []; // private browsing, or a damaged entry: start empty
  }
}

export function storeNotes(mapId: string, notes: Note[]): void {
  try {
    localStorage.setItem(key(mapId), JSON.stringify(notes.slice(-MAX_NOTES)));
  } catch {
    // Storage is full or blocked: the notes still show for this visit.
  }
}

export function loadMode(): NoteMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'exact' ? 'exact' : 'talk';
  } catch {
    return 'talk';
  }
}

export function storeMode(mode: NoteMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not remembered next time; nothing else is lost.
  }
}

/**
 * Writes the notes into the project folder. Only the viewer's own dev server
 * has this endpoint; anywhere else the answer is null and the notes stay in
 * the browser. Returns the file's path inside the project.
 */
export async function saveToProject(mapId: string, markdown: string, removed: string[] = []): Promise<string | null> {
  try {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `removed`: notes this device took back (undone, or rewritten), so the
      // file drops them; lines from other devices stay.
      body: JSON.stringify({ mapId, markdown, removed: removed.slice(-50) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { path?: string };
    return json.path ?? null;
  } catch {
    return null;
  }
}

/** Adds one note from outside the notes room (a robot suggesting a fix), and saves it the same ways. */
export function appendNote(mapId: string, graph: GraphData, text: string, part?: string): void {
  const notes = loadNotes(mapId);
  notes.push({ text, at: Date.now(), how: 'talk', part: part ?? partNamed(graph, text) });
  storeNotes(mapId, notes);
  void saveToProject(mapId, notesMarkdown(graph, notes));
}

/**
 * Talks one idea over with the note taker. Null when it cannot be reached
 * (no server, no key, too slow): the caller then writes the words down as said.
 */
export async function talkOver(
  mapId: string,
  persona: Persona,
  said: string,
  notes: string[],
  history: ChatTurn[],
): Promise<ScribeReply | null> {
  try {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, persona, said, notes, history, scribe: true }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await response.json()) as Partial<ScribeReply> & { error?: string };
    if (!response.ok || typeof json.say !== 'string') throw new Error(json.error ?? `HTTP ${response.status}`);
    return { say: json.say, note: json.note ?? null, revise: json.revise === true, marked: json.marked !== false };
  } catch (e) {
    console.warn('[notes] could not talk it over:', (e as Error).message);
    return null;
  }
}
