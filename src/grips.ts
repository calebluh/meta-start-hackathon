import {
  Box3,
  CapsuleGeometry,
  createSystem,
  type Entity,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  RayInteractable,
  Vector3,
  type World,
} from '@iwsdk/core';
import { isPaused } from './pause.js';
import { forgetPanelMoves, movePanel, panelMoved } from './reach.js';

/**
 * Grab bars: everything that floats near the visitor can be put where they
 * want it. Each panel, card and speech bubble has a small bar at its edge,
 * like the grey bar under the desk. Pinch the bar, with a fingertip on it or
 * pointing at it from the chair, and the thing follows the hand until the
 * fingers open. It keeps facing the visitor wherever it goes, and Recenter
 * puts everything back.
 *
 * The bar is taken the way the desk's bar is (see WorkspaceSystem): not
 * through the grab system, which treats a bare-hand pinch as a near grab,
 * but by watching each hand. A pinch takes the bar the fingertip is on, or
 * the one that hand's ray was on a moment before: closing the fingers swings
 * a hand's ray off a small target, so the moment of the pinch itself is too
 * late to ask. A controller's trigger does the same with its own ray.
 *
 * The thing is not dragged by the hand's travel alone, which would move a
 * card across the room a hand's width at a time. It turns about the head
 * with the hand, and comes nearer or goes further as the hand does: what is
 * under the fingertip, seen from the eye, stays under it.
 */

/** Something with a bar. */
export interface Movable {
  /** The bar is named `grip:<id>`, for logs and test scripts. */
  id: string;
  /** What the bar moves, or null while there is none (no card up, nobody talking). */
  target(): Object3D | null;
  /** The world position of the middle of the edge the bar sits at. Returns false when it cannot be told. */
  edge(out: Vector3): boolean;
  /** The bar sits above the thing (1) or below it (-1). */
  side: 1 | -1;
  /** Puts the target's own origin at this world position. */
  moveTo(world: Vector3): void;
  /** For things that do not turn to the visitor by themselves: called every frame with the head's position. */
  face?(head: Vector3, delta: number): void;
  /** Recenter: back to where it stands when nobody has moved it. */
  reset?(): void;
}

const movables: Movable[] = [];

/** Gives something a bar. Returns a function that takes the bar away again. */
export function addMovable(movable: Movable): () => void {
  movables.push(movable);
  return () => {
    const at = movables.indexOf(movable);
    if (at >= 0) movables.splice(at, 1);
  };
}

/** Recenter: everything the visitor moved goes back to its own place. */
export function resetMoves(): void {
  for (const movable of movables) movable.reset?.();
}

/** The distance (metres) the bar's own size is right for: an arm's reach. Further off it is drawn bigger, so it always looks the same size. */
const REACH = 0.63;
const PILL_RADIUS = 0.007;
const PILL_LENGTH = 0.06;
/** From the thing's edge to the middle of its bar, at arm's reach. */
const GAP = 0.03;
/** A ray passing this close to the bar (metres, at arm's reach) is on it: under three degrees, clear of the buttons along a panel's foot. */
const AIM = 0.03;
/** Fingers closed this close (metres) to the bar take it, with no pointing. */
const TAKE_REACH = 0.06;
/** A pinch begun this soon (ms) after pointing at a bar takes it. */
const GRACE_MS = 300;
/** The hand must travel this far (metres) before the thing moves: a pinch that only meant to press a button nearby moves nothing. */
const SLACK = 0.015;
/** The hand must come this much nearer the head, or go this much further (as a share of its distance), before the thing does. */
const DEPTH_SLACK = 0.15;
/** How near and how far from the head a thing can be put (metres), and the lowest it can go above the floor. */
const NEAREST = 0.3;
const FURTHEST = 4.2;
const LOWEST = 0.15;
const IDLE = '#8b95a5';
const LIVE = '#7ee0ff';
const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];
const UP = new Vector3(0, 1, 0);

interface Bar {
  group: Group;
  entity: Entity;
  material: MeshBasicMaterial;
  shown: boolean;
}

