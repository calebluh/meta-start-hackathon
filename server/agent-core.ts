import {
  AGENT_TOOLS,
  leavesRoom,
  parseReply,
  plainRequest,
  spokenRoom,
  systemPrompt,
  validateActions,
  type AgentAction,
  type ChatTurn,
  type Persona,
} from '../src/agent/prompt.js';
import { gradingPrompt, parseVerdict, quizFor } from '../src/agent/quiz.js';
import { MAPS } from '../src/maps/index.js';
import { createLimiter } from './rate-limit.js';

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
const UPSTREAM_TIMEOUT_MS = 14_000;
/** A spoken answer shorter than this, with nowhere to go, is treated as unfinished. */
const THIN_ANSWER = 90;
/** Do not start a second request with less time than this left. */
const MIN_SECOND_TRY_MS = 3_500;
/** Marking a quiz answer is one short reply; the visitor is waiting for a yes or no. */
const MARK_TIMEOUT_MS = 9_000;

export interface AgentRequest {
  mapId: string;
  nodeId: string;
  question: string;
  persona: Persona;
  history?: ChatTurn[];
  /**
   * Set when `question` is the visitor's spoken answer to one of the room's
   * quiz questions: the id of that question. The question, its right answer
   * and the marking instructions all come from the map, never the client.
   */
  quiz?: string;
}

