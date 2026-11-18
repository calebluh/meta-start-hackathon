import {
  Box3,
  CanvasTexture,
  ConeGeometry,
  createSystem,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { blip } from './audio/sound.js';
import { District } from './diorama-components.js';
import { guideProgress } from './guide.js';
import { resolveRef } from './layout.js';
import type { GraphData } from './maps/types.js';
import { ignoreRays } from './rays.js';
import { Bubble } from './rooms/worker.js';
import { addMovable } from './grips.js';
import { app } from './state.js';
import { NOTES_ROOM } from './notes/scribe.js';
import { HACKATHON } from './edition.js';
import { isPaused } from './pause.js';
import { aimWord, placement, pressWord } from './placement.js';
import { dive } from './transition.js';

/**
 * The first five minutes: a short guided path that teaches the hand
 * interactions by doing them, one at a time. One line of text per step, an
 * animated pinch beside it, and an arrow over the thing to point at. Each step
 * finishes when the visitor actually does it, and steps they do early are
 * skipped, so nobody has to read ahead or press Next.
 *
 * The competition build shows it on every visit (a headset is often passed
 * around); the personal edition shows it once per browser. `?guide=0` in the
 * address turns it off and `?guide=1` turns it on; development key `u`
 * starts it over.
 */

type Target = 'building' | 'worker' | 'handle' | null;

interface Step {
  title: string;
  text: (project: string) => string;
  /** True once the visitor has done this step (or something past it). */
  done: (clock: number) => boolean;
  target: Target;
  /** Show the animated pinch beside the card. */
  pinch: boolean;
  /** Only doable inside a room; at the table the guide points back in. */
  inRoom?: boolean;
}

const STEPS: Step[] = [
  {
    title: 'Welcome',
    text: (p) => `This little city is ${p}, a real codebase. Each building is one part of the code.`,
    done: (clock) => clock > 6 || app.selected !== null || app.mode === 'room',
    target: null,
    pinch: false,
  },
  {
    title: 'Point and pinch',
    text: () => `${aimWord()} the building with the arrow, then tap your thumb and finger together.`,
    done: () => app.selected !== null || app.mode === 'room' || guideProgress.talked,
    target: 'building',
    pinch: true,
  },
  {
    title: 'Step inside',
    text: () =>
      placement.gaze
        ? 'The roof lifts: that is its team. Pinch Step inside, over the building, to visit them.'
        : 'The roof lifts: that is its team. Tap Step inside on the desk with a fingertip to visit them.',
    done: () => app.mode === 'room' || guideProgress.asked,
    target: null,
    pinch: false,
  },
  {
    title: 'Meet the team',
    text: () => `The robots here run this part of the code. ${aimWord()} one and pinch to talk.`,
    done: () => guideProgress.talked,
    target: 'worker',
    pinch: true,
    inRoom: true,
  },
  {
    title: 'Ask anything',
    text: () => `Just say your question out loud, or ${pressWord().toLowerCase()} Questions on the left for ideas.`,
    done: () => guideProgress.asked,
    target: null,
    pinch: false,
    inRoom: true,
  },
  {
    title: 'Back to the city',
    text: () => `${pressWord()} Back to table, or just ask a robot to take you back to the city.`,
    done: () => app.mode === 'table',
    target: null,
    pinch: false,
  },
  {
    title: 'Get comfortable',
    text: () =>
      placement.onTable
        ? 'The city is standing on your own table. Pinch the grey bar below the buttons to slide it where you like.'
        : placement.mixed
          ? 'Pinch the grey bar below the buttons and set the city down on your own desk.'
          : 'Too close or too far? Pinch the grey bar below the buttons and drag it where you like.',
    done: (clock) => guideProgress.moved || clock > 14 || app.mode === 'room',
    target: 'handle',
    pinch: true,
  },
  {
    title: 'Make it yours',
    text: () =>
      placement.gaze
        ? 'Every building, button and robot works the same way: look at it and pinch.'
        : 'Pinch and hold a glowing corner peg to turn the city. Hold two at once and pull your hands apart to resize it.',
    done: (clock) => guideProgress.turned || clock > 15,
    target: null,
    pinch: true,
  },
  {
    title: 'You are set',
    text: () => `${pressWord()} Street view to walk the city, Play flow to follow a request, or Notes for ideas.`,
    done: (clock) => clock > 7,
    target: null,
    pinch: false,
  },
];

/** Shown instead of a room step while the visitor is back at the table. */
const BACK_INSIDE: Step = {
  title: 'Step inside',
  text: () => 'Pinch any building, then Step inside, to meet the team that runs it.',
  done: () => false,
  target: 'building',
  pinch: true,
};

const STORAGE_KEY = 'codebase-diorama.guide';
const ACCENT = '#7ee0ff';
/** Where the card floats, in the workspace's space: above the far edge of the board. */
const CARD_ANCHOR = new Vector3(0, 0.3, -0.24);
/**
 * Inside a room the city is gone and a robot stands straight ahead to talk,
 * so the card shrinks and sits low, just behind the buttons, well below the
 * line from the eyes to the robot and its speech bubble.
 */
const ROOM_ANCHOR = new Vector3(0, 0.045, 0.16);
const ROOM_SCALE = 0.6;
const CARD_WIDTH = 0.46;
const PINCH_SECONDS = 1.6;
/** The Skip tour button under the card's right corner, in metres. */
const SKIP_WIDTH = 0.1;
const SKIP_HEIGHT = 0.032;

/** A small dark pill reading "Skip tour". */
function makeSkipButton(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = Math.round((320 * SKIP_HEIGHT) / SKIP_WIDTH);
  const ctx = canvas.getContext('2d')!;
  const h = canvas.height;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.92)';
  ctx.beginPath();
  ctx.roundRect(3, 3, canvas.width - 6, h - 6, (h - 6) / 2);
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = '600 44px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#f0f3f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Skip tour', canvas.width / 2, h / 2 + 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(SKIP_WIDTH, SKIP_HEIGHT), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.name = 'guide-skip';
  mesh.renderOrder = 21;
  return mesh;
}

