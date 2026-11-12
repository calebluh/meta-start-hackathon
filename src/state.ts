import { resolveRef } from './layout.js';
import { HACKATHON } from './edition.js';
import { DEFAULT_MAP, MAPS } from './maps/index.js';
import type { Flow, GraphData } from './maps/types.js';

/**
 * Shared app state for the tabletop and room views. Systems read it every
 * frame or subscribe with `onChange`; only the functions below change it.
 */
export interface FlowStepState {
  nodeId: string;
  note: string;
}

export const app = {
  /** Id of the bundled map, as the agent server knows it. */
  mapId: DEFAULT_MAP,
  /** The start menu is up: pick a demo before anything else shows. */
  menu: HACKATHON,
  graph: MAPS[DEFAULT_MAP] as GraphData,
  /** `table`: the diorama on the desk. `room`: sitting inside one part. */
  mode: 'table' as 'table' | 'room',
  /** Street view: the city is life size around the visitor instead of on the desk. */
  street: false,
  roomNode: null as string | null,
  selected: null as string | null,
  flowIndex: 0,
  flowSteps: [] as FlowStepState[],
  /** -1 when no flow is running. */
  stepIndex: -1,
  playing: false,
  /** In a room, jump to the next room when the packet leaves. */
  follow: true,
  /** Set when a worker sends the visitor to another room, so its worker can pick up the thread. */
  handoff: null as Handoff | null,
  /** A worker is quizzing the visitor: the room's notes are put away until it ends. */
  quiz: false,
};

export interface Handoff {
  toRoom: string;
  fromWorker: string;
  fromRoom: string;
  /** The room left, so the colleague can come in through the pipe from it. */
  fromRoomId: string;
  question: string;
  answer: string;
}

const listeners = new Set<() => void>();

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  // Development: a one-line state trace, for automated interaction tests.
  if (import.meta.env.DEV) {
    console.log(`[state] menu=${app.menu} map=${app.mapId} mode=${app.mode} room=${app.roomNode} selected=${app.selected} step=${app.stepIndex} flow=${app.flowIndex}`);
  }
  for (const l of listeners) l();
}

export function currentFlow(): Flow | undefined {
  return app.graph.flows[app.flowIndex];
}

export function currentStep(): FlowStepState | undefined {
  return app.stepIndex >= 0 ? app.flowSteps[app.stepIndex] : undefined;
}

export function select(id: string | null): void {
  app.selected = id;
  if (app.stepIndex >= 0) stopFlow(false);
  emit();
}

export function startFlow(autoplay = true): void {
  const flow = currentFlow();
  if (!flow) return;
  app.flowSteps = flow.steps
    .map((s) => ({ nodeId: resolveRef(app.graph, s.ref) ?? '', note: s.note }))
    .filter((s) => app.graph.nodes.some((n) => n.id === s.nodeId));
  if (app.flowSteps.length === 0) return;
  app.playing = autoplay;
  app.stepIndex = 0;
  if (app.mode === 'room' && app.follow) app.roomNode = app.flowSteps[0].nodeId;
  emit();
}

export function stopFlow(notify = true): void {
  app.playing = false;
  app.stepIndex = -1;
  if (notify) emit();
}

/** Moves to the next step, or ends the flow after the last one. */
export function nextStep(): void {
  if (app.stepIndex < 0) {
    startFlow(false);
    return;
  }
  if (app.stepIndex + 1 >= app.flowSteps.length) {
    stopFlow();
    return;
  }
  app.stepIndex += 1;
  if (app.mode === 'room' && app.follow) app.roomNode = app.flowSteps[app.stepIndex].nodeId;
  emit();
}

export function cycleFlow(): void {
  stopFlow(false);
  app.flowIndex = (app.flowIndex + 1) % Math.max(app.graph.flows.length, 1);
  emit();
}

/** Switches to another codebase: back to the table, nothing selected or playing. */
export function setMap(id: string): void {
  const graph = MAPS[id];
  if (!graph || id === app.mapId) return;
  app.mapId = id;
  app.graph = graph;
  app.street = false;
  app.mode = 'table';
  app.roomNode = null;
  app.selected = null;
  app.flowIndex = 0;
  app.flowSteps = [];
  app.stepIndex = -1;
  app.playing = false;
  app.handoff = null;
  emit();
}

export function cycleMap(): void {
  const ids = Object.keys(MAPS);
  setMap(ids[(ids.indexOf(app.mapId) + 1) % ids.length]);
}

/** Switches between the city on the desk (map view) and walking its streets. */
export function setStreet(on: boolean): void {
  if (app.street === on || app.mode !== 'table') return;
  app.street = on;
  app.selected = null;
  emit();
}

/** Back to the start menu, from the table or a room. */
export function openMenu(): void {
  app.menu = true;
  app.street = false;
  app.mode = 'table';
  app.roomNode = null;
  app.selected = null;
  app.stepIndex = -1;
  app.playing = false;
  app.handoff = null;
  emit();
}

/** Closes the menu on the chosen demo codebase. */
export function chooseDemo(id: string): void {
  app.menu = false;
  if (id !== app.mapId && MAPS[id]) setMap(id);
  else emit();
}

export function enterRoom(id: string): void {
  app.menu = false;
  app.mode = 'room';
  app.roomNode = id;
  emit();
}

/** Puts the room's notes away for a quiz, or brings them back. */
export function setQuiz(on: boolean): void {
  if (app.quiz === on) return;
  app.quiz = on;
  emit();
}

export function leaveRoom(): void {
  app.quiz = false;
  app.mode = 'table';
  app.roomNode = null;
  app.handoff = null;
  emit();
}
