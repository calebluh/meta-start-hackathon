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
  QuadraticBezierCurve3,
  RayInteractable,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  TwoHandsGrabbable,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
} from '@iwsdk/core';
import { click } from './audio/sound.js';
import { KIND_COLORS } from './colors.js';
import { HACKATHON } from './edition.js';
import { inPassthrough } from './passthrough.js';
import { placement } from './placement.js';
import { setPanelShown } from './panels.js';
import { ignoreRays } from './rays.js';
import { buildRooftops } from './rooftops.js';
import { classifyHop, HOP_COLORS, HOP_TAGS, type HopKind } from './network.js';
import { mergeGeometries } from './rooms/merge.js';
import { District } from './diorama-components.js';
import { isPaused } from './pause.js';
import { dive, DIVE_SECONDS } from './transition.js';
import { buildLayout, resolveRef, type DioramaLayout } from './layout.js';
import type { GraphData, HealthIssue, NodeKind } from './maps/types.js';
import { pickTheme } from './rooms/themes.js';
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
  startFlow,
  stopFlow,
} from './state.js';



/** A building's footprint grows to about this many metres as you dive in. */
const DIVE_SPAN = 9;
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
const BASE_GLOW = 0.16;
const HOVER_GLOW = 0.55;
const SELECT_GLOW = 0.85;
const FLOW_GLOW = 1.3;
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
  /** Windowed buildings only glow through their windows, so they glow harder. */
  boost: number;
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
}

