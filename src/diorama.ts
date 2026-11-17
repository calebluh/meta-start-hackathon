import {
  AssetManager,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  CircleGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Euler,
  type Entity,
  InputComponent,
  Group,
  Hovered,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Pressed,
  Ray,
  Quaternion,
  QuadraticBezierCurve3,
  PokeInteractable,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
} from '@iwsdk/core';
import { click, pop } from './audio/sound.js';
import {
  BeamBatch,
  blockShell,
  buildPools,
  circuitTexture,
  facadeTextures,
  keepWholeForRays,
  type Pool,
  setRoofOpen,
  shadowTexture,
  type Shell,
  tint,
  towerShell,
} from './city-style.js';
import { KIND_COLORS } from './colors.js';
import { HACKATHON } from './edition.js';
import { inPassthrough } from './passthrough.js';
import { placement } from './placement.js';
import { setPanelShown } from './panels.js';
import { ignoreRays } from './rays.js';
import { buildRooftops } from './rooftops.js';
import { classifyHop, HOP_COLORS, HOP_TAGS, type HopKind } from './network.js';
import { mergeGeometries, mergeStatic } from './rooms/merge.js';
import { BoardPeg, District } from './diorama-components.js';
import { guideNote } from './guide.js';
import { Peek } from './peek.js';
import { isPaused, onPause } from './pause.js';
import { dive, DIVE_SECONDS } from './transition.js';
import { buildLayout, resolveRef, type DioramaLayout, type District as Lot, type Rect } from './layout.js';
import type { GraphData, HealthIssue, NodeKind } from './maps/types.js';
import { hashString, pickTheme } from './rooms/themes.js';
import { NOTES_NODE, NOTES_ROOM } from './notes/scribe.js';
import { setInspectorShift } from './reach.js';
import { loadNotes } from './notes/store.js';
import {
  app,
  currentFlow,
  currentStep,
  cycleFlow,
  enterRoom,
  freshParts,
  leaveRoom,
  nextStep,
  cycleMap,
  onChange,
  openMenu,
  select,
  setStreet,
  startFlow,
  stopFlow,
} from './state.js';



/** A building's footprint grows to about this many metres as you dive in. */
const DIVE_SPAN = 9;
/** Street view: how many times life size is the desk model, and how long the change takes. */
const STREET_SCALE = 150;
const STREET_SECONDS = 1.8;
const STREET_LABEL_SCALE = 0.3;
/** Ignore pinches this soon after a move: one pinch often registers twice. */
const STREET_QUIET_MS = 700;
/** How far outside a building's front wall the visitor stands, in board units (the middle of the alley). */
const DOOR_STANDOFF = 0.012;
const STREET_WALK_SPEED = 2.5;
/** Each turn in street view (a Turn button, or the right stick flicked aside), in radians. */
const STREET_TURN = Math.PI / 6;
/** Street view waypoints: discs on the ground at each door, this radius on the board (about 0.4 m at life size). */
const WAYPOINT_RADIUS = 0.0027;
const WAYPOINT_COLOR = '#7ee0ff';
/** The Turn buttons float this far out to either side, low, and this far below the eyes (metres). */
const TURN_BUTTON_OUT = 0.55;
const TURN_BUTTON_DROP = 0.18;
const TURN_BUTTON_ANGLE = 0.95;
/** The Turn buttons come round again only when the head turns this far (radians) from where they were placed. */
const TURN_BUTTON_FOLLOW = 1.6;
const UP = new Vector3(0, 1, 0);
/**
 * The city is turned and resized with four pegs at its corners, never by
 * taking hold of the board itself: a pinch on or near a building only ever
 * picks that building. (The whole desk moves with the grey bar.)
 */
const PEG_TURN_SPEED = 0.5; // radians a second while a peg is held: about a turn in 12 seconds
const PEG_RADIUS = 0.013;
const PEG_HEIGHT = 0.05;
/** How far outside the board's corners the pegs stand. */
const PEG_OUTSET = 0.014;
/** A pinch begun this soon (ms) after a peg was pointed at takes it, though the closing fingers swung the ray off. */
const PEG_HOVER_GRACE_MS = 300;
/** Fingers closed within this distance (metres) of a peg take it, with no pointing. */
const NEAR_TAKE_REACH = 0.06;
/** How close a hand's own ray must pass to count as aimed at a peg, a Turn button or a disc (metres; a disc is life size). */
const AIM_PEG = 0.04;
const AIM_TURN = 0.07;
const AIM_DISC = 0.6;
/**
 * A hand pinch made at the buttons or panels is meant for them: with the
 * fingertip within this margin of a panel (metres), or the hand's ray
 * passing through a panel padded by UI_PAD, it never picks a building or
 * walks the street, even when the press itself just misses a button.
 */
const UI_MARGIN = 0.1;
const UI_PAD = 0.03;
const UI_REACH = 0.35;
/** Panels a stray pinch must not pass through to the city. */
const UI_PANELS = ['controls-panel', 'inspector-panel', 'ask-panel', 'notes-panel', 'menu-panel'];
/** After changing between map, street and room, presses on the city wait this long (ms): a double pinch must not walk you into a wall. */
const MODE_QUIET_MS = 1200;
const HANDS = ['left', 'right'] as const;
/** In the notes room the info panel moves this far right (metres, desk space), clear of the note taker's bubble. */
const NOTES_INSPECTOR_SHIFT = 0.1;
type Peg = { entity: Entity; mesh: Mesh; material: MeshStandardMaterial };
const PEG_COLOR = '#7ee0ff';
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
/**
 * Extra room around each building for a pointing ray to hit, so a hand ray
 * that shakes a little still lands on it: about half the alley either side,
 * and a little above the roof.
 */
const HIT_PAD_SIDE = 0.002;
const HIT_PAD_TOP = 0.008;
/**
 * A pinch made with the fingertip right at a building picks it, though no
 * ray was aimed: within this distance (metres) of its walls or roof.
 */
const NEAR_PICK_REACH = 0.04;
/** A ray pick this soon after a near pick is the same pinch, seen twice. */
const NEAR_PICK_QUIET_MS = 400;
/** Invisible, but hit by rays (rays ignore material visibility; only the object's own visibility counts). */
const HIT_MATERIAL = new MeshBasicMaterial({ visible: false });
/** A unit cube standing on its base: buildings are this, scaled to size. */
const UNIT_BOX = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
/** Where the building's base ends up: the floor under a seated viewer. */
const DIVE_FLOOR_BELOW_HEAD = 1.15;

/** At most this many data packets travel one conduit at a time. */
const DOTS_PER_CONDUIT = 3;

const KIND_NAMES: Record<NodeKind, string> = {
  ui: 'APP',
  service: 'SERVER',
  worker: 'BACKGROUND JOB',
  library: 'SHARED LOGIC',
  feature: 'FEATURE',
  data: 'DATA',
  config: 'SETTINGS',
  test: 'TESTS',
  script: 'SCRIPT',
  infra: 'INFRASTRUCTURE',
  external: 'OUTSIDE SERVICE',
  misc: 'OTHER',
};

/** A second pinch on the selected building within this time is the same pinch. */
const RESELECT_QUIET_MS = 1200;
/**
 * How strongly a part glows at rest, pointed at, picked, and as the current
 * step of a flow. Buildings glow through their windows, so they glow harder
 * than the flat plinths and outside towers.
 */
type Glow = readonly [number, number, number, number];
const BUILDING_GLOW: Glow = [1.05, 1.9, 2.6, 3.4];
const PLINTH_GLOW: Glow = [0.03, 0.16, 0.3, 0.5];
const TOWER_GLOW: Glow = [0.35, 0.8, 1.1, 1.6];
/** The walls brighten a little along with the windows. */
const TINT_LIFT: Glow = [1, 1.5, 1.9, 2.2];
/** How long a part the coding agent just changed keeps throbbing. */
const FRESH_SECONDS = 10;
/** Thickness of the neon edges on buildings and on plinths. */
const EDGE = 0.0012;
const PLINTH_EDGE = 0.0008;
/** Ignore a pinch on the Step inside chip this soon after the building was picked. */
const CHIP_QUIET_MS = 500;
/** The Step inside chip's height, and the invisible catcher's around it, in metres (at the city's own size). */
const CHIP_HEIGHT = 0.04;
const CHIP_CATCH = 0.06;
/** A fingertip this close to the chip, when pinching, presses it. */
const CHIP_PINCH_REACH = 0.03;
const HOP_SECONDS = 1.3;
const DWELL_SECONDS = 2.8;

/** One placed part of the app: its building, label and connections. */
interface Site {
  id: string;
  mesh: Mesh;
  material: MeshStandardMaterial;
  /** Centre of the roof, in board coordinates. */
  roof: Vector3;
  conduits: Conduit[];
  issues: HealthIssue[];
  recentNotes: string[];
  hovered: boolean;
  glow: Glow;
  /** The wall colour at rest. */
  tint: Color;
  label: Mesh;
  labelY: number;
  /** Its name shows all the time; other names show when pointed at or connected to the picked part. */
  always: boolean;
  /** A building whose roof can lift (leaf parts only). */
  shell: Shell | null;
  lot: Lot | null;
}

interface Conduit {
  a: string;
  b: string;
  weight: number;
  /** Its tube, kept un-rendered; conduits draw as two merged meshes. */
  tube: Mesh;
  curve?: QuadraticBezierCurve3;
}

interface Beacon {
  mesh: Mesh;
  baseY: number;
  phase: number;
  siteId: string;
}

/** Draws a text label on a canvas and returns a plane `height` meters tall. */
export function makeLabel(text: string, height: number, accent: string): Mesh {
  const fontPx = 56;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  const font = `600 ${fontPx}px Inter, "Segoe UI", system-ui, sans-serif`;
  measure.font = font;
  const padX = 26;
  const w = Math.ceil(measure.measureText(text).width + padX * 2);
  const h = 88;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 20);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(14, h / 2 - 16, 6, 32);
  ctx.font = font;
  ctx.fillStyle = '#f0f3f6';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX + 6, h / 2 + 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new Mesh(
    new PlaneGeometry((height * w) / h, height),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 10;
  return mesh;
}

/** The "Step inside" button that floats over a picked building: a bright pill, `height` meters tall. */
/** A round button with a curved arrow, for turning left (-1) or right (1) in street view. */
function makeTurnButton(dir: -1 | 1): Mesh {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7ee0ff';
  ctx.lineWidth = 6;
  ctx.stroke();
  // A curved arrow round the middle, pointing the way it turns.
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const r = size * 0.27;
  const start = dir > 0 ? Math.PI * 1.15 : Math.PI * 1.85;
  const end = dir > 0 ? Math.PI * 1.85 : Math.PI * 1.15;
  ctx.arc(size / 2, size / 2 + 10, r, start, end, dir < 0);
  ctx.stroke();
  const tipX = size / 2 + Math.cos(end) * r;
  const tipY = size / 2 + 10 + Math.sin(end) * r;
  ctx.fillStyle = '#7ee0ff';
  ctx.beginPath();
  ctx.moveTo(tipX + dir * 22, tipY + 4);
  ctx.lineTo(tipX - dir * 8, tipY - 20);
  ctx.lineTo(tipX - dir * 8, tipY + 22);
  ctx.closePath();
  ctx.fill();
  ctx.font = '700 26px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Turn', size / 2, size * 0.8);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return new Mesh(new PlaneGeometry(0.11, 0.11), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}

function makeChip(text: string, height: number): Mesh {
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  const font = '700 54px Inter, "Segoe UI", system-ui, sans-serif';
  measure.font = font;
  const textW = Math.ceil(measure.measureText(text).width);
  const h = 104;
  const w = textW + 150;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7ee0ff';
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, (h - 6) / 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = '#06222c';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 44, h / 2 + 3);
  // An arrow pointing down into the building.
  const ax = w - 62;
  ctx.strokeStyle = '#06222c';
  ctx.lineWidth = 9;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, h / 2 - 20);
  ctx.lineTo(ax, h / 2 + 18);
  ctx.moveTo(ax - 17, h / 2 + 2);
  ctx.lineTo(ax, h / 2 + 19);
  ctx.lineTo(ax + 17, h / 2 + 2);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new Mesh(
    new PlaneGeometry((height * w) / h, height),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.name = 'step-inside-chip';
  mesh.renderOrder = 11;
  return mesh;
}

/**
 * Builds the codebase diorama from a Floorplan graph and runs the tabletop:
 * hover glow, pinch-to-inspect, the inspector and control panels, and flow
 * playback on the board.
 *
 * Interaction with bare hands:
 * - point at a building and pinch to select it (ray select): its roof lifts
 *   to show the robots inside, and a Step inside button appears over it;
 * - pinch near the board to pick the whole diorama up; use both hands to turn
 *   and resize it;
 * - with a part selected, Step inside to sit in its room (RoomSystem).
 */
