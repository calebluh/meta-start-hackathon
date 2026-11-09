import {
  createSystem,
  type Object3D,
  Quaternion,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';

/** How far in front of the eyes the desk's centre sits, and how far below. */
const REACH = 0.5;
const DROP = 0.42;
/** Frames to wait after entering VR so the headset pose has settled. */
const SETTLE_FRAMES = 12;

/**
 * Keeps the desk, diorama and panels (the scene's `workspace` node) within
 * comfortable reach, whether the user is seated or standing. On entering VR,
 * and whenever Recenter is pressed, the workspace moves to just below and in
 * front of the head and turns to face it. Leaving VR restores the authored
 * position used by the desktop browser view.
 */
export class WorkspaceSystem extends createSystem({}) {
  private workspace: Object3D | undefined;
  private homePosition = new Vector3();
  private homeYaw = 0;
  private pendingFrames = -1;
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
          this.pendingFrames = -1;
          this.workspace!.position.copy(this.homePosition);
          this.workspace!.rotation.set(0, this.homeYaw, 0);
        } else if (state === VisibilityState.Visible && this.pendingFrames < 0) {
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
    const head = this.player.head;
    head.getWorldPosition(this.head);
    head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();

    this.workspace.position.set(
      this.head.x + this.forward.x * REACH,
      Math.max(this.head.y - DROP, 0.45),
      this.head.z + this.forward.z * REACH,
    );
    // Turn the desk so its front edge (+Z) faces back toward the viewer.
    this.workspace.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
  }
}
