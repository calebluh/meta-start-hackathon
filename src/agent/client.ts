import { asksToLeave, offlineAnswer, suggestedQuestions, type AgentAction, type ChatTurn, type Persona } from './prompt.js';
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
    // Leaving by voice needs no model: it works with no server at all.
    if (asksToLeave(question)) {
      return { answer: 'Of course. Back to the city you go. Come and see us again.', followups: [], actions: [{ type: 'back_to_city' }], offline: true };
    }
    return { answer: offlineAnswer(graph, nodeId, question, persona), followups: others, actions: [], offline: true };
  }
}

// Speech lives in voice.ts.
export { speak, speakingSeconds, stopSpeaking, voiceLevel } from './voice.js';
