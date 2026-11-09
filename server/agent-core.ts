import {
  AGENT_TOOLS,
  parseReply,
  systemPrompt,
  validateActions,
  type AgentAction,
  type ChatTurn,
  type Persona,
} from '../src/agent/prompt.js';
import { MAPS } from '../src/maps/index.js';

/**
 * Answers one question to a room's worker through Meta's Model API
 * (dev.meta.ai; OpenAI-compatible chat completions at api.meta.ai/v1). Shared by the Vercel function (api/agent.ts)
 * and the local dev server (vite.config.ts).
 *
 * The client never sends a prompt: it names a bundled map and room, and the
 * server builds the grounded system prompt itself. Inputs are length-capped so
 * the endpoint cannot be used as a general-purpose chat proxy on your credits.
 */

export const MODEL_API_BASE = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-spark-1.3';

export interface AgentRequest {
  mapId: string;
  nodeId: string;
  question: string;
  persona: Persona;
  history?: ChatTurn[];
}

export interface AgentReply {
  answer: string;
  followups: string[];
  actions: AgentAction[];
}

export class AgentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const str = (v: unknown, max: number, field: string): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) {
    throw new AgentError(400, `${field} must be a non-empty string of at most ${max} characters`);
  }
  return v.trim();
};

export function validate(body: unknown): AgentRequest {
  if (!body || typeof body !== 'object') throw new AgentError(400, 'Expected a JSON body');
  const b = body as Record<string, unknown>;
  const mapId = str(b.mapId, 40, 'mapId');
  const graph = MAPS[mapId];
  if (!graph) throw new AgentError(404, `Unknown map "${mapId}"`);
  const nodeId = str(b.nodeId, 120, 'nodeId');
  if (!graph.nodes.some((n) => n.id === nodeId)) throw new AgentError(404, `Unknown room "${nodeId}"`);
  const p = (b.persona ?? {}) as Record<string, unknown>;
  const persona = { name: str(p.name, 30, 'persona.name'), role: str(p.role, 40, 'persona.role'), place: str(p.place, 40, 'persona.place') };
  const history: ChatTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const t of b.history.slice(-6)) {
      const turn = t as Record<string, unknown>;
      if ((turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string') {
        history.push({ role: turn.role, content: turn.content.slice(0, 700) });
      }
    }
  }
  return { mapId, nodeId, question: str(b.question, 300, 'question'), persona, history };
}

export async function askAgent(req: AgentRequest, apiKey: string | undefined, model = DEFAULT_MODEL): Promise<AgentReply> {
  if (!apiKey) throw new AgentError(503, 'MODEL_API_KEY is not set on the server');
  const graph = MAPS[req.mapId];
  const messages = [
    { role: 'system', content: systemPrompt(graph, req.nodeId, req.persona) },
    ...(req.history ?? []),
    { role: 'user', content: req.question },
  ];
  const response = await fetch(`${MODEL_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // Muse models reason by default; minimal keeps replies to a few seconds.
    // Reasoning tokens count against max_tokens, and a reply that runs out
    // mid-thought drops its tool calls, so leave plenty of room.
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1400,
      reasoning_effort: 'minimal',
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new AgentError(502, `Model API ${response.status}: ${detail}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  };
  const message = data.choices?.[0]?.message;
  const calls = (message?.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      // ignore malformed arguments
    }
    return { name: c.function?.name ?? '', args };
  });
  const leaked = extractLeakedCalls(message?.content ?? '');
  const actions = validateActions(graph, req.nodeId, [...calls, ...leaked.calls]);
  const text = leaked.text;
  const promised = goToFallback(graph, req.nodeId, req.question, text, actions);
  if (promised) actions.push(promised);
  if (!text.trim() && actions.length === 0) throw new AgentError(502, 'Model API returned an empty answer');
  return { ...parseReply(text), actions };
}

/**
 * The model sometimes promises to send the visitor somewhere ("I'm sending you
 * over") without calling go_to_room. When the visitor asked to go, the reply
 * promises it, and exactly one other room is named, keep the promise.
 */
function goToFallback(
  graph: (typeof MAPS)[string],
  nodeId: string,
  question: string,
  answer: string,
  actions: AgentAction[],
): AgentAction | null {
  if (actions.some((a) => a.type === 'go_to_room' || a.type === 'play_flow')) return null;
  const asked = /\b(take|send|bring|walk) me\b|\bgo to\b|\bvisit\b|\bhead (over|to)\b|\bcan i see\b/i.test(question);
  const promised = /\b(send(ing)? you|head(ing)? (you )?over|take you|walk you|over you go|let'?s go)\b/i.test(answer);
  if (!asked || !promised) return null;
  const haystack = ` ${question.toLowerCase()} `;
  const named = graph.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => ({ id: n.id, label: n.label.toLowerCase(), singular: n.label.toLowerCase().replace(/s$/, '') }))
    .filter((n) => haystack.includes(n.label) || new RegExp(`\\b${n.singular}\\b`).test(haystack))
    .sort((a, b) => b.label.length - a.label.length);
  return named.length > 0 ? { type: 'go_to_room', roomId: named[0].id } : null;
}

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Now and then the model writes a tool call into its text as XML-ish markup
 * (`<x:invoke name="default.gotoroom"><x:parameter name="roomid">…`) instead
 * of a structured call. Recover those calls and remove the markup from speech.
 */
export function extractLeakedCalls(content: string): { text: string; calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const invoke = /<[\w-]*:?invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/[\w-]*:?invoke>/g;
  for (const m of content.matchAll(invoke)) {
    const name = TOOL_NAMES.find((t) => squash(t) === squash(m[1].split('.').pop() ?? ''));
    if (!name) continue;
    const args: Record<string, unknown> = {};
    for (const p of m[2].matchAll(/<[\w-]*:?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/[\w-]*:?parameter>/g)) {
      const key = squash(p[1]);
      // Map squashed names (roomid, flowid, path) back to the schema's keys.
      const canonical = key === 'roomid' ? 'room_id' : key === 'flowid' ? 'flow_id' : key;
      args[canonical] = p[2].trim();
    }
    calls.push({ name, args });
  }
  const text = content
    .replace(/<([\w-]*:)?function_?calls>[\s\S]*?<\/([\w-]*:)?function_?calls>/gi, '')
    .replace(invoke, '')
    .trim();
  return { text, calls };
}

/** Request handler shared by both hosts: JSON in, JSON out. */
export async function handleAgent(body: unknown, apiKey: string | undefined, model?: string): Promise<{ status: number; json: unknown }> {
  try {
    const req = validate(body);
    const reply = await askAgent(req, apiKey, model || undefined);
    return { status: 200, json: reply };
  } catch (e) {
    if (e instanceof AgentError) return { status: e.status, json: { error: e.message } };
    return { status: 500, json: { error: 'Unexpected server error' } };
  }
}
