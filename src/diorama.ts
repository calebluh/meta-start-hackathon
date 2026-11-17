import {
  AssetManager,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  CylinderGeometry,
  EdgesGeometry,
  type Entity,
  Grabbed,
  GrabSystem,
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
  OctahedronGeometry,
  PlaneGeometry,
  Pressed,
  Quaternion,
  QuadraticBezierCurve3,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  TwoHandsGrabbable,
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
import { District } from './diorama-components.js';
import { Peek } from './peek.js';
import { isPaused } from './pause.js';
import { dive, DIVE_SECONDS } from './transition.js';
import { buildLayout, resolveRef, type DioramaLayout, type District as Lot, type Rect } from './layout.js';
import type { GraphData, HealthIssue, NodeKind } from './maps/types.js';
import { hashString, pickTheme } from './rooms/themes.js';
import {
  app,
  currentFlow,
  currentStep,
  cycleFlow,
  enterRoom,
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
const UP = new Vector3(0, 1, 0);
const BOARD_GRAB = {
  rotate: true,
  // Spin it like a lazy Susan, but never tip the city over.
  rotateMin: [0, -Infinity, 0] as [number, number, number],
  rotateMax: [0, Infinity, 0] as [number, number, number],
  translate: true,
  scale: true,
  scaleMin: [0.5, 0.5, 0.5] as [number, number, number],
  scaleMax: [3, 3, 3] as [number, number, number],
};
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
/** Thickness of the neon edges on buildings and on plinths. */
const EDGE = 0.0012;
const PLINTH_EDGE = 0.0008;
/** Ignore a pinch on the Step inside chip this soon after the building was picked. */
const CHIP_QUIET_MS = 500;
/**
 * A pinch made right at the city takes hold of the board (a near grab), not
 * of a building. Held this briefly and moved this little, it was not a grab
 * at all: it picks the building the fingers closed on, within this reach.
 */
const TAP_MS = 450;
const TAP_SLIP = 0.02;
const TAP_REACH = 0.05;
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
function makeLabel(text: string, height: number, accent: string): Mesh {
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
  /** The diorama's size; two-hand grabs stretch one axis, we apply it to all. */
  private uniformScale = 1;
  private grabStartScale = 1;
  private wasGrabbed = false;
  /** The start of the current hold on the board: when, which hand, where its fingertip was, and the board's pose. */
  private tapAt = 0;
  private tapHand: 'left' | 'right' | null = null;
  private tapPoint = new Vector3();
  private tapPose = { position: new Vector3(), quaternion: new Quaternion(), scale: 1 };
  private tapBox = new Box3();
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

    this.cleanupFuncs.push(
      onChange(() => this.render()),
      this.queries.hovered.subscribe('qualify', (e) => this.setHovered(e, true)),
      this.queries.hovered.subscribe('disqualify', (e) => this.setHovered(e, false)),
      this.queries.pressed.subscribe('qualify', (e) => {
        if (app.mode !== 'table') return;
        const id = e.getValue(District, 'nodeId') as string;
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

  /** Remembers how a hold on the board began, in case it turns out to be a quick pinch on a building. */
  private noteGrabStart(): void {
    const obj = this.root.object3D!;
    this.tapAt = performance.now();
    this.tapPose.position.copy(obj.position);
    this.tapPose.quaternion.copy(obj.quaternion);
    this.tapPose.scale = this.uniformScale;
    this.tapHand = this.world.getSystem(GrabSystem)?.getHolderHand(this.root) ?? null;
    if (this.tapHand) this.player.indexTipSpaces[this.tapHand].getWorldPosition(this.tapPoint);
  }

  /**
   * The board was let go. A hold that was short and went nowhere was a pinch
   * on a building: put the board back exactly and pick the building nearest
   * the fingertip.
   */
  private tapPick(): void {
    const obj = this.root.object3D!;
    if (!this.tapHand || performance.now() - this.tapAt > TAP_MS) return;
    if (obj.position.distanceTo(this.tapPose.position) > TAP_SLIP) return;
    obj.position.copy(this.tapPose.position);
    obj.quaternion.copy(this.tapPose.quaternion);
    this.uniformScale = this.tapPose.scale;
    obj.scale.setScalar(this.uniformScale);
    obj.updateWorldMatrix(true, true);
    let best: string | null = null;
    let bestDistance = TAP_REACH;
    for (const site of this.sitesById.values()) {
      // Buildings and outside towers, not the plinths under them.
      if (this.layout.districts.has(site.id) && !site.lot) continue;
      const distance = this.tapBox.setFromObject(site.mesh).distanceToPoint(this.tapPoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site.id;
      }
    }
    if (import.meta.env.DEV) console.log(`[tap] ${best ?? 'nothing in reach'}`);
    if (best && best !== app.selected) this.pick(best);
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
    this.root.addComponent(TwoHandsGrabbable, {
      rotate: true,
      // Spin it like a lazy Susan, but never tip the city over.
      rotateMin: [0, -Infinity, 0],
      rotateMax: [0, Infinity, 0],
      translate: true,
      scale: true,
      scaleMin: [0.5, 0.5, 0.5],
      scaleMax: [3, 3, 3],
    });
    this.uniformScale = 1;
    this.streetShown = false;
    this.streetMoving = false;
    this.streetPressed = null;

    const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
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
    const chip = makeChip('Step inside', 0.026);
    chip.visible = false;
    this.chip = this.world.createTransformEntity(chip, { parent: this.root });
    this.entities.push(this.chip);
    // Acted on next frame: walking in takes the button's ray target away,
    // which must not happen while the pointer event is still being delivered.
    (chip as unknown as { addEventListener(type: string, fn: () => void): void }).addEventListener('pointerdown', () => {
      this.chipHit = true;
    });

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
    this.chip?.object3D?.position.set(site.roof.x, site.roof.y + this.peek.clearance + 0.044, site.roof.z);
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
    on('btn-street', () => setStreet(!app.street), 800);
  }

  private resetBoard(): void {
    if (app.mode !== 'table' || this.diveDir !== 0 || this.surfaceFrom || app.street || this.streetMoving) return;
    const board = this.root.object3D!;
    board.position.set(0, 0.002, -0.04);
    board.quaternion.identity();
    board.scale.setScalar(1);
    this.uniformScale = 1;
    this.grabStartScale = 1;
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
    this.diveBox.setFromObject(site.mesh);
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
      // The visitor may have turned around inside the room, so the desk
      // comes back in front of them first, unseen.
      placement.recentre();
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
      if (this.root.hasComponent(TwoHandsGrabbable)) this.root.removeComponent(TwoHandsGrabbable);
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
    this.streetShown = move.toStreet;
    // Name signs sized for the desk would be billboards at life size.
    for (const label of this.labels) label.scale.setScalar(move.toStreet ? STREET_LABEL_SCALE : 1);
    if (!move.toStreet) {
      this.root.object3D!.position.copy(this.mapPose.position);
      if (!this.root.hasComponent(TwoHandsGrabbable)) this.root.addComponent(TwoHandsGrabbable, BOARD_GRAB);
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
    if (this.streetMoving || now - this.streetMovedAt < STREET_QUIET_MS) return;
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
    if (app.mode !== 'table' || this.diveDir !== 0) return;

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
        if (!this.root.hasComponent(TwoHandsGrabbable)) this.root.addComponent(TwoHandsGrabbable, BOARD_GRAB);
        this.applyVisibility();
      } else this.beginStreetMove(app.street);
    }
    if (this.streetPressed) {
      const id = this.streetPressed;
      this.streetPressed = null;
      if (this.streetShown && !this.streetMoving) this.streetPress(id);
    }
    if (this.streetShown && !this.streetMoving) this.updateStreetWalk(delta);

    // Two-hand resizing changes the axis between the hands; keep the city in
    // proportion by applying whichever axis changed most to all three.
    // The grab rewrites the scale every frame from its value when the grab
    // began, so measure the change against that, not against the last frame.
    const grabbed = this.root.hasComponent(Grabbed);
    if (grabbed && !this.wasGrabbed) {
      this.grabStartScale = this.uniformScale;
      this.noteGrabStart();
    }
    if (!grabbed && this.wasGrabbed) this.tapPick();
    this.wasGrabbed = grabbed;
    const scale = this.root.object3D!.scale;
    if (scale.x !== scale.y || scale.y !== scale.z) {
      const start = this.grabStartScale;
      let next = scale.x;
      if (Math.abs(scale.y - start) > Math.abs(next - start)) next = scale.y;
      if (Math.abs(scale.z - start) > Math.abs(next - start)) next = scale.z;
      this.uniformScale = Math.min(3, Math.max(0.5, next));
      scale.setScalar(this.uniformScale);
    }

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
      chip.scale.setScalar(1 + 0.05 * Math.sin(time * 4));
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