export class GripSystem extends createSystem({}) {
  private bars = new Map<Movable, Bar>();
  private pillGeometry = new CapsuleGeometry(PILL_RADIUS, PILL_LENGTH, 4, 10);
  private catchGeometry = new CapsuleGeometry(0.022, PILL_LENGTH + 0.02, 2, 8);
  private catchMaterial = new MeshBasicMaterial({ visible: false });
  /** What each hand's ray was last on, and when. */
  private aim: Record<Hand, { movable: Movable | null; at: number }> = {
    left: { movable: null, at: -Infinity },
    right: { movable: null, at: -Infinity },
  };
  /** The bar being held: by which hand, and where the hand, the head and the thing were when it was taken. */
  private held: Movable | null = null;
  private heldBy: Hand = 'right';
  private heldByHand = true;
  private heldMoved = false;
  private handStart = new Vector3();
  private headStart = new Vector3();
  private thingStart = new Vector3();
  private thingNow = new Vector3();

  // Scratch.
  private head = new Vector3();
  private point = new Vector3();
  private edgePoint = new Vector3();
  private rayOrigin = new Vector3();
  private rayDir = new Vector3();
  private rayQuat = new Quaternion();
  private from = new Vector3();
  private to = new Vector3();
  private turn = new Quaternion();
  private wanted = new Vector3();

