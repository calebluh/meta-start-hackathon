import type { World } from '@iwsdk/core';

/**
 * True while the visitor is in mixed reality: the headset shows the real room
 * (passthrough) and the app draws only the city, its panels and the robots.
 */
export function inPassthrough(world: World): boolean {
  const mode = world.session?.environmentBlendMode;
  return mode === 'alpha-blend' || mode === 'additive';
}
