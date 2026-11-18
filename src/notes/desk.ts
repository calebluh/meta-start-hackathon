import type { UIKit, UIKitMLAsset, World } from '@iwsdk/core';
import { click } from '../audio/sound.js';
import type { GraphData } from '../maps/types.js';
import { setPanelShown } from '../panels.js';
import { notesMarkdown, partNamed, type Note, type NoteMode } from './scribe.js';
import { loadMode, loadNotes, saveToProject, storeMode, storeNotes } from './store.js';

export interface NotesDeskEvents {
  /** The visitor switched between word for word and talking it over. */
  onMode(mode: NoteMode): void;
  /** The newest note was taken off (undefined: there was none). */
  onUndo(removed: Note | undefined): void;
  onRead(): void;
  /** The visitor asked for the project to be reviewed. */
  onReview(): void;
  onMic(): void;
  onDone(): void;
  /** The notes changed in any way. */
  onChange(): void;
}

/** A tap can land twice in a moment (see DioramaSystem.wireControls). */
const QUIET_MS = 450;
const SHOWN = 3;

/**
 * The notes of the project being looked at, and the panel that shows them in
 * the notes room. RoomSystem decides what is said and when; this keeps the
 * list, saves it, and draws the panel.
 */
export class NotesDesk {
  notes: Note[] = [];
  mode: NoteMode = loadMode();
  private panel: UIKitMLAsset | undefined;
  private mapId = '';
  private graph: GraphData | null = null;
  /** Where the notes were last written in the project folder, or null when they only live in the browser. */
  private savedTo: string | null = null;
  private saving = 0;
  readonly cleanup: (() => void)[] = [];
  /** Notes taken back (undone or rewritten) since the file was last written. */
  private takenBack: string[] = [];

  constructor(
    private world: World,
    private events: NotesDeskEvents,
  ) {
    this.panel = world.getSceneObject<UIKitMLAsset>('notes-panel');
    setPanelShown(world, 'notes-panel', false);
    const on = (id: string, handler: () => void) => {
      const el = this.panel?.getElementById(id);
      if (!el) return;
      let last = -Infinity;
      const tap = () => {
        const now = performance.now();
        if (now - last < QUIET_MS) return;
        last = now;
        click();
        handler();
      };
      el.addEventListener('click', tap);
      this.cleanup.push(() => el.removeEventListener('click', tap));
    };
    on('btn-notes-mode', () => this.setMode(this.mode === 'exact' ? 'talk' : 'exact'));
    on('btn-notes-undo', () => this.events.onUndo(this.undo()));
    on('btn-notes-read', () => this.events.onRead());
    on('btn-notes-review', () => this.events.onReview());
    on('btn-notes-mic', () => this.events.onMic());
    on('btn-notes-done', () => this.events.onDone());
  }

  /** Brings up the notes of one project. */
  open(mapId: string, graph: GraphData): void {
    this.mapId = mapId;
    this.graph = graph;
    this.notes = loadNotes(mapId);
    this.savedTo = null;
    this.live('');
    this.render();
    setPanelShown(this.world, 'notes-panel', true);
    // Says where the notes are kept, and brings the project's file up to date.
    if (this.notes.length) this.persist();
  }

  close(): void {
    setPanelShown(this.world, 'notes-panel', false);
  }

  get shown(): boolean {
    return this.panel?.visible === true;
  }

  setMode(mode: NoteMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    storeMode(mode);
    this.render();
    this.events.onMode(mode);
  }

  add(text: string, how: NoteMode): Note {
    // The same idea said twice is one note.
    const newest = this.notes[this.notes.length - 1];
    if (newest && sameWords(newest.text, text)) return newest;
    const note: Note = { text: text.trim(), at: Date.now(), how, part: this.graph ? partNamed(this.graph, text) : undefined };
    this.notes.push(note);
    this.changed();
    return note;
  }

  /** Rewrites the newest note (talking an idea over refines it rather than piling up versions). */
  reviseLast(text: string): Note {
    const last = this.notes[this.notes.length - 1];
    if (!last) return this.add(text, 'talk');
    this.takenBack.push(last.text);
    last.text = text.trim();
    last.at = Date.now();
    last.how = 'talk';
    last.part = this.graph ? partNamed(this.graph, text) : last.part;
    this.changed();
    return last;
  }

  undo(): Note | undefined {
    const removed = this.notes.pop();
    if (removed) {
      this.takenBack.push(removed.text);
      this.changed();
    }
    return removed;
  }

  /** The line under the heading: the words being heard, or a prompt to speak. */
  live(text: string): void {
    const idle = this.mode === 'exact' ? 'Just talk. I write down exactly what you say.' : 'Just say your idea and we will talk it over.';
    this.text('notes-live', text ? `"${text}"` : idle);
  }

  setReviewLabel(label: string): void {
    this.text('notes-review-label', label);
  }

  setMicLabel(label: string): void {
    this.text('notes-mic-label', label);
  }

  private changed(): void {
    storeNotes(this.mapId, this.notes);
    this.render();
    this.persist();
    this.events.onChange();
  }

  /** Keeps the project's notes file in step. Quietly does nothing where there is no project folder. */
  private persist(): void {
    if (!this.graph) return;
    const run = ++this.saving;
    const takenBack = this.takenBack.splice(0);
    void saveToProject(this.mapId, notesMarkdown(this.graph, this.notes), takenBack).then((path) => {
      if (path === null) this.takenBack.unshift(...takenBack); // try again with the next save
      if (run !== this.saving) return;
      this.savedTo = path;
      this.renderStatus();
    });
  }

  private render(): void {
    this.text('notes-eyebrow', `NOTES | ${(this.graph?.project.name ?? '').toUpperCase().slice(0, 28)}`);
    this.text('notes-title', this.mode === 'exact' ? 'Writing word for word' : 'Talking it over');
    this.text('notes-mode-label', this.mode === 'exact' ? 'Switch to talk it over' : 'Switch to word for word');
    const newest = this.notes.slice(-SHOWN).reverse();
    for (let i = 0; i < SHOWN; i += 1) {
      const note = newest[i];
      const el = this.panel?.getElementById<UIKit.Text>(`note-${i}`);
      el?.setProperties({ display: note || i === 0 ? 'flex' : 'none' });
      if (note) this.text(`note-${i}`, `${this.notes.length - i}. ${note.part ? `[${note.part}] ` : ''}${clip(note.text, 150)}`);
      else if (i === 0) this.text('note-0', 'No notes yet.');
    }
    this.renderStatus();
    this.live('');
  }

  private renderStatus(): void {
    const count = this.notes.length === 1 ? '1 note' : `${this.notes.length} notes`;
    this.text('notes-status', this.savedTo ? `${count} | saved to ${this.savedTo}` : `${count} | on the page when you leave VR`);
  }

  private text(id: string, value: string): void {
    // The panel font lacks a few typographic characters; swap in plain ones.
    const plain = value
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...');
    this.panel?.getElementById<UIKit.Text>(id)?.setProperties({ text: plain });
  }
}

/** True when two notes differ only in case, spacing or punctuation. */
function sameWords(a: string, b: string): boolean {
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return plain(a) === plain(b);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
