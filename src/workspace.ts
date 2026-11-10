import {
  createSystem,
  type Object3D,
  Quaternion,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { FAR, NEAR, placement } from './placement.js';

/** Frames to wait after entering VR so the headset pose has settled. */
const SETTLE_FRAMES = 12;

/**
 * Keeps the desk, diorama and panels (the scene's `workspace` node) within
 * comfortable reach, whether the user is seated or standing. On entering VR,
 * and whenever Recenter is pressed, the workspace moves to just below and in
 * front of the head and turns to face it (how far is in `placement.ts`).
 * Leaving VR restores the authored
 * position used by the desktop browser view.
 */
export class WorkspaceSystem extends createSystem({}) {
  private workspace: Object3D | undefined;
  private homePosition = new Vector3();
  private homeYaw = 0;
  private pendingFrames = -1;
  private immersive = false;
  private head = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();

  init(): void {
    this.workspace = this.world.getSceneObject('workspace');
    if (!this.workspace) return;
    this.homePosition.copy(this.workspace.position);
    this.homeYaw = this.workspace.rotation.y;

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.NonImmersive) {
          this.immersive = false;
          this.pendingFrames = -1;
          placement.reach = NEAR.reach;
          placement.drop = NEAR.drop;
          placement.gaze = false;
          this.workspace!.position.copy(this.homePosition);
          this.workspace!.rotation.set(0, this.homeYaw, 0);
        } else if (state === VisibilityState.Visible && !this.immersive) {
          // Only on entering VR. Coming back from the Quest menu or putting the
          // headset back on must not move a desk the visitor already placed.
          this.immersive = true;
          this.pendingFrames = SETTLE_FRAMES;
        }
      }),
    );

    const recenter = this.world.getSceneObject<UIKitMLAsset>('controls-panel')?.getElementById('btn-recenter');
    if (recenter) {
      const onRecenter = () => this.placeInFrontOfHead();
      recenter.addEventListener('click', onRecenter);
      this.cleanupFuncs.push(() => recenter.removeEventListener('click', onRecenter));
    }
  }

  update(): void {
    if (this.pendingFrames > 0) {
      this.pendingFrames -= 1;
      if (this.pendingFrames === 0) this.placeInFrontOfHead();
    }
  }

  private placeInFrontOfHead(): void {
    if (!this.workspace) return;
    // A session that was granted gaze tracking is running on glasses.
    const gaze = this.world.session?.enabledFeatures?.includes('gaze-tracking') ?? false;
    const { reach, drop } = gaze ? FAR : NEAR;
    placement.reach = reach;
    placement.drop = drop;
    placement.gaze = gaze;
    const head = this.player.head;
    head.getWorldPosition(this.head);
    head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();

    this.workspace.position.set(
      this.head.x + this.forward.x * reach,
      Math.max(this.head.y - drop, 0.45),
      this.head.z + this.forward.z * reach,
    );
    // Turn the desk so its front edge (+Z) faces back toward the viewer.
    this.workspace.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
  }
}
