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
      // Notes spoken in the notes room are written into this folder, so the
      // owner (and their coding agent) can pick them up: notes/<map>.md. Only
      // this local server does that; the hosted site has no such endpoint.
      server.middlewares.use('/api/notes', (req, res) => {
        const send = (status: number, json: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        };
        if (req.method !== 'POST') return send(405, { error: 'POST only' });
        let raw = '';
        req.on('data', (chunk) => {
          if (raw.length < 300_000) raw += chunk;
        });
        req.on('end', async () => {
          try {
            const body = JSON.parse(raw) as { mapId?: unknown; markdown?: unknown; removed?: unknown };
            // The map id becomes a file name: plain names only, never a path.
            if (typeof body.mapId !== 'string' || !/^[\w-]{1,40}$/.test(body.mapId)) return send(400, { error: 'Bad map id' });
            if (typeof body.markdown !== 'string' || body.markdown.length > 200_000) return send(400, { error: 'Bad notes' });
            const { mkdir, readFile, writeFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            await mkdir(join(process.cwd(), 'notes'), { recursive: true });
            const file = join(process.cwd(), 'notes', `${body.mapId}.md`);
            // A coding agent ticks notes off in this file (- [x]); the headset
            // only knows the notes, not the ticks, so keep them when rewriting.
            // Each device (the headset, a desktop browser) keeps its own list,
            // so the file is a merge: a line another device wrote stays unless
            // this device took it back (body.removed).
            const key = (rest: string) => rest.replace(/ _\(.*\)_$/, '').trim();
            const removed = new Set((Array.isArray(body.removed) ? body.removed : []).filter((r): r is string => typeof r === 'string').map((r) => r.replace(/\s+/g, ' ').trim()));
            const done = new Set<string>();
            const older: string[] = [];
            const incoming = new Set<string>();
            for (const line of body.markdown.split('\n')) {
              const match = /^- \[ \] (.*)$/.exec(line);
              if (match) incoming.add(key(match[1]));
            }
            try {
              for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
                const match = /^- \[([ xX])\] (.*)$/.exec(line);
                if (!match) continue;
                const k = key(match[2]);
                if (match[1] !== ' ') done.add(k);
                if (!incoming.has(k) && !removed.has(k)) older.push(line);
              }
            } catch {
              // No file yet.
            }
            const lines = body.markdown.split('\n').map((line) => {
              const match = /^- \[ \] (.*)$/.exec(line);
              return match && done.has(key(match[1])) ? `- [x] ${match[1]}` : line;
            });
            // Lines only the file had go just before this device's notes.
            const first = lines.findIndex((l) => l.startsWith('- ['));
            if (older.length) lines.splice(first < 0 ? lines.length : first, 0, ...older);
            const markdown = lines.join('\n');
            await writeFile(file, markdown, 'utf8');
            send(200, { path: `notes/${body.mapId}.md` });
          } catch {
            send(400, { error: 'Could not save the notes' });
          }
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
  // PORT lets a second copy (another worktree) run beside the first.
  server: { host: '0.0.0.0', port: Number(process.env.PORT) || 8081, open: false },
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
