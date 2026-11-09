import { offlineAnswer, suggestedQuestions, type AgentAction, type ChatTurn, type Persona } from './prompt.js';
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
    return { answer: offlineAnswer(graph, nodeId, question, persona), followups: others, actions: [], offline: true };
  }
}

// ---------------------------------------------------------------- speech

/** Roughly how long a line takes to say, for pacing when there is no voice. */
export const speakingSeconds = (text: string): number => Math.max(1.2, text.length / 15);

/**
 * Says a line out loud if the browser can, and resolves when it is finished
 * (or after an estimated duration when there is no speech synthesis).
 */
export function speak(text: string, pitch = 1): Promise<void> {
  const estimate = speakingSeconds(text) * 1000;
  if (!('speechSynthesis' in window)) return new Promise((r) => setTimeout(r, estimate));
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.03;
    utterance.pitch = pitch;
    // Some engines never fire onend; never wait much longer than the estimate.
    const fallback = setTimeout(resolve, estimate + 2500);
    const done = () => {
      clearTimeout(fallback);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
