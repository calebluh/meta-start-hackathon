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
import { ask, markSpoken, speak, speakingSeconds, stopSpeaking, voiceLevel, voiceMissing } from '../agent/client.js';
import { LiveMic } from '../agent/live-mic.js';
import { canRecord } from '../agent/recorder.js';
import { asksToLeave, leavesRoom, plainRequest, suggestedQuestions, type ChatTurn } from '../agent/prompt.js';
import { NotesDesk } from '../notes/desk.js';
import { MAX_SAID, noteCommand, type Note, type NoteMode, NOTES_IN_PROMPT, NOTES_NODE, NOTES_ROOM, readBack } from '../notes/scribe.js';
import { appendNote, reviewProject, talkOver } from '../notes/store.js';
import { answerOrder, asksForQuiz, asksToStopQuiz, heardAnswer, quizRound, type QuizQuestion } from '../agent/quiz.js';
import { Carryable, Pipe, Worker } from '../diorama-components.js';
import { resolveRef } from '../layout.js';
import { dive, DIVE_FADE_AT } from '../transition.js';
import { guideNote } from '../guide.js';
import { isPaused, onPause, whenResumed } from '../pause.js';
import { placement, pressWord } from '../placement.js';
import { setPanelShown } from '../panels.js';
import { app, currentStep, enterRoom, type Handoff, leaveRoom, nextStep, onChange, setQuiz, startFlow, stopFlow } from '../state.js';
import { arrive, blip, click, pop, setListener, startAmbience, stopAmbience, whoosh } from '../audio/sound.js';
import { addCeiling, addFloorMarkings, addPilasters, addWindows, makeSwirl, Trail } from './dressing.js';
import { KIND_COLORS } from '../colors.js';
import { thinkingLine } from './lines.js';
import { ignoreRays, takeRays } from '../rays.js';
import { mergeStatic } from './merge.js';
import { loadProps } from './props.js';
import { makePropDecor, makePropStation, propsForTheme } from './stations.js';
import { makeDecor, makeItem, makePalette, makeStation, pickTheme, type Theme } from './themes.js';
import { type Mood, RobotCharacter } from './character.js';
import { Bubble } from './worker.js';
import { CodeCard } from './code-card.js';
import { type CodeRequest, findCode } from './code-fetch.js';
import { CUSTOM_MAPS } from '../maps/index.js';

const ROOM_RADIUS = 5.2;
const WALL_HEIGHT = 3.4;
const STATION_RADIUS = 3.3;
const PORTAL_RADIUS = 5.05;
/** Where the lead stands to hand the visitor the request, and how long it waits. */
const OFFER_SPOT = new Vector3(0.45, 0, -1.3);
const OFFER_SECONDS = import.meta.env.DEV ? 40 : 10;

/** The request held out to the visitor during a flow (see RoomSystem.offerPacket). */
interface Offer {
  lead: WorkerState;
  portal: Portal;
  next: string;
  /** When the lead stops waiting and sends it itself (seconds, performance clock). */
  deadline: number;
  carrying: boolean;
  sending: boolean;
}
const WALK_SPEED = 0.8;
/** Workers keep at least this far from the seated viewer. */
const SAFE_RADIUS = 2.3;
const FADE_SECONDS = 0.35;
/** Short, easy to say and to hear, from many places. */
const NAMES = [
  'Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jun',
  'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sami', 'Tess',
  'Uma', 'Vik', 'Wren', 'Yara', 'Zed', 'Aiko', 'Bram', 'Chloe', 'Dev', 'Esme',
  'Femi', 'Greta', 'Hugo', 'Ines', 'Jonah', 'Kofi', 'Luca', 'Mira', 'Noor', 'Otto',
];

type Task =
  | { kind: 'walk'; to: Vector3 }
  | { kind: 'face'; at: Vector3 }
  /** Waits `seconds`, or (after a short minimum) until `done` says so. */
  | { kind: 'wait'; seconds: number; say?: string; title?: string; done?: () => boolean }
  | { kind: 'until'; test: () => boolean }
  | { kind: 'call'; fn: () => void };

interface WorkerState {
  rig: RobotCharacter;
  /** The invisible capsule that pointers hit: the only part of a robot that takes rays or touches. */
  entity: Entity;
  /** The robot's body, which takes none. */
  body: Entity;
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
  /**
   * When the pointer last left (seconds, performance clock). The robot keeps
   * still a moment longer: a hand ray flickers off as the fingers pinch, and
   * a robot that set off again then would walk away from the pinch.
   */
  hoverLeft: number;
  ring: Mesh;
  /** What the worker is doing with their body, beyond walking and carrying. */
  mood: Mood;
  /** The line being typed into the bubble, if any. */
  /** The line being said: typed out from `start` (when the voice began) at `rate` characters a second. */
  speech: { text: string; title: string; start: number; rate: number } | null;
  /** Bumped whenever a new line starts, so a finished old line does not reset the mood. */
  speechToken: number;
}

/** A robot stays still this long (seconds) after the pointer leaves it. */
const HOVER_LINGER = 0.6;
/** How far to either side of straight ahead a robot may stand to talk, in radians. */
const TALK_ARC = 0.25;
const TALK_ARC_NARROW = 0.06;
/** Typing speed of speech bubbles, matched to talking pace. */
const CHARS_PER_SECOND = 16;
/** A ready answer waits at most this long for the "let me check" line to finish. */
const ACK_GRACE_MS = 1500;
/** How wide a robot's speech bubble is, in metres. */
const SPEECH_WIDTH = 1.2;
/**
 * A file or code card stands this far from the visitor's head (metres): well
 * inside the ring the robots keep clear of, so nothing in the room can cut
 * through it, and at the distance a headset focuses best.
 */
const CARD_DISTANCE = 1.3;
/** The gap between a card and the speech bubble beside it, as seen from the head (radians). */
const CARD_GAP = 0.035;
/**
 * Where the robot stands while it holds a card up (radians left of straight
 * ahead), if it was standing further right: its bubble then ends just right
 * of centre and the card starts there, a short look to the side.
 */
const CARD_ROBOT = -0.2;
/** How far from the visitor a robot stands to talk, in metres. */
const TALK_DISTANCE = 2.0;
/** The foot of the sign on the far wall, in metres: above the labels over the tubes. */
const SIGN_FOOT = 2.2;
/** A card's middle is this far above the visitor's eyes (metres): level with the speech bubble beside it, an easy height to read at. */
const CARD_RISE = 0.11;
/** A file card with no code to show: this wide, in metres. */
const FILE_CARD_WIDTH = 0.8;
/**
 * How wide one character of code is on a card, in metres: about half a
 * degree from where the visitor sits, which reads easily in a headset and
 * lets a full line of code fit in one look.
 */
const CODE_CHAR = CARD_DISTANCE * Math.tan((0.54 * Math.PI) / 180);
/** "Show me more", "the rest", "keep going": the next lines of the code already up (not "more about billing"). */
const ASKS_FOR_MORE = /^(?!.*\b(?:about|another|other|different)\b).*\b(?:more|the rest|next (?:part|bit|lines?|page)|keep going|carry on|continue|further down|scroll)\b/i;
/** If the code has not come after this long (ms), a card says what the file is for until it does. */
const CODE_PATIENCE_MS = 900;

/** What is held up beside a robot: a card of code, or a plain bubble about a file. */
interface FileCard {
  mesh: Mesh;
  dispose(): void;
  /** Called each frame while the card is up (a code card pops in). */
  grow?(delta: number): void;
}
/** The shortest time a flow step's note stays up, even if the voice was cut off. */
const MIN_NOTE_SECONDS = 2.5;
/**
 * The longest a flow step may sit in a room without moving on: reading the
 * note (up to 16 s), the request held out (10 s) and carried to a pipe
 * (20 s) all fit inside it, with time to spare.
 */
const STEP_STALL_SECONDS = import.meta.env.DEV ? 90 : 60;

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
/** Around each pipe's swirl (radius 0.4): the area a ray may hit to choose that pipe. */
const PIPE_HIT = new CircleGeometry(0.62, 20);

/** Side-by-side spacing of standing spots at a station. */
const SPOT_SPACING = 0.85;

