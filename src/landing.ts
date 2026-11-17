import { SessionMode, VisibilityState, type World } from '@iwsdk/core';
import { canRecord } from './agent/recorder.js';
import { unlock } from './audio/sound.js';
import { anchorsWanted } from './desk-anchor.js';
import { HACKATHON } from './edition.js';
import { MAPS } from './maps/index.js';
import { buildRepoCity, restoreRepoMap } from './maps/repo.js';
import type { GraphData } from './maps/types.js';
import { chooseDemo } from './state.js';

/**
 * The flat web page around the 3D view: a title while the app loads, then one
 * large "Enter VR" button. The page's markup and styles are in `index.html`,
 * so the title shows before any script has run.
 *
 * XR is the immersive session a headset runs. A headset browser shows this
 * page on a flat panel first, and only a press on the page may start the
 * session, so the button has to be here and has to be easy to hit with a
 * hand pinch.
 */

const el = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** Call when the app could not start at all. */
export function landingFailed(): void {
  const root = el('landing');
  if (!root) return;
  root.querySelector('.bar')?.remove();
  const text = root.querySelector('.brand p');
  if (text) text.textContent = 'Something went wrong while loading. Please reload the page.';
}

/** Call once the world exists: swaps the loading title for the entry buttons. */
export async function landingReady(world: World): Promise<void> {
  const root = el('landing');
  const enter = el<HTMLButtonElement>('enter-vr');
  const mixed = el<HTMLButtonElement>('enter-mr');
  const mic = el<HTMLButtonElement>('allow-mic');
  const note = el('landing-note');
  if (!root || !enter || !mic || !note) return;

  let supported = false;
  try {
    supported = (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
  } catch {
    // No WebXR here; the page stays a flat preview.
  }

  if (supported) {
    enter.hidden = false;
    note.textContent = 'Put your controllers down. Everything here is done with your hands.';
    enter.addEventListener('click', () => {
      unlock();
      world.launchXR();
    });
    void offerMicrophone(mic, note);
    // Mixed reality: the city on the visitor's own desk, in their own room.
    let passthrough = false;
    try {
      passthrough = (await navigator.xr?.isSessionSupported('immersive-ar')) ?? false;
    } catch {
      // No passthrough here; VR only.
    }
    if (passthrough && mixed) {
      mixed.hidden = false;
      mixed.addEventListener('click', () => {
        unlock();
        // Plane detection is the headset's map of the room's flat surfaces
        // (scene understanding). With it the city is set down on the
        // visitor's real table; without it the app still runs (see
        // WorkspaceSystem). Asked for here only, so plain VR never prompts.
        // ?noplanes leaves it out (for troubleshooting a headset).
        const planes = !new URLSearchParams(location.search).has('noplanes');
        // Anchors (optional): the headset remembers where the city stood in
        // this room, for next time (see desk-anchor.ts). ?noanchor leaves it out.
        const anchors = anchorsWanted();
        world.launchXR({ sessionMode: SessionMode.ImmersiveAR, features: { ...(planes ? { planeDetection: true } : {}), ...(anchors ? { anchors: true } : {}) } });
      });
    }
  } else {
    // A phone or a desktop browser: say where the real thing is, then get out of the way.
    note.textContent =
      'This is a VR app. Open this page in the browser on a Meta Quest headset to step inside. ' +
      'Here you can preview it with a mouse: click a building, then press Step inside. ' +
      'WASD moves you, and the arrow keys or a right-mouse drag look around.';
    enter.textContent = 'Preview here';
    enter.hidden = false;
    enter.addEventListener('click', () => {
      unlock();
      root.hidden = true;
    });
  }

  setupRepoForm();
  root.classList.remove('loading');
  root.classList.add('ready');

  // The page is not looked at during a session; keep it out of the way anyway.
  let dismissed = false;
  if (!supported) enter.addEventListener('click', () => (dismissed = true));
  world.visibilityState.subscribe((state) => {
    root.hidden = dismissed || state !== VisibilityState.NonImmersive;
  });
}

/**
 * Asking a robot a question out loud needs the microphone. The browser's
 * permission prompt is a flat window, so it is far better answered here than
 * in the middle of a conversation inside the headset.
 */
async function offerMicrophone(mic: HTMLButtonElement, note: HTMLElement): Promise<void> {
  if (!canRecord()) return;
  const granted = () => {
    mic.hidden = false;
    mic.disabled = true;
    mic.textContent = 'Microphone on';
  };
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted') return granted();
  } catch {
    // Not every browser can report this; offering the button is harmless.
  }
  mic.hidden = false;
  mic.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      granted();
    } catch {
      mic.textContent = 'Microphone blocked';
      note.textContent = 'No problem: every question can also be picked from a list with a pinch.';
    }
  });
}

/**
 * Any public GitHub repository as a city: type owner/name (or paste its
 * link), the server maps it (server/repo-map.ts), and Enter VR walks into it.
 * Checked on the live site (17 Nov): Flask, Express, SWR, FastAPI and sindresorhus/is build in 2-5 s.
 */
function setupRepoForm(): void {
  const form = el<HTMLFormElement>('repo-form');
  const input = el<HTMLInputElement>('repo-input');
  const go = el<HTMLButtonElement>('repo-go');
  const note = el('repo-note');
  if (!form || !input || !go || !note || !HACKATHON) return;
  form.hidden = false;
  let busy = false;
  const say = (text: string, tone: '' | 'ok' | 'bad' = '') => {
    note.textContent = text;
    note.className = tone;
  };
  const build = async (repo: string) => {
    if (busy || !repo.trim()) return;
    busy = true;
    go.disabled = true;
    unlock();
    say('Downloading the code and drawing the city: about 10 seconds...');
    const result = await buildRepoCity(repo.trim());
    busy = false;
    go.disabled = false;
    if ('error' in result) {
      say(result.error, 'bad');
      return;
    }
    ready(result.id, result.graph);
  };
  const ready = (id: string, graph: GraphData) => {
    const parts = graph.nodes.filter((n) => n.kind !== 'external').length;
    chooseDemo(id);
    // The address now names the repository: a reload, or the link shared
    // with anyone, opens the same city (rebuilt, or kept in this browser).
    const url = new URL(location.href);
    url.searchParams.delete('map');
    const repo = graph.source?.repo?.replace(/^github\.com\//, '');
    if (repo) url.searchParams.set('repo', repo);
    history.replaceState(null, '', url);
    say(`${graph.project.name} is ready: ${parts} buildings. Press Enter VR or Mixed reality to step inside.`, 'ok');
  };
  // A link with ?repo=owner/name opens that repository's city straight away.
  const asked = new URLSearchParams(location.search).get('repo')?.trim();
  if (asked) {
    input.value = asked;
    const kept = restoreRepoMap();
    const keptGraph = kept ? MAPS[kept] : undefined;
    if (kept && keptGraph && keptGraph.source?.repo?.toLowerCase() === `github.com/${asked.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/+$/, '')}`.toLowerCase()) {
      ready(kept, keptGraph);
    } else {
      void build(asked);
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void build(input.value);
  });
  for (const chip of form.querySelectorAll<HTMLButtonElement>('button[data-repo]')) {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.repo ?? '';
      void build(input.value);
    });
  }
}