/** One window cell: a light wall with a darker pane, and a matching glow mask. */
function windowTextures(): { body: CanvasTexture; glow: CanvasTexture } {
  const make = (wall: string, pane: string) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = pane;
    ctx.fillRect(7, 8, 18, 16);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { body: make('#ffffff', '#5a6270'), glow: make('#000000', '#ffffff') };
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

/**
 * Builds the codebase diorama from a Floorplan graph and runs the tabletop:
 * hover glow, pinch-to-inspect, the inspector and control panels, and flow
 * playback on the board.
 *
 * Interaction with bare hands:
 * - point at a building and pinch to select it (ray select);
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
  private beacons: Beacon[] = [];

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
  /** When the current building was picked, to tell a second pinch from a shaky first one. */
  private selectedAt = 0;

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
      }),
    );
    this.render();
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
    const board = new Mesh(
      new BoxGeometry(this.layout.width + 0.02, 0.008, this.layout.depth + 0.16),
      new MeshStandardMaterial({ color: '#1a1d24', roughness: 0.8 }),
    );
    board.position.set(0, -0.004, -0.04);
    board.name = 'board';
    group.add(board);
    const rim = ignoreRays(new LineSegments(new EdgesGeometry(board.geometry), new LineBasicMaterial({ color: '#2f3b4a' })));
    rim.position.copy(board.position);
    group.add(rim);

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

    const unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const unitEdges = new EdgesGeometry(unitBox);
    const unitTower = new CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0);
    const recentLine = new LineBasicMaterial({ color: '#3fb950' });
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

    const addSite = (id: string, mesh: Mesh, material: MeshStandardMaterial, roof: Vector3, labelHeight: number, boost = 1) => {
      const node = nodesById.get(id)!;
      const entity = this.world.createTransformEntity(mesh, { parent: this.root });
      this.entities.push(entity);
      entity.addComponent(District, { nodeId: id });
      entity.addComponent(RayInteractable);
      const label = makeLabel(node.label, labelHeight, KIND_COLORS[node.kind]);
      label.position.set(roof.x, roof.y + labelHeight * 0.9, roof.z);
      group.add(ignoreRays(label));
      this.labels.push(label);
      this.sitesById.set(id, { id, mesh, material, roof, conduits: [], issues: [], recentNotes: [], hovered: false, boost });
    };

    const windows = windowTextures();
    for (const d of this.layout.districts.values()) {
      const color = new Color(KIND_COLORS[d.kind]);
      const material = new MeshStandardMaterial({
        color: d.isLeaf ? color : color.clone().multiplyScalar(0.35),
        emissive: d.isLeaf ? color.clone().lerp(new Color('#ffffff'), 0.35) : color,
        emissiveIntensity: BASE_GLOW,
        roughness: 0.55,
        metalness: 0.05,
      });
      if (d.isLeaf) {
        // Buildings get rows of lit windows, sized to the building.
        const repeatX = Math.max(1, Math.round(Math.max(d.rect.w, d.rect.d) / 0.012));
        const repeatY = Math.max(1, Math.round(d.height / 0.013));
        material.map = windows.body.clone();
        material.emissiveMap = windows.glow.clone();
        for (const t of [material.map, material.emissiveMap]) {
          t.wrapS = t.wrapT = RepeatWrapping;
          t.repeat.set(repeatX, repeatY);
          t.needsUpdate = true;
        }
      }
      // Data stores are round silos; everything else is a block.
      const mesh = new Mesh(d.isLeaf && d.kind === 'data' ? unitTower : unitBox, material);
      mesh.name = `district:${d.id}`;
      mesh.position.set(d.rect.x + d.rect.w / 2, d.base, d.rect.z + d.rect.d / 2);
      mesh.scale.set(d.rect.w, d.height, d.rect.d);
      // Parents label their front edge; buildings label their roof.
      const roof = d.isLeaf
        ? new Vector3(mesh.position.x, d.base + d.height, mesh.position.z)
        : new Vector3(mesh.position.x, d.base + d.height + 0.004, d.rect.z + d.rect.d - 0.008);
      addSite(d.id, mesh, material, roof, d.depth === 0 ? 0.02 : 0.016, d.isLeaf ? 5 : 1);
    }

    group.add(buildRooftops(this.layout.districts.values()));

    for (const s of this.layout.externals.values()) {
      const material = new MeshStandardMaterial({
        color: new Color(KIND_COLORS.external).multiplyScalar(0.5),
        emissive: new Color(KIND_COLORS.external),
        emissiveIntensity: BASE_GLOW,
        roughness: 0.4,
      });
      const mesh = new Mesh(unitTower, material);
      mesh.name = `external:${s.id}`;
      mesh.position.set(s.x, 0, s.z);
      mesh.scale.set(s.radius * 2, s.height, s.radius * 2);
      addSite(s.id, mesh, material, new Vector3(s.x, s.height, s.z), 0.016);
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
      c.tube = new Mesh(new TubeGeometry(curve, 28, radius, 5, false));
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
        this.beacons.push({ mesh: beacon, baseY, phase: this.beacons.length * 1.7 });
      }
    }

    // Recent work: a green outline around each part that just changed.
    for (const task of graph.recent?.tasks ?? []) {
      for (const item of task.items) {
        const id = resolveRef(graph, item.ref);
        const site = id ? this.sitesById.get(id) : undefined;
        if (!site) continue;
        site.recentNotes.push(item.note);
        if (site.recentNotes.length === 1 && site.mesh.geometry === unitBox) {
          const outline = ignoreRays(new LineSegments(unitEdges, recentLine));
          outline.scale.setScalar(1.02);
          outline.position.y = -0.01;
          site.mesh.add(outline);
        }
      }
    }

    if (graph.project.logo) this.addLogoPlaque(group, graph.project.logo);

    this.addGateway(group);

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
  }

  private resetBoard(): void {
    if (app.mode !== 'table' || this.diveDir !== 0 || this.surfaceFrom) return;
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
    if (desk) desk.visible = onTable && this.diveDir === 0 && !inPassthrough(this.world);
    for (const label of this.labels) label.visible = this.diveDir === 0;
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
      let glow = BASE_GLOW;
      if (site.hovered) glow = HOVER_GLOW;
      if (site.id === focus) glow = app.stepIndex >= 0 ? FLOW_GLOW : SELECT_GLOW;
      site.material.emissiveIntensity = glow * site.boost;
    }
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
      const mesh = ignoreRays(new Mesh(geometry, new MeshBasicMaterial({ color: '#7ee0ff', transparent: true, opacity, depthWrite: false })));
      mesh.renderOrder = 5;
      this.root.object3D!.add(mesh);
      this.conduitMeshes.push(mesh);
    };
    add(lit, 0.95);
    add(rest, focus ? 0.08 : 0.4);
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
    const material = new MeshStandardMaterial({ color: '#5ce1ff', emissive: new Color('#5ce1ff'), emissiveIntensity: 0.9, roughness: 0.4 });
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
    this.gatePoint.set(x, 0.03, z);
  }

  // --------------------------------------------------------------- frame

  update(delta: number, time: number): void {
    if (isPaused()) return; // headset off or system menu up: hold everything still
    this.updateDive(delta);
    if (app.mode !== 'table' || this.diveDir !== 0) return;

    // Two-hand resizing changes the axis between the hands; keep the city in
    // proportion by applying whichever axis changed most to all three.
    // The grab rewrites the scale every frame from its value when the grab
    // began, so measure the change against that, not against the last frame.
    const grabbed = this.root.hasComponent(Grabbed);
    if (grabbed && !this.wasGrabbed) this.grabStartScale = this.uniformScale;
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
    if (stick && !grabbed && (Math.abs(stick.x) > 0.2 || Math.abs(stick.y) > 0.2)) {
      const obj = this.root.object3D!;
      if (Math.abs(stick.x) > 0.2) obj.rotation.y -= stick.x * 1.4 * delta;
      if (Math.abs(stick.y) > 0.2) {
        this.uniformScale = Math.min(3, Math.max(0.5, this.uniformScale * (1 - stick.y * 0.9 * delta)));
        obj.scale.setScalar(this.uniformScale);
      }
    }

    // Labels turn to face the viewer.
    this.world.camera.getWorldPosition(this.headWorld);
    for (const label of this.labels) label.lookAt(this.headWorld);

    this.updateFlowDots(time);

    for (const b of this.beacons) {
      b.mesh.rotation.y = time * 2 + b.phase;
      b.mesh.position.y = b.baseY + Math.sin(time * 3 + b.phase) * 0.003;
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
