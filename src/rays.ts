import type { Object3D } from '@iwsdk/core';

const noRaycast = () => {};

/**
 * Makes decorative objects invisible to pointer rays (hands, controllers,
 * mouse). Needed for anything parented under an interactive object, and above
 * all for lines: three.js tests lines with a hit tolerance of about a metre,
 * so a thin outline otherwise catches nearly every ray aimed near it.
 */
export function ignoreRays<T extends Object3D>(object: T): T {
  object.traverse((o) => {
    o.raycast = noRaycast;
  });
  return object;
}
