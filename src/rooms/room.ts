import {
  AssetManager,
  BackSide,
  CircleGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  type Entity,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  QuadraticBezierCurve3,
  Quaternion,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
} from '@iwsdk/core';
import { ask, speak, speakingSeconds, stopSpeaking, voiceLevel } from '../agent/client.js';
import { LiveMic } from '../agent/live-mic.js';
import { canRecord } from '../agent/recorder.js';
import { suggestedQuestions, type ChatTurn } from '../agent/prompt.js';
import { Worker } from '../diorama-components.js';
import { resolveRef } from '../layout.js';
import { dive, DIVE_FADE_AT } from '../transition.js';
import { guideNote } from '../guide.js';
import { isPaused, onPause, whenResumed } from '../pause.js';
import { placement } from '../placement.js';
import { app, currentStep, enterRoom, type Handoff, nextStep, onChange, startFlow, stopFlow } from '../state.js';
import { arrive, blip, click, pop, setListener, startAmbience, stopAmbience, whoosh } from '../audio/sound.js';
import { addCeiling, addFloorMarkings, addPilasters, makeSwirl, Trail } from './dressing.js';
import { thinkingLine } from './lines.js';
import { ignoreRays } from '../rays.js';
import { mergeStatic } from './merge.js';
import { loadProps } from './props.js';
import { makePropDecor, makePropStation, propsForTheme } from './stations.js';
import { makeDecor, makeItem, makePalette, makeStation, pickTheme, type Theme } from './themes.js';
import { type Mood, RobotCharacter } from './character.js';
import { Bubble } from './worker.js';

const ROOM_RADIUS = 5.2;
const WALL_HEIGHT = 3.4;
const STATION_RADIUS = 3.3;
const PORTAL_RADIUS = 5.05;
const WALK_SPEED = 0.8;
/** Workers keep at least this far from the seated viewer. */
const SAFE_RADIUS = 2.3;
const FADE_SECONDS = 0.35;
const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy'];

type Task =
  | { kind: 'walk'; to: Vector3 }
  | { kind: 'face'; at: Vector3 }
  /** Waits `seconds`, or (after a short minimum) until `done` says so. */
  | { kind: 'wait'; seconds: number; say?: string; title?: string; done?: () => boolean }
  | { kind: 'until'; test: () => boolean }
  | { kind: 'call'; fn: () => void };

interface WorkerState {
  rig: RobotCharacter;
  entity: Entity;
  name: string;
  bubble: Bubble;
  queue: Task[];
  clock: number;
  heading: number;
  item: Object3D;
  carrying: boolean;
  stations: [number, number];
  scripted: boolean;
  /** Being pointed at: stands still, faces the visitor, ring at the feet. */
  hovered: boolean;
  ring: Mesh;
  /** What the worker is doing with their body, beyond walking and carrying. */
  mood: Mood;
  /** The line being typed into the bubble, if any. */
  speech: { text: string; title: string; start: number } | null;
  /** Bumped whenever a new line starts, so a finished old line does not reset the mood. */
  speechToken: number;
}

/** Typing speed of speech bubbles, matched to talking pace. */
const CHARS_PER_SECOND = 16;
/** A ready answer waits at most this long for the "let me check" line to finish. */
const ACK_GRACE_MS = 1500;
/** The shortest time a flow step's note stays up, even if the voice was cut off. */
const MIN_NOTE_SECONDS = 2.5;

interface Station {
  point: Vector3;
  /**
   * Where each worker stands to use it: one spot per worker, side by side,
   * so two workers are never sent to the same place.
   */
  spots: Vector3[];
  /** What each spot faces: the part of the station in front of it. */
  faces: Vector3[];
}

/** Invisible shape that rays hit when pointing at a worker. */
const WORKER_HITBOX = new CylinderGeometry(0.42, 0.42, 1.3, 12);
const RING_GEOMETRY = new TorusGeometry(0.42, 0.018, 6, 40);
const HITBOX_MATERIAL = new MeshBasicMaterial({ visible: false });

/** Side-by-side spacing of standing spots at a station. */
const SPOT_SPACING = 0.85;

interface Portal {
  nodeId: string;
  /** Mouth of the tube on the wall, at chest height. */
  mouth: Vector3;
  /** Floor spot in front of it where a worker waits. */
  landing: Vector3;
}

interface Packet {
  group: Group;
  label: Bubble;
  curve: QuadraticBezierCurve3;
  flying: boolean;
  held: boolean;
  t: number;
  duration: number;
  onArrive: (() => void) | null;
}

/**
 * The inside view. When the app is in `room` mode, builds a life-size room for
 * that part of the codebase around the seated viewer, staffs it with workers
 * who carry the room's goods between stations, and plays flow steps as a
 * packet that arrives through a wall tube, gets handled, and leaves for the
 * next part. With Follow on, the view cuts to the next room as it leaves.
 */
