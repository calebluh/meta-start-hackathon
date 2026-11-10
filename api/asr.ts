import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { relayAsr } from '../server/asr-relay.js';
import { callerAddress } from '../server/rate-limit.js';

/**
 * Vercel Function: WebSocket /api/asr, live speech recognition for the open
 * microphone. Relays the headset's audio to Meta's realtime transcription
 * with MODEL_API_KEY, which therefore never reaches the page. See
 * server/asr-relay.ts for the protocol and its limits.
 */
const server = createServer((_request, response) => {
  response.writeHead(426, { 'Content-Type': 'text/plain' });
  response.end('Expected a WebSocket connection');
});

// One audio frame is 2.5 kB; nothing the headset sends is near this size.
const sockets = new WebSocketServer({ server, maxPayload: 64 * 1024 });
sockets.on('connection', (socket, request) => {
  relayAsr(
    socket,
    process.env.MODEL_API_KEY ?? process.env.LLAMA_API_KEY,
    callerAddress(request.headers['x-forwarded-for'], request.socket.remoteAddress ?? 'unknown'),
  );
});

export default server;
