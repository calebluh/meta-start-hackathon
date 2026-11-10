/**
 * Paused means the visitor cannot see or hear the app right now: the headset
 * came off, the Quest menu is open over it, or (outside VR) the browser tab is
 * in the background. While paused nothing speaks, the microphone is closed and
 * all sound stops; resuming picks up where it left off.
 *
 * `src/index.ts` decides when the app is paused. Everything else listens.
 */
type Listener = (paused: boolean) => void;

const listeners = new Set<Listener>();
let paused = false;

export const isPaused = (): boolean => paused;

export function setPaused(value: boolean): void {
  if (value === paused) return;
  paused = value;
  for (const l of listeners) l(value);
}

/** Resolves at once when running, otherwise when the visitor is back. */
export function whenResumed(): Promise<void> {
  if (!paused) return Promise.resolve();
  return new Promise((resolve) => {
    const off = onPause((value) => {
      if (value) return;
      off();
      resolve();
    });
  });
}

export function onPause(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
