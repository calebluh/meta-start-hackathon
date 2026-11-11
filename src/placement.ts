/**
 * Where the desk sits relative to the viewer's head. `WorkspaceSystem` picks
 * the values when a VR session starts; the room reads `reach` so that stepping
 * inside puts the viewer on the same spot of the room floor either way.
 *
 * A Quest shows a wide view, so the desk sits within arm's reach and can be
 * touched. Meta VR Glasses show a much narrower one (37 degrees to each side,
 * 25 up, 43 down) and are aimed with the eyes (gaze) plus a pinch, so there
 * the desk sits further away and a little higher: the whole city, its
 * buttons and the side panel then fit in one look.
 */
export const NEAR = { reach: 0.6, drop: 0.42 } as const;
export const FAR = { reach: 0.95, drop: 0.36 } as const;

export const placement: { reach: number; drop: number; gaze: boolean } = { ...NEAR, gaze: false };

/** "Point at" for hands on a Quest, "Look at" where the eyes do the aiming. */
export const aimWord = (): string => (placement.gaze ? 'Look at' : 'Point at');
