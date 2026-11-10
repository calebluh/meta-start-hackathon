import { resolveRef } from '../layout.js';
import type { GraphData } from '../maps/types.js';

/**
 * What each room's worker knows, and how it talks. Pure (no DOM, no Three.js),
 * so the server function and the in-headset fallback build the same facts.
 */

export interface Persona {
  name: string;
  role: string;
  place: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** The facts about one part of the codebase, as plain lines. */
export function roomFacts(graph: GraphData, nodeId: string): string[] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const facts: string[] = [];
  facts.push(`This room is "${node.label}": ${node.summary}`);

  const files = graph.files.filter((f) => f.n === nodeId);
  if (files.length) {
    facts.push('Files kept in this room:');
    for (const f of files) facts.push(`- ${f.name} (${f.p}, ${f.loc} lines): ${f.d}`);
  }
  const children = graph.nodes.filter((n) => n.parent === nodeId);
  if (children.length) facts.push(`Rooms inside this one: ${children.map((c) => `${c.label} (${c.summary})`).join('; ')}`);

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const l of graph.links) {
    const a = resolveRef(graph, l.a);
    const b = resolveRef(graph, l.b);
    if (!a || !b || a === b) continue;
    const what = l.labels?.length ? l.labels.join(', ') : l.k;
    if (b === nodeId) (incoming.get(a) ?? incoming.set(a, new Set()).get(a)!).add(what);
    if (a === nodeId) (outgoing.get(b) ?? outgoing.set(b, new Set()).get(b)!).add(what);
  }
  if (incoming.size) facts.push(`Work comes in from: ${[...incoming].map(([id, w]) => `${label(id)} (${[...w].join(', ')})`).join('; ')}`);
  if (outgoing.size) facts.push(`This room sends work to: ${[...outgoing].map(([id, w]) => `${label(id)} (${[...w].join(', ')})`).join('; ')}`);

  for (const flow of graph.flows) {
    const steps = flow.steps.map((s) => ({ id: resolveRef(graph, s.ref), note: s.note }));
    if (!steps.some((s) => s.id === nodeId)) continue;
    facts.push(`Flow "${flow.title}" (${flow.description}):`);
    steps.forEach((s, i) => facts.push(`  ${i + 1}. ${s.id ? label(s.id) : '?'}${s.id === nodeId ? ' (THIS ROOM)' : ''}: ${s.note}`));
  }

  for (const issue of graph.health?.issues ?? []) {
    if ((issue.locations ?? []).some((loc) => resolveRef(graph, loc.file) === nodeId)) {
      facts.push(`Health warning (${issue.severity}): ${issue.title}. ${issue.detail ?? ''}`);
    }
  }
  for (const task of graph.recent?.tasks ?? []) {
    for (const item of task.items) {
      if (resolveRef(graph, item.ref) === nodeId) facts.push(`Recently changed for "${task.title}": ${item.note}`);
    }
  }
  return facts;
}

export function systemPrompt(graph: GraphData, nodeId: string, persona: Persona): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return [
    `You are ${persona.name}, a ${persona.role} in the ${persona.place}. You are a worker in an imaginary building where every part of the "${graph.project.name}" codebase is a room, and the workers in each room personify that code. Your room is "${node?.label ?? nodeId}" (room id ${nodeId}).`,
    `The app as a whole: ${graph.project.summary}`,
    '',
    'Facts about your room (the only things you know for certain):',
    ...roomFacts(graph, nodeId),
    '',
    'Building directory (room id = name):',
    ...graph.nodes.map((n) => `- ${n.id} = ${n.label}`),
    'Flows you can play (flow id = title):',
    ...graph.flows.map((f) => `- ${f.id} = ${f.title}`),
    '',
    'How to answer:',
    '- Speak in the first person as the worker, warm and plain-spoken, for someone who may not be a programmer. Use the building metaphor lightly, but name real files and requests when they help. Sound like a person talking, not a document: contractions, no lists, no markdown.',
    '- Keep it to 2-4 short sentences; your words appear in a speech bubble in VR and are read aloud.',
    '- You have already said hello and given your name and job. Do not do that again, and do not announce what you are about to say ("here is what I do", "I am on it"). Your first sentence is already the answer.',
    '- Only use the facts above. If something is not covered, say you do not know and suggest which room to ask.',
    '- You can act, using your tools, in the same reply as your words. Acting never replaces talking: still give your full 2-4 sentence spoken answer, then act. Never write tool calls as text.',
    '  - go_to_room when the visitor asks to go somewhere or to see another part, or agrees to your suggestion. Say you are sending them over.',
    '  - play_flow when they want to watch how something happens from start to finish.',
    '  - point_to_room when you mention a neighbouring room (never your own).',
    '  - show_file when you talk about one of your files in detail.',
    '  - back_to_city when the visitor wants to leave, step outside, or go back to the city, the table or the map. Say goodbye first.',
    '- After your answer, write exactly one more line: FOLLOWUPS: <question> | <question>',
    '  Those are two short questions (under 8 words) the visitor might ask you next.',
  ].join('\n');
}

