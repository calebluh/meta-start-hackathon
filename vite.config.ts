/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { WebSocketServer } from 'ws';

/**
 * Serves POST /api/agent during development with the same handler the Vercel
 * function uses, reading MODEL_API_KEY from .env.local (never sent to the page).
 */
function agentApi(): Plugin {
  return {
    name: 'agent-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');

      // Live speech recognition: relay WebSocket upgrades on /api/asr.
      const asrSockets = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/api/asr')) return; // leave Vite's own HMR socket alone
        asrSockets.handleUpgrade(req, socket, head, async (client) => {
          const { relayAsr } = (await server.ssrLoadModule('/server/asr-relay.ts')) as typeof import('./server/asr-relay');
          relayAsr(client, env.MODEL_API_KEY ?? env.LLAMA_API_KEY, req.socket.remoteAddress ?? 'local');
        });
      });
      server.middlewares.use('/api/agent', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', async () => {
          const { handleAgent } = (await server.ssrLoadModule('/server/agent-core.ts')) as typeof import('./server/agent-core');
          let body: unknown = null;
          try {
            body = JSON.parse(raw);
          } catch {
            // handleAgent reports the bad body
          }
          const { status, json } = await handleAgent(body, env.MODEL_API_KEY ?? env.LLAMA_API_KEY, env.MODEL_NAME, req.socket.remoteAddress ?? 'local');
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        });
      });
      server.middlewares.use('/api/tts', (req, res) => {
        const send = async (result: { status: number; audio?: Uint8Array; json?: unknown }) => {
          res.statusCode = result.status;
          if (result.audio) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.end(Buffer.from(result.audio));
          } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.json));
          }
        };
        const load = async () => (await server.ssrLoadModule('/server/tts-core.ts')) as typeof import('./server/tts-core');
        if (req.method === 'GET') {
          void load().then((m) => send(m.ttsStatus(env.OPENAI_API_KEY)));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', async () => {
          let body: unknown = null;
          try {
            body = JSON.parse(raw);
          } catch {
            // handleTts reports the bad body
          }
          const m = await load();
          await send(await m.handleTts(body, env.OPENAI_API_KEY, req.socket.remoteAddress ?? 'local'));
        });
      });
      server.middlewares.use('/api/transcribe', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          const { handleTranscribe } = (await server.ssrLoadModule('/server/transcribe-core.ts')) as typeof import('./server/transcribe-core');
          const { status, json } = await handleTranscribe(new Uint8Array(Buffer.concat(chunks)), env.MODEL_API_KEY ?? env.LLAMA_API_KEY, req.socket.remoteAddress ?? 'local');
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), agentApi()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