  init(): void {
    for (const id of ['ask-panel', 'inspector-panel', 'notes-panel']) this.cleanupFuncs.push(addMovable(panelMovable(this.world, id)));

    const sourceOf = (event: Event): XRInputSource | null => (event as Event & { inputSource?: XRInputSource }).inputSource ?? null;
    const onSelectStart = (event: Event) => {
      const source = sourceOf(event);
      if (!source || (source.handedness !== 'left' && source.handedness !== 'right') || this.held) return;
      const hand = source.handedness;
      const byHand = !!source.hand;
      this.pointer(hand, byHand, this.point);
      // The bar the fingers closed on, else the one this hand was pointing at a moment ago.
      let taken: Movable | null = null;
      let nearest = TAKE_REACH;
      for (const [movable, bar] of this.bars) {
        if (!bar.shown) continue;
        const distance = bar.group.position.distanceTo(this.point);
        if (distance < nearest) {
          nearest = distance;
          taken = movable;
        }
      }
      const aim = this.aim[hand];
      if (!taken && aim.movable && performance.now() - aim.at < GRACE_MS && this.bars.get(aim.movable)?.shown) taken = aim.movable;
      const target = taken?.target();
      if (!taken || !target) return;
      this.held = taken;
      this.heldBy = hand;
      this.heldByHand = byHand;
      this.heldMoved = false;
      this.handStart.copy(this.point);
      this.world.camera.getWorldPosition(this.headStart);
      target.getWorldPosition(this.thingStart);
      this.thingNow.copy(this.thingStart);
      if (import.meta.env.DEV) console.log(`[grip] ${hand} ${byHand ? 'hand' : 'controller'} took ${taken.id}`);
    };
    const onSelectEnd = (event: Event) => {
      if (this.held && sourceOf(event)?.handedness === this.heldBy) this.letGo();
    };
    const onSourcesChange = (event: Event) => {
      for (const source of (event as Event & { removed?: readonly XRInputSource[] }).removed ?? []) {
        if (this.held && source.handedness === this.heldBy) this.letGo();
      }
    };
    const onSession = () => {
      const session = this.world.renderer.xr.getSession();
      session?.addEventListener('selectstart', onSelectStart);
      session?.addEventListener('selectend', onSelectEnd);
      session?.addEventListener('inputsourceschange', onSourcesChange);
    };
    const onSessionEnd = () => this.letGo();
    this.world.renderer.xr.addEventListener('sessionstart', onSession);
    this.world.renderer.xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => {
      this.world.renderer.xr.removeEventListener('sessionstart', onSession);
      this.world.renderer.xr.removeEventListener('sessionend', onSessionEnd);
    });
  }

  private letGo(): void {
    if (this.held && import.meta.env.DEV) {
      console.log(`[grip] let go of ${this.held.id}${this.heldMoved ? ` at ${this.thingNow.x.toFixed(2)}, ${this.thingNow.y.toFixed(2)}, ${this.thingNow.z.toFixed(2)}` : ' (not moved)'}`);
    }
    this.held = null;
  }

  /** Where a hand is: its index fingertip, or the controller in it. */
  private pointer(hand: Hand, byHand: boolean, out: Vector3): Vector3 {
    return (byHand ? this.player.indexTipSpaces[hand] : this.player.gripSpaces[hand]).getWorldPosition(out);
  }

  private barFor(movable: Movable): Bar {
    let bar = this.bars.get(movable);
    if (bar) return bar;
    const group = new Group();
    group.name = `grip:${movable.id}`;
    const material = new MeshBasicMaterial({ color: IDLE });
    const pill = new Mesh(this.pillGeometry, material);
    pill.rotation.z = Math.PI / 2;
    // A wider shape nobody sees, so the bar is easy to point at and a ray stops there instead of going on to what is behind.
    const catcher = new Mesh(this.catchGeometry, this.catchMaterial);
    catcher.rotation.z = Math.PI / 2;
    group.add(pill, catcher);
    group.visible = false;
    bar = { group, entity: this.world.createTransformEntity(group, { persistent: true }), material, shown: false };
    this.bars.set(movable, bar);
    return bar;
  }

  private show(bar: Bar, shown: boolean): void {
    if (bar.shown === shown) return;
    bar.shown = shown;
    bar.group.visible = shown;
    if (shown && !bar.entity.hasComponent(RayInteractable)) bar.entity.addComponent(RayInteractable);
    else if (!shown && bar.entity.hasComponent(RayInteractable)) bar.entity.removeComponent(RayInteractable);
  }

  update(delta: number): void {
    if (isPaused()) return;
    const immersive = this.world.renderer.xr.isPresenting;
    this.world.camera.getWorldPosition(this.head);
    const now = performance.now();

    // A bar whose thing has gone (the card came down, the talk ended) is let go.
    if (this.held && (!immersive || !this.held.target())) this.letGo();
    if (this.held) this.follow();

    for (const movable of movables) {
      const bar = this.barFor(movable);
      const target = movable.target();
      const shown = immersive && !!target && inView(target) && movable.edge(this.edgePoint);
      this.show(bar, shown);
      if (!shown) continue;
      movable.face?.(this.head, delta);
      // Just outside the edge, the same size to the eye at any distance, lying level and turned to the visitor.
      const size = Math.max(0.8, this.edgePoint.distanceTo(this.head) / REACH);
      bar.group.position.copy(this.edgePoint);
      bar.group.position.y += movable.side * GAP * size;
      bar.group.scale.setScalar(size);
      bar.group.lookAt(this.head);
      let live = this.held === movable;
      for (const hand of HANDS) {
        const space = this.player.raySpaces[hand];
        space.getWorldPosition(this.rayOrigin);
        space.getWorldQuaternion(this.rayQuat);
        this.rayDir.set(0, 0, -1).applyQuaternion(this.rayQuat);
        this.point.copy(bar.group.position).sub(this.rayOrigin);
        const along = this.point.dot(this.rayDir);
        if (along <= 0) continue;
        if (Math.sqrt(Math.max(0, this.point.lengthSq() - along * along)) > AIM * size) continue;
        this.aim[hand].movable = movable;
        this.aim[hand].at = now;
        live = true;
      }
      bar.material.color.set(live ? LIVE : IDLE);
    }
    // Bars of things that are no longer offered.
    for (const [movable, bar] of this.bars) if (!movables.includes(movable)) this.show(bar, false);
  }

  /** The held thing turns about the head with the hand, and comes nearer or goes further as the hand does. */
  private follow(): void {
    const movable = this.held!;
    this.pointer(this.heldBy, this.heldByHand, this.point);
    if (!this.heldMoved && this.point.distanceTo(this.handStart) < SLACK) return;
    this.heldMoved = true;
    this.from.copy(this.handStart).sub(this.headStart);
    this.to.copy(this.point).sub(this.headStart);
    // Only a clear push or pull changes how far away the thing is: an arm swung
    // to one side also carries the hand a little further from the head, and
    // that must not send a card off across the room.
    const ratio = this.to.length() / Math.max(0.05, this.from.length());
    const pushed = ratio > 1 + DEPTH_SLACK ? ratio / (1 + DEPTH_SLACK) : ratio < 1 - DEPTH_SLACK ? ratio / (1 - DEPTH_SLACK) : 1;
    const reach = Math.min(2.5, Math.max(0.5, pushed));
    this.turn.setFromUnitVectors(this.from.normalize(), this.to.normalize());
    this.wanted.copy(this.thingStart).sub(this.headStart).applyQuaternion(this.turn).multiplyScalar(reach);
    this.wanted.setLength(Math.min(FURTHEST, Math.max(NEAREST, this.wanted.length()))).add(this.headStart);
    this.wanted.y = Math.max(LOWEST, this.wanted.y);
    // A little smoothing: a fingertip's small tremble is three times as large on a card across the room.
    this.thingNow.lerp(this.wanted, 0.4);
    movable.moveTo(this.thingNow);
  }
}

