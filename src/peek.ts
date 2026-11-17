import {
  BackSide,
  BoxGeometry,
  CapsuleGeometry,
  type CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  QuadraticBezierCurve3,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import { interiorTexture } from './city-style.js';
import { ignoreRays } from './rays.js';
import { mergeStatic } from './rooms/merge.js';

/**
 * Lifting the roof off a building. Picking a building raises its roof like a
 * lid and shows, in miniature, what Step inside leads to: a lit room with the
 * robots who work there and the pipes that carry their requests.
 *
 * One building is open at a time. Everything is built when the roof lifts
 * and thrown away when it closes, so a closed city pays nothing for it.
 */

export interface PeekSite {
  /** Centre of the footprint and its size, in board space. */
  x: number;
  z: number;
  w: number;
  d: number;
  base: number;
  height: number;
  round: boolean;
  accent: string;
}

const OPEN_SECONDS = 0.5;
const CLOSE_SECONDS = 0.22;
/** How thick the walls look from above. */
const WALL = 0.0012;
const LID = 0.0016;

let wallGlow: CanvasTexture | null = null;

/** A robot one unit tall, standing on the origin and facing +Z. */
function makeBot(accent: Color): Group {
  const shell = new MeshStandardMaterial({ color: '#f1ece8', roughness: 0.45, metalness: 0.1 });
  const dark = new MeshStandardMaterial({ color: '#141922', roughness: 0.35, metalness: 0.3 });
  const light = new MeshBasicMaterial({ color: accent.clone().lerp(new Color('#ffffff'), 0.45) });
  const bot = new Group();
  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    bot.add(mesh);
    return mesh;
  };
  add(new Mesh(new CapsuleGeometry(0.19, 0.16, 3, 10), shell), 0, 0.36, 0);
  add(new Mesh(new SphereGeometry(0.25, 14, 10), shell), 0, 0.76, 0).scale.set(1.08, 0.86, 0.96);
  add(new Mesh(new BoxGeometry(0.36, 0.2, 0.06), dark), 0, 0.76, 0.215);
  for (const side of [-1, 1]) {
    add(new Mesh(new SphereGeometry(0.038, 8, 6), light), side * 0.085, 0.77, 0.25);
    add(new Mesh(new CapsuleGeometry(0.05, 0.14, 2, 6), shell), side * 0.26, 0.38, 0).rotation.z = side * 0.25;
    add(new Mesh(new BoxGeometry(0.13, 0.08, 0.18), dark), side * 0.1, 0.04, 0.02);
  }
  add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.12, 5), dark), 0, 1.02, 0);
  add(new Mesh(new SphereGeometry(0.04, 8, 6), light), 0, 1.1, 0);
  add(new Mesh(new BoxGeometry(0.2, 0.035, 0.02), light), 0, 0.42, 0.185);
  mergeStatic(bot);
  return bot;
}

function easeOutBack(t: number): number {
  const k = t - 1;
  return 1 + 2.2 * k * k * k + 1.2 * k * k;
}

export class Peek {
  /** Add this to the board once; it stays empty while no roof is open. */
  readonly group = new Group();
  /** How far above the roof line the open lid reaches, for placing the label over it. */
  clearance = 0;

  private lid = new Group();
  private bots: Group[] = [];
  private top = 0;
  private lift = 0;
  private angle = 0;
  private t = 0;
  private opening = false;
  private built = false;

  constructor() {
    this.group.name = 'peek';
  }

  get active(): boolean {
    return this.built;
  }

  /** 0 closed, 1 fully open. */
  get amount(): number {
    return this.t;
  }

  /**
   * Starts lifting the roof. `roofFeatures` is whatever stood on the roof (in
   * board space); it rides up on the lid.
   */
  open(site: PeekSite, roofFeatures: Object3D): void {
    this.clear();
    const { x, z, w, d, base, height: h, round, accent } = site;
    const color = new Color(accent);
    const group = this.group;
    this.top = base + h;
    this.lift = Math.min(0.012, Math.max(0.004, h * 0.3));
    this.angle = Math.min(0.72, Math.asin(Math.min(1, 0.045 / d)));
    this.clearance = this.lift + d * Math.sin(this.angle) + 0.008;

    // Inside walls and floor: one inward-facing shape, lit from within.
    wallGlow ??= interiorTexture();
    const warm = new Color('#ffffff').lerp(color, 0.18);
    const liner = new Mesh(
      round
        ? new CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0)
        : new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshBasicMaterial({ map: wallGlow, color: warm, side: BackSide }),
    );
    liner.position.set(x, base + 0.0003, z);
    liner.scale.set(w - WALL, h - 0.0003, d - WALL);
    group.add(liner);

