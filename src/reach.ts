import { type Object3D, Quaternion, Vector3, type World } from '@iwsdk/core';

/**
 * Tapping instead of pinching. A button can be pressed with a fingertip only
 * if the hand can get to it, and the panels beside and above the desk are
 * authored a little out of reach: fine for pointing at from a distance, as
 * the mouse, a controller or the eyes do, but too far to touch.
 *
 * When bare hands are in use (a Quest, not Meta VR Glasses, which are aimed
 * with the eyes) the panels move in to about half a metre from the head, so
 * every button on them can be tapped. Pointing and pinching still works.
 *
 * Positions are in the workspace's space, where the seated head is at about
 * (0, 0.42, 0.7): the desk top is the origin and +Z comes toward the visitor.
 */
interface Pose {
  position: [number, number, number];
  /** Turn about the vertical axis, in degrees. Omitted: keep the authored rotation. */
  yawDeg?: number;
  scale?: number;
}

const WITHIN_REACH: Record<string, Pose> = {
  // Left and right of the city, clear of the buttons along the desk's front edge, turned to face the
  // seated head (it sits about 0.5 m behind and 0.4 m above them). The visitor prefers them facing
  // them; in the emulator a fingertip tap on a turned panel often missed, pointing and pinching did not.
  'ask-panel': { position: [-0.39, 0.29, 0.2], yawDeg: 38, scale: 0.088 },
  'notes-panel': { position: [-0.39, 0.29, 0.2], yawDeg: 38, scale: 0.088 },
  'inspector-panel': { position: [0.39, 0.29, 0.2], yawDeg: -38, scale: 0.088 },
  // The start menu is three wide cards: a little smaller, and much nearer.
  'menu-panel': { position: [0, 0.27, 0.14], scale: 0.085 },
};

const authored = new Map<string, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
/**
 * Panels the visitor has dragged somewhere of their own choosing (by its grab
 * bar, see grips.ts), and where, in the desk's space. Such a panel stays
 * there, whatever placement is asked for, until Recenter forgets it.
 */
const moved = new Map<string, Vector3>();

/** The visitor put a panel somewhere: `position` is in the desk's space. */
export function movePanel(world: World, id: string, position: Vector3): void {
  const at = moved.get(id) ?? new Vector3();
  moved.set(id, at.copy(position));
  world.getSceneObject<Object3D>(id)?.position.copy(at);
}

export const panelMoved = (id: string): boolean => moved.has(id);

/** Puts a moved panel (or, with no id, all of them) back where the app stands it. */
export function forgetPanelMoves(world: World, id?: string): void {
  if (id) moved.delete(id);
  else moved.clear();
  setPanelsWithinReach(world, lastNear);
}
/** Extra sideways offset for the info panel (the notes room moves it right), and the last placement asked for. */
let inspectorShift = 0;
let lastNear = false;

/** Moves the info panel sideways by `dx` metres (desk space) on top of wherever it stands. */
export function setInspectorShift(world: World, dx: number): void {
  inspectorShift = dx;
  setPanelsWithinReach(world, lastNear);
}
const UP = new Vector3(0, 1, 0);

/** Moves the tappable panels within arm's reach, or back to where the scene has them. */
export function setPanelsWithinReach(world: World, near: boolean): void {
  lastNear = near;
  for (const [id, pose] of Object.entries(WITHIN_REACH)) {
    const panel = world.getSceneObject<Object3D>(id);
    if (!panel) continue;
    let home = authored.get(id);
    if (!home) {
      home = { position: panel.position.clone(), quaternion: panel.quaternion.clone(), scale: panel.scale.clone() };
      authored.set(id, home);
    }
    const shift = id === 'inspector-panel' ? inspectorShift : 0;
    const own = moved.get(id);
    if (own) {
      // Where the visitor put it; grips.ts keeps it turned to them. Only its size follows the placement.
      panel.position.copy(own);
      if (near && pose.scale !== undefined) panel.scale.setScalar(pose.scale);
      else panel.scale.copy(home.scale);
      continue;
    }
    if (!near) {
      panel.position.copy(home.position);
      panel.position.x += shift;
      panel.quaternion.copy(home.quaternion);
      panel.scale.copy(home.scale);
      continue;
    }
    panel.position.set(...pose.position);
    panel.position.x += shift;
    if (pose.yawDeg !== undefined) panel.quaternion.setFromAxisAngle(UP, (pose.yawDeg * Math.PI) / 180);
    if (pose.scale !== undefined) panel.scale.setScalar(pose.scale);
  }
}