export class GuideSystem extends createSystem({
  sites: { required: [District] },
}) {
  private holder = new Group();
  private card = new Bubble(CARD_WIDTH, ACCENT, 5);
  private pinch = new Group();
  private thumb!: Mesh;
  private finger!: Mesh;
  private ring!: Mesh;
  private ringMaterial!: MeshBasicMaterial;
  private arrow!: Mesh;
  private skip = makeSkipButton();
  private skipEntity: Entity | null = null;
  private skipHit = false;
  /** Each fingertip's last depth in front of Skip tour (Infinity: not over it). */
  private skipTipZ = { left: Infinity, right: Infinity };
  private tip = new Vector3();

  private active = false;
  private index = -1;
  private shown: Step | null = null;
  private clock = 0;
  private graph: GraphData | null = null;
  private suggested: Object3D | null = null;
  private workers: Object3D[] = [];
  private workerScan = 0;
  private handle: Object3D | null = null;

  private head = new Vector3();
  private point = new Vector3();
  private box = new Box3();
  /** How far the visitor has moved the card from each of its two places (the desk's space). */
  private nudgeNear = new Vector3();
  private nudgeFar = new Vector3();

  init(): void {
    this.holder.name = 'guide';
    this.holder.add(this.card.mesh);
    this.card.mesh.position.x = 0.025;
    // The card can be put anywhere: its bar is over it (its Skip button and the desk's buttons are under it).
    this.cleanupFuncs.push(
      addMovable({
        id: 'tour',
        side: 1,
        target: () => (this.card.mesh.visible ? this.holder : null),
        edge: (out) => {
          this.card.mesh.localToWorld(out.set(0, 0.5, 0));
          return true;
        },
        moveTo: (world) => {
          const workspace = this.world.getSceneObject('workspace');
          if (!workspace) return;
          const near = app.mode === 'room' || app.street;
          workspace.worldToLocal(this.point.copy(world));
          (near ? this.nudgeNear : this.nudgeFar).copy(this.point).sub(near ? ROOM_ANCHOR : CARD_ANCHOR);
        },
        reset: () => {
          this.nudgeNear.set(0, 0, 0);
          this.nudgeFar.set(0, 0, 0);
        },
      }),
    );

    // The pinch: a thumb and a fingertip that meet, with a ring on contact.
    const tipMaterial = new MeshBasicMaterial({ color: '#ffffff' });
    this.thumb = new Mesh(new SphereGeometry(0.007, 12, 8), tipMaterial);
    this.finger = new Mesh(new SphereGeometry(0.007, 12, 8), tipMaterial);
    this.ringMaterial = new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(0.009, 0.012, 24), this.ringMaterial);
    this.pinch.add(this.thumb, this.finger, this.ring);
    this.pinch.position.x = -CARD_WIDTH / 2 - 0.012;
    this.holder.add(this.pinch);

    this.arrow = new Mesh(new ConeGeometry(0.5, 1, 16), new MeshBasicMaterial({ color: ACCENT }));
    this.arrow.rotation.x = Math.PI; // point down
    this.arrow.visible = false;
    ignoreRays(this.holder);
    ignoreRays(this.arrow);
    this.holder.visible = false;
    const holderEntity = this.world.createTransformEntity(this.holder, { persistent: true });
    // Skip tour: pinch it from afar or tap it with a fingertip.
    this.skipEntity = this.world.createTransformEntity(this.skip, { parent: holderEntity, persistent: true });
    (this.skip as unknown as { addEventListener(type: string, fn: () => void): void }).addEventListener('pointerdown', () => {
      this.skipHit = true;
    });
    this.world.createTransformEntity(this.arrow, { persistent: true });

    const wanted = new URLSearchParams(location.search).get('guide');
    this.active = wanted === '0' ? false : wanted === '1' || HACKATHON || !this.seen();
  }

  private seen(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'done';
    } catch {
      return false;
    }
  }

  private finish(): void {
    if (import.meta.env.DEV) console.log('[guide] finished');
    this.active = false;
    this.holder.visible = false;
    this.arrow.visible = false;
    this.skipTipZ.left = this.skipTipZ.right = Infinity;
    this.setSkipPressable(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      // Private browsing: the guide simply shows again next time.
    }
  }

  /** The building to suggest first: the first stop of the first flow, as a leaf. */
  private findSuggested(): Object3D | null {
    const graph = app.graph;
    const leaves = graph.nodes.filter((n) => !graph.nodes.some((c) => c.parent === n.id));
    let id = resolveRef(graph, graph.flows[0]?.steps[0]?.ref ?? '') ?? null;
    if (id && !leaves.some((n) => n.id === id)) id = leaves.find((n) => n.parent === id)?.id ?? null;
    id ??= leaves[0]?.id ?? null;
    for (const entity of this.queries.sites.entities) {
      if (entity.getValue(District, 'nodeId') === id) return entity.object3D ?? null;
    }
    return null;
  }

  private scanWorkers(): void {
    this.workers.length = 0;
    this.world.scene.traverse((o) => {
      if (o.name.startsWith('worker:')) this.workers.push(o);
    });
  }

  update(delta: number, time: number): void {
    if (isPaused()) return;
    if (guideProgress.restart) {
      guideProgress.restart = false;
      this.active = true;
      this.index = -1;
      this.shown = null;
    }
    if (!this.active) return;
    if (this.skipHit) {
      this.skipHit = false;
      if (this.holder.visible) {
        if (import.meta.env.DEV) console.log('[guide] skipped');
        blip();
        this.finish();
        return;
      }
    }
    if (app.menu) {
      this.holder.visible = false;
      this.arrow.visible = false;
      this.setSkipPressable(false);
      return;
    }
    if (this.graph !== app.graph) {
      this.graph = app.graph;
      this.suggested = null;
    }

    // Advance past every step already done; each change restarts the clock.
    this.clock += delta;
    let next = Math.max(this.index, 0);
    while (next < STEPS.length && STEPS[next].done(next === this.index ? this.clock : 0)) next += 1;
    if (next >= STEPS.length) {
      this.finish();
      return;
    }
    if (next !== this.index) {
      if (this.index >= 0) blip();
      this.index = next;
      this.clock = 0;
    }
    const current = STEPS[this.index];
    const step = current.inRoom && app.mode !== 'room' ? BACK_INSIDE : current;
    if (step !== this.shown) {
      this.shown = step;
      this.card.setText(step.text(app.graph.project.name), `${this.index + 1} of ${STEPS.length}  ${step.title}`);
      // Under the card's right corner, clear of its text.
      this.skip.position.set(this.card.mesh.position.x + CARD_WIDTH / 2 - SKIP_WIDTH / 2, -this.card.mesh.scale.y / 2 - SKIP_HEIGHT / 2 - 0.008, 0.002);
      this.pinch.visible = step.pinch;
      if (import.meta.env.DEV) console.log(`[guide] step=${this.index + 1} ${step.title}`);
      this.workers.length = 0;
    }

    // The card floats over the board, turned to the viewer; it steps aside
    // during a dive.
    const workspace = this.world.getSceneObject('workspace');
    // The notes room explains itself (its panel and the side panel): no guide card there.
    const hidden = dive.active || !workspace || (app.mode === 'room' && app.roomNode === NOTES_ROOM);
    this.holder.visible = !hidden;
    this.setSkipPressable(!hidden);
    this.world.camera.getWorldPosition(this.head);
    if (workspace && !hidden) {
      // In a room, and at life size in the streets, the card sits low and close, just
      // behind the buttons: out there a building's wall is often nearer than the far edge of the desk.
      const near = app.mode === 'room' || app.street;
      // Plus wherever the visitor has dragged it to (see grips.ts): each of its two places keeps its own.
      this.holder.position.copy(near ? ROOM_ANCHOR : CARD_ANCHOR).add(near ? this.nudgeNear : this.nudgeFar);
      workspace.localToWorld(this.holder.position);
      this.holder.scale.setScalar(near ? ROOM_SCALE : 1);
      this.holder.lookAt(this.head);
    }

    if (this.pinch.visible) {
      // Open, close, a flash on contact, a beat, again.
      const phase = (time % PINCH_SECONDS) / PINCH_SECONDS;
      const close = phase < 0.45 ? phase / 0.45 : phase < 0.7 ? 1 : 1 - (phase - 0.7) / 0.3;
      const gap = 0.007 + 0.022 * (1 - close * close * (3 - 2 * close));
      this.thumb.position.set(-0.004, -gap / 2, 0);
      this.finger.position.set(0.004, gap / 2, 0);
      const flash = phase >= 0.45 && phase < 0.75 ? (phase - 0.45) / 0.3 : -1;
      this.ringMaterial.opacity = flash >= 0 ? 0.9 * (1 - flash) : 0;
      this.ring.scale.setScalar(flash >= 0 ? 1 + flash * 1.6 : 1);
    }

    if (!hidden) this.pokeSkip();
    this.placeArrow(step.target, delta, time, hidden);
  }

  /** Skip tour takes rays and fingertips only while the card shows. */
  private setSkipPressable(on: boolean): void {
    const e = this.skipEntity;
    if (!e) return;
    if (on && !e.hasComponent(RayInteractable)) e.addComponent(RayInteractable);
    else if (!on && e.hasComponent(RayInteractable)) e.removeComponent(RayInteractable);
    if (on && !e.hasComponent(PokeInteractable)) e.addComponent(PokeInteractable);
    else if (!on && e.hasComponent(PokeInteractable)) e.removeComponent(PokeInteractable);
  }

  /** A fingertip in Skip tour's own space (front: +z), into `tip`; true when over the button. */
  private tipOverSkip(hand: 'left' | 'right', margin: number): boolean {
    this.player.indexTipSpaces[hand].getWorldPosition(this.tip);
    this.skip.worldToLocal(this.tip);
    return Math.abs(this.tip.x) < SKIP_WIDTH / 2 + margin && Math.abs(this.tip.y) < SKIP_HEIGHT / 2 + margin;
  }

  /** A fingertip pushed through Skip tour, or a pinch made right at it, presses it. */
  private pokeSkip(): void {
    if (!this.world.renderer.xr.isPresenting) return;
    for (const hand of ['left', 'right'] as const) {
      const over = this.tipOverSkip(hand, 0.006);
      const z = this.tip.z;
      const before = this.skipTipZ[hand];
      this.skipTipZ[hand] = over ? z : Infinity;
      if (over && before > 0 && before < 0.05 && z <= 0.004 && z > -0.04) this.skipHit = true;
    }
  }

  private placeArrow(target: Target, delta: number, time: number, hidden: boolean): void {
    let size = 0;
    if (!hidden && target === 'building' && app.mode === 'table' && !app.street) {
      this.suggested ??= this.findSuggested();
      if (this.suggested) {
        this.box.setFromObject(this.suggested);
        this.box.getCenter(this.point);
        this.point.y = this.box.max.y + 0.03;
        size = 0.018;
      }
    } else if (!hidden && target === 'handle' && app.mode === 'table') {
      this.handle ??= this.world.scene.getObjectByName('desk-handle') ?? null;
      if (this.handle?.visible) {
        this.handle.getWorldPosition(this.point);
        this.point.y += 0.045;
        size = 0.016;
      }
    } else if (!hidden && target === 'worker' && app.mode === 'room') {
      this.workerScan -= delta;
      if (this.workers.length === 0 && this.workerScan <= 0) {
        this.workerScan = 0.5;
        this.scanWorkers();
      }
      // The nearest robot to the viewer.
      let best = Infinity;
      for (const w of this.workers) {
        w.getWorldPosition(this.box.min);
        const d = this.box.min.distanceToSquared(this.head);
        if (d < best) {
          best = d;
          this.point.copy(this.box.min);
        }
      }
      if (best < Infinity) {
        this.point.y += 1.34;
        size = 0.12;
      }
    }
    this.arrow.visible = size > 0;
    if (!this.arrow.visible) return;
    this.arrow.position.copy(this.point);
    this.arrow.position.y += Math.sin(time * 4) * size * 0.4;
    this.arrow.scale.set(size, size * 1.6, size);
  }
}