export interface AgentReply {
  answer: string;
  followups: string[];
  actions: AgentAction[];
  /** Only when marking a quiz answer: whether the visitor had it right. */
  right?: boolean;
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

/**
 * A worker's name, job and workplace are short plain phrases ("Bolt", "line
 * cook", "kitchen"). Anything else is refused, so these fields cannot carry
 * instructions into the prompt.
 */
const phrase = (v: unknown, max: number, field: string): string => {
  const text = str(v, max, field);
  if (!/^[\p{L}\p{N} .,'&()\/-]+$/u.test(text)) throw new AgentError(400, `${field} may only contain letters, numbers and simple punctuation`);
  return text;
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
  const persona = { name: phrase(p.name, 30, 'persona.name'), role: phrase(p.role, 40, 'persona.role'), place: phrase(p.place, 40, 'persona.place') };
  const history: ChatTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const t of b.history.slice(-6)) {
      const turn = t as Record<string, unknown>;
      if ((turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string') {
        history.push({ role: turn.role, content: turn.content.slice(0, 700) });
      }
    }
  }
  let quiz: string | undefined;
  if (b.quiz !== undefined) {
    quiz = str(b.quiz, 80, 'quiz');
    if (!quizFor(graph, nodeId).some((q) => q.id === quiz)) throw new AgentError(404, `Unknown quiz question "${quiz}"`);
  }
  return { mapId, nodeId, question: str(b.question, 300, 'question'), persona, history, quiz };
}

/** Marks an answer the visitor gave to a quiz question in their own words. */
export async function markAnswer(req: AgentRequest, apiKey: string | undefined, model = DEFAULT_MODEL): Promise<AgentReply> {
  if (!apiKey) throw new AgentError(503, 'MODEL_API_KEY is not set on the server');
  const graph = MAPS[req.mapId];
  const question = quizFor(graph, req.nodeId).find((q) => q.id === req.quiz);
  if (!question) throw new AgentError(404, 'Unknown quiz question');
  const room = graph.nodes.find((n) => n.id === req.nodeId)?.label ?? req.nodeId;
  const reply = await complete(
    [
      { role: 'system', content: gradingPrompt(question, req.persona, room) },
      { role: 'user', content: req.question },
    ],
    apiKey,
    model,
    MARK_TIMEOUT_MS,
    false,
  );
  const verdict = parseVerdict(reply.text);
  if (!verdict) throw new AgentError(502, 'Model API returned no verdict');
  // The fact is always said, even if the model only wrote the verdict.
  const say = verdict.say || (verdict.right ? "That's right." : `Not quite. ${question.explain}`);
  return { answer: say, followups: [], actions: [], right: verdict.right };
}

export async function askAgent(req: AgentRequest, apiKey: string | undefined, model = DEFAULT_MODEL): Promise<AgentReply> {
  if (!apiKey) throw new AgentError(503, 'MODEL_API_KEY is not set on the server');
  const graph = MAPS[req.mapId];
  const messages = [
    { role: 'system', content: systemPrompt(graph, req.nodeId, req.persona) },
    ...(req.history ?? []),
    { role: 'user', content: req.question },
  ];
  const started = Date.now();
  const first = await complete(messages, apiKey, model, UPSTREAM_TIMEOUT_MS);
  let text = first.text;
  const calls = first.calls;
  let actions = validateActions(graph, req.nodeId, calls);

  // A quick model sometimes says one line ("here's what I do"), calls a tool
  // and stops, waiting to hear how the tool went before it carries on. Or it
  // answers with a single throwaway line. Give it one more turn to finish.
  const left = UPSTREAM_TIMEOUT_MS - (Date.now() - started);
  if (!actions.some(leavesRoom) && parseReply(text).answer.length < THIN_ANSWER && left > MIN_SECOND_TRY_MS) {
    try {
      if (first.raw.tool_calls?.length) {
        const more = await complete(
          [
            ...messages,
            { role: 'assistant', content: first.raw.content ?? '', tool_calls: first.raw.tool_calls },
            ...first.raw.tool_calls.map((c) => ({ role: 'tool', tool_call_id: c.id ?? '', content: 'Done. Now say your full answer to the visitor.' })),
          ],
          apiKey,
          model,
          left,
        );
        // The second turn usually says everything; keep the first line only
        // when the second is itself short.
        text = parseReply(more.text).answer.length >= THIN_ANSWER ? more.text : `${parseReply(text).answer} ${more.text}`.trim();
        actions = validateActions(graph, req.nodeId, [...calls, ...more.calls]);
      } else {
        const again = await complete(messages, apiKey, model, left);
        if (parseReply(again.text).answer.length > parseReply(text).answer.length) {
          text = again.text;
          actions = validateActions(graph, req.nodeId, again.calls);
        }
      }
    } catch {
      // Keep the short answer: it is better than none.
    }
  }

  // The model sometimes says "I'm sending you over" and then calls no tool.
  // When the visitor's words are plain, keep the promise for it.
  if (!actions.some(leavesRoom)) {
    const kept = plainRequest(graph, req.nodeId, req.question, text);
    if (kept) actions.push(kept);
  }
  // And sometimes it names one room aloud and calls the tool with another.
  for (const action of actions) {
    if (action.type !== 'go_to_room') continue;
    const said = spokenRoom(graph, req.nodeId, text, action.roomId);
    if (said) action.roomId = said;
  }
  if (!text.trim() && actions.length === 0) throw new AgentError(502, 'Model API returned an empty answer');
  const reply = parseReply(text);
  // Promises to move are checked above against the full words; only now is it
  // safe to drop an opening line that talks about the answer.
  if (!actions.some(leavesRoom)) reply.answer = dropLeadIn(reply.answer);
  return { ...reply, actions };
}

/**
 * An opening sentence that announces the answer instead of giving it: "I'm on
 * it - answering what I do here.", "Your cashier's ready - I'll get his
 * plain-spoken intro."
 */
const LEAD_IN =
  /^[^.!?]{0,140}\b(?:I'll explain|I'll (?:have|let) (?:him|her|them) |I'll (?:get|give) (?:you )?(?:his|her|their|my|a|the) [^.!?]{0,40}(?:intro|answer|run-?down|version|take)|I'm on it|answering what|here(?:'s| is) what I do|plain-spoken)\b[^.!?]{0,140}[.!?]\s+(?=\S)/i;

/** Removes such a sentence when a full answer follows it. */
export function dropLeadIn(answer: string): string {
  const rest = answer.replace(LEAD_IN, '');
  return rest !== answer && rest.length >= THIN_ANSWER ? rest : answer;
}

interface RawCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface RawMessage {
  content?: string | null;
  tool_calls?: RawCall[];
}

/** One request to the model: the words it said, the tools it called, and the message as it came. */
async function complete(
  messages: unknown[],
  apiKey: string,
  model: string,
  timeoutMs: number,
  withTools = true,
): Promise<{ text: string; calls: { name: string; args: Record<string, unknown> }[]; raw: RawMessage }> {
  const response = await fetch(`${MODEL_API_BASE}/chat/completions`, {
    method: 'POST',
    // The headset stops waiting after 15 seconds; do not keep paying after that.
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // Muse models reason by default; minimal keeps replies to a few seconds.
    // Reasoning tokens count against max_tokens, and a reply that runs out
    // mid-thought drops its tool calls, so leave plenty of room.
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1400,
      reasoning_effort: 'minimal',
      ...(withTools ? { tools: AGENT_TOOLS, tool_choice: 'auto' } : {}),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new AgentError(502, `Model API ${response.status}: ${detail}`);
  }
  const data = (await response.json()) as { choices?: { message?: RawMessage }[] };
  const message = data.choices?.[0]?.message ?? {};
  const calls = (message.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      // ignore malformed arguments
    }
    return { name: c.function?.name ?? '', args };
  });
  const leaked = extractLeakedCalls(message.content ?? '');
  return { text: leaked.text, calls: [...calls, ...leaked.calls], raw: message };
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

/** A conversation is a question every few seconds; nobody needs more than this. */
const perMinute = createLimiter(20, 60_000);
const perHour = createLimiter(240, 60 * 60_000);
/** Across all visitors, so one busy day cannot empty the owner's credits. */
const everyone = createLimiter(4000, 24 * 60 * 60_000);

/** Request handler shared by both hosts: JSON in, JSON out. `address` is who is asking, for the rate limit. */
export async function handleAgent(
  body: unknown,
  apiKey: string | undefined,
  model?: string,
  address = 'local',
): Promise<{ status: number; json: unknown }> {
  try {
    const req = validate(body);
    if (apiKey && !(perMinute.allow(address) && perHour.allow(address) && everyone.allow('all'))) {
      throw new AgentError(429, 'Too many questions; try again in a minute');
    }
    const reply = await (req.quiz ? markAnswer(req, apiKey, model || undefined) : askAgent(req, apiKey, model || undefined));
    return { status: 200, json: reply };
  } catch (e) {
    if (e instanceof AgentError) return { status: e.status, json: { error: e.message } };
    if ((e as Error)?.name === 'TimeoutError') return { status: 504, json: { error: 'The model took too long to answer' } };
    return { status: 500, json: { error: 'Unexpected server error' } };
  }
}
