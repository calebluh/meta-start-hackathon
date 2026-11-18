import {
  CapsuleGeometry,
  createSystem,
  DistanceGrabbable,
  type Entity,
  Euler,
  Grabbed,
  Group,
  Hovered,
  RayInteractable,
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
import { DeskAnchor } from './desk-anchor.js';
import { makeLabel } from './diorama.js';
import { guideNote } from './guide.js';
import { inPassthrough } from './passthrough.js';
import { FAR, NEAR, placement } from './placement.js';
import { setPanelsWithinReach } from './reach.js';
import { resetMoves } from './grips.js';
import { app, onChange } from './state.js';
import { dive } from './transition.js';

/** Frames to wait after entering VR so the headset pose has settled. */
const SETTLE_FRAMES = 12;
const UP = new Vector3(0, 1, 0);
/** Where the grab bar rests, in the workspace's space: just past the middle of the desk's front edge. */
const HANDLE_REST = new Vector3(0, -0.012, 0.385);
const HANDLE_IDLE = '#8b95a5';
const HANDLE_LIVE = '#7ee0ff';
/**
 * The button strip's own grip, just past the strip's right-hand end
 * (the strip is about 1.24 m wide), measured from the strip's centre in
 * the desk's space. Apart from the desk's bar under the middle of the
 * strip and from the city's corner pegs, so one is never taken for another.
 */
const STRIP_GRIP_OFFSET = new Vector3(0.665, 0.006, 0);
/**
 * A bare-hand pinch begun within this many ms of pointing at the bar or the
 * grip takes it: closing the fingers swings a hand's ray off a small target.
 */
const HAND_GRAB_GRACE_MS = 300;
/** Fingers closed this close (metres) to the bar or the grip take it, with no pointing. */
const HAND_TAKE_REACH = 0.06;
/** A hand's own ray passing this close (metres) counts as aimed at the bar or the grip. */
const HAND_AIM = 0.045;
/** Half the bar's length, along the desk's front edge (see buildHandle). */
const BAR_HALF = 0.12;
const GRAB = { movementMode: MovementMode.MoveAtSource, translate: true, rotate: false, scale: false };
/** Mixed reality: keep looking for a real table this long after the desk is placed (the room's surfaces arrive a little after the session starts). */
const TABLE_SEARCH_SECONDS = 5;
/** Mixed reality: how long to wait for the headset to find last visit's spot. */
const RESTORE_SECONDS = 4;
/** Last visit's spot is used only within this distance of where the visitor now sits. */
const RESTORE_MAX_DISTANCE = 1.8;
/** How long "Back where you left it" shows. */
const CUE_SECONDS = 6;
/** A real table must be at least this big, this high off the floor, and this near, to take the city. */
const TABLE_MIN_WIDTH = 0.5;
const TABLE_MIN_DEPTH = 0.4;
const TABLE_MIN_HEIGHT = 0.35;
const TABLE_MAX_DISTANCE = 1.6;
/** A table spot must lie roughly ahead: the cosine between the head's forward direction and the way to the spot (seen from above). */
const TABLE_MIN_AHEAD = 0.4;
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
/**
 * Back from a room, the desk returns to its spot if that spot is still in
 * front of the visitor (cosine of the angle off straight ahead, about 55
 * degrees) and within this many metres of the head; otherwise it comes round.
 */
const RETURN_FACING = 0.57;
const RETURN_REACH = 1.4;
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
  /** The button strip, where the scene put it, and its grip (see STRIP_GRIP_OFFSET). */
  private strip: Object3D | undefined;
  private stripHome = new Vector3();
  private stripGrip: Entity | undefined;
  private stripGripMaterial = new MeshBasicMaterial({ color: HANDLE_IDLE });
  private stripGripPos = new Vector3();
  /**
   * Bare hands drag the bar and the grip here, not through the grab system:
   * a hand pinch there is a near grab (squeeze), which these ray-only
   * handles ignore. Which one a hand holds, where its fingertip and the
   * handle were when the pinch began, and when each was last pointed at.
   */
  private handDrag: { what: 'desk' | 'strip'; hand: 'left' | 'right'; tip: Vector3; from: Vector3 } | null = null;
  /** What each hand's own ray was last on (the bar or the grip), and when. */
  private handAim: Record<'left' | 'right', { what: 'desk' | 'strip' | null; at: number }> = {
    left: { what: null, at: -Infinity },
    right: { what: null, at: -Infinity },
  };
  private aimOrigin = new Vector3();
  private aimDir = new Vector3();
  private aimQuat = new Quaternion();
  private aimTmp = new Vector3();
  private barEnd = new Vector3();
  private dragTip = new Vector3();
  private floor: Object3D | undefined;
  private passthrough = false;
  /** Seconds left to keep looking for a real table. */
  private tableSearch = 0;
  /** Height of the real table the city stands on, and which way its edges run. */
  private tableY = 0;
  private tableAxis = 0;
  /** Where the desk stood when the visitor stepped into a room. */
  private saved: { position: Vector3; yaw: number; onTable: boolean; axis: number; tableY: number } | null = null;
  private lastMode: 'table' | 'room' = 'table';
  private planeMatrix = new Matrix4();
  private planeInverse = new Matrix4();
  private spot = new Vector3();
  private headAhead = new Vector3();
  private best = new Vector3();
  /** Mixed reality: the spot in the real room the city is remembered at (see desk-anchor.ts). */
  private deskAnchor = new DeskAnchor();
  /** Seconds left to wait for last visit's spot to be found again. */
  private restoreWait = 0;
  /** Set on entering VR, cleared once the desk has been placed. */
  private entering = false;
  private anchorMatrix = new Matrix4();
  private anchorPos = new Vector3();
  private anchorQuat = new Quaternion();
  private anchorScale = new Vector3();
  /** "Back where you left it", shown for a moment when the city returns to its spot. */
  private cue: Mesh | undefined;
  /** When the cue goes (performance.now(), ms): a wall clock, as the first frames of a session can be long. */
  private cueUntil = 0;
  private cuePending = false;

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
          this.entering = true;
          this.pendingFrames = SETTLE_FRAMES;
        }
      }),
    );

    // Bare-hand pinches on the bar and the grip (see handDrag).
    const handOf = (event: Event): XRInputSource | null => (event as Event & { inputSource?: XRInputSource }).inputSource ?? null;
    const onSelectStart = (event: Event) => {
      const source = handOf(event);
      if (!source?.hand || (source.handedness !== 'left' && source.handedness !== 'right')) return;
      const now = performance.now();
      // Fingers closed on the bar or the grip, or this hand's own ray on one a moment ago.
      const aim = this.handAim[source.handedness];
      const what = this.touching(source.handedness) ?? (now - aim.at < HAND_GRAB_GRACE_MS ? aim.what : null);
      const object = what === 'strip' ? this.stripGrip?.object3D : what === 'desk' ? this.handle?.object3D : null;
      if (import.meta.env.DEV && what) console.log(`[grip] ${source.handedness} hand took the ${what === 'strip' ? 'strip grip' : 'desk bar'}`);
      if (!what || !object) return;
      const tip = new Vector3();
      this.player.indexTipSpaces[source.handedness].getWorldPosition(tip);
      this.handDrag = { what, hand: source.handedness, tip, from: object.getWorldPosition(new Vector3()) };
    };
    const onSelectEnd = (event: Event) => {
      if (this.handDrag && handOf(event)?.handedness === this.handDrag.hand) this.handDrag = null;
    };
    const onHandSourcesChange = (event: Event) => {
      for (const source of (event as Event & { removed?: readonly XRInputSource[] }).removed ?? []) {
        if (this.handDrag?.hand === source.handedness) this.handDrag = null;
      }
    };
    const onHandSession = () => {
      const session = this.world.renderer.xr.getSession();
      if (session) this.deskAnchor.begin(session);
      session?.addEventListener('selectstart', onSelectStart);
      session?.addEventListener('selectend', onSelectEnd);
      session?.addEventListener('inputsourceschange', onHandSourcesChange);
    };
    this.world.renderer.xr.addEventListener('sessionstart', onHandSession);
    this.cleanupFuncs.push(() => this.world.renderer.xr.removeEventListener('sessionstart', onHandSession));
    const onSessionEnd = () => {
      this.deskAnchor.end();
      this.restoreWait = 0;
    };
    this.world.renderer.xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => this.world.renderer.xr.removeEventListener('sessionend', onSessionEnd));

    // Recentering from the Quest menu moves the world origin; follow it.
    const xr = this.world.renderer.xr;
    const onReset = () => (this.pendingFrames = SETTLE_FRAMES);
    const onSessionStart = () => xr.getReferenceSpace()?.addEventListener('reset', onReset);
    xr.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(() => xr.removeEventListener('sessionstart', onSessionStart));

    this.buildHandle();
    this.strip = this.world.getSceneObject('controls-panel');
    if (this.strip) {
      this.stripHome.copy(this.strip.position);
      this.buildStripGrip();
    }
    placement.recentre = () => {
      resetMoves();
      if (this.immersive) this.placeInFrontOfHead();
    };
    placement.returnToTable = () => {
      if (this.immersive) this.returnToTable();
    };
    this.cleanupFuncs.push(() => {
      placement.recentre = () => undefined;
      placement.returnToTable = () => undefined;
    });
    // Stepping into a room: remember where the desk was, to put it back after.
    this.cleanupFuncs.push(
      onChange(() => {
        if (app.mode === 'room' && this.lastMode === 'table' && this.immersive && this.workspace) {
          this.saved = { position: this.workspace.position.clone(), yaw: this.workspace.rotation.y, onTable: placement.onTable, axis: this.tableAxis, tableY: this.tableY };
        }
        this.lastMode = app.mode;
      }),
    );
    this.floor = this.world.getSceneObject('floor');

    const recenter = this.world.getSceneObject<UIKitMLAsset>('controls-panel')?.getElementById('btn-recenter');
    if (recenter) {
      // Whatever the visitor moved by its own bar (panels, cards, bubbles) goes back to its place too.
      const onRecenter = () => {
        resetMoves();
        this.placeInFrontOfHead();
      };
      recenter.addEventListener('click', onRecenter);
      this.cleanupFuncs.push(() => recenter.removeEventListener('click', onRecenter));
    }
  }

  update(delta: number): void {
    if (this.pendingFrames > 0) {
      this.pendingFrames -= 1;
      if (this.pendingFrames === 0) {
        // Entering mixed reality with a spot saved last time: give the
        // headset a moment to find it before anything is saved over it.
        if (this.entering && inPassthrough(this.world) && this.deskAnchor.hasSaved) this.restoreWait = RESTORE_SECONDS;
        this.entering = false;
        this.placeInFrontOfHead();
      }
    }
    this.updateAnchor(delta);
    // Mixed reality: the room's surfaces can arrive a moment after the desk
    // was placed. Keep looking for a short while, at the table only.
    if (this.tableSearch > 0) {
      this.tableSearch -= delta;
      if (app.mode !== 'table' || app.street || dive.active) this.tableSearch = 0;
      else if (this.snapToTable()) {
        this.tableSearch = 0;
        this.rememberSpot();
      }
      else if (this.tableSearch <= 0 && import.meta.env.DEV) this.reportPlanes();
    }
    this.updateHandle();
    this.updateStripGrip();
    this.updateHandAims();
    // Mixed reality: the real floor is the floor.
    const passthrough = this.immersive && inPassthrough(this.world);
    if (passthrough !== this.passthrough) {
      this.passthrough = passthrough;
      placement.mixed = passthrough;
      if (this.floor) this.floor.visible = !passthrough;
    }
  }

  /** A short pill at the strip's right end, inside a larger invisible catch area. */
  private buildStripGrip(): void {
    const group = new Group();
    group.name = 'strip-grip';
    const pill = new Mesh(new CapsuleGeometry(0.01, 0.05, 4, 12), this.stripGripMaterial);
    pill.rotation.x = Math.PI / 2;
    group.add(pill);
    const catcher = new Mesh(new CapsuleGeometry(0.03, 0.07, 2, 8), new MeshBasicMaterial({ visible: false }));
    catcher.rotation.x = Math.PI / 2;
    group.add(catcher);
    group.visible = false;
    this.stripGrip = this.world.createTransformEntity(group, { persistent: true });
  }

  /**
   * The button strip moves on its own: drag its grip and the strip follows,
   * keeping its tilt, while the city and desk stay put. Recenter puts it
   * back along the desk's front edge.
   */
  private updateStripGrip(): void {
    const grip = this.stripGrip;
    const object = grip?.object3D;
    if (!grip || !object || !this.strip || !this.workspace) return;
    const usable = this.immersive && app.mode === 'table' && !app.menu && !dive.active && !app.street;
    if (usable !== object.visible) {
      object.visible = usable;
      if (usable && !grip.hasComponent(DistanceGrabbable)) grip.addComponent(DistanceGrabbable, GRAB);
      else if (!usable && grip.hasComponent(DistanceGrabbable)) grip.removeComponent(DistanceGrabbable);
      // Pointable too, so a hand's ray finds it (see handDrag).
      if (usable && !grip.hasComponent(RayInteractable)) grip.addComponent(RayInteractable);
      else if (!usable && grip.hasComponent(RayInteractable)) grip.removeComponent(RayInteractable);
    }
    if (!usable) {
      if (this.handDrag?.what === 'strip') this.handDrag = null;
      return;
    }
    const byHand = this.followHand('strip', object);
    const grabbed = byHand || grip.hasComponent(Grabbed);
    this.stripGripMaterial.color.set(grabbed || grip.hasComponent(Hovered) ? HANDLE_LIVE : HANDLE_IDLE);
    if (grabbed) {
      object.getWorldPosition(this.stripGripPos);
      this.workspace.worldToLocal(this.stripGripPos);
      this.strip.position.copy(this.stripGripPos).sub(STRIP_GRIP_OFFSET);
      // Not below the desk top's level by much, nor up in the visitor's face.
      this.strip.position.y = Math.min(Math.max(this.strip.position.y, -0.15), 0.45);
      return;
    }
    object.position.copy(this.strip.position).add(STRIP_GRIP_OFFSET);
    this.workspace.localToWorld(object.position);
    object.rotation.set(0, this.workspace.rotation.y, 0);
  }

  /** The bar or the grip within reach of this hand's fingertip, nearest first. */
  private touching(hand: 'left' | 'right'): 'desk' | 'strip' | null {
    this.player.indexTipSpaces[hand].getWorldPosition(this.aimTmp);
    let best: 'desk' | 'strip' | null = null;
    let bestDistance = HAND_TAKE_REACH;
    const grip = this.stripGrip?.object3D;
    if (grip?.visible) {
      const d = grip.position.distanceTo(this.aimTmp);
      if (d < bestDistance) {
        bestDistance = d;
        best = 'strip';
      }
    }
    const bar = this.handle?.object3D;
    if (bar?.visible && this.distanceToBar(bar, this.aimTmp) < bestDistance) best = 'desk';
    return best;
  }

  /** Distance from a point to the bar's centre line (it lies along the desk's front edge). */
  private distanceToBar(bar: Object3D, point: Vector3): number {
    let best = Infinity;
    for (let i = -2; i <= 2; i += 1) {
      this.barEnd.set((i / 2) * BAR_HALF, 0, 0).applyAxisAngle(UP, bar.rotation.y).add(bar.position);
      best = Math.min(best, this.barEnd.distanceTo(point));
    }
    return best;
  }

  /** Records, for each hand, whether its own ray is on the bar or the grip. */
  private updateHandAims(): void {
    const bar = this.handle?.object3D;
    const grip = this.stripGrip?.object3D;
    if (!bar?.visible && !grip?.visible) return;
    const now = performance.now();
    for (const hand of ['left', 'right'] as const) {
      const space = this.player.raySpaces[hand];
      space.getWorldPosition(this.aimOrigin);
      space.getWorldQuaternion(this.aimQuat);
      this.aimDir.set(0, 0, -1).applyQuaternion(this.aimQuat);
      const aim = this.handAim[hand];
      if (grip?.visible && this.rayDistance(grip.position) < HAND_AIM) {
        aim.what = 'strip';
        aim.at = now;
        continue;
      }
      if (!bar?.visible) continue;
      for (let i = -2; i <= 2; i += 1) {
        this.barEnd.set((i / 2) * BAR_HALF, 0, 0).applyAxisAngle(UP, bar.rotation.y).add(bar.position);
        if (this.rayDistance(this.barEnd) < HAND_AIM) {
          aim.what = 'desk';
          aim.at = now;
          break;
        }
      }
    }
  }

  /** How far a point lies from the ray (aimOrigin, aimDir), or Infinity when behind it. */
  private rayDistance(point: Vector3): number {
    this.aimTmp.copy(point).sub(this.aimOrigin);
    const along = this.aimTmp.dot(this.aimDir);
    if (along < 0) return Infinity;
    return Math.sqrt(Math.max(0, this.aimTmp.lengthSq() - along * along));
  }

  /** A bare hand holding this handle: move it with the fingertip. Returns true while held. */
  private followHand(what: 'desk' | 'strip', object: Object3D): boolean {
    const drag = this.handDrag;
    if (!drag || drag.what !== what) return false;
    this.player.indexTipSpaces[drag.hand].getWorldPosition(this.dragTip);
    object.position.copy(drag.from).add(this.dragTip).sub(drag.tip);
    object.updateMatrixWorld();
    return true;
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
      if (usable && !handle.hasComponent(RayInteractable)) handle.addComponent(RayInteractable);
      else if (!usable && handle.hasComponent(RayInteractable)) handle.removeComponent(RayInteractable);
    }
    if (!usable) {
      if (this.handDrag?.what === 'desk') this.handDrag = null;
      return;
    }

    const byHand = this.followHand('desk', object);
    const grabbed = byHand || handle.hasComponent(Grabbed);
    // The visitor is placing the desk themselves: stop looking for a table.
    if (grabbed) {
      this.tableSearch = 0;
      // Moved by hand before last visit's spot turned up: this spot wins.
      if (this.restoreWait > 0) {
        this.restoreWait = 0;
        this.deskAnchor.dropRestored();
      }
    }
    if (this.wasGrabbed && !grabbed) {
      guideNote('moved');
      this.rememberSpot();
    }
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

  /**
   * Back from a room. The desk returns to where it stood before, so a city
   * set on the real table, or dragged to a spot, stays there. Only if the
   * visitor has turned away from that spot (or it is out of reach) does the
   * desk come round in front of them instead.
   */
  private returnToTable(): void {
    const saved = this.saved;
    this.saved = null;
    if (!saved || !this.workspace) {
      this.placeInFrontOfHead();
      return;
    }
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldQuaternion(this.headQuat);
    this.euler.setFromQuaternion(this.headQuat, 'YXZ');
    this.forward.set(-Math.sin(this.euler.y), 0, -Math.cos(this.euler.y));
    this.offset.set(saved.position.x - this.head.x, 0, saved.position.z - this.head.z);
    const distance = this.offset.length();
    const facing = distance > 1e-3 ? this.offset.dot(this.forward) / distance : 1;
    // On a real table the city stays even if the visitor looks away: the table is where it belongs.
    const fits = saved.onTable || (facing > RETURN_FACING && distance < RETURN_REACH);
    if (import.meta.env.DEV) console.log(`[table] back from a room: ${fits ? 'desk stays where it was' : 'desk comes round'} (facing ${facing.toFixed(2)}, ${distance.toFixed(2)} m)`);
    if (!fits) {
      this.placeInFrontOfHead();
      return;
    }
    this.workspace.position.copy(saved.position);
    this.workspace.rotation.set(0, saved.yaw, 0);
    placement.onTable = saved.onTable;
    this.tableAxis = saved.axis;
    this.tableY = saved.tableY;
    this.tableSearch = 0;
  }

  private placeInFrontOfHead(): void {
    if (!this.workspace) return;
    // Recentred on purpose (inside a room too): that is where the desk goes now.
    this.saved = null;
    // And the button strip goes back along the desk's front edge.
    this.strip?.position.copy(this.stripHome);
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
    if (inPassthrough(this.world)) {
      if (this.snapToTable()) this.rememberSpot();
      else this.tableSearch = TABLE_SEARCH_SECONDS;
    }
  }

  /**
   * Mixed reality: puts the city back on last visit's spot once the headset
   * finds it, saves a spot asked for while another was saving, and fades the
   * "back where you left it" cue.
   */
  private updateAnchor(delta: number): void {
    // The cue waits for the city itself: after a reload the start menu comes first.
    if (this.cuePending && !app.menu && app.mode === 'table') {
      this.cuePending = false;
      this.showCue();
    }
    if (this.cue?.visible) {
      if (performance.now() > this.cueUntil || app.mode !== 'table' || app.menu) this.cue.visible = false;
    }
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    if (!frame || !space || !this.workspace) return;
    const pending = this.deskAnchor.pendingSave;
    if (pending && this.restoreWait <= 0) {
      this.deskAnchor.pendingSave = null;
      this.deskAnchor.save(frame, space, pending.position, pending.orientation, pending.onTable, pending.axis);
    }
    if (this.restoreWait <= 0) return;
    if (app.mode !== 'table' || app.street || dive.active) return;
    const found = this.deskAnchor.takeRestored(frame, space);
    if (!found) {
      this.restoreWait -= delta;
      // Not found in time: keep where the table search put the city, and remember that instead.
      if (this.restoreWait <= 0) {
        this.deskAnchor.dropRestored();
        if (import.meta.env.DEV) console.log('[anchor] last spot not found in time');
        this.rememberSpot();
      }
      return;
    }
    this.restoreWait = 0;
    // Anchor pose (reference space) to world (the XR origin can itself be moved).
    this.anchorMatrix.fromArray(found.matrix).premultiply(this.player.matrixWorld);
    this.anchorMatrix.decompose(this.anchorPos, this.anchorQuat, this.anchorScale);
    this.player.head.getWorldPosition(this.head);
    const away = Math.hypot(this.anchorPos.x - this.head.x, this.anchorPos.z - this.head.z);
    // Somewhere this visitor cannot reach from where they sit now: leave the city where it is.
    if (away > RESTORE_MAX_DISTANCE || this.anchorPos.y < 0.3 || this.anchorPos.y > this.head.y - 0.1) {
      if (import.meta.env.DEV) console.log(`[anchor] last spot is out of reach (${away.toFixed(2)} m), not used`);
      return;
    }
    this.euler.setFromQuaternion(this.anchorQuat, 'YXZ');
    this.workspace.position.copy(this.anchorPos);
    this.workspace.rotation.set(0, this.euler.y, 0);
    placement.onTable = found.spot.onTable;
    this.tableAxis = found.spot.axis;
    this.tableY = this.anchorPos.y;
    this.tableSearch = 0;
    this.cuePending = true;
    if (import.meta.env.DEV) {
      console.log('[anchor] back on last visit\'s spot at ' + [this.anchorPos.x, this.anchorPos.y, this.anchorPos.z].map((v) => v.toFixed(2)).join(', '));
    }
  }

  /** Mixed reality: asks the headset to remember where the city now stands. */
  private rememberSpot(): void {
    if (!this.workspace || this.restoreWait > 0 || !inPassthrough(this.world) || !this.deskAnchor.enabled) return;
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    if (!frame || !space) return;
    // World to the session's reference space.
    this.anchorMatrix
      .compose(this.workspace.position, this.anchorQuat.setFromAxisAngle(UP, this.workspace.rotation.y), this.anchorScale.set(1, 1, 1))
      .premultiply(this.planeInverse.copy(this.player.matrixWorld).invert());
    this.anchorMatrix.decompose(this.anchorPos, this.anchorQuat, this.anchorScale);
    this.deskAnchor.save(
      frame,
      space,
      { x: this.anchorPos.x, y: this.anchorPos.y, z: this.anchorPos.z, w: 1 },
      { x: this.anchorQuat.x, y: this.anchorQuat.y, z: this.anchorQuat.z, w: this.anchorQuat.w },
      placement.onTable,
      this.tableAxis,
    );
  }

  private showCue(): void {
    if (!this.workspace) return;
    if (!this.cue) {
      this.cue = makeLabel('Back where you left it', 0.05, '#7ee0ff');
      // Low over the front of the city: the guide card floats above its middle.
      this.cue.position.set(0, 0.17, 0.16);
      this.workspace.add(this.cue);
    }
    this.cue.visible = true;
    this.cueUntil = performance.now() + CUE_SECONDS * 1000;
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
    // Where the visitor is facing, level: a table behind or beside them is never used.
    this.player.head.getWorldQuaternion(this.headQuat);
    this.headAhead.set(0, 0, -1).applyQuaternion(this.headQuat).setY(0);
    const level = this.headAhead.length();
    if (level < 1e-3) return false; // looking straight up or down: try again in a moment
    this.headAhead.divideScalar(level);
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
      const away = Math.hypot(this.spot.x - this.head.x, this.spot.z - this.head.z);
      if (away > TABLE_MAX_DISTANCE) continue;
      const ahead = away > 1e-3 ? ((this.spot.x - this.head.x) * this.headAhead.x + (this.spot.z - this.head.z) * this.headAhead.z) / away : 0;
      if (ahead < TABLE_MIN_AHEAD) continue;
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