    // The robots: more of them in a bigger building.
    const span = Math.min(w, d);
    const tall = Math.min(Math.min(0.026, Math.max(0.007, span * 0.32)), h * 1.25);
    const hx = w / 2 - WALL - tall * 0.3;
    const hz = d / 2 - WALL - tall * 0.3;
    const spots = span < 0.03 ? [[0, 0.15]] : span < 0.05 ? [[-0.5, 0.3], [0.45, -0.1]] : [[-0.55, 0.4], [0.5, 0.15], [-0.05, -0.35]];
    spots.forEach(([fx, fz], i) => {
      const bot = makeBot(color);
      bot.position.set(x + fx * hx, base + 0.0004, z + fz * hz);
      bot.rotation.y = (i - 1) * 0.5;
      bot.userData.size = tall;
      bot.userData.turn = bot.rotation.y;
      bot.scale.setScalar(0.001);
      group.add(bot);
      this.bots.push(bot);
    });

    // A console against the back wall, its screen lit.
    const deskW = Math.min(w * 0.5, tall * 2.4);
    const console_ = new Mesh(
      new BoxGeometry(deskW, tall * 0.5, tall * 0.4),
      new MeshStandardMaterial({ color: '#2a303b', roughness: 0.5, metalness: 0.4 }),
    );
    console_.position.set(x + hx * 0.25, base + tall * 0.25, z - d / 2 + WALL + tall * 0.2);
    const screen = new Mesh(
      new BoxGeometry(deskW * 0.8, tall * 0.4, tall * 0.04),
      new MeshBasicMaterial({ color: color.clone().lerp(new Color('#ffffff'), 0.35) }),
    );
    screen.position.set(console_.position.x, base + tall * 0.75, console_.position.z);
    group.add(console_, screen);

    // Two pipes of light, from the floor up and out through the walls.
    const pipe = (sx: number, ex: number, ez: number, tone: string) => {
      const from = new Vector3(x + sx * hx, base + 0.0006, z - hz * 0.2);
      const to = new Vector3(x + ex * (w / 2 - WALL), base + h * 0.85, z + ez * hz);
      const mid = from.clone().lerp(to, 0.5);
      mid.y = base + h * 1.05;
      mid.x = from.x;
      const tube = new Mesh(
        new TubeGeometry(new QuadraticBezierCurve3(from, mid, to), 14, Math.max(0.0005, tall * 0.045), 5),
        new MeshBasicMaterial({ color: tone }),
      );
      group.add(tube);
    };
    pipe(-0.25, -1, 0.3, '#6fe4ff');
    pipe(0.3, 1, -0.2, '#ffb45e');

    // The lid: hinged along the back edge of the roof.
    const lid = this.lid;
    lid.position.set(x, this.top, z - d / 2);
    lid.rotation.set(0, 0, 0);
    const slab = new Mesh(
      round ? new CylinderGeometry(0.5, 0.5, 1, 20) : new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.4),
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.5,
      }),
    );
    slab.scale.set(w, LID, d);
    slab.position.set(0, LID / 2, d / 2);
    roofFeatures.position.set(-lid.position.x, -lid.position.y + LID, -lid.position.z);
    lid.add(slab, roofFeatures);
    group.add(lid);

    ignoreRays(group);
    this.t = 0;
    this.opening = true;
    this.built = true;
    this.pose(0);
  }

  /** Lifts the roof again if it was on its way down. */
  reopen(): void {
    if (this.built) this.opening = true;
  }

  /** Starts lowering the roof; `update` reports when it is down. */
  close(): void {
    this.opening = false;
  }

  /** Advances the lid and the robots. Returns true on the frame the roof has closed. */
  update(delta: number, time: number): boolean {
    if (!this.built) return false;
    const before = this.t;
    this.t = this.opening ? Math.min(1, this.t + delta / OPEN_SECONDS) : Math.max(0, this.t - delta / CLOSE_SECONDS);
    if (this.t !== before || this.t > 0) this.pose(time);
    return !this.opening && this.t <= 0;
  }

  private pose(time: number): void {
    const e = this.opening ? easeOutBack(this.t) : this.t;
    this.lid.position.y = this.top + this.lift * e;
    this.lid.rotation.x = -this.angle * e;
    // The robots pop up once the lid is clear, then idle: a bob and a look around.
    const grown = Math.min(1, Math.max(0, (this.t - 0.3) / 0.5));
    const pop = grown <= 0 ? 0.001 : easeOutBack(grown);
    for (let i = 0; i < this.bots.length; i += 1) {
      const bot = this.bots[i];
      const size = bot.userData.size as number;
      bot.scale.setScalar(size * pop);
      bot.scale.y = size * pop * (1 + 0.04 * Math.sin(time * 3.1 + i * 2.1));
      bot.rotation.y = (bot.userData.turn as number) + 0.35 * Math.sin(time * 0.9 + i * 1.7);
    }
  }

  /** Removes everything and frees it. */
  clear(): void {
    if (!this.built) return;
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of ([] as Material[]).concat(mesh.material)) m.dispose();
    });
    this.lid.clear();
    this.group.clear();
    this.bots.length = 0;
    this.built = false;
    this.t = 0;
    this.opening = false;
    this.clearance = 0;
  }
}