export class DioramaSystem extends createSystem({
  sites: { required: [District] },
  hovered: { required: [District, Hovered] },
  pressed: { required: [District, Pressed] },
  heldPegs: { required: [BoardPeg, Pressed] },
}) {
  private layout!: DioramaLayout;
  private root!: Entity;
  private sitesById = new Map<string, Site>();
  /** Every entity the diorama created, so a map switch can remove them. */
  private entities: Entity[] = [];
  private builtGraph: GraphData | null = null;
  private conduits: Conduit[] = [];
  private conduitMeshes: Mesh[] = [];
  private conduitFocus: string | null | undefined = undefined;
  /** Data packets travelling along the conduits, all in one instanced mesh. */
  private flowDots: InstancedMesh | null = null;
  private dotMatrix = new Matrix4();
  private dotScale = new Vector3();
  private labels: Mesh[] = [];
  private gateLabel: Mesh | null = null;
  private beacons: Beacon[] = [];
  /** Rooftop features for the whole city, rebuilt without one building while its roof is lifted. */
  private rooftops: Group | null = null;
  /** The lifted roof and the room under it (see peek.ts), and whose it is. */
  private peek = new Peek();
  private peekId: string | null = null;
  /** The Step inside button over the open building. */
  private chip: Entity | null = null;
  private chipHit = false;
  /** Each fingertip's last depth in front of the chip (Infinity: not over it), to see it pushed through. */
  private chipTipZ = { left: Infinity, right: Infinity };
  private chipLocal = new Vector3();
  /** Mixed reality: the tray's shadow on the real table. */
  private shadow: Mesh | null = null;

  private shownStep = -1;
  private stepClock = 0;
  private hopCurve = new QuadraticBezierCurve3();
  /** Where requests from the internet come in: the top of the gateway, in board space. */
  private gatePoint = new Vector3();
  /** The current flow step's hop: across the network, into stored data, or inside the code. */
  private hop: { kind: HopKind; detail: string } | null = null;
  private pulse!: Mesh;

  private inspector: UIKitMLAsset | undefined;
  private controls: UIKitMLAsset | undefined;

  private headWorld = new Vector3();
  private scratch = new Vector3();
  /** The diorama's size, the same on every axis. */
  private uniformScale = 1;
  /** The corner pegs, and whether they are out (only at the desk, at rest). */
  private pegs: { entity: Entity; mesh: Mesh; material: MeshStandardMaterial }[] = [];
  private pegsShown = true;
  /** Half the board's diagonal at 1x, and the city size the pegs were last placed for. */
  private pegReach = 0;
  private pegScale = -1;

  /**
   * Stands the pegs on the board's diagonals, just beyond its corners at the
   * city's current size. On the diagonal they stay outside the city however
   * it is turned; moved out with its size, a grown city never covers them.
   */
  private placePegs(): void {
    this.pegScale = this.uniformScale;
    const centre = this.root.object3D!.position;
    const reach = this.pegReach * this.uniformScale + PEG_OUTSET;
    for (const peg of this.pegs) {
      const corner = peg.mesh.userData.corner as Vector3;
      peg.mesh.position.set(centre.x + corner.x * reach, centre.y, centre.z + corner.z * reach);
    }
  }
  /** Two pegs held: the distance between the hands, and the city's size, when the second was taken. */
  private resize: { distance: number; scale: number } | null = null;
  private handLeft = new Vector3();
  private handRight = new Vector3();
  private wasTurning = false;
  /** A bare-hand pinch began this frame (which hand), to try as a near pick. */
  private nearPinch: 'left' | 'right' | null = null;
  /** The hand whose pinch or trigger went down last, and the peg each hand is holding (in VR). */
  private lastSelectHand: 'left' | 'right' | null = null;
  private pegHolds = new Map<'left' | 'right', { entity: Entity; mesh: Mesh; material: MeshStandardMaterial }>();
  private nearPickAt = 0;
  private nearTip = new Vector3();
  private nearBox = new Box3();
  /** When the current building was picked, to tell a second pinch from a shaky first one. */
  private selectedAt = 0;
  /** Street view: whether the city is life size now, and the move between the two. */
  private streetShown = false;
  private streetMoving = false;
  private streetMove = { t: 0, toStreet: false, focus: new Vector3(), from: new Vector3(), to: new Vector3(), fromScale: 1, toScale: 1, fromYaw: 0, toYaw: 0 };
  private mapPose = { position: new Vector3(), yaw: 0, scale: 1 };
  private streetAt = new Vector3();
  private streetSpot = new Vector3();
  private streetTmp = new Vector3();
  private streetInverse = new Matrix4();
  private streetMovedAt = 0;
  /** Where the last pinch landed on the city (world space), and when. */
  private hitPoint = new Vector3();
  private hitAt = 0;
  private streetPressed: string | null = null;
  /**
   * Street view from a chair: discs on the ground at every door (one
   * instanced mesh), and where each stands on the board; two Turn buttons
   * low to either side; and the right stick's last state, for snap turns.
   */
  private waypoints: InstancedMesh | null = null;
  private waypointSpots: Vector3[] = [];
  private waypointHit: Vector3 | null = null;
  private turnButtons: { entity: Entity; mesh: Mesh; dir: 1 | -1 }[] = [];
  private turnHit: 1 | -1 | 0 = 0;
  /** Where the Turn buttons were last placed: the head's turn then, and the street move they belong to. */
  private turnAnchorYaw = 0;
  private turnAnchorAt = -1;
  /**
   * What each hand's own ray is on (a peg, a Turn button or a disc), and
   * when it last was: a hand pinch takes what that hand was aiming at a
   * moment ago, since closing the fingers swings the ray off a small target.
   * Per hand, so an idle hand's ray never decides the other hand's pinch.
   */
  private handAim: Record<'left' | 'right', { kind: 'peg' | 'turn' | 'disc' | 'building' | null; peg: Peg | null; dir: 1 | -1; point: Vector3; building: string | null; at: number }> = {
    left: { kind: null, peg: null, dir: 1, point: new Vector3(), building: null, at: -Infinity },
    right: { kind: null, peg: null, dir: 1, point: new Vector3(), building: null, at: -Infinity },
  };
  /** When a pinch was last taken by a peg, button or disc, or made at the panels: the city ignores that same pinch. */
  private pinchTakenAt = -Infinity;
  /** When the city last changed between map, street and room. */
  private modeChangedAt = -Infinity;
  private aimOrigin = new Vector3();
  private aimDir = new Vector3();
  private aimPoint = new Vector3();
  private aimQuat = new Quaternion();
  private uiBox = new Box3();
  private uiBoxPart = new Box3();
  private uiRay = new Ray();
  private inspectorShifted = false;
  private stickTurned = false;
  private streetExtrasShown = false;
  private headQuat = new Quaternion();
  private headEuler = new Euler();

  // The dive into a building (see transition.ts). The board scales up about
  // the building's base while that base slides under the viewer.
  /** 1 diving in, -1 surfacing back to the desk, 0 at rest. */
  private diveDir: 0 | 1 | -1 = 0;
  private diveFrom = new Vector3();
  private diveFromScale = 1;
  private divePivot = new Vector3();
  private diveTo = new Vector3();
  private diveGrowth = 1;
  private diveBox = new Box3();
  private diveCentre = new Vector3();
  /** Room to surface from, once RoomSystem has taken its room down. */
  private surfaceFrom: string | null = null;
  private lastMode: 'table' | 'room' = 'table';
  /** Whether the real room was showing (mixed reality) when visibility was last worked out. */
  private passthroughShown = false;
  private menuShown: boolean | null = null;
  private lastRoom: string | null = null;

  init(): void {
    this.inspector = this.world.getSceneObject<UIKitMLAsset>('inspector-panel');
    this.controls = this.world.getSceneObject<UIKitMLAsset>('controls-panel');
    this.buildDiorama();
    this.wireControls();
    this.buildTurnButtons();

    // Pinches and triggers, by hand: a bare-hand pinch may pick the building
    // the fingertip is at (see nearPick), and a peg stays held until the
    // pinch or trigger that took it lets go (see pegHolds).
    const xr = this.world.renderer.xr;
    const handOf = (event: Event): 'left' | 'right' | null => {
      const side = (event as Event & { inputSource?: XRInputSource }).inputSource?.handedness;
      return side === 'left' || side === 'right' ? side : null;
    };
    const onSelectStart = (event: Event) => {
      const hand = handOf(event);
      if (!hand) return;
      this.lastSelectHand = hand;
      if (!(event as Event & { inputSource?: XRInputSource }).inputSource?.hand) return;
      this.handPinch(hand);
    };
    const onSelectEnd = (event: Event) => {
      const hand = handOf(event);
      if (hand) this.pegHolds.delete(hand);
    };
    // A hand that stops being tracked mid-pinch never sends selectend: let go of its peg.
    const onSourcesChange = (event: Event) => {
      for (const source of (event as Event & { removed?: readonly XRInputSource[] }).removed ?? []) {
        if (source.handedness === 'left' || source.handedness === 'right') this.pegHolds.delete(source.handedness);
      }
    };
    const onSessionStart = () => {
      xr.getSession()?.addEventListener('selectstart', onSelectStart);
      xr.getSession()?.addEventListener('selectend', onSelectEnd);
      xr.getSession()?.addEventListener('inputsourceschange', onSourcesChange);
    };
    // Headset off or the system menu up: nothing stays held.
    this.cleanupFuncs.push(onPause(() => this.pegHolds.clear()));
    const onSessionEnd = () => this.pegHolds.clear();
    xr.addEventListener('sessionstart', onSessionStart);
    xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(() => {
      xr.removeEventListener('sessionstart', onSessionStart);
      xr.removeEventListener('sessionend', onSessionEnd);
      xr.getSession()?.removeEventListener('selectstart', onSelectStart);
      xr.getSession()?.removeEventListener('selectend', onSelectEnd);
      xr.getSession()?.removeEventListener('inputsourceschange', onSourcesChange);
    });
    // A peg taken in VR belongs to the hand whose pinch just began. (Outside
    // VR, with the mouse, the Pressed query alone says what is held.)
    this.cleanupFuncs.push(
      this.queries.heldPegs.subscribe('qualify', (entity) => {
        if (!this.world.renderer.xr.isPresenting) return;
        const peg = this.pegs.find((p) => p.entity === entity);
        if (peg) this.pegHolds.set(this.lastSelectHand ?? 'right', peg);
      }),
    );

    this.cleanupFuncs.push(
      onChange(() => this.render()),
      this.queries.hovered.subscribe('qualify', (e) => this.setHovered(e, true)),
      this.queries.hovered.subscribe('disqualify', (e) => this.setHovered(e, false)),
      this.queries.pressed.subscribe('qualify', (e) => {
        if (app.mode !== 'table') return;
        const id = e.getValue(District, 'nodeId') as string;
        // The same pinch already picked a building by touch (see nearPick), or
        // was taken by a peg, a button or a disc, or was made at the panels.
        const now = performance.now();
        if (now - this.nearPickAt < NEAR_PICK_QUIET_MS || now - this.pinchTakenAt < NEAR_PICK_QUIET_MS) return;
        // Just after changing between map, street and room, the city waits.
        if (now - this.modeChangedAt < MODE_QUIET_MS) return;
        if (app.street) {
          // Decided next frame, once the pinch's landing point is known.
          this.streetPressed = id;
          return;
        }
        this.pick(id);
      }),
    );
    this.render();
  }

  /** A pinch on a part: picks it, or puts it back if it was already picked. */
  private pick(id: string): void {
    const now = performance.now();
    if (app.selected === id) {
      // A hand pinch often registers twice. Pinching the same building
      // again only clears it once the first pinch is clearly over.
      if (now - this.selectedAt < RESELECT_QUIET_MS) return;
      select(null);
    } else {
      this.selectedAt = now;
      select(id);
    }
  }

  /**
   * Four pegs just outside the board's corners. Right-hand pegs turn the city
   * clockwise, left-hand ones the other way. They stand on the desk, not on
   * the board: the city turns between them, so a held peg stays under the
   * pointer (a peg turning with the city would slide out from under it).
   */
  private buildPegs(): void {
    const desk = this.world.getSceneEntity('workspace');
    const geometry = new CylinderGeometry(PEG_RADIUS, PEG_RADIUS, PEG_HEIGHT, 16).translate(0, PEG_HEIGHT / 2, 0);
    const hitGeometry = new CylinderGeometry(PEG_RADIUS * 3.5, PEG_RADIUS * 3.5, PEG_HEIGHT * 1.8, 8).translate(0, PEG_HEIGHT * 0.75, 0);
    const halfW = this.layout.width / 2;
    const halfD = this.layout.depth / 2;
    // On the board's diagonals, just beyond its corners at any turn (see placePegs).
    this.pegReach = Math.hypot(halfW, halfD);
    this.pegScale = -1;
    for (const [x, z] of [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]]) {
      const material = new MeshStandardMaterial({ color: PEG_COLOR, emissive: new Color(PEG_COLOR), emissiveIntensity: 1, roughness: 0.4 });
      const mesh = new Mesh(geometry, material);
      mesh.name = `peg-${z < 0 ? 'back' : 'front'}-${x < 0 ? 'left' : 'right'}`;
      mesh.userData.corner = new Vector3(x, 0, z).normalize();
      // A wider invisible column around the peg, easy to point at.
      mesh.add(new Mesh(hitGeometry, HIT_MATERIAL));
      const entity = this.world.createTransformEntity(mesh, { parent: desk ?? this.root });
      entity.addComponent(BoardPeg, { turn: x > 0 ? -1 : 1 });
      entity.addComponent(RayInteractable);
      this.entities.push(entity);
      this.pegs.push({ entity, mesh, material });
    }
    this.pegsShown = true;
  }

  /**
   * A bare-hand pinch, in order: fingers closed on a peg take it; then
   * whatever this hand's own ray was on a moment ago (a peg, a Turn button,
   * a disc); a pinch made at the buttons or panels goes no further; and only
   * then may it pick the building the fingertip is at (nearPick, next frame).
   */
  private handPinch(hand: 'left' | 'right'): void {
    const now = performance.now();
    if (import.meta.env.DEV) console.log(`[pinch] ${hand} begins (aim ${this.handAim[hand].kind} ${Math.round(now - this.handAim[hand].at)} ms ago)`);
    // Fingers closed right at the Step inside button: that button.
    const chip = this.chip?.object3D;
    if (chip?.visible && this.tipOverChip(chip, hand, CHIP_PINCH_REACH) && Math.abs(this.chipLocal.z) < CHIP_PINCH_REACH) {
      this.chipHit = true;
      if (import.meta.env.DEV) console.log(`[chip] ${hand} pinch at Step inside (${this.chipLocal.x.toFixed(3)}, ${this.chipLocal.y.toFixed(3)}, ${this.chipLocal.z.toFixed(3)})`);
      this.pinchTakenAt = now;
      return;
    }
    if (this.pegsShown) {
      this.player.indexTipSpaces[hand].getWorldPosition(this.nearTip);
      let best: Peg | null = null;
      let bestDistance = NEAR_TAKE_REACH;
      for (const peg of this.pegs) {
        peg.mesh.getWorldPosition(this.aimPoint);
        this.aimPoint.y += PEG_HEIGHT / 2;
        const distance = this.aimPoint.distanceTo(this.nearTip);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = peg;
        }
      }
      if (best) {
        this.pegHolds.set(hand, best);
        this.pinchTakenAt = now;
        return;
      }
    }
    const aim = this.handAim[hand];
    if (now - aim.at < PEG_HOVER_GRACE_MS) {
      if (aim.kind === 'peg' && aim.peg && this.pegsShown) {
        this.pegHolds.set(hand, aim.peg);
        this.pinchTakenAt = now;
        return;
      }
      if (aim.kind === 'turn' && this.streetExtrasShown) {
        this.turnHit = aim.dir;
        this.pinchTakenAt = now;
        return;
      }
    }
    if (this.nearUi(hand)) {
      this.pinchTakenAt = now;
      if (import.meta.env.DEV) console.log(`[pinch] ${hand} hand at the panels: not for the city`);
      return;
    }
    // Fingers at a building: that building (picked next frame, see nearPick), whatever the ray was on.
    if (!app.street && !this.streetShown && !app.menu && this.buildingAtFingertip(hand)) {
      this.nearPinch = hand;
      return;
    }
    // The building this hand's own ray was on: the closing fingers often
    // swing the ray off a small building into the alley. Never the one
    // already picked: its Step inside button floats right over it, and a
    // pinch on the button must not close the building first (the ordinary
    // press still puts a picked building back).
    if (aim.kind === 'building' && aim.building && aim.building !== app.selected && now - aim.at < PEG_HOVER_GRACE_MS && !app.street && !this.streetShown && !app.menu) {
      this.nearPickAt = now;
      this.pick(aim.building);
      if (import.meta.env.DEV) console.log(`[pinch] ${hand} hand picked ${aim.building} (aimed)`);
      return;
    }
    if (aim.kind === 'disc' && now - aim.at < PEG_HOVER_GRACE_MS && this.streetExtrasShown) {
      this.waypointHit = aim.point.clone();
      this.pinchTakenAt = now;
      return;
    }
    this.nearPinch = hand;
  }

  /** The fingertip is at a visible panel, or the hand's ray passes through one (a press that just missed a button). */
  private nearUi(hand: 'left' | 'right'): boolean {
    this.player.indexTipSpaces[hand].getWorldPosition(this.nearTip);
    this.handRay(hand);
    this.uiRay.set(this.aimOrigin, this.aimDir);
    for (const id of UI_PANELS) {
      const panel = this.world.getSceneObject(id);
      if (!panel?.visible) continue;
      this.panelBox(panel);
      if (this.uiBox.isEmpty()) continue;
      this.uiBox.expandByScalar(UI_PAD);
      // Through a panel the hand is reaching towards: a press that just missed a
      // button. (Aiming past a panel from further back, at the street, is not.)
      if (this.uiRay.intersectsBox(this.uiBox) && this.uiBox.distanceToPoint(this.nearTip) < UI_REACH) return true;
      this.uiBox.expandByScalar(UI_MARGIN - UI_PAD);
      if (this.uiBox.containsPoint(this.nearTip)) return true;
    }
    return false;
  }

  /**
   * A panel's bounds, into uiBox, from its ordinary meshes. Box3.setFromObject
   * throws on the UI library's text meshes (they have no bounding box it can
   * read), so those are skipped: the panel's background covers its area.
   */
  private panelBox(panel: Object3D): void {
    this.uiBox.makeEmpty();
    panel.updateWorldMatrix(true, true);
    panel.traverseVisible((o) => {
      const mesh = o as Mesh & { isMesh?: boolean; isInstancedMesh?: boolean };
      if (!mesh.isMesh || mesh.isInstancedMesh) return;
      const geometry = mesh.geometry;
      if (!geometry?.attributes?.position) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) return;
      this.uiBoxPart.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      this.uiBox.union(this.uiBoxPart);
    });
  }

  /** A hand's pointing ray in world space, into aimOrigin and aimDir. */
  private handRay(hand: 'left' | 'right'): void {
    const space = this.player.raySpaces[hand];
    space.getWorldPosition(this.aimOrigin);
    space.getWorldQuaternion(this.aimQuat);
    this.aimDir.set(0, 0, -1).applyQuaternion(this.aimQuat);
  }

  /** The nearest building or outside tower on the ray (aimOrigin, aimDir), with its hit margin, or null. */
  private buildingOnRay(): string | null {
    this.uiRay.set(this.aimOrigin, this.aimDir);
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const site of this.sitesById.values()) {
      if (this.layout.districts.has(site.id) && !site.lot) continue; // a plinth, not a building
      const geometry = site.mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      this.uiBoxPart.copy(geometry.boundingBox!).applyMatrix4(site.mesh.matrixWorld).expandByScalar(HIT_PAD_SIDE);
      if (!this.uiRay.intersectBox(this.uiBoxPart, this.aimPoint)) continue;
      const distance = this.aimPoint.distanceToSquared(this.aimOrigin);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site.id;
      }
    }
    return best;
  }

  /** How far `point` lies from a ray (aimOrigin, aimDir), or Infinity when it is behind. */
  private rayDistance(point: Vector3): number {
    this.scratch.copy(point).sub(this.aimOrigin);
    const along = this.scratch.dot(this.aimDir);
    if (along < 0) return Infinity;
    return Math.sqrt(Math.max(0, this.scratch.lengthSq() - along * along));
  }

  /** Records, for each hand, the peg, Turn button or disc its own ray is on now. */
  private updateHandAims(): void {
    if (!this.pegsShown && !this.streetExtrasShown) return;
    const now = performance.now();
    for (const hand of HANDS) {
      const aim = this.handAim[hand];
      this.handRay(hand);
      if (this.pegsShown) {
        let onPeg = false;
        for (const peg of this.pegs) {
          peg.mesh.getWorldPosition(this.aimPoint);
          this.aimPoint.y += PEG_HEIGHT / 2;
          if (this.rayDistance(this.aimPoint) < AIM_PEG) {
            aim.kind = 'peg';
            aim.peg = peg;
            aim.at = now;
            onPeg = true;
          }
        }
        // Otherwise the nearest building this hand's ray passes through.
        if (!onPeg) {
          const building = this.buildingOnRay();
          if (building) {
            aim.kind = 'building';
            aim.building = building;
            aim.at = now;
          }
        }
        continue;
      }
      for (const b of this.turnButtons) {
        if (this.rayDistance(b.mesh.position) < AIM_TURN) {
          aim.kind = 'turn';
          aim.dir = b.dir;
          aim.at = now;
        }
      }
      // Discs: where the ray meets the ground they lie on, and the nearest disc to that point.
      const first = this.waypointSpots[0];
      if (!first || aim.at === now || this.aimDir.y > -1e-3) continue;
      const obj = this.root.object3D!;
      this.aimPoint.copy(first);
      obj.localToWorld(this.aimPoint);
      const t = (this.aimPoint.y - this.aimOrigin.y) / this.aimDir.y;
      if (t <= 0) continue;
      this.scratch.copy(this.aimDir).multiplyScalar(t).add(this.aimOrigin);
      for (const spot of this.waypointSpots) {
        this.aimPoint.copy(spot);
        obj.localToWorld(this.aimPoint);
        if (this.aimPoint.distanceTo(this.scratch) < AIM_DISC) {
          aim.kind = 'disc';
          aim.point.copy(this.aimPoint);
          aim.at = now;
          break;
        }
      }
    }
  }

  /** In the notes room the info panel steps a little further right, clear of the note taker's speech bubble. */
  private shiftInspectorForNotes(): void {
    const want = app.mode === 'room' && app.roomNode === NOTES_ROOM;
    if (want === this.inspectorShifted) return;
    this.inspectorShifted = want;
    setInspectorShift(this.world, want ? NOTES_INSPECTOR_SHIFT : 0);
  }

  /**
   * A pinch with the fingertip at a building picks it. The city takes no
   * near grab (it is turned with its pegs), so without this a pinch made
   * right on a building would do nothing: the pointing ray starts at the
   * hand and is not aimed at what the fingers are touching.
   */
  private nearPick(hand: 'left' | 'right'): void {
    const best = this.buildingAtFingertip(hand);
    if (import.meta.env.DEV) console.log(`[near] ${best ?? 'nothing in reach'}`);
    if (!best) return;
    this.nearPickAt = performance.now();
    // Never puts back the building already picked: a pinch on its Step inside
    // button, which floats right over it, must not close it first.
    if (best !== app.selected) this.pick(best);
  }

  /** The building or outside tower within reach of this hand's fingertip, nearest first. */
  private buildingAtFingertip(hand: 'left' | 'right'): string | null {
    this.player.indexTipSpaces[hand].getWorldPosition(this.nearTip);
    let best: string | null = null;
    let bestDistance = NEAR_PICK_REACH;
    for (const site of this.sitesById.values()) {
      // Buildings and outside towers, not the plinths under them.
      if (this.layout.districts.has(site.id) && !site.lot) continue;
      const geometry = site.mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const distance = this.nearBox.copy(geometry.boundingBox!).applyMatrix4(site.mesh.matrixWorld).distanceToPoint(this.nearTip);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site.id;
      }
    }
    return best;
  }

  /** Pegs show only with the city at rest on the desk: not in the menu, a room, a dive or street view. */
  private showPegs(shown: boolean): void {
    if (shown === this.pegsShown) return;
    this.pegsShown = shown;
    for (const peg of this.pegs) {
      peg.mesh.visible = shown;
      if (shown && !peg.entity.hasComponent(RayInteractable)) peg.entity.addComponent(RayInteractable);
      else if (!shown && peg.entity.hasComponent(RayInteractable)) peg.entity.removeComponent(RayInteractable);
    }
    if (!shown) {
      this.resize = null;
      this.pegHolds.clear();
    }
  }

  /**
   * One peg held: the city turns slowly until it is let go. Two held: pull
   * the hands apart or together to resize it. Returns true while a peg is held.
   */
  private updatePegs(delta: number): boolean {
    let held = 0;
    let turn = 0;
    if (this.world.renderer.xr.isPresenting) {
      // Held until that hand lets go, even once its ray has slid off the peg
      // (hands drift as they pull apart, and a held peg must not drop).
      for (const peg of this.pegHolds.values()) {
        held += 1;
        turn = peg.entity.getValue(BoardPeg, 'turn') as number;
      }
    } else {
      for (const entity of this.queries.heldPegs.entities) {
        held += 1;
        turn = entity.getValue(BoardPeg, 'turn') as number;
      }
    }
    if (this.uniformScale !== this.pegScale) this.placePegs();
    for (const peg of this.pegs) {
      // Brighter when pointed at, brightest while held.
      let holding = peg.entity.hasComponent(Pressed);
      for (const held of this.pegHolds.values()) if (held === peg) holding = true;
      peg.material.emissiveIntensity = holding ? 2.4 : peg.entity.hasComponent(Hovered) ? 1.8 : 1;
    }
    const obj = this.root.object3D!;
    if (held >= 2) {
      this.player.gripSpaces.left.getWorldPosition(this.handLeft);
      this.player.gripSpaces.right.getWorldPosition(this.handRight);
      const distance = Math.max(this.handLeft.distanceTo(this.handRight), 0.02);
      if (!this.resize) this.resize = { distance, scale: this.uniformScale };
      this.uniformScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (this.resize.scale * distance) / this.resize.distance));
      obj.scale.setScalar(this.uniformScale);
    } else {
      this.resize = null;
      if (held === 1) obj.rotation.y += turn * PEG_TURN_SPEED * delta;
    }
    const turning = held > 0;
    if (turning && !this.wasTurning) guideNote('turned');
    this.wasTurning = turning;
    return turning;
  }


  // ---------------------------------------------------------------- build

  private buildDiorama(): void {
    const graph = app.graph;
    this.builtGraph = graph;
    const workspace = this.world.getSceneEntity('workspace');
    this.layout = buildLayout(graph);
    const group = new Group();
    group.name = 'diorama';
    group.position.set(0, 0.002, -0.04);

    // The board the districts stand on. It must exist before the grab
    // component is added, since grabbing needs a mesh to hit.
    const boardW = this.layout.width + 0.02;
    const boardD = this.layout.depth + 0.16;
    const boardZ = -0.04;
    const boardRect: Rect = { x: -boardW / 2, z: boardZ - boardD / 2, w: boardW, d: boardD };
    // A circuit board for a floor: its traces carry a little light.
    const circuit = circuitTexture();
    circuit.repeat.set(boardW / 0.2, boardD / 0.2);
    const board = new Mesh(
      new BoxGeometry(boardW, 0.008, boardD),
      new MeshStandardMaterial({
        map: circuit,
        emissiveMap: circuit,
        emissive: new Color('#ffffff'),
        emissiveIntensity: 0.7,
        roughness: 0.4,
        metalness: 0.5,
      }),
    );
    board.position.set(0, -0.004, boardZ);
    board.name = 'board';
    group.add(board);
    group.add(this.buildTray(boardW, boardD, boardZ));
    // In mixed reality the tray casts a soft shadow, so it sits on the real
    // table instead of floating over it.
    this.shadow = ignoreRays(
      new Mesh(
        new PlaneGeometry(boardW + 0.14, boardD + 0.14),
        new MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, opacity: 0.6, depthWrite: false }),
      ),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, -0.0015, boardZ);
    this.shadow.renderOrder = -1;
    this.shadow.visible = false;
    group.add(this.shadow);

    // Neon edges and pools of light for the whole city, each merged into one mesh below.
    const beams = new BeamBatch();
    const pools: Pool[] = [];
    const white = new Color('#ffffff');
    beams.outline(
      { x: boardRect.x + 0.003, z: boardRect.z + 0.003, w: boardW - 0.006, d: boardD - 0.006 },
      0,
      0.0007,
      0.0014,
      new Color('#3fd0ff').multiplyScalar(0.7),
      false,
    );

    this.root = this.world.createTransformEntity(group, workspace ? { parent: workspace } : undefined);
    this.uniformScale = 1;
    this.pegs = [];
    this.buildPegs();
    this.streetShown = false;
    this.streetMoving = false;
    this.streetPressed = null;

    const unitBox = UNIT_BOX;
    const unitEdges = new EdgesGeometry(unitBox);
    const unitTower = new CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0);
    const recentLine = new LineBasicMaterial({ color: '#3fb950' });
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

    const addSite = (
      id: string,
      mesh: Mesh,
      material: MeshStandardMaterial,
      roof: Vector3,
      labelHeight: number,
      glow: Glow,
      always: boolean,
      shell: Shell | null = null,
      lot: Lot | null = null,
    ) => {
      const node = nodesById.get(id)!;
      const entity = this.world.createTransformEntity(mesh, { parent: this.root });
      this.entities.push(entity);
      entity.addComponent(District, { nodeId: id });
      entity.addComponent(RayInteractable);
      // A slightly larger invisible box around buildings and towers (not the
      // plinths under them), so a ray that wavers still lands. The mesh is a
      // unit shape scaled to size, so the padding is divided by that size.
      if (!(this.layout.districts.has(id) && !lot)) {
        const pad = new Mesh(UNIT_BOX, HIT_MATERIAL);
        pad.scale.set(1 + (2 * HIT_PAD_SIDE) / Math.max(mesh.scale.x, 1e-3), 1 + HIT_PAD_TOP / Math.max(mesh.scale.y, 1e-3), 1 + (2 * HIT_PAD_SIDE) / Math.max(mesh.scale.z, 1e-3));
        mesh.add(pad);
      }
      // Remember where a pinch lands, for walking to that spot in street view.
      (mesh as unknown as { addEventListener(type: string, fn: (e: { point?: Vector3 }) => void): void }).addEventListener(
        'pointerdown',
        (e) => {
          if (!e.point) return;
          this.hitPoint.copy(e.point);
          this.hitAt = performance.now();
        },
      );
      const label = makeLabel(node.label, labelHeight, KIND_COLORS[node.kind]);
      const labelY = roof.y + labelHeight * 0.9;
      label.position.set(roof.x, labelY, roof.z);
      group.add(ignoreRays(label));
      this.labels.push(label);
      this.sitesById.set(id, {
        id,
        mesh,
        material,
        roof,
        conduits: [],
        issues: [],
        recentNotes: [],
        hovered: false,
        glow,
        tint: material.color.clone(),
        label,
        labelY,
        always,
        shell,
        lot,
      });
    };

    for (const d of this.layout.districts.values()) {
      const accent = KIND_COLORS[d.kind];
      const color = new Color(accent);
      // Data stores are round silos; everything else is a block.
      const round = d.isLeaf && d.kind === 'data';
      let shell: Shell | null = null;
      let material: MeshStandardMaterial;
      if (d.isLeaf) {
        // A building: dark glass, with rows of lit windows sized to it.
        const cells = (meters: number) => Math.max(1, Math.round(meters / 0.012));
        const cellsY = Math.max(1, Math.round(d.height / 0.013));
        shell = round
          ? towerShell(cells((Math.PI * (d.rect.w + d.rect.d)) / 2), cellsY)
          : blockShell(cells(d.rect.w), cells(d.rect.d), cellsY);
        material = new MeshStandardMaterial({
          color: color.clone().multiplyScalar(0.13),
          emissive: new Color('#ffffff'),
          emissiveIntensity: BUILDING_GLOW[0],
          roughness: 0.25,
          metalness: 0.7,
          ...facadeTextures(accent, hashString(d.id)),
        });
      } else {
        // A plinth: the ground a group of parts stands on.
        material = new MeshStandardMaterial({
          color: color.clone().multiplyScalar(0.07),
          emissive: color,
          emissiveIntensity: PLINTH_GLOW[0],
          roughness: 0.5,
          metalness: 0.3,
        });
      }
      const mesh = new Mesh(shell ? shell.geometry : unitBox, material);
      if (shell) keepWholeForRays(mesh);
      mesh.name = `district:${d.id}`;
      mesh.position.set(d.rect.x + d.rect.w / 2, d.base, d.rect.z + d.rect.d / 2);
      mesh.scale.set(d.rect.w, d.height, d.rect.d);
      const top = d.base + d.height;
      if (d.isLeaf) {
        const edge = color.clone().lerp(white, 0.2);
        if (round) beams.ring(mesh.position.x, top, mesh.position.z, d.rect.w, d.rect.d, EDGE, edge);
        else beams.outline(d.rect, d.base, top, EDGE, edge, true);
        const under = d.parent ? this.layout.districts.get(d.parent)?.rect : undefined;
        pools.push({ rect: d.rect, y: d.base + 0.0004, clip: under ?? boardRect, color: color.clone().multiplyScalar(0.32) });
      } else {
        beams.outline(d.rect, d.base, top, PLINTH_EDGE, color.clone().multiplyScalar(0.6), false);
      }
      // Parents label their front edge; buildings label their roof.
      const roof = d.isLeaf
        ? new Vector3(mesh.position.x, top, mesh.position.z)
        : new Vector3(mesh.position.x, top + 0.004, d.rect.z + d.rect.d - 0.008);
      addSite(
        d.id,
        mesh,
        material,
        roof,
        d.depth === 0 ? 0.02 : 0.016,
        d.isLeaf ? BUILDING_GLOW : PLINTH_GLOW,
        !d.isLeaf || d.depth === 0,
        shell,
        d.isLeaf ? d : null,
      );
    }

    this.setRooftops(null);

    for (const s of this.layout.externals.values()) {
      const material = new MeshStandardMaterial({
        color: new Color(KIND_COLORS.external).multiplyScalar(0.4),
        emissive: new Color(KIND_COLORS.external),
        emissiveIntensity: TOWER_GLOW[0],
        roughness: 0.3,
        metalness: 0.5,
      });
      const mesh = new Mesh(unitTower, material);
      mesh.name = `external:${s.id}`;
      mesh.position.set(s.x, 0, s.z);
      mesh.scale.set(s.radius * 2, s.height, s.radius * 2);
      beams.ring(s.x, s.height, s.z, s.radius * 2, s.radius * 2, EDGE, new Color(KIND_COLORS.external).lerp(white, 0.3));
      addSite(s.id, mesh, material, new Vector3(s.x, s.height, s.z), 0.016, TOWER_GLOW, true);
    }

    // Connections, folded up to one conduit per pair of parts.
    const pairs = new Map<string, Conduit>();
    for (const l of graph.links) {
      const a = resolveRef(graph, l.a);
      const b = resolveRef(graph, l.b);
      if (!a || !b || a === b || !this.sitesById.has(a) || !this.sitesById.has(b)) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const existing = pairs.get(key);
      if (existing) {
        existing.weight += l.w;
        continue;
      }
      pairs.set(key, {
        a,
        b,
        weight: l.w,
        tube: new Mesh(),
      });
    }
    for (const c of pairs.values()) {
      const from = this.sitesById.get(c.a)!.roof;
      const to = this.sitesById.get(c.b)!.roof;
      const mid = from.clone().lerp(to, 0.5);
      mid.y = Math.max(from.y, to.y) + 0.03 + from.distanceTo(to) * 0.35;
      const curve = new QuadraticBezierCurve3(from.clone(), mid, to.clone());
      const radius = 0.0007 + 0.0004 * Math.log2(1 + c.weight);
      // Each conduit takes the colour of the part it starts from.
      const tone = new Color(KIND_COLORS[nodesById.get(c.a)!.kind]).lerp(white, 0.3);
      c.tube = new Mesh(tint(new TubeGeometry(curve, 28, radius, 5, false), tone));
      c.curve = curve;
      this.conduits.push(c);
      this.sitesById.get(c.a)!.conduits.push(c);
      this.sitesById.get(c.b)!.conduits.push(c);
    }

    // Health warnings: a beacon spinning over each affected part.
    const beaconGeometry = new OctahedronGeometry(0.006);
    for (const issue of graph.health?.issues ?? []) {
      for (const loc of issue.locations ?? []) {
        const id = resolveRef(graph, loc.file);
        const site = id ? this.sitesById.get(id) : undefined;
        if (!site || site.issues.includes(issue)) continue;
        site.issues.push(issue);
        const color = issue.severity === 'high' ? '#ff4d4f' : '#f0b429';
        const beacon = new Mesh(beaconGeometry, new MeshBasicMaterial({ color }));
        const baseY = site.roof.y + 0.032;
        beacon.position.set(site.roof.x + 0.012, baseY, site.roof.z);
        group.add(beacon);
        this.beacons.push({ mesh: beacon, baseY, phase: this.beacons.length * 1.7, siteId: site.id });
      }
    }

    // Recent work: a green outline around each part that just changed.
    for (const task of graph.recent?.tasks ?? []) {
      for (const item of task.items) {
        const id = resolveRef(graph, item.ref);
        const site = id ? this.sitesById.get(id) : undefined;
        if (!site) continue;
        site.recentNotes.push(item.note);
        const boxy = this.layout.districts.has(site.id) && site.lot?.kind !== 'data';
        if (site.recentNotes.length === 1 && boxy) {
          const outline = ignoreRays(new LineSegments(unitEdges, recentLine));
          outline.scale.setScalar(1.02);
          outline.position.y = -0.01;
          site.mesh.add(outline);
        }
      }
    }

    if (graph.project.logo) this.addLogoPlaque(group, graph.project.logo);

    this.addGateway(group);

    const neon = beams.build();
    if (neon) group.add(neon);
    const light = buildPools(pools);
    if (light) group.add(light);

    // The lifted roof of the picked building, and the Step inside button over it.
    group.add(this.peek.group);
    const chip = makeChip('Step inside', CHIP_HEIGHT);
    chip.name = 'step-inside';
    chip.visible = false;
    // A wider invisible card behind the button (60 mm tall), so a wavering ray still lands on it.
    const chipPad = new Mesh(chip.geometry, HIT_MATERIAL);
    chipPad.scale.set(1.25, CHIP_CATCH / CHIP_HEIGHT, 1);
    // For pointing only: to a fingertip it would make the button far bigger than it looks, and a hand
    // reaching for the building next door would brush it and walk in.
    (chipPad as Mesh & { pointerEventsType?: unknown }).pointerEventsType = { deny: 'touch' };
    chip.add(chipPad);
    this.chip = this.world.createTransformEntity(chip, { parent: this.root });
    this.entities.push(this.chip);
    // Acted on next frame: walking in takes the button's ray target away,
    // which must not happen while the pointer event is still being delivered.
    (chip as unknown as { addEventListener(type: string, fn: () => void): void }).addEventListener('pointerdown', () => {
      this.chipHit = true;
    });

    this.buildWaypoints(group);

    // The pulse that travels along a flow.
    this.pulse = new Mesh(new SphereGeometry(0.0055, 16, 12), new MeshBasicMaterial({ color: '#ffffff' }));
    this.pulse.visible = false;
    this.pulse.renderOrder = 12;
    group.add(this.pulse);

    // Packets of data travel each conduit, more on the busier ones.
    if (this.conduits.length) {
      this.flowDots = ignoreRays(
        new InstancedMesh(
          new SphereGeometry(0.0022, 8, 6),
          new MeshBasicMaterial({ color: '#c8f4ff', transparent: true, opacity: 0.9, depthWrite: false }),
          this.conduits.length * DOTS_PER_CONDUIT,
        ),
      );
      this.flowDots.frustumCulled = false;
      this.flowDots.renderOrder = 6;
      group.add(this.flowDots);
    }
  }

  /** Removes the current diorama (on switching codebase). */
  private disposeDiorama(): void {
    this.flowDots?.geometry.dispose();
    this.flowDots = null;
    if (this.diveDir !== 0) this.endDive();
    this.surfaceFrom = null;
    this.peek.clear();
    this.peek.group.removeFromParent();
    this.peekId = null;
    this.rooftops = null;
    this.chip = null;
    this.gateLabel = null;
    this.shadow = null;
    for (const e of this.entities) e.dispose();
    this.entities = [];
    this.root?.dispose();
    this.sitesById.clear();
    this.conduits = [];
    for (const m of this.conduitMeshes) m.geometry.dispose();
    this.conduitMeshes = [];
    this.conduitFocus = undefined;
    this.labels = [];
    this.beacons = [];
    this.shownStep = -1;
  }

  /** The tray the city stands in: a low metal rim around the board. */
  private buildTray(w: number, d: number, z: number): Group {
    const rim = new Group();
    rim.name = 'tray';
    const metal = new MeshStandardMaterial({ color: '#3a414e', roughness: 0.3, metalness: 0.85 });
    const t = 0.008;
    const h = 0.016;
    const y = -0.008 + h / 2;
    for (const side of [-1, 1]) {
      const long = new Mesh(new BoxGeometry(w + 2 * t, h, t), metal);
      long.position.set(0, y, z + side * (d / 2 + t / 2));
      const short = new Mesh(new BoxGeometry(t, h, d), metal);
      short.position.set(side * (w / 2 + t / 2), y, z);
      rim.add(long, short);
    }
    mergeStatic(rim);
    return ignoreRays(rim);
  }

  /** (Re)builds the rooftop features, leaving one roof bare while it is lifted. */
  private setRooftops(skip: string | null): void {
    if (this.rooftops) {
      this.rooftops.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      });
      this.rooftops.removeFromParent();
    }
    this.rooftops = buildRooftops(this.layout.districts.values(), { skip });
    this.root.object3D!.add(this.rooftops);
  }

  // ---------------------------------------------------------- lifted roof

  /** Lifts the roof of the picked building, and lowers any other. */
  private syncPeek(): void {
    if (app.mode !== 'table') return; // through a dive the roof stays as it was
    const lot = app.selected ? this.sitesById.get(app.selected)?.lot : null;
    const want =
      lot && !app.street && !this.streetShown && !this.streetMoving && app.stepIndex < 0 && !app.menu ? lot.id : null;
    if (want === this.peekId) {
      if (want) this.peek.reopen();
      return;
    }
    if (!want) {
      this.peek.close(); // update() puts the roof back once it is down
      return;
    }
    if (this.peekId) this.shutPeek();
    this.openPeek(want);
  }

  private openPeek(id: string): void {
    const site = this.sitesById.get(id);
    const lot = site?.lot;
    if (!site || !lot || !site.shell) return;
    this.peekId = id;
    pop();
    setRoofOpen(site.shell, true);
    this.setRooftops(id);
    this.peek.open(
      {
        x: lot.rect.x + lot.rect.w / 2,
        z: lot.rect.z + lot.rect.d / 2,
        w: lot.rect.w,
        d: lot.rect.d,
        base: lot.base,
        height: lot.height,
        round: lot.kind === 'data',
        accent: KIND_COLORS[lot.kind],
      },
      buildRooftops([lot], { doors: false }),
    );
    // The name and the button move up, clear of the lid.
    site.label.position.y = site.roof.y + this.peek.clearance + 0.012;
    this.chip?.object3D?.position.set(site.roof.x, site.roof.y + this.peek.clearance + 0.052, site.roof.z);
  }

  /** Puts the roof back at once and clears the room under it. */
  private shutPeek(): void {
    const site = this.peekId ? this.sitesById.get(this.peekId) : undefined;
    if (site?.shell) setRoofOpen(site.shell, false);
    if (site) site.label.position.y = site.labelY;
    this.peek.clear();
    if (this.peekId) this.setRooftops(null);
    this.peekId = null;
    this.showChip();
  }

  /** The Step inside button shows over an open building, and only then can it be pinched. */
  private showChip(): void {
    const chip = this.chip;
    const object = chip?.object3D;
    if (!chip || !object) return;
    const shown =
      this.peekId !== null && app.selected === this.peekId && app.mode === 'table' && this.diveDir === 0 && !this.surfaceFrom;
    object.visible = shown;
    if (shown && !chip.hasComponent(RayInteractable)) chip.addComponent(RayInteractable);
    else if (!shown && chip.hasComponent(RayInteractable)) chip.removeComponent(RayInteractable);
    if (shown && !chip.hasComponent(PokeInteractable)) chip.addComponent(PokeInteractable);
    else if (!shown && chip.hasComponent(PokeInteractable)) chip.removeComponent(PokeInteractable);
  }

  /**
   * Where a fingertip is in the chip's own space (its front faces the viewer, +z),
   * into chipLocal, and whether it is over the button or its catcher.
   */
  private tipOverChip(chip: Object3D, hand: 'left' | 'right', margin: number): boolean {
    this.player.indexTipSpaces[hand].getWorldPosition(this.chipLocal);
    chip.worldToLocal(this.chipLocal);
    const geometry = (chip as Mesh).geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return (
      Math.abs(this.chipLocal.x) < box.max.x + margin &&
      Math.abs(this.chipLocal.y) < Math.max(box.max.y, CHIP_CATCH / 2) + margin
    );
  }

  /** A fingertip pushed through the front of the chip presses it, as on the desk buttons. */
  private chipPoke(chip: Object3D): void {
    if (!this.world.renderer.xr.isPresenting) return;
    for (const hand of HANDS) {
      const over = this.tipOverChip(chip, hand, 0.005);
      const z = this.chipLocal.z;
      const before = this.chipTipZ[hand];
      this.chipTipZ[hand] = over ? z : Infinity;
      if (over && before > 0 && before < 0.05 && z <= 0.004 && z > -0.04) {
        if (import.meta.env.DEV) console.log(`[chip] ${hand} fingertip tapped Step inside`);
        this.chipHit = true;
      }
    }
  }

  private chipPressed(): void {
    const id = this.peekId;
    // A pinch often registers twice: the one that picked the building must not also walk in.
    if (!id || app.mode !== 'table' || performance.now() - this.selectedAt < CHIP_QUIET_MS) return;
    click();
    enterRoom(id);
  }

  /** The project's logo on a small plaque at the front-left of the board. */
  private addLogoPlaque(group: Group, url: string): void {
    const plaque = new Mesh(new PlaneGeometry(0.06, 0.06), new MeshBasicMaterial({ transparent: true }));
    plaque.rotation.x = -Math.PI / 2 + 0.5;
    plaque.position.set(-this.layout.width / 2 + 0.04, 0.012, this.layout.depth / 2 + 0.025);
    group.add(plaque);
    void AssetManager.loadTexture(`${import.meta.env.BASE_URL}${url}`, `logo:${url}`).then((texture) => {
      texture.colorSpace = SRGBColorSpace;
      (plaque.material as MeshBasicMaterial).map = texture;
      (plaque.material as MeshBasicMaterial).needsUpdate = true;
    });
  }

  // ------------------------------------------------------------ controls

  private wireControls(): void {
    const panel = this.controls;
    if (!panel) return;
    // `quiet`: a hand pinch or a fingertip poke can land twice in a moment.
    // A repeat inside this time is ignored, so Play does not start and stop
    // at once, and Step inside does not step straight back out.
    const on = (id: string, handler: () => void, quiet = 350) => {
      const el = panel.getElementById(id);
      if (!el) return;
      let last = -Infinity;
      const withSound = () => {
        const now = performance.now();
        if (now - last < quiet) return;
        last = now;
        click();
        handler();
      };
      el.addEventListener('click', withSound);
      this.cleanupFuncs.push(() => el.removeEventListener('click', withSound));
    };
    on('btn-play', () => (app.stepIndex >= 0 ? stopFlow() : startFlow()), 800);
    on('btn-next', () => nextStep());
    on('btn-flow', () => cycleFlow());
    // Hackathon: back to the demo menu. Personal: on to the next of your maps.
    on('btn-map', () => (HACKATHON ? openMenu() : cycleMap()));
    on('btn-inside', () => {
      if (app.mode === 'room') leaveRoom();
      else {
        const target = currentStep()?.nodeId ?? app.selected;
        if (target) enterRoom(target);
      }
    }, 800);
    // Recenter also puts the city back to its starting place and size (the
    // desk itself is moved by WorkspaceSystem).
    on('btn-recenter', () => this.resetBoard());
    on('btn-street', () => setStreet(!app.street), 1200);
    // The notes room belongs to the whole project, so it is on the desk, not in a building.
    on('btn-notes', () => {
      if (app.mode === 'room' && app.roomNode === NOTES_ROOM) leaveRoom();
      else {
        if (app.stepIndex >= 0) stopFlow(false);
        enterRoom(NOTES_ROOM);
      }
    }, 800);
  }

  private resetBoard(): void {
    if (app.mode !== 'table' || this.diveDir !== 0 || this.surfaceFrom || app.street || this.streetMoving) return;
    const board = this.root.object3D!;
    board.position.set(0, 0.002, -0.04);
    board.quaternion.identity();
    board.scale.setScalar(1);
    this.uniformScale = 1;
  }

  private setText(panel: UIKitMLAsset | undefined, id: string, text: string): void {
    // The panel font lacks a few typographic characters; swap in plain ones.
    const plain = text
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/·/g, '|')
      .replace(/—|–/g, '-')
      .replace(/…/g, '...');
    panel?.getElementById<UIKit.Text>(id)?.setProperties({ text: plain });
  }

  private setShown(id: string, shown: boolean): void {
    this.inspector?.getElementById(id)?.setProperties({ display: shown ? 'flex' : 'none' });
  }

  // -------------------------------------------------------------- render

  /** Board and desk show at the table, and through a dive either way. */
  private applyVisibility(): void {
    const onTable = (app.mode === 'table' && !this.surfaceFrom) || this.diveDir !== 0;
    this.root.object3D!.visible = onTable && !app.menu;
    // So do the street's discs and Turn buttons (in the air, not on the board), when a dive starts.
    this.showStreetExtras(app.mode === 'table' && this.diveDir === 0 && this.streetShown && !this.streetMoving && !app.menu);
    // The pegs stand on the desk, so they must be put away with the city.
    this.showPegs(onTable && this.diveDir === 0 && !app.menu && !app.street && !this.streetShown && !this.streetMoving && !this.surfaceFrom);
    // Under the start menu only the desk shows.
    if (app.menu !== this.menuShown) {
      this.menuShown = app.menu;
      setPanelShown(this.world, 'inspector-panel', !app.menu);
      setPanelShown(this.world, 'controls-panel', !app.menu);
    }
    // Inside a room the desk would hide the floor; the panels stay.
    const desk = this.world.getSceneObject('desk');
    // The desk drops away as a dive starts, so the city rises around the viewer.
    // In mixed reality the visitor's own desk takes its place.
    if (desk) desk.visible = onTable && this.diveDir === 0 && !inPassthrough(this.world) && !app.street && !this.streetShown && !this.streetMoving;
    this.refreshLabels();
    this.showChip();
    this.showShadow();
  }

  private showShadow(): void {
    if (!this.shadow) return;
    this.shadow.visible =
      inPassthrough(this.world) && this.diveDir === 0 && !app.street && !this.streetShown && !this.streetMoving;
  }

  /**
   * Which names show. Groups, standalone parts and outside services are
   * always named; a building inside a group is named when it is pointed at,
   * picked, the current step of a flow, or connected to the part in focus.
   * That keeps the city readable, and shows at a glance what a part talks to.
   * In street view every building keeps its sign.
   */
  private refreshLabels(): void {
    const shown = this.diveDir === 0;
    const all = app.street || this.streetShown;
    const focus = currentStep()?.nodeId ?? app.selected;
    for (const site of this.sitesById.values()) {
      const linked = !!focus && (site.id === focus || site.conduits.some((c) => c.a === focus || c.b === focus));
      site.label.visible = shown && (all || site.always || site.hovered || linked);
    }
    if (this.gateLabel) this.gateLabel.visible = shown;
  }

  /**
   * Prepares a dive into one building: scale the board up about the centre of
   * the building's base until its footprint spans about a room, while that
   * point slides to the floor under the viewer's head.
   */
  private beginDive(id: string): boolean {
    const site = this.sitesById.get(id);
    const obj = this.root.object3D!;
    const parent = obj.parent;
    if (!site || !parent || !obj.visible) return false;
    this.diveFrom.copy(obj.position);
    this.diveFromScale = obj.scale.x;
    obj.updateWorldMatrix(true, true);
    // From the shape itself: its invisible hit padding must not change the dive.
    site.mesh.geometry.computeBoundingBox();
    this.diveBox.copy(site.mesh.geometry.boundingBox!).applyMatrix4(site.mesh.matrixWorld);
    this.diveBox.getCenter(this.divePivot);
    this.divePivot.y = this.diveBox.min.y;
    this.diveBox.getSize(this.diveCentre);
    this.diveGrowth = DIVE_SPAN / Math.max(this.diveCentre.x, this.diveCentre.z, 1e-3);
    // From the street the building is already bigger than a room: just walk in.
    if (this.streetShown) this.diveGrowth = Math.max(1, this.diveGrowth);
    this.world.camera.getWorldPosition(this.diveTo);
    this.diveTo.y -= DIVE_FLOOR_BELOW_HEAD;
    // Work in the workspace's space, where the board's position lives.
    parent.worldToLocal(this.divePivot);
    parent.worldToLocal(this.diveTo);
    return true;
  }

  /** Poses the board `t` of the way into the dive (0 desk, 1 inside). */
  private poseDive(t: number): void {
    const u = t * t * (3 - 2 * t);
    // Growth is exponential so the zoom feels steady rather than lurching.
    const s = Math.exp(Math.log(this.diveGrowth) * t * t);
    const obj = this.root.object3D!;
    this.diveCentre.lerpVectors(this.divePivot, this.diveTo, u);
    obj.position.copy(this.diveFrom).sub(this.divePivot).multiplyScalar(s).add(this.diveCentre);
    obj.scale.setScalar(this.diveFromScale * s);
  }

  /** Puts the board back on the desk at its size from before the dive. */
  private endDive(): void {
    const obj = this.root.object3D!;
    obj.position.copy(this.diveFrom);
    obj.scale.setScalar(this.diveFromScale);
    this.diveDir = 0;
    dive.active = false;
    dive.t = 0;
    this.applyVisibility();
  }

  private updateDive(delta: number): void {
    if (this.surfaceFrom && !dive.roomShown) {
      // The room is gone behind the dark: start huge and shrink to the desk.
      // The desk goes back where the visitor had it (their real table, or
      // where they dragged it), or comes round if they turned away, unseen.
      placement.returnToTable();
      this.modeChangedAt = performance.now();
      const from = this.surfaceFrom;
      this.surfaceFrom = null;
      this.root.object3D!.visible = true;
      // Back out on the street, at the door of the building just left.
      if (this.streetShown) {
        this.root.object3D!.parent?.updateWorldMatrix(true, false);
        this.standAtDoor(from);
      }
      if (this.beginDive(from)) {
        this.diveDir = -1;
        dive.t = 1;
        this.poseDive(1);
      }
      this.applyVisibility();
      return;
    }
    if (this.diveDir === 0) return;
    dive.t = Math.min(1, Math.max(0, dive.t + (this.diveDir * delta) / DIVE_SECONDS));
    if (dive.holdAt !== null) dive.t = this.diveDir === 1 ? Math.min(dive.t, dive.holdAt) : Math.max(dive.t, dive.holdAt);
    this.poseDive(dive.t);
    if ((this.diveDir === 1 && dive.t >= 1) || (this.diveDir === -1 && dive.t <= 0)) this.endDive();
  }

  /** Brings the board, panels and pulse in line with the shared state. */
  private render(): void {
    if (this.builtGraph !== app.graph) {
      this.disposeDiorama();
      this.buildDiorama();
    }
    this.setText(this.controls, 'map-label', HACKATHON ? 'Demos' : 'Next map');
    const flow = currentFlow();
    const step = currentStep();
    this.setText(this.controls, 'flow-label', flow ? flow.title : 'No flows');
    this.setText(this.controls, 'play-label', app.stepIndex >= 0 ? 'Stop' : 'Play flow');
    this.setText(this.controls, 'street-label', app.street ? 'Map view' : 'Street view');
    this.setText(this.controls, 'notes-label', app.mode === 'room' && app.roomNode === NOTES_ROOM ? 'Close notes' : 'Notes');
    this.setText(
      this.controls,
      'inside-label',
      app.mode === 'room' ? 'Back to table' : step || app.selected ? 'Step inside' : 'Pick a part',
    );

    if (app.mode !== this.lastMode) {
      if (app.mode === 'room' && app.roomNode && this.beginDive(app.roomNode)) {
        this.diveDir = 1;
        dive.active = true;
        dive.t = 0;
      } else if (app.mode === 'table') {
        if (this.diveDir === 1) this.endDive();
        // Surface from the room just left, once its room is gone.
        if (this.lastRoom && this.sitesById.has(this.lastRoom)) this.surfaceFrom = this.lastRoom;
      }
      this.lastMode = app.mode;
    }
    if (app.mode === 'room') this.lastRoom = app.roomNode;
    this.syncPeek();
    this.applyVisibility();

    if (app.stepIndex !== this.shownStep) {
      this.shownStep = app.stepIndex;
      if (step) this.startHop();
      else this.pulse.visible = false;
    }

    if (app.quiz && app.mode === 'room' && app.roomNode) this.showQuizCard(app.roomNode);
    else if (step) this.showStep();
    else if (app.mode === 'room' && app.roomNode === NOTES_ROOM) this.showNotesRoom();
    else if (app.mode === 'room' && app.roomNode) this.showNode(app.roomNode);
    else if (app.selected) this.showNode(app.selected);
    else this.showOverview();
    this.refreshGlow();
  }

  private showOverview(): void {
    const graph = app.graph;
    const files = graph.files.length;
    const loc = graph.files.reduce((sum, f) => sum + f.loc, 0);
    this.setText(this.inspector, 'insp-kind', 'CODEBASE');
    this.setText(this.inspector, 'insp-title', graph.project.name);
    this.setText(this.inspector, 'insp-summary', graph.project.summary);
    this.setText(
      this.inspector,
      'insp-stats',
      `${files} files · ${loc.toLocaleString('en-US')} lines · point at a building and pinch to inspect it`,
    );
    if (graph.source) {
      const repo = graph.source.repo.replace(/^https?:\/\/github\.com\//, '');
      this.setText(this.inspector, 'insp-stats', `${repo} @ ${graph.source.commit.slice(0, 7)}${graph.source.license ? ` (${graph.source.license})` : ''} · ${files} files · ${loc.toLocaleString('en-US')} lines · pinch a building to inspect it`);
    }
    const issues = graph.health?.issues ?? [];
    this.setShown('insp-alert-box', issues.length > 0);
    this.setText(
      this.inspector,
      'insp-alert',
      issues.length === 1 ? `1 health warning: ${issues[0].title}` : `${issues.length} health warnings are flashing on the map`,
    );
    const task = graph.recent?.tasks[0];
    this.setShown('insp-recent-box', !!task);
    if (task) this.setText(this.inspector, 'insp-recent', `Just changed: ${task.title}. ${task.summary}`);
    this.setShown('insp-files', false);
  }

  /** The side panel in the notes room: what the room is for and how to use it. */
  private showNotesRoom(): void {
    const count = loadNotes(app.mapId).length;
    this.setText(this.inspector, 'insp-kind', 'NOTES ROOM');
    this.setText(this.inspector, 'insp-title', `Notes for ${app.graph.project.name}`);
    this.setText(this.inspector, 'insp-summary', NOTES_NODE.summary);
    this.setText(
      this.inspector,
      'insp-stats',
      `${count} note${count === 1 ? '' : 's'} so far | say "scratch that" to take one back, "read them back" to hear them`,
    );
    this.setShown('insp-alert-box', false);
    this.setShown('insp-recent-box', false);
    for (let i = 0; i < 4; i += 1) this.inspector?.getElementById(`file-${i}`)?.setProperties({ display: 'none' });
  }

  private showNode(id: string): void {
    const graph = app.graph;
    const node = graph.nodes.find((n) => n.id === id);
    const site = this.sitesById.get(id);
    if (!node || !site) return;
    const district = this.layout.districts.get(id);
    const owned = graph.files.filter((f) => f.n === id || this.isDescendant(f.n, id)).sort((a, b) => b.loc - a.loc);
    const place = pickTheme(graph, id).place.toUpperCase();
    this.setText(this.inspector, 'insp-kind', `${KIND_NAMES[node.kind]} · ${place}`);
    this.setText(this.inspector, 'insp-title', node.label);
    this.setText(this.inspector, 'insp-summary', node.summary);
    const files = district?.totalFiles ?? owned.length;
    const loc = district?.totalLoc ?? 0;
    const links = site.conduits.length;
    this.setText(
      this.inspector,
      'insp-stats',
      node.kind === 'external'
        ? `Outside service · ${links} part${links === 1 ? '' : 's'} talk to it`
        : `${files} files · ${loc.toLocaleString('en-US')} lines · ${links} connection${links === 1 ? '' : 's'}`,
    );
    this.setShown('insp-alert-box', site.issues.length > 0);
    if (site.issues.length > 0) {
      const issue = site.issues[0];
      this.setText(this.inspector, 'insp-alert', `${issue.title}. ${issue.detail ?? ''}`.trim());
    }
    this.setShown('insp-recent-box', site.recentNotes.length > 0);
    if (site.recentNotes.length > 0) this.setText(this.inspector, 'insp-recent', `Just changed: ${site.recentNotes.join(' ')}`);
    this.setShown('insp-files', owned.length > 0);
    for (let i = 0; i < 4; i += 1) {
      const f = owned[i];
      this.setText(this.inspector, `file-${i}`, f ? `${f.name}  —  ${f.d}` : '…');
      this.inspector?.getElementById(`file-${i}`)?.setProperties({ display: f ? 'flex' : 'none' });
    }
  }

  /** During a quiz the card would give the answers away, so it only says so. */
  private showQuizCard(id: string): void {
    const node = app.graph.nodes.find((n) => n.id === id);
    if (!node) return;
    this.setText(this.inspector, 'insp-kind', 'QUIZ IN PROGRESS');
    this.setText(this.inspector, 'insp-title', node.label);
    this.setText(this.inspector, 'insp-summary', 'The notes on this room are put away while you are quizzed.');
    this.setText(this.inspector, 'insp-stats', 'They come back when the quiz ends.');
    this.setShown('insp-alert-box', false);
    this.setShown('insp-recent-box', false);
    this.setShown('insp-files', false);
  }

  private showStep(): void {
    const flow = currentFlow()!;
    const step = currentStep()!;
    const node = app.graph.nodes.find((n) => n.id === step.nodeId)!;
    const hop = this.hop;
    this.setText(
      this.inspector,
      'insp-kind',
      `STEP ${app.stepIndex + 1} OF ${app.flowSteps.length}${hop ? ` · ${HOP_TAGS[hop.kind]}` : ` · ${flow.title.toUpperCase()}`}`,
    );
    this.setText(this.inspector, 'insp-title', node.label);
    this.setText(this.inspector, 'insp-summary', step.note);
    this.setText(this.inspector, 'insp-stats', hop ? `${hop.detail} ${node.summary}` : node.summary);
    this.setShown('insp-alert-box', false);
    this.setShown('insp-recent-box', false);
    this.setShown('insp-files', false);
  }

  private isDescendant(id: string, ancestor: string): boolean {
    let current = app.graph.nodes.find((n) => n.id === id)?.parent ?? null;
    while (current) {
      if (current === ancestor) return true;
      current = app.graph.nodes.find((n) => n.id === current)?.parent ?? null;
    }
    return false;
  }

  // ------------------------------------------------------- highlighting

  private setHovered(entity: Entity, hovered: boolean): void {
    const site = this.sitesById.get(entity.getValue(District, 'nodeId') as string);
    if (!site) return;
    site.hovered = hovered;
    this.refreshGlow();
  }

  /**
   * Parts the coding agent just changed (a live map update) throb brightly for
   * a few seconds, so the visitor sees where the code moved.
   */
  private pulseFresh(): void {
    const now = performance.now();
    let ended = false;
    for (const [id, at] of freshParts) {
      const age = (now - at) / 1000;
      const site = this.sitesById.get(id);
      if (age > FRESH_SECONDS || !site) {
        freshParts.delete(id);
        ended = true;
        continue;
      }
      const beat = 0.5 + 0.5 * Math.sin(age * 5);
      site.material.emissiveIntensity = site.glow[3] * (0.7 + 0.8 * beat);
      site.material.color.copy(site.tint).multiplyScalar(TINT_LIFT[3]);
    }
    if (ended) this.refreshGlow();
  }

  /** Recomputes every building's glow and conduit brightness from the current state. */
  private refreshGlow(): void {
    const focus = currentStep()?.nodeId ?? app.selected;
    for (const site of this.sitesById.values()) {
      const level = site.id === focus ? (app.stepIndex >= 0 ? 3 : 2) : site.hovered ? 1 : 0;
      site.material.emissiveIntensity = site.glow[level];
      site.material.color.copy(site.tint).multiplyScalar(TINT_LIFT[level]);
    }
    this.refreshLabels();
    this.redrawConduits(focus ?? null);
  }

  /**
   * Conduits draw as two merged meshes (40-odd tubes in two draw calls): the
   * ones touching the focused part, bright, and the rest, faint when
   * something is focused. Rebuilt only when the focus changes.
   */
  /** Moves the data packets along their conduits; with a focus, only its own conduits carry any. */
  private updateFlowDots(time: number): void {
    const dots = this.flowDots;
    if (!dots) return;
    const focus = this.conduitFocus ?? null;
    let i = 0;
    for (const c of this.conduits) {
      const shown = !focus || c.a === focus || c.b === focus;
      const speed = 0.18 + 0.06 * Math.log2(1 + c.weight);
      for (let k = 0; k < DOTS_PER_CONDUIT; k += 1, i += 1) {
        if (!shown || !c.curve || k >= 1 + Math.min(DOTS_PER_CONDUIT - 1, Math.floor(Math.log2(1 + c.weight)))) {
          this.dotMatrix.makeScale(0, 0, 0);
        } else {
          // Each conduit runs from a to b; stagger the packets along it.
          const t = (time * speed + k / DOTS_PER_CONDUIT + (i % 7) * 0.13) % 1;
          c.curve.getPoint(t, this.scratch);
          const size = focus ? 1.5 : 1;
          this.dotMatrix.makeScale(size, size, size).setPosition(this.scratch);
        }
        dots.setMatrixAt(i, this.dotMatrix);
      }
    }
    dots.instanceMatrix.needsUpdate = true;
  }

  private redrawConduits(focus: string | null): void {
    if (focus === this.conduitFocus && this.conduitMeshes.length) return;
    this.conduitFocus = focus;
    for (const m of this.conduitMeshes) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.removeFromParent();
    }
    this.conduitMeshes = [];
    const lit = this.conduits.filter((c) => focus && (c.a === focus || c.b === focus));
    const rest = this.conduits.filter((c) => !lit.includes(c));
    const add = (list: Conduit[], opacity: number) => {
      const geometry = mergeGeometries(list.map((c) => c.tube));
      if (!geometry) return;
      const mesh = ignoreRays(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false })));
      mesh.renderOrder = 5;
      this.root.object3D!.add(mesh);
      this.conduitMeshes.push(mesh);
    };
    add(lit, 0.95);
    add(rest, focus ? 0.1 : 0.55);
  }

  private startHop(): void {
    const step = currentStep()!;
    const site = this.sitesById.get(step.nodeId);
    if (!site) return;
    const prevId = app.flowSteps[app.stepIndex - 1]?.nodeId ?? null;
    const hop = classifyHop(app.graph, prevId, step.nodeId);
    this.hop = hop;
    // A request from the internet comes in through the gateway.
    const from = hop.kind === 'entry' ? this.gatePoint : (prevId && this.sitesById.get(prevId)?.roof) || site.roof;
    const to = site.roof;
    this.hopCurve.v0.copy(from);
    this.hopCurve.v2.copy(to);
    this.hopCurve.v1.copy(from).lerp(to, 0.5);
    // Network hops fly high over the city; work inside the code stays low.
    const lift = hop.kind === 'local' ? 0.012 + from.distanceTo(to) * 0.15 : hop.kind === 'storage' ? 0.025 + from.distanceTo(to) * 0.25 : 0.05 + from.distanceTo(to) * 0.5;
    this.hopCurve.v1.y = Math.max(from.y, to.y) + lift;
    (this.pulse.material as MeshBasicMaterial).color.set(HOP_COLORS[hop.kind]);
    this.pulse.scale.setScalar(hop.kind === 'local' ? 0.75 : 1);
    this.stepClock = app.stepIndex === 0 && hop.kind !== 'entry' ? HOP_SECONDS : 0;
    this.pulse.visible = true;
  }

  /**
   * The gateway on the front-right corner of the board: where requests from
   * the internet come in, and the start of every flow that begins in a
   * browser or at a server.
   */
  private addGateway(group: Group): void {
    const w = this.layout.width;
    const front = -0.04 + (this.layout.depth + 0.16) / 2;
    const x = w / 2 - 0.035;
    const z = front - 0.035;
    const material = new MeshStandardMaterial({ color: '#5ce1ff', emissive: new Color('#5ce1ff'), emissiveIntensity: 1.4, roughness: 0.4 });
    const arch = new Mesh(new TorusGeometry(0.022, 0.0035, 8, 24, Math.PI), material);
    arch.position.set(x, 0.03, z);
    group.add(ignoreRays(arch));
    for (const side of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.03, 8), material);
      post.position.set(x + side * 0.022, 0.015, z);
      group.add(ignoreRays(post));
    }
    const label = makeLabel('Internet', 0.016, '#5ce1ff');
    label.position.set(x, 0.07, z);
    group.add(ignoreRays(label));
    this.labels.push(label);
    this.gateLabel = label;
    this.gatePoint.set(x, 0.03, z);
  }

  // ---------------------------------------------------------- street view

  /** The board's turn about the vertical axis (it only ever turns that way). */
  private boardYaw(): number {
    const q = this.root.object3D!.quaternion;
    return 2 * Math.atan2(q.y, q.w);
  }

  /** The floor under the viewer's head, in the workspace's space. */
  private floorUnderHead(out: Vector3): Vector3 {
    this.world.camera.getWorldPosition(out);
    out.y = 0;
    return this.root.object3D!.parent!.worldToLocal(out);
  }

  /** Poses the board so its local point `focus` sits at `at` (workspace space). */
  private poseBoard(focus: Vector3, at: Vector3, yaw: number, scale: number): void {
    const obj = this.root.object3D!;
    obj.quaternion.setFromAxisAngle(UP, yaw);
    obj.scale.setScalar(scale);
    this.streetTmp.copy(focus).multiplyScalar(scale).applyAxisAngle(UP, yaw);
    obj.position.copy(at).sub(this.streetTmp);
  }

  /** Starts growing the city to life size around the viewer, or shrinking it back onto the desk. */
  private beginStreetMove(toStreet: boolean): void {
    const obj = this.root.object3D!;
    const move = this.streetMove;
    move.t = 0;
    move.toStreet = toStreet;
    move.fromScale = obj.scale.x;
    move.fromYaw = this.boardYaw();
    if (toStreet) {
      this.mapPose.position.copy(obj.position);
      this.mapPose.yaw = move.fromYaw;
      this.mapPose.scale = obj.scale.x;
      // Arrive at the Internet gateway, like a request does.
      move.focus.set(this.gatePoint.x - 0.02, 0, this.gatePoint.z);
      move.from.copy(move.focus).multiplyScalar(move.fromScale).applyAxisAngle(UP, move.fromYaw).add(obj.position);
      this.floorUnderHead(move.to);
      move.toScale = STREET_SCALE;
      move.toYaw = move.fromYaw;
    } else {
      // Shrink away from wherever the viewer is standing.
      this.floorUnderHead(move.from);
      obj.updateWorldMatrix(true, false);
      this.world.camera.getWorldPosition(move.focus);
      move.focus.y = 0;
      obj.worldToLocal(move.focus);
      move.toScale = this.mapPose.scale;
      move.toYaw = this.mapPose.yaw;
      move.to.copy(move.focus).multiplyScalar(move.toScale).applyAxisAngle(UP, move.toYaw).add(this.mapPose.position);
    }
    this.streetMoving = true;
    this.applyVisibility();
  }

  private updateStreetMove(delta: number): void {
    const move = this.streetMove;
    move.t = Math.min(1, move.t + delta / STREET_SECONDS);
    const u = move.t * move.t * (3 - 2 * move.t);
    // Exponential growth, so the zoom feels steady.
    const scale = Math.exp(Math.log(move.fromScale) + (Math.log(move.toScale) - Math.log(move.fromScale)) * (move.toStreet ? move.t * move.t : 1 - (1 - move.t) * (1 - move.t)));
    this.streetAt.lerpVectors(move.from, move.to, u);
    this.poseBoard(move.focus, this.streetAt, move.fromYaw + (move.toYaw - move.fromYaw) * u, scale);
    if (move.t < 1) return;
    this.streetMoving = false;
    this.modeChangedAt = performance.now();
    this.streetShown = move.toStreet;
    // Name signs sized for the desk would be billboards at life size.
    for (const label of this.labels) label.scale.setScalar(move.toStreet ? STREET_LABEL_SCALE : 1);
    if (!move.toStreet) {
      this.root.object3D!.position.copy(this.mapPose.position);
    }
    this.applyVisibility();
  }

  /** Stands the viewer on a spot of the board (board space), keeping the city's turn unless `yaw` is given. */
  private standAt(spot: Vector3, yaw = this.boardYaw()): void {
    this.poseBoard(spot, this.floorUnderHead(this.streetAt), yaw, STREET_SCALE);
    this.streetMovedAt = performance.now();
    click();
  }

  /** Stands the viewer at a building's door, facing it. */
  private standAtDoor(id: string): void {
    const d = this.layout.districts.get(id);
    if (!d) return;
    this.streetSpot.set(d.rect.x + d.rect.w / 2, d.base, d.rect.z + d.rect.d + DOOR_STANDOFF);
    // Turn the city so the door (towards -Z on the board) is where the head is looking.
    const parent = this.root.object3D!.parent!;
    this.world.camera.getWorldDirection(this.streetTmp);
    this.streetTmp.y = 0;
    if (this.streetTmp.lengthSq() < 1e-4) this.streetTmp.set(0, 0, -1);
    this.streetTmp.normalize().transformDirection(this.streetInverse.copy(parent.matrixWorld).invert());
    this.standAt(this.streetSpot, Math.atan2(-this.streetTmp.x, -this.streetTmp.z));
  }

  /** A pinch on the city in street view: walk to that spot, or to that building's door. */
  private streetPress(id: string): void {
    const now = performance.now();
    // A hand pinch often registers twice, and after a move the ray points somewhere new.
    if (this.streetMoving || now - this.streetMovedAt < STREET_QUIET_MS || now - this.modeChangedAt < MODE_QUIET_MS) return;
    const d = this.layout.districts.get(id);
    if (!d) {
      select(id); // an outside service: just show what it is
      return;
    }
    if (d.isLeaf) {
      // Pinching the building you are standing at goes in.
      if (app.selected === id) {
        enterRoom(id);
        return;
      }
      this.standAtDoor(id);
      select(id);
      return;
    }
    // Open ground: walk to the spot pointed at, on top of that plinth.
    const obj = this.root.object3D!;
    if (now - this.hitAt < 400) {
      obj.updateWorldMatrix(true, false);
      obj.worldToLocal(this.streetSpot.copy(this.hitPoint));
    } else this.streetSpot.set(d.rect.x + d.rect.w / 2, 0, d.rect.z + d.rect.d / 2);
    this.streetSpot.y = d.base + d.height;
    this.standAt(this.streetSpot);
  }

  /** Discs on the ground at every building's door: pinch one to stand there. */
  private buildWaypoints(group: Group): void {
    this.waypointSpots = [];
    for (const d of this.layout.districts.values()) {
      if (!d.isLeaf) continue;
      this.waypointSpots.push(new Vector3(d.rect.x + d.rect.w / 2, d.base + 0.0003, d.rect.z + d.rect.d + DOOR_STANDOFF));
    }
    const disc = new CircleGeometry(WAYPOINT_RADIUS, 24).rotateX(-Math.PI / 2);
    const mesh = new InstancedMesh(disc, new MeshBasicMaterial({ color: WAYPOINT_COLOR, transparent: true, opacity: 0.55, depthWrite: false }), this.waypointSpots.length);
    this.waypointSpots.forEach((spot, i) => {
      this.dotMatrix.makeTranslation(spot.x, spot.y, spot.z);
      mesh.setMatrixAt(i, this.dotMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.visible = false;
    mesh.name = 'street-waypoints';
    group.add(mesh);
    const entity = this.world.createTransformEntity(mesh, { parent: this.root });
    this.entities.push(entity);
    this.waypoints = mesh;
    // Which disc: the one nearest where the pinch landed. Acted on next frame.
    const events = mesh as unknown as { addEventListener(type: string, fn: (e: { point?: Vector3 }) => void): void };
    events.addEventListener('pointerdown', (e) => {
      if (e.point) this.waypointHit = e.point.clone();
    });
    this.streetExtrasShown = true;
    this.showStreetExtras(false);
  }

  /** Two buttons, low to the left and right, that turn the view 30 degrees: for hands, with no thumbstick. */
  private buildTurnButtons(): void {
    for (const dir of [-1, 1] as const) {
      const mesh = makeTurnButton(dir);
      mesh.name = dir < 0 ? 'turn-left' : 'turn-right';
      mesh.visible = false;
      const entity = this.world.createTransformEntity(mesh, { persistent: true });
      (mesh as unknown as { addEventListener(type: string, fn: () => void): void }).addEventListener('pointerdown', () => {
        this.turnHit = dir;
      });
      this.turnButtons.push({ entity, mesh, dir });
    }
  }

  /** The discs and Turn buttons show only while standing in the street, and only then take a pinch. */
  private showStreetExtras(shown: boolean): void {
    if (shown === this.streetExtrasShown) return;
    this.streetExtrasShown = shown;
    if (this.waypoints) this.waypoints.visible = shown;
    // Development: where the nearest discs are, for automated tests to aim at.
    if (import.meta.env.DEV && shown && this.waypoints) {
      const obj = this.root.object3D!;
      obj.updateWorldMatrix(true, false);
      this.world.camera.getWorldPosition(this.headWorld);
      const near = this.waypointSpots
        .map((s) => obj.localToWorld(s.clone()))
        .sort((a, b) => a.distanceTo(this.headWorld) - b.distanceTo(this.headWorld))
        .slice(0, 3);
      console.log(`[street] discs ${near.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(' | ')}`);
    }
    const discs = this.entities.find((e) => e.object3D === this.waypoints);
    for (const target of [discs, ...this.turnButtons.map((b) => b.entity)]) {
      if (!target) continue;
      if (shown && !target.hasComponent(RayInteractable)) target.addComponent(RayInteractable);
      else if (!shown && target.hasComponent(RayInteractable)) target.removeComponent(RayInteractable);
    }
    // Point and pinch (a fingertip tap did not register on these head-facing buttons in testing).
    for (const b of this.turnButtons) b.mesh.visible = shown;
  }

  /**
   * The Turn buttons stand low to either side of where the visitor faced on
   * arriving, or after their last move or turn. They stay put while the head
   * turns, so either one can be looked at and pinched; only a much bigger
   * head turn brings them round again.
   */
  private placeTurnButtons(): void {
    this.world.camera.getWorldPosition(this.headWorld);
    this.world.camera.getWorldQuaternion(this.headQuat);
    this.headEuler.setFromQuaternion(this.headQuat, 'YXZ');
    let drift = this.headEuler.y - this.turnAnchorYaw;
    while (drift > Math.PI) drift -= Math.PI * 2;
    while (drift < -Math.PI) drift += Math.PI * 2;
    const replace = this.turnAnchorAt !== this.streetMovedAt || Math.abs(drift) > TURN_BUTTON_FOLLOW;
    if (replace) {
      this.turnAnchorAt = this.streetMovedAt;
      this.turnAnchorYaw = this.headEuler.y;
    }
    for (const b of this.turnButtons) {
      if (replace) {
        const a = this.turnAnchorYaw - b.dir * TURN_BUTTON_ANGLE;
        b.mesh.position.set(this.headWorld.x - Math.sin(a) * TURN_BUTTON_OUT, this.headWorld.y - TURN_BUTTON_DROP, this.headWorld.z - Math.cos(a) * TURN_BUTTON_OUT);
      }
      b.mesh.lookAt(this.headWorld);
      b.mesh.scale.setScalar(b.entity.hasComponent(Hovered) ? 1.15 : 1);
    }
  }

  /**
   * Turning in street view without standing up: a Turn button, or the right
   * stick flicked left or right, swings the city 30 degrees round the visitor.
   * A pinched waypoint disc walks there.
   */
  private updateStreetTurn(): void {
    const now = performance.now();
    const quiet = now - this.streetMovedAt < STREET_QUIET_MS || now - this.modeChangedAt < MODE_QUIET_MS;
    // A pinch that lands twice on a Turn button turns once.
    let dir: number = quiet ? 0 : this.turnHit;
    this.turnHit = 0;
    const stick = this.input.xr.gamepads.right?.getAxesValues(InputComponent.Thumbstick);
    if (stick) {
      if (Math.abs(stick.x) > 0.7 && !this.stickTurned) {
        this.stickTurned = true;
        dir = stick.x > 0 ? 1 : -1;
      } else if (Math.abs(stick.x) < 0.3) this.stickTurned = false;
    }
    if (dir !== 0) {
      // Turning to the right swings the world the other way round the visitor.
      const obj = this.root.object3D!;
      obj.updateWorldMatrix(true, false);
      this.floorUnderHead(this.streetAt);
      obj.parent!.localToWorld(this.streetSpot.copy(this.streetAt));
      obj.worldToLocal(this.streetSpot);
      this.poseBoard(this.streetSpot, this.streetAt, this.boardYaw() + dir * STREET_TURN, obj.scale.x);
      this.streetMovedAt = now;
      click();
      return;
    }
    const hit = this.waypointHit;
    this.waypointHit = null;
    if (!hit || quiet) return;
    const obj = this.root.object3D!;
    obj.updateWorldMatrix(true, false);
    obj.worldToLocal(hit);
    let best: Vector3 | null = null;
    let bestDistance = Infinity;
    for (const spot of this.waypointSpots) {
      const distance = (spot.x - hit.x) ** 2 + (spot.z - hit.z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = spot;
      }
    }
    if (!best) return;
    if (import.meta.env.DEV) console.log(`[street] walked to the disc at ${best.x.toFixed(3)}, ${best.z.toFixed(3)} (board)`);
    this.standAt(this.streetSpot.copy(best));
  }

  /** Controllers and keyboard: the left thumbstick walks the streets. */
  private updateStreetWalk(delta: number): void {
    const stick = this.input.xr.gamepads.left?.getAxesValues(InputComponent.Thumbstick);
    if (!stick || (Math.abs(stick.x) < 0.2 && Math.abs(stick.y) < 0.2)) return;
    const parent = this.root.object3D!.parent!;
    this.world.camera.getWorldDirection(this.streetTmp);
    this.streetTmp.y = 0;
    if (this.streetTmp.lengthSq() < 1e-4) return;
    this.streetTmp.normalize().transformDirection(this.streetInverse.copy(parent.matrixWorld).invert());
    const fx = this.streetTmp.x;
    const fz = this.streetTmp.z;
    // Forward is stick up (negative y); right is (-fz, fx).
    const mx = fx * -stick.y + -fz * stick.x;
    const mz = fz * -stick.y + fx * stick.x;
    const obj = this.root.object3D!;
    obj.position.x -= mx * STREET_WALK_SPEED * delta;
    obj.position.z -= mz * STREET_WALK_SPEED * delta;
  }

  // --------------------------------------------------------------- frame

  update(delta: number, time: number): void {
    if (isPaused()) return; // headset off or system menu up: hold everything still
    // Entering or leaving mixed reality swaps the virtual desk for the real one.
    const passthrough = inPassthrough(this.world);
    if (passthrough !== this.passthroughShown) {
      this.passthroughShown = passthrough;
      this.applyVisibility();
    }
    this.updateDive(delta);
    // What shows and takes a pinch follows the state every frame, not only its changes.
    const atRest = app.mode === 'table' && this.diveDir === 0 && !app.menu && !this.streetMoving && !this.surfaceFrom;
    this.showPegs(atRest && !app.street && !this.streetShown);
    this.showStreetExtras(atRest && this.streetShown);
    this.shiftInspectorForNotes();
    if (freshParts.size) this.pulseFresh();
    if (app.mode !== 'table' || this.diveDir !== 0) {
      // A pinch made in a room or mid-dive is not one at the city.
      this.nearPinch = null;
      return;
    }

    if (this.nearPinch) {
      const hand = this.nearPinch;
      this.nearPinch = null;
      if (!app.street && !this.streetShown && !app.menu) this.nearPick(hand);
    }
    if (this.chipHit) {
      this.chipHit = false;
      this.chipPressed();
      if (app.mode !== 'table') return;
    }
    // The lifted roof: once it has come back down, the building is whole again.
    if (this.peek.update(delta, time)) this.shutPeek();

    // Street view: grow to life size or shrink back, then walk by pinching.
    if (this.streetMoving) {
      this.updateStreetMove(delta);
    } else if (app.street !== this.streetShown && !this.surfaceFrom) {
      if (app.menu) {
        // The menu opened from the street: put the city back on the desk at once.
        this.poseBoard(this.streetSpot.set(0, 0, 0), this.mapPose.position, this.mapPose.yaw, this.mapPose.scale);
        this.streetShown = false;
        this.applyVisibility();
      } else this.beginStreetMove(app.street);
    }
    if (this.streetPressed) {
      const id = this.streetPressed;
      this.streetPressed = null;
      if (this.streetShown && !this.streetMoving) this.streetPress(id);
    }
    if (this.streetShown && !this.streetMoving) {
      this.updateStreetWalk(delta);
      this.updateStreetTurn();
    }
    if (this.streetExtrasShown) this.placeTurnButtons();
    this.updateHandAims();

    // The corner pegs: hold one to turn the city, two to resize it.
    const grabbed = this.pegsShown && this.updatePegs(delta);

    // Controllers: the right thumbstick spins the city (left and right) and
    // resizes it (up and down), when it is not being held.
    const stick = this.input.xr.gamepads.right?.getAxesValues(InputComponent.Thumbstick);
    if (stick && !grabbed && !this.streetShown && !this.streetMoving && (Math.abs(stick.x) > 0.2 || Math.abs(stick.y) > 0.2)) {
      const obj = this.root.object3D!;
      if (Math.abs(stick.x) > 0.2) obj.rotation.y -= stick.x * 1.4 * delta;
      if (Math.abs(stick.y) > 0.2) {
        this.uniformScale = Math.min(3, Math.max(0.5, this.uniformScale * (1 - stick.y * 0.9 * delta)));
        obj.scale.setScalar(this.uniformScale);
      }
    }

    this.showShadow();

    // Labels turn to face the viewer.
    this.world.camera.getWorldPosition(this.headWorld);
    for (const label of this.labels) label.lookAt(this.headWorld);
    const chip = this.chip?.object3D;
    if (chip?.visible) {
      chip.lookAt(this.headWorld);
      // Pointed at, it stands out and holds still, so the pinch is sure to land.
      chip.scale.setScalar(this.chip!.hasComponent(Hovered) ? 1.25 : 1 + 0.05 * Math.sin(time * 4));
      this.chipPoke(chip);
    } else {
      this.chipTipZ.left = this.chipTipZ.right = Infinity;
    }

    this.updateFlowDots(time);

    for (const b of this.beacons) {
      b.mesh.rotation.y = time * 2 + b.phase;
      // Over an open building the beacon rides above the lid.
      const lifted = b.siteId === this.peekId ? this.peek.clearance * this.peek.amount : 0;
      b.mesh.position.y = b.baseY + lifted + Math.sin(time * 3 + b.phase) * 0.003;
    }

    if (app.stepIndex >= 0) {
      this.stepClock += delta;
      const t = Math.min(this.stepClock / HOP_SECONDS, 1);
      const eased = t * t * (3 - 2 * t);
      this.hopCurve.getPoint(eased, this.scratch);
      this.pulse.position.copy(this.scratch);
      this.pulse.scale.setScalar(t >= 1 ? 1 + 0.35 * Math.sin(time * 10) : 1);
      if (app.playing && this.stepClock >= HOP_SECONDS + DWELL_SECONDS) {
        this.stepClock = 0;
        nextStep();
      }
    }
  }
}
