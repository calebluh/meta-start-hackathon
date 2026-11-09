import { resolveRef } from './layout.js';
import { larder } from './maps/larder.js';
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
  mapId: 'larder',
  graph: larder as GraphData,
  /** `table`: the diorama on the desk. `room`: sitting inside one part. */
  mode: 'table' as 'table' | 'room',
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
};

export interface Handoff {
  toRoom: string;
  fromWorker: string;
  fromRoom: string;
  question: string;
  answer: string;
}

const listeners = new Set<() => void>();

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
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

export function enterRoom(id: string): void {
  app.mode = 'room';
  app.roomNode = id;
  emit();
}

export function leaveRoom(): void {
  app.mode = 'table';
  app.roomNode = null;
  emit();
}
