import {
  Box3,
  ConeGeometry,
  createSystem,
  DoubleSide,
  Grabbed,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
  SphereGeometry,
  TwoHandsGrabbable,
  Vector3,
} from '@iwsdk/core';
import { blip } from './audio/sound.js';
import { District } from './diorama-components.js';
import { guideProgress } from './guide.js';
import { resolveRef } from './layout.js';
import type { GraphData } from './maps/types.js';
import { ignoreRays } from './rays.js';
import { Bubble } from './rooms/worker.js';
import { app } from './state.js';
import { HACKATHON } from './edition.js';
import { isPaused } from './pause.js';
import { aimWord, placement } from './placement.js';
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
  done: (clock: number, grabbed: boolean) => boolean;
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
    title: 'Get comfortable',
    text: () => 'Too close or too far? Pinch the grey bar below the buttons and drag it where you like.',
    done: (clock) => guideProgress.moved || clock > 14 || app.selected !== null || app.mode === 'room',
    target: 'handle',
    pinch: true,
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
    text: () => 'Pinch Step inside, on the panel in front of you, to visit its room.',
    done: () => app.mode === 'room' || guideProgress.asked,
    target: null,
    pinch: true,
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
    text: () => 'Pinch a question on the left, or just say yours out loud.',
    done: () => guideProgress.asked,
    target: null,
    pinch: false,
    inRoom: true,
  },
  {
    title: 'Back to the city',
    text: () => 'Pinch Back to table, or just ask a robot to take you back to the city.',
    done: () => app.mode === 'table',
    target: null,
    pinch: true,
  },
  {
    title: 'Make it yours',
    text: () =>
      placement.gaze
        ? 'Every building, button and robot works the same way: look at it and pinch.'
        : 'Pinch the board with both hands, then pull apart to resize it or twist to turn it.',
    done: (clock, grabbed) => grabbed || clock > 15,
    target: null,
    pinch: true,
  },
  {
    title: 'You are set',
    text: () => 'Pinch Street view to walk the city at life size, or Play flow to watch a request travel through the code. Have fun!',
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

export class GuideSystem extends createSystem({
  sites: { required: [District] },
  grabbedBoard: { required: [TwoHandsGrabbable, Grabbed] },
}) {
  private holder = new Group();
  private card = new Bubble(CARD_WIDTH, ACCENT, 3);
  private pinch = new Group();
  private thumb!: Mesh;
  private finger!: Mesh;
  private ring!: Mesh;
  private ringMaterial!: MeshBasicMaterial;
  private arrow!: Mesh;

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

  init(): void {
    this.holder.name = 'guide';
    this.holder.add(this.card.mesh);
    this.card.mesh.position.x = 0.025;

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
    this.world.createTransformEntity(this.holder, { persistent: true });
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
    if (app.menu) {
      this.holder.visible = false;
      this.arrow.visible = false;
      return;
    }
    if (this.graph !== app.graph) {
      this.graph = app.graph;
      this.suggested = null;
    }

    // Advance past every step already done; each change restarts the clock.
    this.clock += delta;
    const grabbed = this.queries.grabbedBoard.entities.size > 0;
    let next = Math.max(this.index, 0);
    while (next < STEPS.length && STEPS[next].done(next === this.index ? this.clock : 0, grabbed)) next += 1;
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
      this.pinch.visible = step.pinch;
      if (import.meta.env.DEV) console.log(`[guide] step=${this.index + 1} ${step.title}`);
      this.workers.length = 0;
    }

    // The card floats over the board, turned to the viewer; it steps aside
    // during a dive.
    const workspace = this.world.getSceneObject('workspace');
    const hidden = dive.active || !workspace;
    this.holder.visible = !hidden;
    this.world.camera.getWorldPosition(this.head);
    if (workspace && !hidden) {
      this.holder.position.copy(app.mode === 'room' ? ROOM_ANCHOR : CARD_ANCHOR);
      workspace.localToWorld(this.holder.position);
      this.holder.scale.setScalar(app.mode === 'room' ? ROOM_SCALE : 1);
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

    this.placeArrow(step.target, delta, time, hidden);
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
