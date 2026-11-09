import { MODEL_API_BASE } from './agent-core.js';

/**
 * Relays live speech recognition between the headset and Meta's realtime
 * transcription WebSocket. The headset cannot connect directly: Meta expects
 * the API key inside the first frame, and the key must never reach a browser.
 *
 * Protocol with the headset:
 *  1. headset → relay: one JSON text frame `{ "keywords": [...] }` (optional
 *     words to bias recognition toward, such as room and file names);
 *  2. headset → relay: binary frames of 16 kHz mono 16-bit PCM, in real time;
 *  3. relay → headset: Meta's JSON events, passed through unchanged
 *     (`speechStart`, `transcript` partials, `speechEnd`, `speechComplete`).
 *
 * Host-agnostic: works with anything shaped like a `ws` WebSocket.
 */

export interface SocketLike {
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  readonly readyState: number;
}

const REALTIME_URL = `${MODEL_API_BASE.replace(/^http/, 'ws')}/asr/realtime`;
const OPEN = 1;
/** A conversation is short; cap a session so a forgotten mic can't run up costs. */
const MAX_SESSION_MS = 5 * 60 * 1000;
/** Real-time 16 kHz 16-bit audio is 32 kB/s; allow headroom, drop anything far beyond. */
const MAX_BYTES_PER_SECOND = 64 * 1024;

export function relayAsr(client: SocketLike, apiKey: string | undefined): void {
  if (!apiKey) {
    client.send(JSON.stringify({ type: 'error', message: 'MODEL_API_KEY is not set on the server' }));
    client.close(1011, 'no key');
    return;
  }

  let upstream: WebSocket | null = null;
  let upstreamReady = false;
  const pending: Uint8Array[] = [];
  let closed = false;
  let windowStart = Date.now();
  let windowBytes = 0;

  const shutdown = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    clearTimeout(limit);
    try {
      if (upstream?.readyState === OPEN) upstream.send(JSON.stringify({ type: 'endStream' }));
      upstream?.close();
    } catch {
      // already gone
    }
    if (client.readyState === OPEN) client.close(code, reason);
  };
  const limit = setTimeout(() => shutdown(1000, 'session limit'), MAX_SESSION_MS);

  const start = (keywords: string[]) => {
    upstream = new WebSocket(REALTIME_URL);
    upstream.binaryType = 'arraybuffer';
    upstream.onopen = () => {
      upstream!.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${apiKey}` },
          audioEncoding: 'PCM_16KHZ',
          model: 'muse-voice-transcribe-1.0',
          mode: 'ENDPOINTING',
          ...(keywords.length ? { keywords } : {}),
        }),
      );
    };
    upstream.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      if (!upstreamReady) {
        // The handshake acknowledgement carries a sessionId and no type.
        try {
          const ack = JSON.parse(event.data) as { sessionId?: string; type?: string };
          if (ack.sessionId && !ack.type) {
            upstreamReady = true;
            client.send(JSON.stringify({ type: 'ready' }));
            for (const chunk of pending.splice(0)) upstream!.send(chunk);
            return;
          }
        } catch {
          // fall through and forward as-is
        }
      }
      // Progress ticks arrive every 80 ms and the headset has no use for them.
      if (event.data.includes('"audioProgress"')) return;
      if (client.readyState === OPEN) client.send(event.data);
    };
    upstream.onerror = () => {
      if (client.readyState === OPEN) client.send(JSON.stringify({ type: 'error', message: 'transcription service error' }));
    };
    upstream.onclose = (event) => shutdown(event.code === 1000 ? 1000 : 1011, event.reason || 'upstream closed');
  };

  let configured = false;
  client.on('message', (data, isBinary) => {
    if (closed) return;
    if (!isBinary) {
      if (configured) return;
      configured = true;
      let keywords: string[] = [];
      try {
        const msg = JSON.parse(String(data)) as { keywords?: unknown };
        if (Array.isArray(msg.keywords)) {
          keywords = msg.keywords
            .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 40)
            .slice(0, 40);
        }
      } catch {
        // no keywords
      }
      start(keywords);
      return;
    }
    if (!configured) {
      configured = true;
      start([]);
    }
    const chunk = toBytes(data);
    if (!chunk) return;
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      windowBytes = 0;
    }
    windowBytes += chunk.byteLength;
    if (windowBytes > MAX_BYTES_PER_SECOND) return; // faster than real time: drop
    if (upstreamReady && upstream?.readyState === OPEN) upstream.send(chunk);
    else if (pending.length < 50) pending.push(chunk);
  });
  client.on('close', () => shutdown());
  client.on('error', () => shutdown(1011, 'client error'));
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const parts = data.filter((d): d is Uint8Array => d instanceof Uint8Array);
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    return out;
  }
  return null;
}
