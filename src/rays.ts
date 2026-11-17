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
    // A fingertip touch does not ray-test: it measures distance to the mesh,
    // using its bounds. A skinned robot's bounds are in unscaled bind-pose
    // units, tens of metres across, so without this every touch "lands" on
    // a robot and no button in a room can be tapped.
    (o as Object3D & { pointerEvents?: string }).pointerEvents = 'none';
  });
  return object;
}

/** Lets pointers (rays and fingertips) hit this object again, inside something made with `ignoreRays`. */
export function takeRays<T extends Object3D>(object: T): T {
  (object as Object3D & { pointerEvents?: string }).pointerEvents = 'auto';
  return object;
}
