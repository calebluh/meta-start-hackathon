import type { ChatTurn, Persona } from '../agent/prompt.js';
import type { GraphData, GraphNode } from '../maps/types.js';

/**
 * The notes room: a room that belongs to the project as a whole, not to one
 * part of it. The visitor says ideas out loud and a note taker writes them
 * down, either exactly as said or after talking each one over.
 *
 * Pure (no DOM, no Three.js): the server builds its prompt from the same code.
 */

/** Room id of the notes room. Floorplan ids never start with `~`, so no map can have a part with this id. */
export const NOTES_ROOM = '~notes';

/** Stands in for a map node wherever a room needs a name and a summary. */
export const NOTES_NODE: GraphNode = {
  id: NOTES_ROOM,
  parent: null,
  label: 'Notes',
  kind: 'misc',
  summary: 'Say an idea out loud and it is written down for this project, word for word or after talking it over.',
};

/** `exact`: written as said. `talk`: talked over with the note taker first, then written tight. */
export type NoteMode = 'exact' | 'talk';

export interface Note {
  text: string;
  /** When it was written (milliseconds since 1970). */
  at: number;
  how: NoteMode;
  /** The part of the app the note names, if any. */
  part?: string;
}

export const MAX_SAID = 600;
export const MAX_NOTE = 400;
/** How many earlier notes the note taker is shown when talking an idea over. */
export const NOTES_IN_PROMPT = 8;

export type NoteCommand = 'undo' | 'exact' | 'talk' | 'read';

const COMMANDS: [RegExp, NoteCommand][] = [
  [/^(scratch|delete|undo|remove|strike|erase) (that|it|the last (one|note))$/, 'undo'],
  [/^(word for word|(just |please )?write (it|this|that|them) down( exactly)?|take dictation|dictation( mode)?|exactly as i say( it)?)$/, 'exact'],
  [/^((let'?s |let us )?talk it over|help me think|think (it through )?with me|(let'?s )?bounce (it|ideas) around)$/, 'talk'],
  [/^(read (them|it|that|my notes|the notes)( back)?( to me)?|what (have|do) (you|we) (got|have)( so far)?)$/, 'read'],
];

/**
 * A spoken command to the note taker. Only a short sentence that is nothing
 * but the command counts, so an idea that happens to contain "write it down"
 * is still written down.
 */
export function noteCommand(said: string): NoteCommand | null {
  const plain = said
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.split(' ').length > 8) return null;
  for (const [pattern, command] of COMMANDS) if (pattern.test(plain)) return command;
  return null;
}

/** The first part of the app a note names, by its label ("Payments", "Order history"). */
export function partNamed(graph: GraphData, text: string): string | undefined {
  const lower = text.toLowerCase();
  let best: { label: string; at: number } | undefined;
  for (const node of graph.nodes) {
    const label = node.label.toLowerCase();
    if (label.length < 4) continue;
    const at = lower.search(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    if (at >= 0 && (!best || at < best.at)) best = { label: node.label, at };
  }
  return best?.label;
}

/** What the note taker is told before the visitor's words. Built on the server from the bundled map. */
export function scribePrompt(graph: GraphData, persona: Persona, notes: string[]): string {
  const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
  const parts = graph.nodes
    .filter((n) => n.kind !== 'external')
    .slice(0, 30)
    .map((n) => `- ${n.label}: ${cut(n.summary, 140)}`);
  const written = notes.length ? notes.map((n, i) => `${i + 1}. ${n}`) : ['(none yet)'];
  return [
    `You are ${persona.name}, the note taker for the software project "${graph.project.name}": ${cut(graph.project.summary, 400)}`,
    'A visitor is sitting with you in virtual reality, thinking out loud about this project. You keep their notes.',
    '',
    'The parts of the project:',
    ...parts,
    '',
    'Notes written so far, newest last:',
    ...written,
    '',
    'How to answer:',
    '- You are heard, not read: one to three short sentences of plain spoken English. No lists, no markdown, no code.',
    '- Help them sharpen the idea: say what is strong about it, name one thing that is unclear or risky, or ask one question. One of these, not all.',
    '- Use the parts above when it helps. Never invent files, parts or facts about the project.',
    '- Never say that you are writing or have written the note; just talk about the idea.',
    '',
    'Then finish with exactly one last line, in one of these three forms:',
    'NOTE: <the idea as one or two tight sentences in the visitor\'s own terms; add nothing they did not say or agree to>',
    'REVISE: <the newest note above, rewritten, when the visitor is refining or correcting that same idea or answering your question about it>',
    'NOTE: none',
    'Use "NOTE: none" when they asked a question or made small talk and there is nothing to write down, or when the idea is already in the notes above and nothing about it has changed.',
  ].join('\n');
}

export interface ScribeReply {
  /** What the note taker says out loud. */
  say: string;
  /** The note to write, or null when there is nothing to write. */
  note: string | null;
  /** The note replaces the newest one instead of being added. */
  revise: boolean;
  /** False when the model left the note line out: the caller then keeps the visitor's own words. */
  marked: boolean;
}

/** Splits the model's reply into its spoken part and its note line. */
export function parseScribe(text: string): ScribeReply {
  const lines = text.replace(/\r/g, '').split('\n');
  let note: string | null = null;
  let revise = false;
  let marked = false;
  const spoken: string[] = [];
  for (const raw of lines) {
    let line = raw;
    let match = /^\s*[*_`>-]*\s*(NOTE|REVISE)\s*[*_`]*\s*:\s*(.*)$/i.exec(line);
    if (!match) {
      // The fast model sometimes runs the marker onto the end of its speech
      // ("...for customers. NOTE: cache the menu"). Only a capitalised marker
      // after a sentence counts, so "a note: ..." in plain speech is left alone.
      const inline = /([.!?:]["')\]]?)\s+[*_`]*(NOTE|REVISE)[*_`]*\s*:\s*(.*)$/.exec(line);
      if (inline) {
        spoken.push(line.slice(0, inline.index + inline[1].length));
        line = '';
        match = ['', inline[2], inline[3]] as unknown as RegExpExecArray;
      }
    }
    if (!match) {
      spoken.push(line);
      continue;
    }
    marked = true;
    const body = match[2].replace(/[*_`]+$/g, '').trim();
    if (!body || /^none\.?$/i.test(body)) continue;
    note = body.slice(0, MAX_NOTE);
    revise = match[1].toUpperCase() === 'REVISE';
  }
  const say = spoken
    .join(' ')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { say, note, revise, marked };
}

/** The notes as a Markdown checklist, for the project and for a coding agent to pick up. */
export function notesMarkdown(graph: GraphData, notes: Note[]): string {
  const stamp = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `# Notes: ${graph.project.name}`,
    '',
    'Ideas spoken in Walkthrough, oldest first. Times are UTC.',
    '',
    ...notes.map((n) => {
      const tags = [n.part, n.how === 'exact' ? 'word for word' : 'talked over', stamp(n.at)].filter(Boolean).join(', ');
      return `- [ ] ${n.text.replace(/\s+/g, ' ')} _(${tags})_`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

/** What the note taker says when asked to read the notes back. */
export function readBack(notes: Note[]): string {
  if (notes.length === 0) return 'There is nothing written down yet. Tell me an idea.';
  const last = notes.slice(-5);
  const lead = notes.length === 1 ? 'You have one note.' : notes.length > last.length ? `You have ${notes.length} notes. Here are the last ${last.length}.` : `You have ${notes.length} notes.`;
  return `${lead} ${last.map((n) => n.text.replace(/[.!?]*$/, '.')).join(' Next. ')}`;
}

export type { ChatTurn, Persona };