/** Tools a worker can use, in OpenAI-compatible chat-completions format. */
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'go_to_room',
      description: 'Take the visitor to another room in the building; their view cuts there and that room’s worker greets them.',
      parameters: { type: 'object', properties: { room_id: { type: 'string', description: 'Room id from the directory' } }, required: ['room_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_flow',
      description: 'Play a flow: a packet travels room to room while each worker explains their step.',
      parameters: { type: 'object', properties: { flow_id: { type: 'string', description: 'Flow id from the list' } }, required: ['flow_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'point_to_room',
      description: 'Point at the wall tube that leads to a neighbouring room while you talk about it.',
      parameters: { type: 'object', properties: { room_id: { type: 'string', description: 'Room id from the directory' } }, required: ['room_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_file',
      description: 'Hand the visitor a card describing one of the files kept in your room.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path as listed in your room facts' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'back_to_city',
      description: 'Take the visitor out of the building, back to the little city on their desk.',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

/** An action a worker took, validated against the map. */
export type AgentAction =
  | { type: 'go_to_room'; roomId: string }
  | { type: 'play_flow'; flowId: string }
  | { type: 'point_to_room'; roomId: string }
  | { type: 'show_file'; path: string }
  | { type: 'back_to_city' };

/** An action that ends the conversation because the visitor goes elsewhere. */
export const leavesRoom = (a: AgentAction): boolean =>
  a.type === 'go_to_room' || a.type === 'play_flow' || a.type === 'back_to_city';

/**
 * True when the visitor plainly asked to leave the building. It backs up the
 * model, and the offline answers, so "take me back to the city" always works
 * by voice alone.
 */
const LEAVE_PATTERNS = [
  // "take me out", "get me back out"
  /\b(take|bring|send|get|let) me (back )?out\b/i,
  // "take me back to the table"
  /\bme back to (the |my )?(city|table|desk|map|diorama|start)\b/i,
  // "back to the city" in any sentence; a table or a map can be part of the code, a city cannot
  /\bback to (the |my )?(city|desk|diorama)\b/i,
  // "go back to the table", as a request and not in the middle of a question
  /(^|[.,!?] ?)(please |ok(ay)?,? |thanks,? )*(go|head) back to (the |my )?(city|table|desk|map)\b/i,
  // "I'd like to leave", "can we go back", "let's step out"
  /\b(i'?d like to|i would like to|i want to|can i|can we|let'?s|let me|i'?ll|time to) (leave|exit|go back|head back|step out)\b/i,
  // "leave this room", as a request
  /(^|[.,!?] ?)(please |ok(ay)?,? |thanks,? )*(leave|exit) (this|the) (room|building)\b/i,
];
export const asksToLeave = (question: string): boolean => LEAVE_PATTERNS.some((p) => p.test(question));

/** Words that do not tell one room or flow from another. */
const SMALL_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'your', 'room']);

/** The telling words of a room or flow name: "Billing day" gives billing, day. */
const nameWords = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SMALL_WORDS.has(w));

/** Where `word` is in `text`, in any simple form ("skip", "skips", "skipping"), or -1. Both are lower case. */
const wordAt = (text: string, word: string): number => text.search(new RegExp(`\\b${word.replace(/s$/, '')}(s|es|ed|[a-z]?ing)?\\b`));

interface Named {
  id: string;
  /** Higher is a surer match: the whole name beats every word, which beats some. */
  score: number;
  /** Where in the text the name starts. */
  at: number;
}

/** The other rooms a lower-case text names, surest first. */
function roomsNamed(graph: GraphData, nodeId: string, text: string): Named[] {
  const found: Named[] = [];
  for (const n of graph.nodes) {
    if (n.id === nodeId) continue;
    const label = n.label.toLowerCase();
    const whole = text.search(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    if (whole >= 0) {
      found.push({ id: n.id, score: 100 + label.length, at: whole });
      continue;
    }
    const words = nameWords(n.label);
    const hits = words.map((w) => wordAt(text, w)).filter((at) => at >= 0);
    if (hits.length === 0) continue;
    found.push({ id: n.id, score: hits.length === words.length ? 50 + hits.length : hits.length, at: Math.min(...hits) });
  }
  return found.sort((a, b) => b.score - a.score);
}

/** The matches that share the best score: one when the text is clear, several when it is not. */
const surest = (found: Named[]): Named[] => found.filter((f) => f.score === found[0].score);

/** "Take me to Checkout": a request to move that needs no promise from the robot. */
const GO_PLAIN =
  /\b(take|send|bring|walk|get) me (over |across )?to\b|\b(i'?d like to|i would like to|i want to|can i|can we|could we|let'?s|let me) (go|head|pop|walk) (over )?to\b|(^|[.,!?] ?)(please |ok(ay)?,? |now )*(go|head) (over )?to\b/i;
/** Looser ways to ask, or a yes to the robot's offer. These count only when the robot then says it is sending you. */
const GO_LOOSE =
  /\b(take|send|bring|walk) me\b|\bgo to\b|\bvisit\b|\bhead (over|to)\b|\bcan i see\b|^(yes|yeah|yep|sure|ok|okay|please|do it|go ahead|let'?s)\b/i;
/** "Show me...", "walk me through...": a request to watch a flow. */
const WATCH = /\b(show|play|watch|replay|demo|(walk|take|talk) me through)\b/i;
/** The robot saying it is moving the visitor now. */
const PROMISE =
  /\b(send(ing)? you|tak(e|ing) you|walk(ing)? you|bring(ing)? you|head(ing)? (you )?over|over you go|off you go|let'?s (go|head))\b/i;
/** The same words as an offer or a question, which is not yet a promise. */
const OFFER = /\b(if you|want me to|would you like|shall i|should i|can|could|happy to)\b/i;

/** Where in its answer the robot promises to move the visitor, or -1. */
function promiseAt(answer: string): number {
  for (const sentence of answer.matchAll(/[^.!?]+[.!?]*/g)) {
    const s = sentence[0];
    const at = s.search(PROMISE);
    // "I can send you" is an offer; "I'm sending you so you can see" is not.
    if (at >= 0 && !s.trim().endsWith('?') && !OFFER.test(s.slice(0, at))) return sentence.index + at;
  }
  return -1;
}

/** The one flow a lower-case question names, if any. */
function flowNamed(graph: GraphData, question: string): string | null {
  const said = /\b(flow|play)\b/.test(question);
  let best: { id: string; hits: number } | null = null;
  let tied = false;
  for (const flow of graph.flows) {
    const words = nameWords(flow.title);
    const hits = words.filter((w) => wordAt(question, w) >= 0).length;
    // One word is enough after "play" or "flow"; otherwise most of the title.
    if (hits < (said ? 1 : Math.min(2, words.length)) || hits === 0) continue;
    if (best && hits === best.hits) tied = true;
    else if (!best || hits > best.hits) {
      best = { id: flow.id, hits };
      tied = false;
    }
  }
  return best && !tied ? best.id : null;
}

/**
 * What the visitor plainly asked to be done, read from their own words and
 * the robot's spoken answer, with no model. It backs the model up when it says
 * "I'll send you over" and then does not, and it is all the offline answers
 * have. So moving between rooms, watching a flow and leaving always work by
 * voice. Returns null when the words are not clear enough to act on.
 */
export function plainRequest(graph: GraphData, nodeId: string, question: string, answer = ''): AgentAction | null {
  if (asksToLeave(question)) return { type: 'back_to_city' };
  const q = question.toLowerCase();
  if (WATCH.test(q)) {
    const flowId = flowNamed(graph, q);
    if (flowId) return { type: 'play_flow', flowId };
  }
  const promise = promiseAt(answer);
  const plain = GO_PLAIN.test(q);
  if (!plain && !(promise >= 0 && GO_LOOSE.test(q))) return null;

  const asked = roomsNamed(graph, nodeId, q);
  const clear = asked.length ? surest(asked) : [];
  // Half a name is enough after "take me to": "the kitchen" is Kitchen dashboard.
  // After "take me there" it is not: the room is the one the robot went on to name.
  if (clear.length === 1 && (plain || clear[0].score >= 50)) return { type: 'go_to_room', roomId: clear[0].id };
  if (promise < 0) return null;
  // The question names no room, or could mean several: the robot's answer says which.
  const said = roomsNamed(graph, nodeId, answer.toLowerCase());
  const both = plain ? said.filter((s) => clear.some((c) => c.id === s.id)) : [];
  const pool = both.length ? both : said;
  if (pool.length === 0) return null;
  // Of equally sure names, the one spoken nearest the promise is where they are going.
  const [to] = surest(pool).sort((a, b) => Math.abs(a.at - promise) - Math.abs(b.at - promise));
  return { type: 'go_to_room', roomId: to.id };
}

/**
 * Now and then the model says "that goes to Stripe, I'll send you over there"
 * and then calls the tool with some other room. The visitor heard the words,
 * so when they name exactly one room in full, and never the room the model
 * picked, the words win. Returns that room, or null to keep the model's pick.
 */
export function spokenRoom(graph: GraphData, nodeId: string, answer: string, pickedId: string): string | null {
  const promise = promiseAt(answer);
  if (promise < 0) return null;
  const said = roomsNamed(graph, nodeId, answer.toLowerCase());
  if (said.some((s) => s.id === pickedId)) return null;
  const full = said.filter((s) => s.score >= 100);
  if (full.length !== 1) return null;
  // Only when the promise points back at it ("over there") or names it itself.
  const rest = answer.slice(promise).split(/[.!?]/)[0];
  const inPromise = full[0].at >= promise && full[0].at < promise + rest.length;
  return inPromise || /\bthere\b/i.test(rest) ? full[0].id : null;
}

/** Keeps only tool calls that name real rooms, flows and files. */
export function validateActions(
  graph: GraphData,
  nodeId: string,
  calls: { name: string; args: Record<string, unknown> }[],
): AgentAction[] {
  const actions: AgentAction[] = [];
  const room = (v: unknown) => (typeof v === 'string' && graph.nodes.some((n) => n.id === v) ? v : null);
  for (const { name, args } of calls) {
    if (name === 'go_to_room' || name === 'point_to_room') {
      const id = room(args.room_id);
      if (id && id !== nodeId && !actions.some((a) => a.type === name)) actions.push({ type: name, roomId: id });
    } else if (name === 'play_flow') {
      const flow = graph.flows.find((f) => f.id === args.flow_id);
      if (flow) actions.push({ type: 'play_flow', flowId: flow.id });
    } else if (name === 'show_file') {
      const file = graph.files.find((f) => f.p === args.path && f.n === nodeId);
      if (file && !actions.some((a) => a.type === 'show_file')) actions.push({ type: 'show_file', path: file.p });
    } else if (name === 'back_to_city') {
      actions.push({ type: 'back_to_city' });
    }
  }
  // Leaving the room or starting a flow ends the conversation; keep only the first.
  const leave = actions.findIndex(leavesRoom);
  return actions.filter((a, i) => (leavesRoom(a) ? i === leave : true));
}

/** Starter questions for a room, before any conversation. */
export function suggestedQuestions(graph: GraphData, nodeId: string): string[] {
  const questions = ['What do you do here?'];
  const flow = graph.flows.find((f) => f.steps.some((s) => resolveRef(graph, s.ref) === nodeId));
  if (flow) questions.push(`What happens here during ${flow.title.toLowerCase()}?`);
  const warned = (graph.health?.issues ?? []).some((i) =>
    (i.locations ?? []).some((loc) => resolveRef(graph, loc.file) === nodeId),
  );
  questions.push(warned ? 'What is the warning about?' : 'What could go wrong here?');
  questions.push('Who do you work with?');
  return questions;
}

/** Splits a model reply into the spoken answer and its follow-up questions. */
export function parseReply(text: string): { answer: string; followups: string[] } {
  const match = text.match(/^\s*FOLLOWUPS:\s*(.+)$/im);
  // Bubbles and speech are plain text: drop Markdown marks the model adds.
  const answer = (match ? text.slice(0, match.index) : text)
    .replace(/[`*_#]/g, '')
    .replace(/\s+—\s+/g, ' - ')
    // Words said before and after a tool call arrive joined: "the building.I'm Eli".
    .replace(/([a-z][.!?])(?=[A-Z][a-z' ])/g, '$1 ')
    .trim();
  const followups = match
    ? match[1]
        .split('|')
        .map((q) => q.trim().replace(/^["']|["']$/g, ''))
        .filter((q) => q.length > 0 && q.length < 80)
        .slice(0, 2)
    : [];
  return { answer, followups };
}

/**
 * A grounded answer without the model, used when the server is unreachable or
 * has no key. It only restates facts, so it is never wrong, just less chatty.
 */
export function offlineAnswer(graph: GraphData, nodeId: string, question: string, persona: Persona): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return "I'm not sure which room this is.";
  const facts = roomFacts(graph, nodeId);
  const q = question.toLowerCase();
  const find = (prefix: string) => facts.find((f) => f.startsWith(prefix));
  if (q.includes('warning') || q.includes('wrong')) {
    return find('Health warning')?.replace(/^Health warning \(\w+\): /, 'Heads up: ') ?? `Nothing is flagged in ${node.label} right now.`;
  }
  if (q.includes('work with') || q.includes('who')) {
    const parts = [find('Work comes in from'), find('This room sends work to')].filter(Boolean);
    return parts.length ? parts.join('. ') + '.' : `${node.label} mostly keeps to itself.`;
  }
  if (q.includes('during') || q.includes('happens')) {
    const mine = facts.find((f) => f.includes('(THIS ROOM)'));
    if (mine) return `In that flow, this is my part: ${mine.split(': ').slice(1).join(': ')}`;
  }
  return `I'm ${persona.name}, the ${persona.role} here. ${node.summary}`;
}