/** Whether something is shown: itself and everything it hangs from. */
function inView(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

const box = new Box3();
const inverse = new Matrix4();
const local = new Matrix4();

/**
 * The middle of a panel's top edge, in the world. A panel is laid out about
 * its own middle and grows both ways with what it holds, so its edge has to
 * be measured: from its background, which is the first ordinary mesh in it
 * and covers its whole area. (Only that one: the meshes of buttons that are
 * put away keep bounds far outside the panel, and the UI library's text and
 * instanced meshes have none to read.)
 */
function panelTop(panel: Object3D, out: Vector3): boolean {
  box.makeEmpty();
  panel.updateWorldMatrix(true, true);
  inverse.copy(panel.matrixWorld).invert();
  panel.traverseVisible((o) => {
    if (!box.isEmpty()) return;
    const mesh = o as Mesh & { isMesh?: boolean; isInstancedMesh?: boolean };
    if (!mesh.isMesh || mesh.isInstancedMesh) return;
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    box.copy(geometry.boundingBox).applyMatrix4(local.multiplyMatrices(inverse, mesh.matrixWorld));
  });
  if (box.isEmpty()) return false;
  panel.localToWorld(out.set((box.min.x + box.max.x) / 2, box.max.y, box.max.z));
  return true;
}

const spot = new Vector3();
/** How fast a moved panel turns to the visitor: most of the way in a fifth of a second. */
const TURN_RATE = 10;

/**
 * A panel that stands by the desk. Its bar is over it: under it, beside the
 * city, a bar would be a finger's width from the peg at the city's corner,
 * and one pinch would take both. Once moved, the panel keeps turned
 * (upright) to the visitor.
 */
function panelMovable(world: World, id: string): Movable {
  let yaw: number | null = null;
  return {
    id: id.replace(/-panel$/, ''),
    side: 1,
    target: () => world.getSceneObject<Object3D>(id) ?? null,
    edge: (out) => {
      const panel = world.getSceneObject<Object3D>(id);
      return !!panel && panelTop(panel, out);
    },
    moveTo: (at) => {
      const panel = world.getSceneObject<Object3D>(id);
      if (panel?.parent) movePanel(world, id, panel.parent.worldToLocal(spot.copy(at)));
    },
    face: (head, delta) => {
      const panel = world.getSceneObject<Object3D>(id);
      if (!panel?.parent || !panelMoved(id)) {
        yaw = null;
        return;
      }
      // A panel shows on one side, the one its +Z looks out of: turn that to the head, staying upright.
      panel.parent.worldToLocal(spot.copy(head));
      const wanted = Math.atan2(spot.x - panel.position.x, spot.z - panel.position.z);
      if (yaw === null) yaw = wanted;
      let off = wanted - yaw;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      yaw += off * Math.min(1, delta * TURN_RATE);
      panel.quaternion.setFromAxisAngle(UP, yaw);
    },
    reset: () => {
      yaw = null;
      forgetPanelMoves(world, id);
    },
  };
}
