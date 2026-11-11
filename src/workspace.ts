import {
  CapsuleGeometry,
  createSystem,
  DistanceGrabbable,
  type Entity,
  Euler,
  Grabbed,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MovementMode,
  type Object3D,
  Quaternion,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { FAR, NEAR, placement } from './placement.js';
import { app } from './state.js';
import { dive } from './transition.js';

/** Frames to wait after entering VR so the headset pose has settled. */
const SETTLE_FRAMES = 12;
const UP = new Vector3(0, 1, 0);
/** Where the grab bar rests, in the workspace's space: just past the middle of the desk's front edge. */
const HANDLE_REST = new Vector3(0, -0.012, 0.385);
const HANDLE_IDLE = '#8b95a5';
const HANDLE_LIVE = '#7ee0ff';
const GRAB = { movementMode: MovementMode.MoveAtSource, translate: true, rotate: false, scale: false };

/**
 * Keeps the desk, diorama and panels (the scene's `workspace` node) within
 * comfortable reach, whether the user is seated or standing. On entering VR,
 * and whenever Recenter is pressed, the workspace moves to just below and in
 * front of the head and turns to face it (how far is in `placement.ts`).
 * Leaving VR restores the authored
 * position used by the desktop browser view.
 *
 * A grab bar on the desk's front edge (like the bar under a Quest window)
 * lets the visitor drag the whole desk, panels and all, nearer, further or
 * aside. The desk keeps turning to face them as it moves.
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
  private euler = new Euler();
  private handle: Entity | undefined;
  private handleMaterial = new MeshBasicMaterial({ color: HANDLE_IDLE });
  private handlePos = new Vector3();
  private offset = new Vector3();

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

    // Recentering from the Quest menu moves the world origin; follow it.
    const xr = this.world.renderer.xr;
    const onReset = () => (this.pendingFrames = SETTLE_FRAMES);
    const onSessionStart = () => xr.getReferenceSpace()?.addEventListener('reset', onReset);
    xr.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(() => xr.removeEventListener('sessionstart', onSessionStart));

    this.buildHandle();

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
    this.updateHandle();
  }

  /** A pill-shaped bar, inside a larger invisible catch area so it is easy to hit. */
  private buildHandle(): void {
    const group = new Group();
    group.name = 'desk-handle';
    const bar = new Mesh(new CapsuleGeometry(0.011, 0.2, 4, 12), this.handleMaterial);
    bar.rotation.z = Math.PI / 2;
    group.add(bar);
    const catcher = new Mesh(
      new CapsuleGeometry(0.03, 0.24, 2, 8),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    catcher.rotation.z = Math.PI / 2;
    group.add(catcher);
    group.visible = false;
    this.handle = this.world.createTransformEntity(group, { persistent: true });
  }

  /**
   * At rest the bar sits on the desk's front edge. While it is held, the desk
   * follows the bar and turns to keep facing the visitor. Inside a room,
   * during a dive and outside VR there is no bar.
   */
  private updateHandle(): void {
    const handle = this.handle;
    const object = handle?.object3D;
    if (!handle || !object || !this.workspace) return;
    const usable = this.immersive && app.mode === 'table' && !dive.active;
    if (usable !== object.visible) {
      object.visible = usable;
      if (usable && !handle.hasComponent(DistanceGrabbable)) handle.addComponent(DistanceGrabbable, GRAB);
      else if (!usable && handle.hasComponent(DistanceGrabbable)) handle.removeComponent(DistanceGrabbable);
    }
    if (!usable) return;

    const grabbed = handle.hasComponent(Grabbed);
    this.handleMaterial.color.set(grabbed || handle.hasComponent(Hovered) ? HANDLE_LIVE : HANDLE_IDLE);
    if (grabbed) {
      this.player.head.getWorldPosition(this.head);
      object.getWorldPosition(this.handlePos);
      // Face the visitor from wherever the bar now is.
      const yaw = Math.atan2(this.handlePos.x - this.head.x, this.handlePos.z - this.head.z);
      this.workspace.rotation.set(0, yaw, 0);
      this.offset.copy(HANDLE_REST).applyAxisAngle(UP, yaw);
      this.workspace.position.copy(this.handlePos).sub(this.offset);
      this.workspace.position.y = Math.min(Math.max(this.workspace.position.y, 0.3), this.head.y - 0.1);
      return;
    }
    object.position.copy(HANDLE_REST);
    this.workspace.localToWorld(object.position);
    object.rotation.set(0, this.workspace.rotation.y, 0);
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
    // Only the way the head is turned, not how far it looks up or down:
    // pressing Recenter means looking down at the button, which must not
    // throw the desk off to one side.
    this.euler.setFromQuaternion(this.headQuat, 'YXZ');
    this.forward.set(-Math.sin(this.euler.y), 0, -Math.cos(this.euler.y));

    this.workspace.position.set(
      this.head.x + this.forward.x * reach,
      Math.max(this.head.y - drop, 0.45),
      this.head.z + this.forward.z * reach,
    );
    // Turn the desk so its front edge (+Z) faces back toward the viewer.
    this.workspace.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
  }
}
