import { offlineAnswer, plainRequest, suggestedQuestions, type AgentAction, type ChatTurn, type Persona } from './prompt.js';
import type { GraphData } from '../maps/types.js';

/**
 * Talks to the /api/agent server function, and wraps the browser's speech
 * features. Everything degrades: no server or key means grounded offline
 * answers; no speech support means silent bubbles and question buttons only.
 */

export interface AgentAnswer {
  answer: string;
  followups: string[];
  actions: AgentAction[];
  offline: boolean;
}

export async function ask(
  mapId: string,
  graph: GraphData,
  nodeId: string,
  persona: Persona,
  question: string,
  history: ChatTurn[],
): Promise<AgentAnswer> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, nodeId, persona, question, history }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = (await response.json()) as { answer?: string; followups?: string[]; actions?: AgentAction[]; error?: string };
    if (!response.ok || (!json.answer && !json.actions?.length)) throw new Error(json.error ?? `HTTP ${response.status}`);
    return { answer: json.answer ?? '', followups: json.followups ?? [], actions: json.actions ?? [], offline: false };
  } catch (e) {
    console.warn('[agent] falling back to offline answer:', (e as Error).message);
    const others = suggestedQuestions(graph, nodeId).filter((q) => q !== question).slice(0, 2);
    // Moving by voice needs no model: it works with no server at all.
    const act = plainRequest(graph, nodeId, question);
    if (act) {
      let answer = 'Of course. Back to the city you go. Come and see us again.';
      if (act.type === 'go_to_room') {
        answer = `Sure. ${graph.nodes.find((n) => n.id === act.roomId)?.label ?? 'That room'} is just through here. I'll send you over.`;
      } else if (act.type === 'play_flow') {
        answer = `Watch closely. Here is ${graph.flows.find((f) => f.id === act.flowId)?.title ?? 'the flow'}, from start to finish.`;
      }
      return { answer, followups: [], actions: [act], offline: true };
    }
    return { answer: offlineAnswer(graph, nodeId, question, persona), followups: others, actions: [], offline: true };
  }
}

/**
 * Asks the server to mark an answer the visitor gave to a quiz question in
 * their own words. Null when it cannot be marked (no server, no key, too
 * slow): the caller then asks the visitor to pick one of the three answers.
 */
export async function markSpoken(
  mapId: string,
  nodeId: string,
  persona: Persona,
  questionId: string,
  said: string,
): Promise<{ right: boolean; say: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, nodeId, persona, question: said.slice(0, 300), quiz: questionId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = (await response.json()) as { answer?: string; right?: boolean; error?: string };
    if (!response.ok || typeof json.right !== 'boolean' || !json.answer) throw new Error(json.error ?? `HTTP ${response.status}`);
    return { right: json.right, say: json.answer };
  } catch (e) {
    console.warn('[agent] could not mark a spoken answer:', (e as Error).message);
    return null;
  }
}

// Speech lives in voice.ts.
export { speak, speakingSeconds, stopSpeaking, voiceLevel } from './voice.js';
