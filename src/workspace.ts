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
  Matrix4,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { guideNote } from './guide.js';
import { inPassthrough } from './passthrough.js';
import { FAR, NEAR, placement } from './placement.js';
import { setPanelsWithinReach } from './reach.js';
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
/** Mixed reality: keep looking for a real table this long after the desk is placed (the room's surfaces arrive a little after the session starts). */
const TABLE_SEARCH_SECONDS = 5;
/** A real table must be at least this big, this high off the floor, and this near, to take the city. */
const TABLE_MIN_WIDTH = 0.5;
const TABLE_MIN_DEPTH = 0.4;
const TABLE_MIN_HEIGHT = 0.35;
const TABLE_MAX_DISTANCE = 1.6;
/**
 * What has to fit on the table, measured from the desk's origin: half the
 * tray's width, how far the tray reaches away from the visitor, and how far
 * the tray and the buttons reach toward them. (The grab bar hangs just off
 * the front edge, where a hand finds it.)
 */
const FOOT_HALF_WIDTH = 0.39;
const FOOT_BACK = 0.39;
const FOOT_FRONT = 0.3;
/** The tray squares up with the table's edges when it faces the visitor to within this (radians). */
const TABLE_SQUARE = 0.52;
/** Dragging the bar this close to the table top keeps the city on the table. */
const TABLE_STICK = 0.12;
/** Surfaces the headset has named that are not for standing a city on. */
const NOT_TABLES = new Set(['floor', 'ceiling', 'couch', 'bed', 'wall', 'wall face', 'door', 'door frame', 'window', 'window frame', 'screen', 'lamp', 'plant']);

/** Turns `yaw` to the nearest of the table's four edge directions, when it is already close to one. */
function squareUp(yaw: number, axis: number): number {
  const quarter = Math.PI / 2;
  const snapped = axis + Math.round((yaw - axis) / quarter) * quarter;
  return Math.abs(yaw - snapped) < TABLE_SQUARE ? snapped : yaw;
}