interface Portal {
  nodeId: string;
  /** Mouth of the tube on the wall, at chest height. */
  mouth: Vector3;
  /** Floor spot in front of it where a worker waits. */
  landing: Vector3;
  /** The swirl inside the tube: pinch it to send the request this way. */
  hole: Mesh;
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

/** A quiz the visitor is taking from the worker they are talking to. */
interface Quiz {
  questions: QuizQuestion[];
  index: number;
  score: number;
  /** The questions answered wrong, to talk over afterwards. */
  missed: string[];
  /** Which answer each of the three buttons holds, for the question now on the panel. */
  order: number[];
  /** From an answer until the next question is up: further answers are ignored. */
  marking: boolean;
  round: number;
}

const QUIZ_RIGHT_COLOR = '#7ee787';
const QUIZ_WRONG_COLOR = '#ffb454';
const ASK_EYEBROW_COLOR = '#4fd1c5';
/** A breath between the verdict and the next question. */
const QUIZ_PAUSE_MS = 700;
/** Reading time for a verdict when it is not spoken aloud. */
const QUIZ_READ_MS_PER_CHAR = 45;
const QUIZ_READ_MAX_MS = 7000;
const RIGHT_LINES = ['That is right.', 'Yes, exactly.', 'Correct. You have been paying attention.', 'Spot on.'];
const WRONG_LINES = ['Not quite.', 'Not that one.', 'Close, but no.', 'Afraid not.'];

/**
 * The inside view. When the app is in `room` mode, builds a life-size room for
 * that part of the codebase around the seated viewer, staffs it with workers
 * who carry the room's goods between stations, and plays flow steps as a
 * packet that arrives through a wall tube, gets handled, and leaves for the
 * next part. With Follow on, the view cuts to the next room as it leaves.
 */
export class RoomSystem extends createSystem({
  pressedWorkers: { required: [Worker, Pressed] },
  pressedPacket: { required: [Carryable, Pressed] },
  pressedPipes: { required: [Pipe, Pressed] },
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
  /** The sign on the far wall, and what it says outside a quiz. */
  private sign: { bubble: Bubble; text: string; title: string } | null = null;
  /** The worker's latest line and until when the mic may still hear it (seconds). */
  private lastSaid: { text: string; until: number } | null = null;
  /** Counts the visitor cutting in, so an interrupted answer's actions are dropped. */
  private cutIns = 0;
  private packet: Packet | null = null;
  private handledStep = -1;
  private offRoomClock = 0;
  /** The flow step this room last saw, and how long it has gone without moving on (see update). */
  private stallStep = -1;
  private stallClock = 0;

  // Conversation with one worker.
  private askPanel: UIKitMLAsset | undefined;
  private talking: WorkerState | null = null;
  private history: ChatTurn[] = [];
  private questions: string[] = [];
  private waiting = false;
  /** Bumped whenever a conversation starts or ends, so a late answer knows it is stale. */
  private conversation = 0;
  private quiz: Quiz | null = null;
  /** Quizzes started in this room, so a second one asks different questions. */
  private quizRounds = 0;
  private mic!: LiveMic;
  /** The visitor turned the mic off for this conversation. */
  private micOff = false;
  /** The visitor opened the question list while the mic is on (it is folded away otherwise). */
  private askOpen = false;
  /** The file or code card held up beside the robot being talked to, and a count that outdates cards still being fetched. */
  private fileCard: FileCard | null = null;
  private cardToken = 0;
  /** The code last held up in this conversation, so "show me more" can carry on from its last line. */
  private lastCode: { path: string; shownTo: number } | null = null;
  /** The room's info panel is put away while a card stands in its place. */
  private inspectorAside = false;
  /** The notes room: the project's notes and their panel, and the newest notes pinned to the far wall. */
  private notesDesk!: NotesDesk;
  private notePlaques: Bubble[] = [];
  private swirls: Mesh[] = [];
  /** Pinchable pipes and the invisible catch area around the request (see offerPacket). */
  private pipeEntities: Entity[] = [];
  private catcher: Entity | null = null;
  /** The request held out to the visitor during a flow, until it goes down the next pipe. */
  private offer: Offer | null = null;
  /** The visitor has been told once how to carry the request. */
  private taughtCarry = false;
  private trail: Trail | null = null;

  // Fade between rooms: a dark sphere around the head.
  private fade!: Mesh;
  private fadeMaterial!: MeshBasicMaterial;
  private fadeLevel = 0;
  private fadeTarget = 0;
  /** True while a room's props are loading behind the fade. */
  private preparing = false;
  /** Notes room: the latest idea said while the last one was still being thought over. */
  private nextNote: string | null = null;
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
    this.notesDesk = new NotesDesk(this.world, {
      onMode: (mode) => this.announceMode(mode),
      onUndo: (removed) => this.noteUndone(removed),
      onRead: () => {
        if (this.talking && !this.waiting) void this.say(this.talking, readBack(this.notesDesk.notes), this.titleFor(this.talking));
      },
      onReview: () => void this.reviewProject(),
      onMic: () => this.toggleMic(),
      onDone: () => {
        this.endConversation();
        leaveRoom();
      },
      onChange: () => this.pinNotes(),
    });
    this.cleanupFuncs.push(...this.notesDesk.cleanup);
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
        if (worker) {
          worker.hovered = false;
          worker.hoverLeft = performance.now() / 1000;
        }
      }),
      this.queries.pressedWorkers.subscribe('qualify', (entity) => {
        const worker = this.workers.find((w) => w.entity === entity);
        if (worker && worker !== this.talking) this.startConversation(worker);
      }),
      this.queries.pressedPacket.subscribe('qualify', () => this.takePacket()),
      this.queries.pressedPipes.subscribe('qualify', (entity) => this.sendPacketTo(entity.getValue(Pipe, 'nodeId') as string)),
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
    this.endOffer();
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
    const notesRoom = nodeId === NOTES_ROOM;
    const node = notesRoom ? NOTES_NODE : app.graph.nodes.find((n) => n.id === nodeId)!;
    const palette = makePalette(theme);
    this.theme = theme;

    const group = new Group();
    group.name = `room:${nodeId}`;
    // Everything that never moves goes here and is merged once built (see merge.ts).
    const staticGroup = new Group();
    staticGroup.name = 'static';
    group.add(staticGroup);
    group.position.set(0, -(this.workspace?.position.y ?? 0.74), placement.reach);
    // The visitor may have moved the desk: centre the room under their head.
    if (this.workspace) {
      this.world.camera.getWorldPosition(this.head);
      this.workspace.worldToLocal(this.head);
      group.position.x = this.head.x;
      group.position.z = this.head.z;
    }

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
    addWindows(staticGroup, app.graph.nodes.filter((n) => n.id !== nodeId).map((n) => KIND_COLORS[n.kind]), this.hash(nodeId), ROOM_RADIUS, WALL_HEIGHT);

    // The room's own files on plaques round the side and back walls, biggest first.
    const files = app.graph.files.filter((f) => f.n === nodeId).sort((a, b) => b.loc - a.loc).slice(0, 6);
    // Behind the outermost tubes (which reach 118 degrees round with their labels)
    // and clear of each other: three a side, a hand's width apart.
    const plaqueAngles = [127, -127, 148, -148, 169, -169];
    files.forEach((f, i) => {
      const a = (plaqueAngles[i] * Math.PI) / 180;
      const plaque = new Bubble(1.5, theme.accent, 4);
      plaque.setText(`${f.d} (${f.loc} lines)`, f.name);
      this.hang(plaque.mesh, a, ROOM_RADIUS - 0.3, 1.7);
      group.add(plaque.mesh);
      this.bubbles.push(plaque);
    });

    // Room sign on the far wall, straight ahead.
    const sign = new Bubble(2.2, theme.accent, 5);
    const signTitle = `${notesRoom ? app.graph.project.name : node.label} · ${theme.place}`;
    this.sign = { bubble: sign, text: node.summary, title: signTitle };
    // 2.2 m of flat card against a round wall: far enough in that its corners stay in front of it.
    this.hang(sign.mesh, 0, ROOM_RADIUS - 0.2, SIGN_FOOT);
    this.writeSign(node.summary);
    group.add(sign.mesh);
    this.bubbles.push(sign);

    // The notes room pins the newest notes up on the far wall, either side of the sign.
    if (notesRoom) {
      this.notePlaques = [-27, 27, -46, 46].map((degrees) => {
        const a = (degrees * Math.PI) / 180;
        const plaque = new Bubble(1.5, theme.accent, 5);
        this.hang(plaque.mesh, a, ROOM_RADIUS - 0.3, 2.3);
        group.add(plaque.mesh);
        this.bubbles.push(plaque);
        return plaque;
      });
    }