export class RoomSystem extends createSystem({
  pressedWorkers: { required: [Worker, Pressed] },
  hoveredWorkers: { required: [Worker, Hovered] },
}) {
  private workspace: Object3D | undefined;
  private roomEntity: Entity | null = null;
  private roomGroup: Group | null = null;
  private builtNode: string | null = null;
  private theme: Theme | null = null;
  private stations: Station[] = [];
  private portals: Portal[] = [];
  private workers: WorkerState[] = [];
  private bubbles: Bubble[] = [];
  private packet: Packet | null = null;
  private handledStep = -1;
  private offRoomClock = 0;

  // Conversation with one worker.
  private askPanel: UIKitMLAsset | undefined;
  private talking: WorkerState | null = null;
  private history: ChatTurn[] = [];
  private questions: string[] = [];
  private waiting = false;
  /** Bumped whenever a conversation starts or ends, so a late answer knows it is stale. */
  private conversation = 0;
  private mic!: LiveMic;
  /** The visitor turned the mic off for this conversation. */
  private micOff = false;
  private fileCard: Bubble | null = null;
  private swirls: Mesh[] = [];
  private trail: Trail | null = null;

  // Fade between rooms: a dark sphere around the head.
  private fade!: Mesh;
  private fadeMaterial!: MeshBasicMaterial;
  private fadeLevel = 0;
  private fadeTarget = 0;
  /** True while a room's props are loading behind the fade. */
  private preparing = false;
  /** The building whose props were last fetched ahead of stepping inside. */
  private prefetched: string | null = null;

  // Scratch.
  private head = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private headForward = new Vector3();
  private headUp = new Vector3();
  private headQuat = new Quaternion();

  /** A room-local point in world space, for placing sounds. */
  private worldPoint(local: Vector3): Vector3 {
    return this.roomGroup ? this.roomGroup.localToWorld(local.clone()) : local.clone();
  }

  init(): void {
    this.workspace = this.world.getSceneObject('workspace');
    this.fadeMaterial = new MeshBasicMaterial({
      color: '#05060a',
      side: BackSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.fade = new Mesh(new SphereGeometry(0.4, 16, 12), this.fadeMaterial);
    this.fade.renderOrder = 1000;
    this.fade.visible = false;
    this.world.createTransformEntity(this.fade, { persistent: true });
    this.cleanupFuncs.push(onChange(() => this.onStateChange()));
    this.wireAskPanel();
    // Headset off or the system menu up: close the microphone, and open it
    // again on return if a conversation is still going.
    this.cleanupFuncs.push(
      onPause((paused) => {
        if (paused) this.mic?.stop();
        else if (this.talking) void this.openMic();
        this.updateMicLabel();
      }),
    );
    this.cleanupFuncs.push(
      this.queries.hoveredWorkers.subscribe('qualify', (entity) => {
        const worker = this.workers.find((w) => w.entity === entity);
        if (worker) worker.hovered = true;
      }),
      this.queries.hoveredWorkers.subscribe('disqualify', (entity) => {
        const worker = this.workers.find((w) => w.entity === entity);
        if (worker) worker.hovered = false;
      }),
      this.queries.pressedWorkers.subscribe('qualify', (entity) => {
        const worker = this.workers.find((w) => w.entity === entity);
        if (worker && worker !== this.talking) this.startConversation(worker);
      }),
    );
  }

  private desiredNode(): string | null {
    return app.mode === 'room' ? app.roomNode : null;
  }

  private onStateChange(): void {
    if (app.stepIndex < 0 && this.handledStep >= 0) this.dropStep();
    this.prefetchSelected();
    if (this.desiredNode() !== this.builtNode) this.fadeTarget = 1;
    else this.maybeHandleStep();
  }

  /**
   * A building was picked on the table: start downloading its room's props
   * now, so stepping inside is not a long wait in the dark.
   */
  private prefetchSelected(): void {
    const id = app.selected;
    if (app.mode !== 'table' || !id || id === this.prefetched) return;
    this.prefetched = id;
    void loadProps(propsForTheme(pickTheme(app.graph, id)));
  }

  /** The flow was stopped part-way through a step: put the packet away and free the lead. */
  private dropStep(): void {
    this.handledStep = -1;
    const packet = this.packet;
    if (packet) {
      packet.flying = false;
      packet.held = false;
      packet.onArrive = null;
      packet.group.visible = false;
    }
    const lead = this.workers[0];
    if (!lead || lead === this.talking) return;
    if (lead.speech && !this.talking) stopSpeaking();
    this.hush(lead);
    lead.queue = [];
    lead.clock = 0;
    lead.scripted = false;
  }

  /** Ends whatever line a worker is saying or showing. */
  private hush(w: WorkerState): void {
    w.speechToken += 1;
    w.speech = null;
    w.mood = 'idle';
    w.bubble.setText('');
  }

  // ------------------------------------------------------------- building

  private build(nodeId: string): void {
    const workspaceEntity = this.world.getSceneEntity('workspace');
    const theme = pickTheme(app.graph, nodeId);
    const node = app.graph.nodes.find((n) => n.id === nodeId)!;
    const palette = makePalette(theme);
    this.theme = theme;

    const group = new Group();
    group.name = `room:${nodeId}`;
    // Everything that never moves goes here and is merged once built (see merge.ts).
    const staticGroup = new Group();
    staticGroup.name = 'static';
    group.add(staticGroup);
    group.position.set(0, -(this.workspace?.position.y ?? 0.74), placement.reach);

    const floor = new Mesh(new CircleGeometry(ROOM_RADIUS, 48), new MeshStandardMaterial({ color: theme.floor, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    staticGroup.add(floor);
    const rug = new Mesh(new TorusGeometry(1.2, 0.02, 6, 64), palette.glow);
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.01;
    staticGroup.add(rug);

    const wall = new Mesh(
      new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, WALL_HEIGHT, 48, 1, true),
      new MeshStandardMaterial({ color: theme.wall, roughness: 0.9, side: BackSide }),
    );
    wall.position.y = WALL_HEIGHT / 2;
    staticGroup.add(wall);
    const trim = new Mesh(new TorusGeometry(ROOM_RADIUS - 0.02, 0.025, 6, 96), palette.glow);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = WALL_HEIGHT - 0.2;
    staticGroup.add(trim);
    addCeiling(staticGroup, theme, palette, ROOM_RADIUS, WALL_HEIGHT);
    addPilasters(staticGroup, theme, ROOM_RADIUS, WALL_HEIGHT);
    addFloorMarkings(staticGroup, theme, palette);

    // Room sign on the far wall, straight ahead.
    const sign = new Bubble(2.2, theme.accent);
    sign.setText(node.summary, `${node.label} · ${theme.place}`);
    sign.mesh.position.set(0, 2.55, -(ROOM_RADIUS - 0.12));
    group.add(sign.mesh);
    this.bubbles.push(sign);

    // The company's logo beside the sign: this building belongs to the project.
    const logoUrl = app.graph.project.logo;
    if (logoUrl) {
      const logo = new Mesh(new PlaneGeometry(0.55, 0.55), new MeshBasicMaterial({ transparent: true }));
      logo.position.set(-1.6, 2.55, -(ROOM_RADIUS - 0.14));
      group.add(logo);
      void AssetManager.loadTexture(`${import.meta.env.BASE_URL}${logoUrl}`, `logo:${logoUrl}`).then((texture) => {
        texture.colorSpace = SRGBColorSpace;
        (logo.material as MeshBasicMaterial).map = texture;
        (logo.material as MeshBasicMaterial).needsUpdate = true;
      });
    }

    // Stations in an arc in front of the viewer, so nobody needs to turn round.
    const stationAngles = [-55, 0, 55].map((d) => (d * Math.PI) / 180);
    this.stations = stationAngles.map((a, i) => {
      const kind = theme.stations[i % theme.stations.length];
      const station = makePropStation(kind, palette) ?? makeStation(kind, palette);
      const point = new Vector3(Math.sin(a) * STATION_RADIUS, 0, -Math.cos(a) * STATION_RADIUS);
      station.position.copy(point);
      station.rotation.y = -a;
      staticGroup.add(station);
      const inward = point.clone().normalize().multiplyScalar(-1);
      const across = new Vector3(inward.z, 0, -inward.x);
      const spots: Vector3[] = [];
      const faces: Vector3[] = [];
      for (let k = 0; k < 3; k += 1) {
        const side = (k - 1) * SPOT_SPACING;
        faces.push(point.clone().addScaledVector(across, side * 0.8));
        spots.push(point.clone().addScaledVector(inward, 0.8).addScaledVector(across, side));
      }
      return { point, spots, faces };
    });

    // Background props near the wall, between and beside the stations.
    const decorAngles = [-90, -28, 28, 90].map((d) => (d * Math.PI) / 180);
    decorAngles.forEach((a, i) => {
      const kind = theme.decor[i % theme.decor.length];
      const prop = makePropDecor(kind) ?? makeDecor(kind, palette);
      const wallHeight = prop.userData.wallHeight as number | undefined;
      // Wall-mounted pieces (clocks) hang on the wall; the rest stand near it.
      const r = wallHeight ? ROOM_RADIUS - 0.2 : ROOM_RADIUS - 0.7;
      prop.position.set(Math.sin(a) * r, wallHeight ?? 0, -Math.cos(a) * r);
      prop.rotation.y = -a;
      staticGroup.add(prop);
    });

    // Tubes to every part this one talks to, plus any flow neighbours.
    const neighbours = new Set<string>();
    for (const l of app.graph.links) {
      const a = resolveRef(app.graph, l.a);
      const b = resolveRef(app.graph, l.b);
      if (a === nodeId && b && b !== nodeId) neighbours.add(b);
      if (b === nodeId && a && a !== nodeId) neighbours.add(a);
    }
    for (const flow of app.graph.flows) {
      const ids = flow.steps.map((s) => resolveRef(app.graph, s.ref));
      ids.forEach((id, i) => {
        if (id !== nodeId) return;
        if (ids[i - 1] && ids[i - 1] !== nodeId) neighbours.add(ids[i - 1]!);
        if (ids[i + 1] && ids[i + 1] !== nodeId) neighbours.add(ids[i + 1]!);
      });
    }
    const list = [...neighbours].slice(0, 9);
    this.portals = list.map((id, i) => {
      const spread = list.length === 1 ? 0 : -1 + (2 * i) / (list.length - 1);
      const a = (spread * 105 * Math.PI) / 180 + (list.length % 2 === 1 ? 0.12 : 0);
      const target = app.graph.nodes.find((n) => n.id === id)!;
      const targetTheme = pickTheme(app.graph, id);
      const mouth = new Vector3(Math.sin(a) * PORTAL_RADIUS, 1.25, -Math.cos(a) * PORTAL_RADIUS);
      const ring = new Mesh(
        new TorusGeometry(0.42, 0.06, 8, 32),
        new MeshStandardMaterial({ color: targetTheme.accent, emissive: new Color(targetTheme.accent), emissiveIntensity: 0.8 }),
      );
      ring.position.copy(mouth);
      ring.rotation.y = -a;
      staticGroup.add(ring);
      const hole = makeSwirl(targetTheme.accent, 0.4);
      this.swirls.push(hole);
      hole.position.copy(mouth).multiplyScalar(1.004);
      hole.rotation.y = -a;
      group.add(hole);
      const label = new Bubble(0.9, targetTheme.accent);
      label.setText(`to ${target.label}`, targetTheme.place);
      label.mesh.position.set(mouth.x * 0.97, 1.95, mouth.z * 0.97);
      group.add(label.mesh);
      this.bubbles.push(label);
      const landing = new Vector3(Math.sin(a) * (PORTAL_RADIUS - 0.9), 0, -Math.cos(a) * (PORTAL_RADIUS - 0.9));
      return { nodeId: id, mouth, landing };
    });

    const folded = mergeStatic(staticGroup);
    if (import.meta.env.DEV) console.log(`[perf] merged ${folded} static meshes in ${nodeId}`);
    this.roomGroup = group;
    this.roomEntity = this.world.createTransformEntity(group, workspaceEntity ? { parent: workspaceEntity } : undefined);

    // Staff: three workers looping between stations.
    this.workers = [0, 1, 2].map((i) => {
      const name = NAMES[(this.hash(nodeId) + i) % NAMES.length];
      // Each worker a slightly different shade of the room colour.
      const rig = new RobotCharacter(theme.accent, (i - 1) * 0.1);
      rig.root.position.copy(this.stations[i].spots[i]);
      rig.root.name = `worker:${name}`;
      // Pointing at a worker uses an invisible body-sized capsule: the
      // skinned robot's own mesh is stored in unscaled bind-pose units, so
      // ray tests against it miss the robot you see.
      ignoreRays(rig.root);
      const hitbox = new Mesh(WORKER_HITBOX, HITBOX_MATERIAL);
      hitbox.position.y = 0.6;
      rig.root.add(hitbox);
      // A glowing ring at the feet while the worker is pointed at.
      const ring = ignoreRays(new Mesh(RING_GEOMETRY, new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.9 })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.visible = false;
      rig.root.add(ring);
      const entity = this.world.createTransformEntity(rig.root, { parent: this.roomEntity! });
      entity.addComponent(Worker, { nodeId, name });
      entity.addComponent(RayInteractable);
      const item = ignoreRays(makeItem(theme.item, palette));
      item.visible = false;
      rig.hands.add(item);
      const bubble = new Bubble(1.2, theme.accent, 10);
      bubble.mesh.position.set(0, 1.55, 0);
      rig.root.add(bubble.mesh);
      this.bubbles.push(bubble);
      return {
        rig,
        entity,
        name,
        bubble,
        queue: [],
        clock: 0,
        heading: 0,
        item,
        carrying: false,
        stations: [i, (i + 1) % this.stations.length] as [number, number],
        scripted: false,
        hovered: false,
        ring,
        mood: 'idle' as Mood,
        speech: null,
        speechToken: 0,
      };
    });

    // The packet.
    const packetGroup = new Group();
    const envelope = new Mesh(new SphereGeometry(0.09, 16, 12), new MeshBasicMaterial({ color: '#ffffff' }));
    const halo = new Mesh(
      new SphereGeometry(0.16, 16, 12),
      new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    packetGroup.add(envelope, halo);
    const packetLabel = new Bubble(0.6, theme.accent);
    packetLabel.mesh.position.y = 0.32;
    packetGroup.add(packetLabel.mesh);
    this.bubbles.push(packetLabel);
    packetGroup.visible = false;
    ignoreRays(packetGroup);
    group.add(packetGroup);
    this.trail = new Trail(group, theme.accent);
    this.packet = {
      group: packetGroup,
      label: packetLabel,
      curve: new QuadraticBezierCurve3(),
      flying: false,
      held: false,
      t: 0,
      duration: 1,
      onArrive: null,
    };

    this.builtNode = nodeId;
    this.handledStep = -1;
    this.maybeHandleStep();

    arrive();
    startAmbience(
      theme.id,
      this.stations.map((st) => this.worldPoint(st.point.clone().setY(1.0))),
    );

    // Sent here by another worker: someone comes over to pick up the thread.
    const handoff = app.handoff;
    app.handoff = null; // for this room or not, it is used up
    if (handoff?.toRoom === nodeId) this.startConversation(this.workers[1], handoff);
  }

  private teardown(): void {
    stopAmbience();
    this.endConversation();
    for (const b of this.bubbles) b.dispose();
    this.bubbles = [];
    for (const w of this.workers) {
      w.rig.dispose();
      w.entity.dispose();
    }
    this.workers = [];
    this.roomEntity?.dispose();
    this.roomEntity = null;
    this.roomGroup = null;
    this.packet = null;
    this.builtNode = null;
    this.stations = [];
    this.portals = [];
    this.swirls = [];
    this.trail = null;
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // -------------------------------------------------------- conversation

  private wireAskPanel(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('ask-panel');
    this.askPanel = panel;
    if (!panel) return;
    this.showAskPanel(false);
    const on = (id: string, handler: () => void) => {
      const el = panel.getElementById(id);
      if (!el) return;
      el.addEventListener('click', handler);
      this.cleanupFuncs.push(() => el.removeEventListener('click', handler));
    };
    for (let i = 0; i < 4; i += 1) on(`q-${i}`, () => {
      click();
      void this.askQuestion(this.questions[i]);
    });
    on('btn-done', () => this.endConversation());
    on('btn-mic', () => this.toggleMic());
    if (!canRecord()) panel.getElementById('btn-mic')?.setProperties({ display: 'none' });
    this.mic = new LiveMic({
      onSpeechStart: () => {
        const w = this.talking;
        if (w && !this.waiting) {
          w.mood = 'listening';
          w.bubble.setText('...', 'YOU');
        }
      },
      onPartial: (text) => {
        const w = this.talking;
        if (w && !this.waiting) w.bubble.setText(text, 'YOU');
      },
      onTurn: (text) => void this.askQuestion(text),
      onMode: () => this.updateMicLabel(),
    });
  }

  /**
   * Shows or hides the question panel. Hidden, it must also stop taking
   * pointer input: an invisible panel would still block rays aimed past it.
   */
  private showAskPanel(shown: boolean): void {
    if (this.askPanel) this.askPanel.visible = shown;
    const entity = this.world.getSceneEntity('ask-panel');
    if (!entity) return;
    if (shown) {
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
      if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable);
    } else {
      if (entity.hasComponent(RayInteractable)) entity.removeComponent(RayInteractable);
      if (entity.hasComponent(PokeInteractable)) entity.removeComponent(PokeInteractable);
    }
  }

  private setAskText(id: string, text: string): void {
    this.askPanel?.getElementById<UIKit.Text>(id)?.setProperties({ text: text.replace(/[’‘]/g, "'") });
  }

  private showQuestions(): void {
    for (let i = 0; i < 4; i += 1) {
      const q = this.questions[i];
      this.askPanel?.getElementById(`q-${i}`)?.setProperties({ display: q ? 'flex' : 'none' });
      if (q) this.setAskText(`q-label-${i}`, q);
    }
  }

  /**
   * Says a line: the bubble types it out at speaking pace while the voice
   * reads it, and the worker gestures until it is done.
   */
  private async say(w: WorkerState, text: string, title: string): Promise<void> {
    const token = ++w.speechToken;
    // An answer that arrives while the headset is off waits for the visitor.
    await whenResumed();
    if (w.speechToken !== token) return;
    if (import.meta.env.DEV) console.log(`[say] ${w.name}: ${text.slice(0, 70)}`);
    w.speech = { text, title, start: performance.now() / 1000 };
    const mouth = w.rig.root.getWorldPosition(new Vector3()).setY(1.1);
    blip(mouth);
    w.mood = 'talking';
    return speak(text, this.hash(w.name), mouth).then(() => {
      if (w.speechToken !== token) return;
      w.mood = 'idle';
      // Leave the whole line up after speaking.
      if (w.speech) w.bubble.setText(w.speech.text, w.speech.title);
      w.speech = null;
    });
  }

  private titleFor(w: WorkerState, suffix = ''): string {
    return `${w.name} | ${this.theme?.role ?? ''}${suffix}`;
  }

  /** The worker walks over to talk, faces the viewer and greets them. */
  private startConversation(w: WorkerState, handoff?: Handoff): void {
    if (!this.builtNode || !this.theme) return;
    this.endConversation();
    guideNote('talked');
    if (app.stepIndex >= 0 && w === this.workers[0]) stopFlow();
    const node = app.graph.nodes.find((n) => n.id === this.builtNode)!;
    this.talking = w;
    this.history = [];
    this.questions = suggestedQuestions(app.graph, this.builtNode);

    // Come within comfortable talking distance, in front of the viewer.
    const p = w.rig.root.position;
    const angle = Math.max(-0.6, Math.min(0.6, Math.atan2(p.x, -p.z)));
    const spot = new Vector3(Math.sin(angle) * 2.0, 0, -Math.cos(angle) * 2.0);
    w.scripted = true;
    w.item.visible = false;
    w.queue = [
      { kind: 'walk', to: spot },
      { kind: 'face', at: new Vector3(0, 0, 0) },
      { kind: 'call', fn: () => w.rig.gesture('Wave') },
    ];

    let greeting = `Hi, I'm ${w.name}, the ${this.theme.role} here in ${node.label}. Ask me anything about this place.`;
    if (handoff) {
      greeting = `Hi, I'm ${w.name}. ${handoff.fromWorker} from ${handoff.fromRoom} sent you over. You were asking "${handoff.question}". What would you like to know about ${node.label}?`;
      // Carry the thread: this worker knows what was said next door.
      this.history.push(
        { role: 'user', content: `(I was just in ${handoff.fromRoom} and asked "${handoff.question}". ${handoff.fromWorker} told me: "${handoff.answer}")` },
        { role: 'assistant', content: greeting },
      );
    }
    void this.say(w, greeting, this.titleFor(w));

    this.setAskText('ask-eyebrow', `ASK ${w.name.toUpperCase()}`);
    this.setAskText('ask-title', `${w.name}, ${this.theme.role} in ${node.label}`);
    this.showQuestions();
    this.showAskPanel(true);
    void this.openMic();
  }

  private async askQuestion(question: string | undefined): Promise<void> {
    const w = this.talking;
    if (!question || !w || !this.builtNode || !this.theme || this.waiting) return;
    this.waiting = true;
    const talk = this.conversation;
    this.hideFileCard();
    const nodeId = this.builtNode;
    const persona = { name: w.name, role: this.theme.role, place: this.theme.place };

    // React straight away and look busy while the model works.
    stopSpeaking();
    const ack = this.say(w, thinkingLine(this.theme.id), this.titleFor(w)).then(() => {
      if (this.waiting && this.talking === w) w.mood = 'thinking';
    });
    const reply = await ask(app.mapId, app.graph, nodeId, persona, question, this.history);
    // Left, or started over with someone else, while waiting: that already
    // reset `waiting`, and this answer belongs to nobody now.
    if (talk !== this.conversation) return;
    // Let the "let me check" line finish, but never keep a ready answer waiting.
    await Promise.race([ack, new Promise((r) => setTimeout(r, ACK_GRACE_MS))]);
    if (talk !== this.conversation) return;
    this.waiting = false;
    guideNote('asked');

    this.history.push({ role: 'user', content: question }, { role: 'assistant', content: reply.answer });
    const asked = new Set(this.history.filter((t) => t.role === 'user').map((t) => t.content));
    const next = [...reply.followups, ...suggestedQuestions(app.graph, nodeId)].filter((q) => !asked.has(q));
    this.questions = [...new Set(next)].slice(0, 4);
    this.showQuestions();

    // Point at a room the worker mentions, whether or not the model asked to.
    const pointAction = reply.actions.find((a) => a.type === 'point_to_room');
    const pointRoom = pointAction?.type === 'point_to_room' ? pointAction.roomId : this.mentionedNeighbour(reply.answer);
    const portal = this.portals.find((p) => p.nodeId === pointRoom);
    if (portal) {
      // Turn to the tube, gesture at it, then turn back to the visitor.
      w.queue.push(
        { kind: 'face', at: portal.mouth },
        { kind: 'call', fn: () => w.rig.gesture('Point') },
        { kind: 'wait', seconds: 1.6 },
        { kind: 'face', at: new Vector3(0, 0, 0) },
      );
    } else w.rig.gesture('Yes');
    const file = reply.actions.find((a) => a.type === 'show_file');
    if (file?.type === 'show_file') this.showFileCard(file.path);

    const answer = reply.answer || 'Right this way.';
    await this.say(w, answer, this.titleFor(w, reply.offline ? ' (offline)' : ''));
    if (talk !== this.conversation) return;

    // Actions that leave the room happen once the worker has finished talking.
    const leave = reply.actions.find((a) => a.type === 'go_to_room' || a.type === 'play_flow');
    if (leave) {
      w.rig.gesture('ThumbsUp');
      await new Promise((r) => setTimeout(r, 900));
      if (talk !== this.conversation) return;
    }
    if (leave?.type === 'go_to_room') {
      app.handoff = { toRoom: leave.roomId, fromWorker: w.name, fromRoom: app.graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId, question, answer };
      this.endConversation();
      enterRoom(leave.roomId);
    } else if (leave?.type === 'play_flow') {
      this.endConversation();
      app.flowIndex = Math.max(0, app.graph.flows.findIndex((f) => f.id === leave.flowId));
      startFlow();
    }
  }

  /** The first neighbouring room named in a reply, if any. */
  private mentionedNeighbour(text: string): string | null {
    const lower = text.toLowerCase();
    let best: { id: string; at: number } | null = null;
    for (const p of this.portals) {
      const label = app.graph.nodes.find((n) => n.id === p.nodeId)?.label.toLowerCase();
      if (!label) continue;
      const at = lower.indexOf(label);
      if (at >= 0 && (!best || at < best.at)) best = { id: p.nodeId, at };
    }
    return best?.id ?? null;
  }

  /** A card for one of the room's files, floating to the viewer's left. */
  private showFileCard(path: string): void {
    const file = app.graph.files.find((f) => f.p === path);
    if (!file || !this.roomGroup || !this.theme) return;
    this.hideFileCard();
    const card = new Bubble(0.7, this.theme.accent, 8);
    card.setText(`${file.d} (${file.loc} lines, ${file.p})`, `File: ${file.name}`);
    card.mesh.position.set(-0.32, 1.42, -1.15); // up and left of centre, clear of the side panels
    this.roomGroup.add(card.mesh);
    this.bubbles.push(card);
    this.fileCard = card;
  }

  private hideFileCard(): void {
    if (!this.fileCard) return;
    this.fileCard.mesh.removeFromParent();
    this.bubbles = this.bubbles.filter((b) => b !== this.fileCard);
    this.fileCard.dispose();
    this.fileCard = null;
  }

  /** Opens the mic for a conversation, unless it is unavailable or switched off. */
  private async openMic(): Promise<void> {
    if (!canRecord() || this.micOff || this.mic.active || isPaused()) return;
    try {
      await this.mic.start(this.micKeywords());
    } catch {
      // Permission refused or no microphone: the question buttons still work.
      this.micOff = true;
    }
    this.updateMicLabel();
  }

  private toggleMic(): void {
    click();
    this.micOff = !this.micOff;
    if (this.micOff) this.mic.stop();
    else if (this.talking) void this.openMic();
    this.updateMicLabel();
  }

  private updateMicLabel(): void {
    const label = this.micOff || !this.mic?.active ? 'Mic off' : 'Mic on - just talk';
    this.setAskText('mic-label', label);
  }

  /** Words to help recognition: room names in the building and this room's files. */
  private micKeywords(): string[] {
    const names = app.graph.nodes.map((n) => n.label);
    const files = app.graph.files.filter((f) => f.n === this.builtNode).map((f) => f.name);
    return [...new Set([...names, ...files])].filter((k) => k.length <= 40).slice(0, 40);
  }

  /** Development hooks (keyboard shortcuts in index.ts). */
  debugTalk(index = 1): void {
    const w = this.workers[index];
    if (w) this.startConversation(w);
  }

  debugAsk(index = 0): void {
    void this.askQuestion(this.questions[index]);
  }

  debugAskText(question: string): void {
    void this.askQuestion(question);
  }

  private endConversation(): void {
    stopSpeaking();
    this.hideFileCard();
    this.mic?.stop();
    this.updateMicLabel();
    this.showAskPanel(false);
    const w = this.talking;
    this.talking = null;
    this.waiting = false;
    this.conversation += 1;
    if (!w) return;
    this.hush(w);
    w.queue = [];
    w.clock = 0;
    w.scripted = false;
  }

  // ---------------------------------------------------------- flow steps

  /** If the current flow step happens in this room, script its handling. */
  private maybeHandleStep(): void {
    const step = currentStep();
    if (!step || !this.builtNode || step.nodeId !== this.builtNode || this.handledStep === app.stepIndex) return;
    this.handledStep = app.stepIndex;
    const index = app.stepIndex;
    const prev = app.flowSteps[index - 1]?.nodeId;
    const next = app.flowSteps[index + 1]?.nodeId;
    const inPortal = this.portals.find((p) => p.nodeId === prev);
    const outPortal = this.portals.find((p) => p.nodeId === next);
    const lead = this.workers[0];
    const packet = this.packet!;
    const desk = this.stations[1];

    packet.label.setText(this.callLabel(prev, this.builtNode) ?? '', undefined);
    packet.held = false;
    packet.flying = false;

    // Drop whatever the lead was doing, a chat with the visitor included.
    if (lead === this.talking) this.endConversation();
    lead.scripted = true;
    lead.queue = [];
    lead.clock = 0;
    lead.item.visible = false;
    this.hush(lead);
    const stepTitle = `${this.theme!.role} ${lead.name} · step ${index + 1} of ${app.flowSteps.length}`;

    const tasks: Task[] = [];
    if (inPortal) {
      tasks.push(
        { kind: 'walk', to: inPortal.landing },
        { kind: 'face', at: inPortal.mouth },
        { kind: 'call', fn: () => this.fly(inPortal.mouth, lead.rig.hands, 1.4, () => this.hold(lead)) },
        { kind: 'until', test: () => packet.held },
      );
    } else {
      tasks.push({ kind: 'call', fn: () => this.hold(lead) });
    }
    // At the desk the lead says what happens in this step, out loud unless
    // the visitor is in the middle of a conversation with someone else.
    const read: Extract<Task, { kind: 'wait' }> = { kind: 'wait', seconds: 3.6 };
    tasks.push(
      { kind: 'walk', to: desk.spots[0] },
      { kind: 'face', at: desk.faces[0] },
      {
        kind: 'call',
        fn: () => {
          if (this.talking) {
            lead.bubble.setText(step.note, stepTitle);
            return;
          }
          let spoken = false;
          read.seconds = Math.min(16, speakingSeconds(step.note) + 4);
          read.done = () => spoken;
          void this.say(lead, step.note, stepTitle).then(() => {
            spoken = true;
          });
        },
      },
      read,
      { kind: 'call', fn: () => this.hush(lead) },
    );
    if (outPortal) {
      tasks.push(
        { kind: 'walk', to: outPortal.landing },
        { kind: 'face', at: outPortal.mouth },
        {
          kind: 'call',
          fn: () => {
            packet.label.setText(this.callLabel(this.builtNode, next) ?? '');
            lead.rig.gesture('Throw');
            this.fly(lead.rig.hands, outPortal.mouth, 1.2, () => {
              packet.group.visible = false;
              this.packetLeft();
            });
          },
        },
        { kind: 'wait', seconds: 1.3 },
      );
    } else {
      tasks.push({
        kind: 'call',
        fn: () => {
          packet.group.visible = false;
          this.packetLeft();
        },
      });
    }
    tasks.push({ kind: 'call', fn: () => (lead.scripted = false) });
    lead.queue = tasks;
  }

  /** The request text on the link between two parts, e.g. "POST /checkout". */
  private callLabel(a: string | null | undefined, b: string | null | undefined): string | null {
    if (!a || !b) return null;
    for (const l of app.graph.links) {
      const x = resolveRef(app.graph, l.a);
      const y = resolveRef(app.graph, l.b);
      if (((x === a && y === b) || (x === b && y === a)) && l.labels?.length) return l.labels[0];
    }
    return null;
  }

  private packetLeft(): void {
    if (!app.playing) return;
    if (app.stepIndex + 1 >= app.flowSteps.length) {
      stopFlow();
      return;
    }
    nextStep();
  }

  private hold(worker: WorkerState): void {
    pop(worker.rig.root.getWorldPosition(new Vector3()).setY(0.8));
    const packet = this.packet!;
    packet.flying = false;
    packet.held = true;
    packet.group.visible = true;
    worker.rig.hands.add(packet.group);
    packet.group.position.set(0, 0.05, 0);
  }

  /** Flies the packet in an arc between two points (Object3Ds are read in world space). */
  private fly(from: Vector3 | Object3D, to: Vector3 | Object3D, seconds: number, onArrive: () => void): void {
    const packet = this.packet!;
    const group = this.roomGroup!;
    const toLocal = (p: Vector3 | Object3D, out: Vector3) => {
      if (p instanceof Vector3) return out.copy(p);
      p.getWorldPosition(out);
      return group.worldToLocal(out);
    };
    toLocal(from, packet.curve.v0);
    toLocal(to, packet.curve.v2);
    packet.curve.v1.copy(packet.curve.v0).lerp(packet.curve.v2, 0.5);
    packet.curve.v1.y += 0.6;
    group.add(packet.group);
    packet.group.position.copy(packet.curve.v0);
    packet.group.visible = true;
    packet.held = false;
    packet.flying = true;
    packet.t = 0;
    packet.duration = seconds;
    packet.onArrive = onArrive;
    whoosh(this.worldPoint(packet.curve.v0));
    this.trail?.reset(packet.curve.v0);
  }

  // ---------------------------------------------------------------- frame

  update(delta: number, time: number): void {
    if (isPaused()) return; // headset off or system menu up: hold everything still
    this.updateFade(delta);
    dive.roomShown = this.roomGroup !== null;
    if (!this.roomGroup) return;

    // Keep the room's floor on the real floor if the desk was recentred.
    if (this.workspace) this.roomGroup.position.y = -this.workspace.position.y;

    this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldDirection(this.headForward);
    this.headUp.set(0, 1, 0).applyQuaternion(this.world.camera.getWorldQuaternion(this.headQuat));
    setListener(this.head, this.headForward, this.headUp);
    for (const b of this.bubbles) if (b.mesh.visible) b.mesh.lookAt(this.head);

    for (const w of this.workers) this.updateWorker(w, delta);
    this.separateWorkers();

    // Half-duplex: the mic is muted while the worker talks or thinks, so it
    // never hears the worker's own voice as a question.
    if (this.talking && this.mic) {
      this.mic.muted = this.waiting || this.talking.mood === 'talking' || this.talking.mood === 'thinking';
    }

    const packet = this.packet;
    if (packet?.flying) {
      packet.t += delta / packet.duration;
      const t = Math.min(packet.t, 1);
      packet.curve.getPoint(t * t * (3 - 2 * t), this.tmp);
      packet.group.position.copy(this.tmp);
      if (t >= 1) {
        packet.flying = false;
        const done = packet.onArrive;
        packet.onArrive = null;
        done?.();
      }
    }
    if (packet?.group.visible) packet.group.rotation.y = time * 1.5;
    this.trail?.update(delta, packet?.flying ? packet.group.position : null);
    for (const swirl of this.swirls) swirl.rotateZ(delta * 1.2);

    // A flow step in another room (Follow off): keep the story moving.
    const step = currentStep();
    if (app.playing && step && step.nodeId !== this.builtNode) {
      this.offRoomClock += delta;
      if (this.offRoomClock > 3.5) {
        this.offRoomClock = 0;
        nextStep();
      }
    } else this.offRoomClock = 0;
  }

  private updateFade(delta: number): void {
    const desired = this.desiredNode();
    if (this.fadeTarget === 1 && this.fadeLevel >= 1 && !this.preparing) {
      // Fully dark: swap rooms, then fade back in. The new room's props load
      // while the view is dark, so nothing pops in.
      if (this.builtNode) this.teardown();
      if (desired) {
        this.preparing = true;
        void loadProps(propsForTheme(pickTheme(app.graph, desired))).then(() => {
          this.preparing = false;
          const now = this.desiredNode();
          if (now) this.build(now);
          this.fadeTarget = 0;
        });
      } else this.fadeTarget = 0;
    }
    const step = delta / FADE_SECONDS;
    // Diving in from the table: let the building grow around the viewer
    // before the view darkens.
    const holding = this.fadeTarget === 1 && dive.active && dive.t < DIVE_FADE_AT;
    if (!holding) this.fadeLevel = this.fadeTarget > this.fadeLevel ? Math.min(1, this.fadeLevel + step) : Math.max(0, this.fadeLevel - step);
    this.fadeMaterial.opacity = this.fadeLevel;
    this.fade.visible = this.fadeLevel > 0.001;
    if (this.fade.visible) this.world.camera.getWorldPosition(this.fade.position);
  }

  private updateWorker(w: WorkerState, delta: number): void {
    w.ring.visible = w.hovered && w !== this.talking;
    // Pointed at (and not busy with a flow step): stop and look at the visitor.
    if (w.hovered && !w.scripted) {
      this.tmp2.set(0, 0, 0).sub(w.rig.root.position);
      this.turnToward(w, Math.atan2(this.tmp2.x, this.tmp2.z), delta);
      this.applyPose(w, false, delta);
      return;
    }
    if (w.queue.length === 0 && !w.scripted) this.queueAmbient(w);
    const task = w.queue[0];
    let walking = false;
    if (task) {
      switch (task.kind) {
        case 'walk': {
          const pos = w.rig.root.position;
          this.tmp.copy(task.to).sub(pos);
          this.tmp.y = 0;
          const dist = this.tmp.length();
          if (dist < 0.04) {
            w.queue.shift();
            break;
          }
          // The viewer sits at the room centre: if the straight line passes
          // too close, walk around the centre on a ring instead.
          if (this.passesNearViewer(pos, task.to)) {
            const from = Math.atan2(pos.z, pos.x);
            let diff = Math.atan2(task.to.z, task.to.x) - from;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const angle = from + Math.sign(diff) * Math.min(Math.abs(diff), 0.6);
            const radius = Math.max(SAFE_RADIUS + 0.5, Math.hypot(pos.x, pos.z));
            this.tmp.set(Math.cos(angle) * radius - pos.x, 0, Math.sin(angle) * radius - pos.z);
          }
          const stepLen = Math.min(dist, WALK_SPEED * delta);
          pos.addScaledVector(this.tmp.normalize(), stepLen);
          this.turnToward(w, Math.atan2(this.tmp.x, this.tmp.z), delta);
          walking = true;
          break;
        }
        case 'face': {
          this.tmp2.copy(task.at).sub(w.rig.root.position);
          const done = this.turnToward(w, Math.atan2(this.tmp2.x, this.tmp2.z), delta);
          if (done) w.queue.shift();
          break;
        }
        case 'wait':
          if (w.clock === 0 && task.say) w.bubble.setText(task.say, task.title);
          w.clock += delta;
          if (w.clock >= task.seconds || (task.done?.() && w.clock >= MIN_NOTE_SECONDS)) {
            w.clock = 0;
            if (task.say) w.bubble.setText('');
            w.queue.shift();
          }
          break;
        case 'until':
          if (task.test()) w.queue.shift();
          break;
        case 'call':
          w.queue.shift();
          task.fn();
          break;
      }
    }

    // The bubble types the current line out at talking pace, a word at a time.
    if (w.speech) {
      const text = w.speech.text;
      let cut = Math.floor((performance.now() / 1000 - w.speech.start) * CHARS_PER_SECOND);
      if (cut < text.length) {
        const space = text.lastIndexOf(' ', cut);
        cut = space > 0 ? space : 0;
        w.bubble.setText(cut > 0 ? `${text.slice(0, cut)} ...` : '...', w.speech.title);
      } else w.bubble.setText(text, w.speech.title);
    }

    this.applyPose(w, walking, delta);
  }

  /** Drives the character's animation from what the worker is doing. */
  private applyPose(w: WorkerState, walking: boolean, delta: number): void {
    const carrying = w.item.visible || (this.packet?.held === true && this.packet.group.parent === w.rig.hands);
    w.rig.mouthLevel = w.mood === 'talking' ? voiceLevel() : -1;
    w.rig.update(delta, walking, WALK_SPEED, w.mood, carrying);
  }

  /**
   * Keeps workers from walking through each other: any two closer than
   * arm's length are pushed apart. The one talking to the visitor stands firm.
   */
  private separateWorkers(): void {
    const minGap = 0.9;
    for (let i = 0; i < this.workers.length; i += 1) {
      for (let j = i + 1; j < this.workers.length; j += 1) {
        const a = this.workers[i];
        const b = this.workers[j];
        const pa = a.rig.root.position;
        const pb = b.rig.root.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d = Math.hypot(dx, dz);
        if (d >= minGap || d < 1e-4) continue;
        const push = minGap - d;
        const share = a === this.talking ? 0 : b === this.talking ? 1 : 0.5;
        pa.x -= (dx / d) * push * share;
        pa.z -= (dz / d) * push * share;
        pb.x += (dx / d) * push * (1 - share);
        pb.z += (dz / d) * push * (1 - share);
      }
    }
  }

  /** True when the straight walk from `a` to `b` comes within SAFE_RADIUS of the viewer. */
  private passesNearViewer(a: Vector3, b: Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / len2)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    return cx * cx + cz * cz < SAFE_RADIUS * SAFE_RADIUS;
  }

  /** Rotates toward a heading; returns true once facing it. */
  private turnToward(w: WorkerState, target: number, delta: number): boolean {
    let diff = target - w.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = delta * 6;
    w.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
    w.rig.root.rotation.y = w.heading;
    return Math.abs(diff) < 0.05;
  }

  /** The everyday loop: fetch goods from one station and take them to another. */
  private queueAmbient(w: WorkerState): void {
    const [a, b] = w.stations;
    const from = this.stations[a];
    const to = this.stations[b];
    const slot = this.workers.indexOf(w);
    w.queue.push(
      { kind: 'walk', to: from.spots[slot] },
      { kind: 'face', at: from.faces[slot] },
      { kind: 'call', fn: () => w.rig.gesture('Interact') },
      { kind: 'wait', seconds: 3.5 + (this.hash(w.name) % 5) * 0.6 },
      { kind: 'call', fn: () => (w.item.visible = true) },
      { kind: 'walk', to: to.spots[slot] },
      { kind: 'face', at: to.faces[slot] },
      { kind: 'call', fn: () => {
        w.item.visible = false;
        w.rig.gesture('Interact');
      } },
      // Work here a while; staff spend most of their time at a station.
      { kind: 'wait', seconds: 4.5 + (this.hash(w.name + 'b') % 5) * 0.7 },
      { kind: 'call', fn: () => w.rig.gesture('Interact') },
      { kind: 'wait', seconds: 3 },
    );
  }
}
