import { VisibilityState, type World } from '@iwsdk/core';
import type { GraphData } from './maps/types.js';
import type { Note } from './notes/scribe.js';
import { loadNotes } from './notes/store.js';
import { app, onChange } from './state.js';

/**
 * Leaving with something in your hands. The notes from a visit (ideas said in
 * the notes room, fixes the robots suggested, the note taker's review) show
 * on the page when the headset comes off, with two ways to take them along:
 * a GitHub issue already filled in for that repository, and a prompt to paste
 * into a coding agent. Nothing is sent anywhere by this page: the issue opens
 * as a draft on github.com for the visitor to submit, and the prompt goes to
 * the clipboard.
 */

const SHOWN = 5;
/** GitHub accepts long issue links, but browsers and proxies cut them; stay well under. */
const MAX_URL = 6000;

const line = (n: Note): string => `${n.part ? `[${n.part}] ` : ''}${n.text.replace(/\s+/g, ' ').trim()}`;

/** "owner/name" when the map came from GitHub. */
export function githubRepo(graph: GraphData): string | null {
  const m = /github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(graph.source?.repo ?? '');
  return m ? m[1] : null;
}

/** A new-issue link on the project's repository with the notes as a checklist. Null when the map is not from GitHub. */
export function issueUrl(graph: GraphData, notes: Note[]): string | null {
  const repo = githubRepo(graph);
  if (!repo || notes.length === 0) return null;
  const title = notes.length === 1 ? line(notes[0]).slice(0, 90) : `Work order from a code walk-through (${notes.length} items)`;
  const foot = `\n\n_Written while walking this repository in VR with Walkthrough: https://walkthrough.calebluh.com/?repo=${repo}_`;
  const base = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=`;
  let kept = notes;
  for (;;) {
    const more = notes.length - kept.length;
    const body = `${kept.map((n) => `- [ ] ${line(n)}`).join('\n')}${more ? `\n- [ ] (and ${more} more in the notes)` : ''}${foot}`;
    const url = base + encodeURIComponent(body);
    if (url.length <= MAX_URL || kept.length <= 1) return url.slice(0, MAX_URL);
    kept = kept.slice(0, -1);
  }
}

/** The notes as instructions for a coding agent working in that repository. */
export function agentPrompt(graph: GraphData, notes: Note[]): string {
  const repo = githubRepo(graph);
  return [
    `You are working in the repository "${graph.project.name}"${repo ? ` (github.com/${repo})` : ''}.`,
    'Below is a work order from a walk-through of the code. Work through it in order, most urgent first.',
    'For each item: open the file it names, confirm the problem is really there, make the smallest change that fixes it, run the tests, and tick the item off. If an item is unclear or already fixed, say so and move on. Ask before anything destructive.',
    '',
    ...notes.map((n, i) => `${i + 1}. ${line(n)}`),
  ].join('\n');
}

const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** Shows the current project's notes on the page whenever the page is what the visitor sees. */
export function setupWorkOrder(world: World): void {
  const box = el('workorder');
  const title = el('workorder-title');
  const list = el('workorder-list');
  const issue = el<HTMLAnchorElement>('workorder-issue');
  const copy = el<HTMLButtonElement>('workorder-copy');
  const said = el('workorder-note');
  const fallback = el<HTMLTextAreaElement>('workorder-text');
  if (!box || !title || !list || !issue || !copy || !said || !fallback) return;

  const refresh = () => {
    const notes = loadNotes(app.mapId);
    box.hidden = notes.length === 0;
    if (notes.length === 0) return;
    const graph = app.graph;
    title.textContent = `Your work order for ${graph.project.name}: ${notes.length === 1 ? '1 item' : `${notes.length} items`}`;
    list.replaceChildren(
      ...notes.slice(0, SHOWN).map((n) => {
        const li = document.createElement('li');
        const text = line(n);
        li.textContent = text.length > 150 ? `${text.slice(0, 147)}...` : text;
        return li;
      }),
    );
    if (notes.length > SHOWN) {
      const li = document.createElement('li');
      li.className = 'more';
      li.textContent = `and ${notes.length - SHOWN} more`;
      list.append(li);
    }
    // MiroFish is someone else's project and its warnings are security findings:
    // no nudge to post those in public. The prompt for a coding agent is still offered.
    const url = app.mapId === 'mirofish' ? null : issueUrl(graph, notes);
    issue.hidden = !url;
    if (url) issue.href = url;
    said.textContent = '';
    fallback.hidden = true;
  };

  copy.addEventListener('click', async () => {
    const text = agentPrompt(app.graph, loadNotes(app.mapId));
    try {
      await navigator.clipboard.writeText(text);
      said.textContent = 'Copied. Paste it into Claude Code, Codex, Cursor or any coding agent in that repository.';
    } catch {
      // No clipboard here (some headset browsers): show the text to select by hand.
      fallback.value = text;
      fallback.hidden = false;
      fallback.select();
      said.textContent = 'Select and copy the text below into your coding agent.';
    }
  });

  let immersive = false;
  world.visibilityState.subscribe((state) => {
    immersive = state !== VisibilityState.NonImmersive;
    if (!immersive) refresh();
  });
  // A different city, or notes changed from the flat preview.
  onChange(() => {
    if (!immersive) refresh();
  });
  refresh();
}
