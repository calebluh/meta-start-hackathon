import { VisibilityState, type World } from '@iwsdk/core';
import { canRecord } from './agent/recorder.js';
import { unlock } from './audio/sound.js';

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
  } else {
    // A phone or a desktop browser: say where the real thing is, then get out of the way.
    note.textContent =
      'This is a VR app. Open this page in the browser on a Meta Quest headset to step inside. ' +
      'Here you can preview it with a mouse: click a building, then press Step inside.';
    enter.textContent = 'Preview here';
    enter.hidden = false;
    enter.addEventListener('click', () => {
      unlock();
      root.hidden = true;
    });
  }

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