/** Keeps `v` between `lo` and `hi`; when the table is too small for that, splits the overhang evenly. */
function fit(v: number, lo: number, hi: number): number {
  return lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2;
}

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
 *
 * In mixed reality (passthrough: the headset shows the real room) the virtual
 * desk is gone and the city is set down on a real one. The headset's scene
 * understanding lists the room's flat surfaces as WebXR planes; the nearest
 * table-like one in front of the visitor takes the city, squared up with the
 * table's edges and kept inside them. A room with no table, or a headset with
 * no room scan, keeps the placement in front of the head, and the grab bar
 * works either way.
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
  private wasGrabbed = false;
  private floor: Object3D | undefined;
  private passthrough = false;
  /** Seconds left to keep looking for a real table. */
  private tableSearch = 0;
  /** Height of the real table the city stands on, and which way its edges run. */
  private tableY = 0;
  private tableAxis = 0;
  private planeMatrix = new Matrix4();
  private planeInverse = new Matrix4();
  private spot = new Vector3();
  private best = new Vector3();

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
          placement.onTable = false;
          this.tableSearch = 0;
          setPanelsWithinReach(this.world, false);
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
    placement.recentre = () => {
      if (this.immersive) this.placeInFrontOfHead();
    };
    this.cleanupFuncs.push(() => (placement.recentre = () => undefined));
    this.floor = this.world.getSceneObject('floor');

    const recenter = this.world.getSceneObject<UIKitMLAsset>('controls-panel')?.getElementById('btn-recenter');
    if (recenter) {
      const onRecenter = () => this.placeInFrontOfHead();
      recenter.addEventListener('click', onRecenter);
      this.cleanupFuncs.push(() => recenter.removeEventListener('click', onRecenter));
    }
  }

  update(delta: number): void {
    if (this.pendingFrames > 0) {
      this.pendingFrames -= 1;
      if (this.pendingFrames === 0) this.placeInFrontOfHead();
    }
    // Mixed reality: the room's surfaces can arrive a moment after the desk
    // was placed. Keep looking for a short while, at the table only.
    if (this.tableSearch > 0) {
      this.tableSearch -= delta;
      if (app.mode !== 'table' || app.street || dive.active) this.tableSearch = 0;
      else if (this.snapToTable()) this.tableSearch = 0;
      else if (this.tableSearch <= 0 && import.meta.env.DEV) this.reportPlanes();
    }
    this.updateHandle();
    // Mixed reality: the real floor is the floor.
    const passthrough = this.immersive && inPassthrough(this.world);
    if (passthrough !== this.passthrough) {
      this.passthrough = passthrough;
      placement.mixed = passthrough;
      if (this.floor) this.floor.visible = !passthrough;
    }
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
    const usable = this.immersive && app.mode === 'table' && !dive.active && !app.street;
    if (usable !== object.visible) {
      object.visible = usable;
      if (usable && !handle.hasComponent(DistanceGrabbable)) handle.addComponent(DistanceGrabbable, GRAB);
      else if (!usable && handle.hasComponent(DistanceGrabbable)) handle.removeComponent(DistanceGrabbable);
    }
    if (!usable) return;

    const grabbed = handle.hasComponent(Grabbed);
    // The visitor is placing the desk themselves: stop looking for a table.
    if (grabbed) this.tableSearch = 0;
    if (this.wasGrabbed && !grabbed) guideNote('moved');
    this.wasGrabbed = grabbed;
    this.handleMaterial.color.set(grabbed || handle.hasComponent(Hovered) ? HANDLE_LIVE : HANDLE_IDLE);
    if (grabbed) {
      this.player.head.getWorldPosition(this.head);
      object.getWorldPosition(this.handlePos);
      // Face the visitor from wherever the bar now is.
      // The desk's front (+Z) points back at the viewer, as in placeInFrontOfHead.
      let yaw = Math.atan2(this.head.x - this.handlePos.x, this.head.z - this.handlePos.z);
      // On a real table the tray stays square with the table's edges.
      if (placement.onTable) yaw = squareUp(yaw, this.tableAxis);
      this.workspace.rotation.set(0, yaw, 0);
      this.offset.copy(HANDLE_REST).applyAxisAngle(UP, yaw);
      this.workspace.position.copy(this.handlePos).sub(this.offset);
      this.workspace.position.y = Math.min(Math.max(this.workspace.position.y, 0.3), this.head.y - 0.1);
      // On a real table the city slides along the table top; lifting the bar
      // well clear of it takes the city off the table.
      if (placement.onTable) {
        if (Math.abs(this.workspace.position.y - this.tableY) < TABLE_STICK) this.workspace.position.y = this.tableY;
        else placement.onTable = false;
      }
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
    // Bare hands tap buttons, so the panels come within reach; eyes aim from afar.
    setPanelsWithinReach(this.world, !gaze);
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

    // Mixed reality: set the city down on a real table if the room has one.
    placement.onTable = false;
    this.tableSearch = 0;
    if (inPassthrough(this.world) && !this.snapToTable()) this.tableSearch = TABLE_SEARCH_SECONDS;
  }

  /** Development: say what the headset knows of the room when no table was found. */
  private reportPlanes(): void {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const planes = frame?.detectedPlanes;
    const lines: string[] = [];
    if (frame && space && planes) {
      for (const plane of planes) {
        const pose = frame.getPose(plane.planeSpace, space);
        const xs = plane.polygon.map((p) => p.x);
        const zs = plane.polygon.map((p) => p.z);
        lines.push(
          `${plane.orientation} "${plane.semanticLabel ?? ''}" at ${pose ? [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z].map((v) => v.toFixed(2)).join(',') : '?'} ` +
            `${(Math.max(...xs) - Math.min(...xs)).toFixed(2)}x${(Math.max(...zs) - Math.min(...zs)).toFixed(2)}`,
        );
      }
    }
    console.log(`[table] none found. blend=${this.world.session?.environmentBlendMode} planes=${planes ? planes.size : 'unsupported'} ${lines.join(' | ')}`);
  }

  /**
   * Moves the desk onto the real table nearest to where it now floats, if the
   * headset knows of one. Returns false when there is none (yet).
   *
   * Each WebXR plane has its own space, with its origin on the surface and
   * +Y along its normal, and an outline (`polygon`) in that space.
   */
  private snapToTable(): boolean {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const planes = frame?.detectedPlanes;
    if (!frame || !space || !planes || planes.size === 0 || !this.workspace) return false;
    this.player.head.getWorldPosition(this.head);
    const want = this.workspace.position;
    const facing = Math.atan2(this.head.x - want.x, this.head.z - want.z);
    let bestScore = Infinity;
    let bestAxis = 0;
    for (const plane of planes) {
      if (plane.orientation !== 'horizontal') continue;
      const label = (plane.semanticLabel ?? '').toLowerCase();
      if (NOT_TABLES.has(label)) continue;
      const pose = frame.getPose(plane.planeSpace, space);
      if (!pose) continue;
      // Plane space to world space (the XR origin can itself be moved).
      this.planeMatrix.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
      const y = this.planeMatrix.elements[13];
      if (y < TABLE_MIN_HEIGHT || y > this.head.y - 0.15) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of plane.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      const sizeX = maxX - minX;
      const sizeZ = maxZ - minZ;
      if (Math.max(sizeX, sizeZ) < TABLE_MIN_WIDTH || Math.min(sizeX, sizeZ) < TABLE_MIN_DEPTH) continue;
      // Which way the table's edges run (its own X axis, seen from above), and
      // the desk turned to face the visitor, square with those edges if close.
      const e = this.planeMatrix.elements;
      const axis = Math.atan2(e[0], e[2]);
      const yaw = squareUp(facing, axis);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // How far the tray and buttons reach from the desk's origin along each
      // of the table's two directions, from the four corners of their footprint.
      let reachX = 0;
      let reachBackX = 0;
      let reachZ = 0;
      let reachBackZ = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        const cx = corner < 2 ? -FOOT_HALF_WIDTH : FOOT_HALF_WIDTH;
        const cz = corner % 2 === 0 ? -FOOT_BACK : FOOT_FRONT;
        const wx = cx * cos + cz * sin;
        const wz = -cx * sin + cz * cos;
        const lx = wx * e[0] + wz * e[2];
        const lz = wx * e[8] + wz * e[10];
        reachX = Math.max(reachX, lx);
        reachBackX = Math.max(reachBackX, -lx);
        reachZ = Math.max(reachZ, lz);
        reachBackZ = Math.max(reachBackZ, -lz);
      }
      // The spot on this table nearest to where the desk floats, with all of that on the table.
      this.spot.copy(want).applyMatrix4(this.planeInverse.copy(this.planeMatrix).invert());
      this.spot.set(
        fit(this.spot.x, minX + reachBackX, maxX - reachX),
        0,
        fit(this.spot.z, minZ + reachBackZ, maxZ - reachZ),
      );
      this.spot.applyMatrix4(this.planeMatrix);
      if (Math.hypot(this.spot.x - this.head.x, this.spot.z - this.head.z) > TABLE_MAX_DISTANCE) continue;
      // Nearest wins; a surface the headset calls a table beats an unnamed one.
      const named = label === 'table' || label === 'desk';
      const score = Math.hypot(this.spot.x - want.x, this.spot.z - want.z) + (named ? 0 : 1);
      if (score < bestScore) {
        bestScore = score;
        bestAxis = axis;
        this.best.copy(this.spot);
      }
    }
    if (bestScore === Infinity) return false;
    this.workspace.position.copy(this.best);
    this.workspace.rotation.set(0, squareUp(Math.atan2(this.head.x - this.best.x, this.head.z - this.best.z), bestAxis), 0);
    this.tableY = this.best.y;
    this.tableAxis = bestAxis;
    placement.onTable = true;
    if (import.meta.env.DEV) {
      console.log('[table] on a real table at ' + [this.best.x, this.best.y, this.best.z].map((v) => v.toFixed(2)).join(', '));
    }
    return true;
  }
}