    // The company's logo beside the sign: this building belongs to the project.
    const logoUrl = app.graph.project.logo;
    if (logoUrl) {
      const logo = new Mesh(new PlaneGeometry(0.55, 0.55), new MeshBasicMaterial({ transparent: true }));
      // On the wall to the left of the sign, between a pilaster and a window.
      this.hang(logo, (-20.2 * Math.PI) / 180, ROOM_RADIUS - 0.15, 2.55);
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
    // A second ring behind and beside the visitor, so turning round is not a bare wall.
    const decorAngles = [-90, -28, 28, 90, -130, 130, -160, 160].map((d) => (d * Math.PI) / 180);
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
      this.hang(label.mesh, a, PORTAL_RADIUS * 0.97, 1.95);
      group.add(label.mesh);
      this.bubbles.push(label);
      const landing = new Vector3(Math.sin(a) * (PORTAL_RADIUS - 0.9), 0, -Math.cos(a) * (PORTAL_RADIUS - 0.9));
      return { nodeId: id, mouth, landing, hole };
    });

    const folded = mergeStatic(staticGroup);
    if (import.meta.env.DEV) console.log(`[perf] merged ${folded} static meshes in ${nodeId}`);
    this.roomGroup = group;
    this.roomEntity = this.world.createTransformEntity(group, workspaceEntity ? { parent: workspaceEntity } : undefined);
    // Pipes take a pinch while the visitor carries a request (see sendPacketTo).
    for (const p of this.portals) {
      p.hole.name = `pipe:${p.nodeId}`;
      const pipe = this.world.createTransformEntity(p.hole, { parent: this.roomEntity });
      pipe.addComponent(Pipe, { nodeId: p.nodeId });
      pipe.addComponent(RayInteractable);
      this.pipeEntities.push(pipe);
      // A wider invisible disc around the pipe's mouth: easy to hit from the chair.
      p.hole.add(new Mesh(PIPE_HIT, HITBOX_MATERIAL));
    }
    const catchArea = new Mesh(
      new SphereGeometry(0.24, 12, 8),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    catchArea.name = 'request';
    this.catcher = this.world.createTransformEntity(catchArea, { parent: this.roomEntity });
    this.catcher.addComponent(Carryable, { nodeId });

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
      const hitbox = takeRays(new Mesh(WORKER_HITBOX, HITBOX_MATERIAL));
      hitbox.name = `hitbox:${name}`;
      // A glowing ring at the feet while the worker is pointed at.
      const ring = ignoreRays(new Mesh(RING_GEOMETRY, new MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.9 })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.visible = false;
      rig.root.add(ring);
      // Only the capsule is interactable. Were the robot's body interactable,
      // its skinned meshes (whose bounds are tens of metres across, see above)
      // would catch every fingertip touch in the room, and no button could be tapped.
      const body = this.world.createTransformEntity(rig.root, { parent: this.roomEntity! });
      const entity = this.world.createTransformEntity(hitbox, { parent: body });
      hitbox.position.set(0, 0.6, 0);
      entity.addComponent(Worker, { nodeId, name });
      entity.addComponent(RayInteractable);
      const item = ignoreRays(makeItem(theme.item, palette));
      item.visible = false;
      rig.hands.add(item);
      const bubble = new Bubble(SPEECH_WIDTH, theme.accent, 10);
      bubble.mesh.position.set(0, 1.55, 0);
      rig.root.add(bubble.mesh);
      this.bubbles.push(bubble);
      return {
        rig,
        entity,
        body,
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
        hoverLeft: -Infinity,
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
    // The notes room is for talking: the note taker comes straight over.
    if (notesRoom) this.startConversation(this.workers[1]);
  }

  /**
   * Hangs a card flat on the round wall at `angle`, facing the middle of the
   * room. A card on the wall does not turn to follow the visitor's head:
   * turned or tipped, a flat card's corners go through a curved wall.
   */
  private hang(card: Object3D, angle: number, radius: number, height: number): void {
    card.position.set(Math.sin(angle) * radius, height, -Math.cos(angle) * radius);
    card.rotation.set(0, -angle, 0);
    card.userData.onWall = true;
  }

  /** Writes on the far wall's sign. It grows upwards from its foot, so a long one never reaches down over the tube labels. */
  private writeSign(text: string): void {
    if (!this.sign) return;
    this.sign.bubble.setText(text, this.sign.title);
    this.sign.bubble.mesh.position.y = SIGN_FOOT + this.sign.bubble.mesh.scale.y / 2;
  }

  private teardown(): void {
    stopAmbience();
    this.endConversation();
    for (const b of this.bubbles) b.dispose();
    this.bubbles = [];
    for (const w of this.workers) {
      w.rig.dispose();
      w.entity.dispose();
      w.body.dispose();
    }
    this.workers = [];
    this.roomEntity?.dispose();
    this.roomEntity = null;
    this.roomGroup = null;
    this.packet = null;
    this.sign = null;
    this.notePlaques = [];
    this.builtNode = null;
    this.stations = [];
    this.portals = [];
    for (const e of this.pipeEntities) e.dispose();
    this.pipeEntities = [];
    this.catcher?.dispose();
    this.catcher = null;
    this.offer = null;
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
    // A pinch or a fingertip tap can land twice in a moment: a repeat inside
    // `quiet` is ignored, so Quiz me and the mic do not switch on and straight off.
    const on = (id: string, handler: () => void, quiet = 450) => {
      const el = panel.getElementById(id);
      if (!el) return;
      let last = -Infinity;
      const once = () => {
        const now = performance.now();
        if (now - last < quiet) return;
        last = now;
        handler();
      };
      el.addEventListener('click', once);
      this.cleanupFuncs.push(() => el.removeEventListener('click', once));
    };
    for (let i = 0; i < 4; i += 1) on(`q-${i}`, () => {
      click();
      if (this.quiz) this.answerQuiz(i);
      else void this.askQuestion(this.questions[i]);
    });
    on('btn-quiz', () => {
      click();
      if (this.quiz) this.stopQuiz();
      else this.startQuiz();
    }, 900);
    on('btn-done', () => this.endConversation());
    on('btn-mic', () => this.toggleMic(), 900);
    on('btn-expand', () => {
      click();
      this.askOpen = !this.askOpen;
      this.layoutAsk();
    });
    if (!canRecord()) panel.getElementById('btn-mic')?.setProperties({ display: 'none' });
    this.mic = new LiveMic({
      onSpeechStart: () => {
        const w = this.talking;
        // While the worker talks this may be its own voice: wait for words.
        if (w && !this.waiting && w.mood !== 'talking') {
          w.mood = 'listening';
          w.bubble.setText('...', 'YOU');
        }
      },
      onPartial: (text) => {
        const w = this.talking;
        // In the notes room the mic stays open while an idea is thought over: show the next one on the desk.
        if (w && this.waiting && this.builtNode === NOTES_ROOM && !this.isEcho(text)) this.notesDesk.live(text);
        if (!w || this.waiting || this.isEcho(text)) return;
        // The visitor is cutting in: stop talking and listen.
        if (w.mood === 'talking') {
          if (text.trim().split(/\s+/).length < 2) return;
          this.interrupt(w);
        }
        w.bubble.setText(text, 'YOU');
        if (this.builtNode === NOTES_ROOM) this.notesDesk.live(text);
      },
      onTurn: (text) => {
        if (this.isEcho(text)) return;
        if (this.talking?.mood === 'talking') this.interrupt(this.talking);
        this.heard(text);
      },
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
    this.layoutAsk();
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
    // The bubble shows "..." until the voice starts, then keeps pace with it.
    const speech = { text, title, start: Infinity, rate: CHARS_PER_SECOND };
    w.speech = speech;
    this.lastSaid = { text, until: Infinity };
    const mouth = w.rig.root.getWorldPosition(new Vector3()).setY(1.1);
    blip(mouth);
    w.mood = 'talking';
    const onStart = (rate: number) => {
      speech.start = performance.now() / 1000;
      speech.rate = Math.min(30, Math.max(8, rate));
    };
    return speak(text, this.hash(w.name), mouth, onStart).then(() => {
      if (w.speechToken !== token) return;
      w.mood = 'idle';
      // The microphone can still hear the tail of this line for a moment.
      this.lastSaid = { text, until: performance.now() / 1000 + 2.5 };
      // Leave the whole line up after speaking.
      if (w.speech) w.bubble.setText(w.speech.text, w.speech.title);
      w.speech = null;
    });
  }

  private titleFor(w: WorkerState, suffix = ''): string {
    // Once it is clear this device cannot speak, the bubble says so, so silence is never a mystery.
    const quiet = voiceMissing() ? ' | no voice here' : '';
    return `${w.name} | ${this.theme?.role ?? ''}${suffix}${quiet}`;
  }

  /** The worker walks over to talk, faces the viewer and greets them. */
  private startConversation(w: WorkerState, handoff?: Handoff): void {
    if (!this.builtNode || !this.theme) return;
    this.endConversation();
    const notesRoom = this.builtNode === NOTES_ROOM;
    if (!notesRoom) guideNote('talked');
    if (app.stepIndex >= 0 && w === this.workers[0]) stopFlow();
    const node = notesRoom ? NOTES_NODE : app.graph.nodes.find((n) => n.id === this.builtNode)!;
    this.talking = w;
    this.history = [];
    this.askOpen = false;
    this.questions = suggestedQuestions(app.graph, this.builtNode);

    // Come within comfortable talking distance, in front of the viewer and
    // inside the gap between the two side panels, which would hide a robot
    // standing farther round.
    const p = w.rig.root.position;
    // A narrow view (glasses) cannot hold a robot off to one side and its
    // speech bubble at once, so there it stands almost straight ahead.
    const arc = placement.gaze ? TALK_ARC_NARROW : TALK_ARC;
    const angle = Math.max(-arc, Math.min(arc, Math.atan2(p.x, -p.z)));
    const spot = new Vector3(Math.sin(angle) * TALK_DISTANCE, 0, -Math.cos(angle) * TALK_DISTANCE);
    w.scripted = true;
    w.item.visible = false;
    // A colleague sent for from next door comes in through the pipe from there.
    const door = handoff ? this.portals.find((d) => d.nodeId === handoff.fromRoomId) : undefined;
    if (door) p.copy(door.landing);
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
    if (notesRoom) {
      // The note taker: the notes panel takes the place of the questions.
      this.notesDesk.open(app.mapId, app.graph);
      this.pinNotes();
      const count = this.notesDesk.notes.length;
      const have = count === 0 ? '' : count === 1 ? ' You have one note so far.' : ` You have ${count} notes so far.`;
      greeting =
        this.notesDesk.mode === 'exact'
          ? `Hi, I'm ${w.name}, the note taker for ${app.graph.project.name}.${have} I am writing word for word: just talk, and say "scratch that" to take one back.`
          : `Hi, I'm ${w.name}, the note taker for ${app.graph.project.name}.${have} Tell me an idea and we will talk it over before I write it down. Say "word for word" if you only want it written.`;
      void this.say(w, greeting, this.titleFor(w));
      void this.openMic();
      return;
    }
    void this.say(w, greeting, this.titleFor(w));

    this.showAskHeader(w);
    this.showQuestions();
    this.showAskPanel(true);
    void this.openMic();
  }

  /** The panel heading outside a quiz: who is being asked. */
  private showAskHeader(w: WorkerState): void {
    const node = app.graph.nodes.find((n) => n.id === this.builtNode);
    this.setAskText('ask-eyebrow', `ASK ${w.name.toUpperCase()}`);
    this.askPanel?.getElementById('ask-eyebrow')?.setProperties({ color: ASK_EYEBROW_COLOR });
    this.setAskText('ask-title', `${w.name}, ${this.theme?.role ?? 'worker'} in ${node?.label ?? 'this room'}`);
    this.setAskText('quiz-label', 'Quiz me');
  }

  // -------------------------------------------------------------- notes

  /** Words heard in the notes room: a spoken command, or an idea to write down. */
  private async takeNote(said: string): Promise<void> {
    const w = this.talking;
    const desk = this.notesDesk;
    if (!w || !this.theme) return;
    if (this.waiting) {
      // Still thinking the last one over: keep this one (the latest wins) and take it next.
      this.nextNote = said;
      desk.live(`Next: ${said}`);
      if (import.meta.env.DEV) console.log(`[notes] held while thinking: ${said}`);
      return;
    }
    desk.live('');
    if (said.trim().split(/\s+/).length <= 10 && asksToLeave(said)) {
      this.endConversation();
      leaveRoom();
      return;
    }
    const command = noteCommand(said);
    if (command === 'undo') return this.noteUndone(desk.undo());
    if (command === 'read') return void this.say(w, readBack(desk.notes), this.titleFor(w));
    if (command === 'exact' || command === 'talk') {
      // Switching tells the visitor through onMode; asking for the mode already on is confirmed here.
      if (desk.mode === command) this.announceMode(command);
      else desk.setMode(command);
      return;
    }

    if (desk.mode === 'exact') {
      // Dictation: written exactly as heard, and no talking back over the visitor.
      desk.add(said, 'exact');
      this.noteWritten(w, said);
      return;
    }

    // Talk it over: the note taker answers, and writes the idea down tight.
    this.waiting = true;
    const talk = this.conversation;
    stopSpeaking();
    this.hush(w);
    w.mood = 'thinking';
    w.bubble.setText('Let me think about that...', this.titleFor(w));
    const persona = { name: w.name, role: this.theme.role, place: this.theme.place };
    const reply = await talkOver(
      app.mapId,
      persona,
      said.slice(0, MAX_SAID),
      desk.notes.slice(-NOTES_IN_PROMPT).map((n) => n.text),
      this.history.slice(-4),
    );
    if (talk !== this.conversation) return;
    this.waiting = false;
    if (!reply) {
      // Nobody to talk it over with (no server, no key, too slow): the idea is still kept.
      desk.add(said, 'exact');
      this.noteWritten(w, said);
      void this.say(w, 'I could not think that one over just now, so I wrote it down exactly as you said it.', this.titleFor(w, ' (offline)')).then(() => this.takeNextNote());
      return;
    }
    // A reply with no note line at all keeps the visitor's own words.
    const note = reply.note ?? (reply.marked ? null : said);
    if (note) {
      if (reply.revise && desk.notes.length) desk.reviseLast(note);
      else desk.add(note, reply.marked ? 'talk' : 'exact');
      this.noteWritten(w, '');
    }
    this.history.push({ role: 'user', content: said }, { role: 'assistant', content: reply.say });
    this.history = this.history.slice(-6);
    // The next idea, if one was said meanwhile, once this reply has been heard.
    void this.say(w, reply.say || 'Noted.', this.titleFor(w)).then(() => this.takeNextNote());
  }

  /**
   * "Review this project for me": the note taker goes through the project's
   * warnings and biggest files and writes a work order on the wall, one item
   * at a time, most urgent first.
   */
  private async reviewProject(): Promise<void> {
    const w = this.talking;
    const desk = this.notesDesk;
    if (!w || this.waiting || this.builtNode !== NOTES_ROOM) return;
    this.waiting = true;
    const talk = this.conversation;
    const idle = 'Review this project for me';
    desk.setReviewLabel('Reviewing...');
    void this.say(w, 'Give me a moment. I am going through the warnings, the biggest files and what leans on what.', this.titleFor(w));
    const started = performance.now();
    const review = await reviewProject(app.mapId);
    // Let the opening line be heard before the list starts to appear.
    await new Promise((r) => setTimeout(r, Math.max(0, 2600 - (performance.now() - started))));
    desk.setReviewLabel(idle);
    if (talk !== this.conversation) return;
    if (!review) {
      this.waiting = false;
      void this.say(w, 'I could not reach the reviewer just now. Try again in a moment.', this.titleFor(w, ' (offline)'));
      return;
    }
    const before = desk.notes.length;
    for (const item of review.items) {
      if (talk !== this.conversation) return;
      desk.add(item.text, 'talk');
      this.noteWritten(w, '');
      await new Promise((r) => setTimeout(r, 900));
    }
    if (talk !== this.conversation) return;
    this.waiting = false;
    const added = desk.notes.length - before;
    const say = added === 0 && review.items.length > 0 ? 'I went through it again. Everything I found is already on your list.' : review.say;
    void this.say(w, say, this.titleFor(w)).then(() => this.takeNextNote());
  }

  /** An idea said while the last was being thought over: taken now, so nothing said is lost. */
  private takeNextNote(): void {
    const next = this.nextNote;
    this.nextNote = null;
    if (next && this.builtNode === NOTES_ROOM && this.talking) void this.takeNote(next);
  }

  /** A note went down: a small sound and a nod, and in dictation the words in the bubble. */
  private noteWritten(w: WorkerState, shown: string): void {
    pop(this.worldPoint(w.rig.root.position).setY(1.1));
    w.rig.gesture('Yes');
    if (!shown) return;
    this.hush(w);
    w.bubble.setText(shown, 'NOTED');
  }

  private noteUndone(removed: Note | undefined): void {
    const w = this.talking;
    if (!w || this.waiting) return;
    void this.say(w, removed ? 'Scratched. That one is gone.' : 'There is nothing to take back yet.', this.titleFor(w));
  }

  private announceMode(mode: NoteMode): void {
    const w = this.talking;
    if (!w || this.waiting) return;
    const line =
      mode === 'exact'
        ? 'Word for word it is. I will write down exactly what you say.'
        : 'Let us talk it over. Tell me the idea, and I will write it down once it is clear.';
    void this.say(w, line, this.titleFor(w));
  }

  /** Shows the newest notes on the far wall of the notes room. */
  private pinNotes(): void {
    const notes = this.notesDesk.notes;
    this.notePlaques.forEach((plaque, i) => {
      const note = notes[notes.length - 1 - i];
      plaque.setText(note?.text ?? '', note ? `Note ${notes.length - i}${note.part ? ` | ${note.part}` : ''}` : undefined);
    });
  }

  // --------------------------------------------------------------- quiz

  /** Words from the open microphone: a request for the quiz, an answer to it, or a question. */
  private heard(text: string): void {
    if (this.builtNode === NOTES_ROOM) {
      void this.takeNote(text);
      return;
    }
    const quiz = this.quiz;
    if (!quiz) {
      if (asksForQuiz(text)) this.startQuiz();
      else void this.askQuestion(text);
      return;
    }
    if (quiz.marking || this.waiting || !this.builtNode) return;
    // One of the three answers, said aloud, comes first: an answer can hold
    // words that sound like "stop" ("...change plan or cancel").
    const question = quiz.questions[quiz.index];
    const picked = heardAnswer(quiz.order.map((i) => question.answers[i]), text);
    if (picked !== null) {
      this.answerQuiz(picked);
      return;
    }
    if (asksToStopQuiz(text)) {
      this.stopQuiz();
      return;
    }
    // Asking to go somewhere ends the quiz and is carried out as usual.
    if (plainRequest(app.graph, this.builtNode, text)) {
      this.closeQuiz();
      void this.askQuestion(text);
      return;
    }
    void this.markSpokenAnswer(text);
  }

  /** The worker tests the visitor on its own room: a few questions, three answers each. */
  private startQuiz(): void {
    const w = this.talking;
    if (!w || !this.builtNode || this.quiz) return;
    // An answer still on its way belongs to the talk before the quiz.
    this.conversation += 1;
    this.waiting = false;
    this.hideFileCard();
    const questions = quizRound(app.graph, this.builtNode, this.quizRounds);
    if (questions.length === 0) {
      void this.say(w, 'I do not know this room well enough to quiz you on it yet. Ask me something instead.', this.titleFor(w));
      return;
    }
    this.quizRounds += 1;
    this.quiz = { questions, index: 0, score: 0, missed: [], order: [0, 1, 2], marking: false, round: this.quizRounds };
    this.setAskText('quiz-label', 'Stop the quiz');
    // Closed book: the wall sign and the info card would give the answers away.
    this.writeSign('Quiz in progress.');
    setQuiz(true);
    const count = questions.length === 1 ? 'One question' : `${questions.length} questions`;
    this.askQuizQuestion(`Quiz time. ${count} about this room. ${pressWord()} an answer, or say it. `);
  }

  /** Puts the current question on the panel and has the worker ask it. */
  private askQuizQuestion(lead = ''): void {
    const quiz = this.quiz;
    const w = this.talking;
    if (!quiz || !w) return;
    const question = quiz.questions[quiz.index];
    quiz.order = answerOrder(question, quiz.round);
    quiz.marking = false;
    this.setAskText('ask-eyebrow', `QUIZ - ${quiz.index + 1} OF ${quiz.questions.length}`);
    this.askPanel?.getElementById('ask-eyebrow')?.setProperties({ color: ASK_EYEBROW_COLOR });
    this.setAskText('ask-title', question.prompt);
    for (let i = 0; i < 4; i += 1) {
      this.askPanel?.getElementById(`q-${i}`)?.setProperties({ display: i < 3 ? 'flex' : 'none' });
      if (i < 3) this.setAskText(`q-label-${i}`, question.answers[quiz.order[i]]);
    }
    this.layoutAsk();
    void this.say(w, lead + question.prompt, this.titleFor(w, ' | quiz'));
  }

  /** The visitor picked one of the three answers on the panel, by pinch or by voice. */
  private answerQuiz(shown: number): void {
    const quiz = this.quiz;
    if (!quiz || quiz.marking || this.waiting || shown < 0 || shown > 2) return;
    const question = quiz.questions[quiz.index];
    const right = quiz.order[shown] === 0;
    const line = right ? RIGHT_LINES[quiz.index % RIGHT_LINES.length] : `${WRONG_LINES[quiz.index % WRONG_LINES.length]} ${question.explain}`;
    void this.markQuiz(right, line);
  }

  /**
   * An answer given in the visitor's own words that matches none of the
   * three: the model marks it. Without the model, the worker asks for a
   * pinch or "first, second or third" instead.
   */
  private async markSpokenAnswer(said: string): Promise<void> {
    const quiz = this.quiz;
    const w = this.talking;
    if (!quiz || !w || !this.builtNode || !this.theme) return;
    const index = quiz.index;
    this.waiting = true;
    w.mood = 'thinking';
    const persona = { name: w.name, role: this.theme.role, place: this.theme.place };
    const mark = await markSpoken(app.mapId, this.builtNode, persona, quiz.questions[index].id, said);
    // Stopped, or answered by a pinch, in the meantime.
    if (this.quiz !== quiz || quiz.index !== index || quiz.marking) return;
    this.waiting = false;
    if (mark) void this.markQuiz(mark.right, mark.say);
    else void this.say(w, `I could not tell which answer you meant. ${pressWord()} one, or say first, second or third.`, this.titleFor(w, ' | quiz'));
  }

  /** The worker says whether the answer was right, corrects it if not, and moves on. */
  private async markQuiz(right: boolean, line: string): Promise<void> {
    const quiz = this.quiz;
    const w = this.talking;
    if (!quiz || !w) return;
    const question = quiz.questions[quiz.index];
    quiz.marking = true;
    if (right) quiz.score += 1;
    else quiz.missed.push(question.prompt);

    // The panel gives the verdict and leaves only the right answer standing.
    this.setAskText('ask-eyebrow', right ? 'CORRECT' : 'NOT QUITE - THE ANSWER IS');
    this.askPanel?.getElementById('ask-eyebrow')?.setProperties({ color: right ? QUIZ_RIGHT_COLOR : QUIZ_WRONG_COLOR });
    for (let i = 0; i < 3; i += 1) {
      this.askPanel?.getElementById(`q-${i}`)?.setProperties({ display: quiz.order[i] === 0 ? 'flex' : 'none' });
    }
    const portal = right ? undefined : this.portals.find((p) => p.nodeId === question.pointRoom);
    if (right) {
      arrive();
      w.rig.gesture('ThumbsUp');
    } else if (portal) {
      // Show where the right answer is: turn to its tube, point, turn back.
      w.queue.push(
        { kind: 'face', at: portal.mouth },
        { kind: 'call', fn: () => w.rig.gesture('Point') },
        { kind: 'wait', seconds: 1.6 },
        { kind: 'face', at: new Vector3(0, 0, 0) },
      );
    } else w.rig.gesture('No');

    const shownAt = performance.now();
    await this.say(w, line, this.titleFor(w, ' | quiz'));
    if (this.quiz !== quiz) return;
    // With no voice the line is over at once: still leave time to read it.
    const toRead = Math.min(QUIZ_READ_MAX_MS, 1200 + line.length * QUIZ_READ_MS_PER_CHAR) - (performance.now() - shownAt);
    await new Promise((r) => setTimeout(r, Math.max(QUIZ_PAUSE_MS, toRead)));
    if (this.quiz !== quiz) return;
    quiz.index += 1;
    if (quiz.index < quiz.questions.length) this.askQuizQuestion();
    else this.finishQuiz();
  }

  /** The score, and back to ordinary questions. */
  private finishQuiz(): void {
    const quiz = this.quiz;
    const w = this.talking;
    if (!quiz || !w) return;
    const total = quiz.questions.length;
    const room = app.graph.nodes.find((n) => n.id === this.builtNode)?.label ?? 'this room';
    const line =
      quiz.score === total
        ? `That is the quiz: ${total} out of ${total}. You know ${room} as well as I do.`
        : `That is the quiz: ${quiz.score} out of ${total}. Ask me about anything you missed, or ${pressWord().toLowerCase()} Quiz me for another go.`;
    this.rememberQuiz(quiz, total, line);
    this.closeQuiz();
    w.rig.gesture(quiz.score === total ? 'ThumbsUp' : 'Wave');
    void this.say(w, line, this.titleFor(w));
  }

  /** The visitor ended the quiz early. */
  private stopQuiz(): void {
    const quiz = this.quiz;
    const w = this.talking;
    if (!quiz) return;
    const done = quiz.index + (quiz.marking ? 1 : 0);
    const line = done > 0 ? `No problem. You got ${quiz.score} of ${done} right. Ask me anything.` : 'No problem. Ask me anything.';
    if (done > 0) this.rememberQuiz(quiz, done, line);
    this.closeQuiz();
    if (w) void this.say(w, line, this.titleFor(w));
  }

  /** Tells the worker how the quiz went, so "why was I wrong?" makes sense to it afterwards. */
  private rememberQuiz(quiz: Quiz, answered: number, line: string): void {
    const missed = quiz.missed.length ? ` I got these wrong: ${quiz.missed.join(' ')}` : '';
    this.history.push(
      { role: 'user', content: `(I took your quiz about this room and got ${quiz.score} of ${answered} right.${missed})` },
      { role: 'assistant', content: line },
    );
  }

  /** Ends the quiz without a word and gives the panel back to ordinary questions. */
  private closeQuiz(): void {
    if (!this.quiz) return;
    this.quiz = null;
    this.waiting = false;
    if (this.sign) this.writeSign(this.sign.text);
    setQuiz(false);
    if (!this.talking) return;
    this.showAskHeader(this.talking);
    this.showQuestions();
  }

  private async askQuestion(question: string | undefined): Promise<void> {
    const w = this.talking;
    if (!question || !w || !this.builtNode || !this.theme || this.waiting) return;
    this.waiting = true;
    const talk = this.conversation;
    this.hideFileCard();
    const nodeId = this.builtNode;
    const persona = { name: w.name, role: this.theme.role, place: this.theme.place };

    // "Show me more" means the rest of the code already held up. Asked in full,
    // the robot answers about that file, and the card carries on from its last line.
    const more = this.lastCode && ASKS_FOR_MORE.test(question) && question.length < 70 ? this.lastCode : null;
    const asked = more ? `Show me the rest of ${more.path}, after line ${more.shownTo}.` : question;

    // React straight away and look busy while the model works.
    stopSpeaking();
    const ack = this.say(w, thinkingLine(this.theme.id, asked), this.titleFor(w)).then(() => {
      if (this.waiting && this.talking === w) w.mood = 'thinking';
    });
    const reply = await ask(app.mapId, app.graph, nodeId, persona, asked, this.history);
    // Left, or started over with someone else, while waiting: that already
    // reset `waiting`, and this answer belongs to nobody now.
    if (talk !== this.conversation) return;
    // Let the "let me check" line finish, but never keep a ready answer waiting.
    await Promise.race([ack, new Promise((r) => setTimeout(r, ACK_GRACE_MS))]);
    if (talk !== this.conversation) return;
    this.waiting = false;
    guideNote('asked');

    this.history.push({ role: 'user', content: asked }, { role: 'assistant', content: reply.answer });
    const already = new Set(this.history.filter((t) => t.role === 'user').map((t) => t.content));
    const next = [...reply.followups, ...suggestedQuestions(app.graph, nodeId)].filter((q) => !already.has(q));
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
    // A suggested fix goes on the project's notes list, under this room's name.
    const note = reply.actions.find((a) => a.type === 'add_note');
    if (note?.type === 'add_note') {
      const room = app.graph.nodes.find((n) => n.id === nodeId)?.label;
      appendNote(app.mapId, app.graph, note.text, room);
      if (import.meta.env.DEV) console.log(`[notes] added from ${w.name}: ${note.text.slice(0, 80)}`);
    }
    const file = reply.actions.find((a) => a.type === 'show_file');
    const said = `${reply.answer} ${note?.type === 'add_note' ? note.text : ''}`;
    if (more) this.showFileCard(more.path, { asked, said, after: more.shownTo });
    else if (file?.type === 'show_file') this.showFileCard(file.path, { asked, said });

    const answer = reply.answer || 'Right this way.';
    const cuts = this.cutIns;
    await this.say(w, answer, this.titleFor(w, reply.offline ? ' (offline)' : ''));
    if (talk !== this.conversation) return;
    // Cut off mid-answer: the visitor has moved on, so do not act on it.
    if (this.cutIns !== cuts) return;

    // Actions that leave the room happen once the worker has finished talking.
    const leave = reply.actions.find(leavesRoom);
    if (leave) {
      w.rig.gesture('ThumbsUp');
      await new Promise((r) => setTimeout(r, 900));
      if (talk !== this.conversation) return;
    }
    if (leave?.type === 'go_to_room') {
      // Hand over out loud: name the colleague who will pick up next door.
      const colleague = this.colleagueIn(leave.roomId);
      const there = app.graph.nodes.find((n) => n.id === leave.roomId)?.label ?? 'the next room';
      w.rig.gesture('Wave');
      await this.say(w, `I'll get ${colleague} in ${there} to take it from here.`, this.titleFor(w));
      if (talk !== this.conversation) return;
      app.handoff = {
        toRoom: leave.roomId,
        fromWorker: w.name,
        fromRoom: app.graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId,
        fromRoomId: nodeId,
        question,
        answer,
      };
      this.endConversation();
      enterRoom(leave.roomId);
    } else if (leave?.type === 'play_flow') {
      this.endConversation();
      app.flowIndex = Math.max(0, app.graph.flows.findIndex((f) => f.id === leave.flowId));
      startFlow();
    } else if (leave?.type === 'back_to_city') {
      this.endConversation();
      leaveRoom();
    }
  }

  /**
   * True when what the microphone heard is mostly the worker's own line:
   * the headset speaker leaking into the mic, not the visitor.
   */
  private isEcho(heard: string): boolean {
    const said = this.lastSaid;
    if (!said || performance.now() / 1000 > said.until) return false;
    const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    const spoken = new Set(words(said.text));
    const got = words(heard).filter((x) => x.length > 2);
    if (got.length === 0) return true;
    const shared = got.filter((x) => spoken.has(x)).length;
    return shared / got.length >= 0.6;
  }

  /** Stops the worker mid-line because the visitor started talking. */
  private interrupt(w: WorkerState): void {
    this.cutIns += 1;
    w.speechToken += 1;
    stopSpeaking();
    if (w.speech) w.speech = null;
    this.lastSaid = null;
    w.mood = 'listening';
  }

  /** The worker who picks up a handoff in a room: the second one there (see build). */
  private colleagueIn(roomId: string): string {
    return NAMES[(this.hash(roomId) + 1) % NAMES.length];
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

  /**
   * Holds up one of the room's files beside the robot's speech bubble: the
   * code that was asked for, in an editor's colours (the function or class
   * named, the lines round a warning; see code-fetch.ts). When its lines
   * cannot be had, or are slow to come, a card saying what the file is for.
   */
  private showFileCard(path: string, request: CodeRequest): void {
    const file = app.graph.files.find((f) => f.p === path);
    if (!file || !this.roomGroup || !this.theme) return;
    this.hideFileCard();
    const token = this.cardToken;
    const graph = app.graph;
    const accent = this.theme.accent;
    // Asked again, left the room or changed project meanwhile: this card is no longer wanted.
    const wanted = () => token === this.cardToken && app.graph === graph && this.roomGroup !== null;
    const plain = () => {
      if (!wanted() || this.fileCard) return;
      const card = new Bubble(FILE_CARD_WIDTH, accent, 8);
      card.setText(`${file.d} (${file.loc} lines, ${file.p})`, `File: ${file.name}`);
      this.holdUp(card, card.mesh.scale.x, card.mesh.scale.y);
    };
    const patience = window.setTimeout(plain, CODE_PATIENCE_MS);
    const source = { mapId: app.mapId, local: import.meta.env.DEV && app.mapId in CUSTOM_MAPS, base: import.meta.env.BASE_URL };
    void findCode(graph, file, request, source).then((view) => {
      window.clearTimeout(patience);
      if (!wanted()) return;
      if (!view) {
        plain();
        return;
      }
      this.dropFileCard();
      const card = new CodeCard(view, accent, CODE_CHAR);
      this.holdUp(card, card.width, card.height);
      this.lastCode = { path: view.path, shownTo: view.shownTo };
      if (import.meta.env.DEV) console.log(`[code] ${view.title} | ${view.where} | ${view.rows.length} rows x ${view.cols} cols`);
    });
  }

  /** Puts a card up beside the robot's bubble, with a small sound. */
  private holdUp(card: FileCard, width: number, height: number): void {
    if (!this.roomGroup) return;
    this.placeCard(card.mesh, width);
    this.roomGroup.add(card.mesh);
    this.fileCard = card;
    // The room's info panel stands where the card goes, and can be tall: it steps aside while the card is up.
    setPanelShown(this.world, 'inspector-panel', false);
    this.inspectorAside = true;
    pop(this.worldPoint(card.mesh.position));
    if (import.meta.env.DEV) console.log(`[card] ${width.toFixed(2)} x ${height.toFixed(2)} m at ${card.mesh.position.x.toFixed(2)}, ${card.mesh.position.y.toFixed(2)}, ${card.mesh.position.z.toFixed(2)}`);
  }

  /**
   * Stands a card to the right of the speech bubble of the robot being talked
   * to, never across it: the bubble's edge, a small gap, then the card,
   * measured from where the visitor's head is now. On the right, each line of
   * code starts on the side nearest the robot. A robot standing too far
   * right for that first steps across to the left of centre.
   */
  private placeCard(card: Object3D, width: number): void {
    const group = this.roomGroup;
    if (!group) return;
    const head = group.worldToLocal(this.world.camera.getWorldPosition(this.tmp));
    let robot = 0;
    let bubble = 0;
    const w = this.talking;
    if (w) {
      // Where the robot stands to talk, or is still walking to.
      const walk = w.queue.find((t) => t.kind === 'walk');
      let at = walk?.kind === 'walk' ? walk.to : w.rig.root.position;
      // A narrow view (glasses) keeps the robot straight ahead; the card is a turn of the head away.
      if (!placement.gaze && Math.atan2(at.x, -at.z) > CARD_ROBOT + 0.03) {
        at = new Vector3(Math.sin(CARD_ROBOT) * TALK_DISTANCE, 0, -Math.cos(CARD_ROBOT) * TALK_DISTANCE);
        w.queue = w.queue.filter((t) => t.kind !== 'walk');
        w.queue.unshift({ kind: 'walk', to: at }, { kind: 'face', at: new Vector3(0, 0, 0) });
      }
      const dx = at.x - head.x;
      const dz = at.z - head.z;
      robot = Math.atan2(dx, -dz);
      bubble = Math.atan2(SPEECH_WIDTH / 2, Math.hypot(dx, dz));
    }
    const angle = robot + bubble + CARD_GAP + Math.atan2(width / 2, CARD_DISTANCE);
    card.position.set(head.x + Math.sin(angle) * CARD_DISTANCE, head.y + CARD_RISE, head.z - Math.cos(angle) * CARD_DISTANCE);
  }

  /** Takes the card down, and forgets any card still on its way. */
  private hideFileCard(): void {
    this.cardToken += 1;
    this.dropFileCard();
  }

  private dropFileCard(): void {
    if (this.inspectorAside) {
      this.inspectorAside = false;
      setPanelShown(this.world, 'inspector-panel', !app.menu);
    }
    if (!this.fileCard) return;
    this.fileCard.mesh.removeFromParent();
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
    this.notesDesk?.setMicLabel(this.micOff || !this.mic?.active ? 'Mic off' : 'Mic on');
    this.layoutAsk();
  }

  /**
   * Talking out loud, the visitor needs no list of questions in the way: it
   * folds away to a Questions button. A quiz always shows its three answers.
   */
  private layoutAsk(): void {
    const voice = !this.micOff && !!this.mic?.active;
    const folded = voice && !this.askOpen && !this.quiz;
    this.askPanel?.getElementById('ask-list')?.setProperties({ display: folded ? 'none' : 'flex' });
    this.askPanel?.getElementById('btn-expand')?.setProperties({ display: voice && !this.quiz ? 'flex' : 'none' });
    this.setAskText('expand-label', this.askOpen ? 'Hide' : 'Questions');
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

  /** Starts the quiz, or stops one that is running. */
  debugQuiz(): void {
    if (this.quiz) this.stopQuiz();
    else this.startQuiz();
  }

  /** Pinches the right answer, or a wrong one. */
  debugQuizAnswer(right: boolean): void {
    if (this.quiz) this.answerQuiz(this.quiz.order.findIndex((i) => (i === 0) === right));
  }

  /** As if the microphone had heard these words. */
  debugHear(text: string): void {
    this.heard(text);
  }

  private endConversation(): void {
    this.closeQuiz();
    stopSpeaking();
    this.hideFileCard();
    this.lastCode = null;
    this.mic?.stop();
    this.updateMicLabel();
    this.showAskPanel(false);
    this.notesDesk?.close();
    const w = this.talking;
    this.talking = null;
    this.waiting = false;
    this.nextNote = null;
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
    if (import.meta.env.DEV && step) console.log(`[step] ${app.stepIndex} in ${step.nodeId}; built ${this.builtNode}; handled ${this.handledStep}; lead talking ${this.workers[0] === this.talking}`);
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
    if (outPortal && next) {
      // The visitor carries it on: the lead holds it out, and does it
      // itself if nobody takes it (see offerPacket and updateOffer).
      tasks.push(
        { kind: 'walk', to: OFFER_SPOT },
        { kind: 'face', at: new Vector3(0, 0, 0) },
        { kind: 'call', fn: () => this.offerPacket(lead, outPortal, next) },
        { kind: 'until', test: () => this.offer === null },
      );
    } else if (outPortal) {
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

  // ------------------------------------------------------ carrying the request

  /** The lead holds the request out: pinch it, then pinch the pipe it goes down next. */
  private offerPacket(lead: WorkerState, portal: Portal, next: string): void {
    this.offer = { lead, portal, next, deadline: Infinity, carrying: false, sending: false };
    const offer = this.offer;
    if (this.catcher && !this.catcher.hasComponent(RayInteractable)) this.catcher.addComponent(RayInteractable);
    const where = app.graph.nodes.find((n) => n.id === next)?.label ?? 'next';
    const line = this.taughtCarry
      ? `Your turn. Send it on to ${where}.`
      : `Here, you take it. Pinch the request, then pinch the ${where} pipe.`;
    this.taughtCarry = true;
    lead.rig.gesture('Yes');
    const title = `${lead.name} | ${this.theme?.role ?? ''}`;
    // The wait starts once the visitor has heard what to do.
    const startClock = () => {
      if (offer.deadline === Infinity) offer.deadline = performance.now() / 1000 + OFFER_SECONDS;
    };
    if (this.talking) {
      lead.bubble.setText(line, title);
      startClock();
    } else void this.say(lead, line, title).then(startClock);
  }

  /** The visitor pinched the request: it leaves the lead's hands and floats with them. */
  private takePacket(): void {
    const offer = this.offer;
    const packet = this.packet;
    if (!offer || offer.carrying || offer.sending || !packet || !this.roomGroup) return;
    offer.carrying = true;
    offer.deadline = performance.now() / 1000 + OFFER_SECONDS * 2;
    if (this.catcher?.hasComponent(RayInteractable)) this.catcher.removeComponent(RayInteractable);
    packet.held = false;
    this.roomGroup.attach(packet.group);
    click();
    const where = app.graph.nodes.find((n) => n.id === offer.next)?.label ?? 'next';
    offer.lead.bubble.setText(`Now pinch the ${where} pipe.`, `${offer.lead.name} | ${this.theme?.role ?? ''}`);
  }

  /** The visitor pinched a pipe while carrying the request. */
  private sendPacketTo(nodeId: string): void {
    const offer = this.offer;
    if (!offer?.carrying || offer.sending) return;
    const title = `${offer.lead.name} | ${this.theme?.role ?? ''}`;
    if (nodeId !== offer.next) {
      const wrong = app.graph.nodes.find((n) => n.id === nodeId)?.label ?? 'somewhere else';
      const right = app.graph.nodes.find((n) => n.id === offer.next)?.label ?? 'the next part';
      offer.lead.rig.gesture('No');
      void this.say(offer.lead, `Not that one, that goes to ${wrong}. This needs to go to ${right}.`, title);
      return;
    }
    offer.lead.rig.gesture('ThumbsUp');
    offer.lead.bubble.setText('Nice. Off it goes.', title);
    this.launchPacket(offer);
  }

  /** Sends the request down the offer's pipe, from wherever it is now. */
  private launchPacket(offer: Offer): void {
    const packet = this.packet;
    if (!packet || !this.roomGroup) return;
    offer.sending = true;
    if (this.catcher?.hasComponent(RayInteractable)) this.catcher.removeComponent(RayInteractable);
    packet.label.setText(this.callLabel(this.builtNode, offer.next) ?? '');
    if (packet.group.parent !== this.roomGroup) this.roomGroup.attach(packet.group);
    const from = packet.group.position.clone();
    this.fly(from, offer.portal.mouth, 1.1, () => {
      packet.group.visible = false;
      if (this.offer === offer) this.offer = null;
      this.packetLeft();
    });
  }

  private endOffer(): void {
    if (this.catcher?.hasComponent(RayInteractable)) this.catcher.removeComponent(RayInteractable);
    this.offer = null;
  }

  /** Each frame: keep the catch area on the request, float a carried one before the visitor, or time out. */
  private updateOffer(): void {
    const offer = this.offer;
    const packet = this.packet;
    if (!offer || !packet || !this.roomGroup || offer.sending) return;
    if (!offer.carrying) {
      packet.group.getWorldPosition(this.tmp);
      this.roomGroup.worldToLocal(this.tmp);
      this.catcher?.object3D?.position.copy(this.tmp);
    } else {
      // In front of the visitor, a little low, as if held.
      this.tmp2.copy(this.headForward);
      this.tmp2.y = 0;
      if (this.tmp2.lengthSq() < 1e-4) this.tmp2.set(0, 0, -1);
      this.tmp2.normalize();
      this.tmp.copy(this.head).addScaledVector(this.tmp2, 0.5);
      this.tmp.y -= 0.18;
      this.roomGroup.worldToLocal(this.tmp);
      packet.group.position.lerp(this.tmp, 0.25);
    }
    if (performance.now() / 1000 > offer.deadline) {
      // Nobody took it, or it was never sent: the lead does it.
      if (!offer.carrying) offer.lead.rig.gesture('Throw');
      this.launchPacket(offer);
    }
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
    // Floating bubbles turn to face the visitor; cards hung on the wall stay flat against it.
    for (const b of this.bubbles) if (b.mesh.visible && !b.mesh.userData.onWall) b.mesh.lookAt(this.head);
    if (this.fileCard) {
      this.fileCard.mesh.lookAt(this.head);
      this.fileCard.grow?.(delta);
    }

    for (const w of this.workers) this.updateWorker(w, delta);
    this.separateWorkers();
    this.updateOffer();

    // The mic stays open while the worker talks, so the visitor can cut in
    // (see isEcho); it is only closed while the answer is being worked out.
    // In the notes room it stays open: an idea said meanwhile is kept for next (see takeNote).
    if (this.talking && this.mic) this.mic.muted = this.waiting && this.builtNode !== NOTES_ROOM;

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
    // Carrying the request, the pipe pointed at swells: that is where it will go.
    // (Not otherwise: a pipe takes a pinch only while a request is carried.)
    const carrying = this.offer?.carrying === true;
    for (const pipe of this.pipeEntities) {
      const hole = pipe.object3D;
      if (hole) hole.scale.setScalar(carrying && pipe.hasComponent(Hovered) ? 1.3 : 1);
    }

    // A flow step in another room (Follow off): keep the story moving.
    const step = currentStep();
    if (app.playing && step && step.nodeId !== this.builtNode) {
      this.offRoomClock += delta;
      if (this.offRoomClock > 3.5) {
        this.offRoomClock = 0;
        nextStep();
      }
    } else this.offRoomClock = 0;

    // A flow step in this room must never sit still (one stalled for minutes
    // in a test, cause not reproduced). A step this room missed (it arrived
    // mid-fade, say) is taken up now; one that makes no progress for
    // STEP_STALL_SECONDS moves on, as the lead would have done itself.
    if (step && step.nodeId === this.builtNode && this.fadeLevel === 0) {
      if (this.handledStep !== app.stepIndex) this.maybeHandleStep();
      const carrying = this.offer?.carrying === true || this.packet?.flying === true;
      if (app.stepIndex === this.stallStep && !carrying && !this.talking) {
        this.stallClock += delta;
        if (this.stallClock > STEP_STALL_SECONDS) {
          if (import.meta.env.DEV) console.warn(`[step] ${app.stepIndex} made no progress for ${STEP_STALL_SECONDS} s: moving on`);
          this.stallClock = 0;
          this.endOffer();
          nextStep();
        }
      } else {
        this.stallStep = app.stepIndex;
        this.stallClock = 0;
      }
    } else this.stallClock = 0;
  }

  private updateFade(delta: number): void {
    const desired = this.desiredNode();
    if (this.fadeTarget === 1 && this.fadeLevel >= 1 && !this.preparing) {
      // Fully dark: swap rooms, then fade back in. The new room's props load
      // while the view is dark, so nothing pops in.
      if (this.builtNode) this.teardown();
      if (desired) {
        this.preparing = true;
        // Whatever goes wrong, the view fades back in: a room that fails to
        // build sends the visitor back to the city rather than leaving them in the dark.
        void loadProps(propsForTheme(pickTheme(app.graph, desired)))
          .then(() => {
            const now = this.desiredNode();
            if (now) this.build(now);
          })
          .catch((error: unknown) => {
            console.error('[room] could not build the room, back to the city:', error);
            try {
              this.teardown();
            } catch {
              // half built: nothing more to undo
            }
            leaveRoom();
          })
          .finally(() => {
            this.preparing = false;
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
    // Pointed at (or just now), and not busy with a flow step: stop and look at the visitor.
    const held = w.hovered || performance.now() / 1000 - w.hoverLeft < HOVER_LINGER;
    if (held && !w.scripted) {
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
          // too close, walk around the centre on a ring instead. The spot
          // where a robot stands to talk is closer than that, so it is
          // walked to directly once nothing nearer lies on the way.
          const keep = Math.min(SAFE_RADIUS, Math.hypot(task.to.x, task.to.z) - 0.05);
          if (this.passesNearViewer(pos, task.to, keep)) {
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
      let cut = Math.floor((performance.now() / 1000 - w.speech.start) * w.speech.rate);
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
        const ra = Math.hypot(pa.x, pa.z);
        const rb = Math.hypot(pb.x, pb.z);
        pa.x -= (dx / d) * push * share;
        pa.z -= (dz / d) * push * share;
        pb.x += (dx / d) * push * (1 - share);
        pb.z += (dz / d) * push * (1 - share);
        this.holdBack(pa, ra);
        this.holdBack(pb, rb);
      }
    }
  }

  /** A push from another worker never moves one nearer the seated viewer than the safe distance. */
  private holdBack(p: Vector3, before: number): void {
    const r = Math.hypot(p.x, p.z);
    const least = Math.min(before, SAFE_RADIUS);
    if (r >= least || r < 1e-4) return;
    p.x *= least / r;
    p.z *= least / r;
  }

  /** True when the straight walk from `a` to `b` comes within `radius` of the viewer. */
  private passesNearViewer(a: Vector3, b: Vector3, radius: number): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / len2)) : 0;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    return cx * cx + cz * cz < radius * radius;
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
