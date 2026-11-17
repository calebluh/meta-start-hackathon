import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
} from '@iwsdk/core';
import type { Rect } from './layout.js';
import { ignoreRays } from './rays.js';
import { mergeGeometries } from './rooms/merge.js';
import { hashString, seeded } from './rooms/themes.js';

/**
 * The look of the tabletop city: dark glass buildings with lit windows, neon
 * edges, light pooling at their feet, and a circuit-board tray under it all.
 *
 * Nothing here costs a draw call per building beyond the building itself: the
 * edges of the whole city are one mesh, and so are the pools of light.
 */

const CELL_PX = 32;
/** Window cells along one side of the facade textures. */
const CELLS = 4;
const WHITE = new Color('#ffffff');

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let wallTexture: CanvasTexture | null = null;
const glowTextures = new Map<string, CanvasTexture>();

/** The facade itself: a light frame with a darker pane in every cell. */
function wall(): CanvasTexture {
  if (wallTexture) return wallTexture;
  const { c, ctx } = canvas(CELL_PX * CELLS);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#3d4656';
  for (let y = 0; y < CELLS; y += 1) for (let x = 0; x < CELLS; x += 1) ctx.fillRect(x * CELL_PX + 7, y * CELL_PX + 8, 18, 16);
  return (wallTexture = finish(c));
}

/**
 * Which windows are lit, and in what colour: most in the building's own
 * colour, a few warm, a few dark. That unevenness is what makes it a city.
 */
function glow(accent: string): CanvasTexture {
  const cached = glowTextures.get(accent);
  if (cached) return cached;
  const { c, ctx } = canvas(CELL_PX * CELLS);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, c.width, c.height);
  const rand = seeded(hashString(accent));
  const own = new Color(accent).lerp(WHITE, 0.25);
  const warm = new Color('#ffd49a');
  const pane = new Color();
  for (let y = 0; y < CELLS; y += 1) {
    for (let x = 0; x < CELLS; x += 1) {
      const r = rand();
      if (r < 0.2) pane.copy(own).multiplyScalar(0.1);
      else if (r < 0.35) pane.copy(warm).multiplyScalar(0.7 + rand() * 0.3);
      else pane.copy(own).multiplyScalar(0.45 + rand() * 0.55);
      ctx.fillStyle = pane.getStyle();
      ctx.fillRect(x * CELL_PX + 7, y * CELL_PX + 8, 18, 16);
    }
  }
  const t = finish(c);
  glowTextures.set(accent, t);
  return t;
}

/** A building's two textures, shifted by whole windows so neighbours differ. */
export function facadeTextures(accent: string, seed: number): { map: CanvasTexture; emissiveMap: CanvasTexture } {
  const rand = seeded(seed);
  const dx = Math.floor(rand() * CELLS) / CELLS;
  const dy = Math.floor(rand() * CELLS) / CELLS;
  const place = (source: CanvasTexture) => {
    const t = source.clone();
    t.repeat.set(1 / CELLS, 1 / CELLS);
    t.offset.set(dx, dy);
    t.needsUpdate = true;
    return t;
  };
  return { map: place(wall()), emissiveMap: place(glow(accent)) };
}

/** A building's geometry, and how many of its last indices draw the roof. */
export interface Shell {
  geometry: BufferGeometry;
  roofIndices: number;
}

/**
 * A unit block (scale it to size) whose walls show `cellsW` by `cellsY`
 * windows on the front and back and `cellsD` on the sides, all the same size.
 * The roof and floor are plain. The roof's triangles come last, so the
 * building can be drawn without them (see `setRoofOpen`).
 */
export function blockShell(cellsW: number, cellsD: number, cellsY: number): Shell {
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const uv = geometry.getAttribute('uv');
  // Faces come as +x, -x, +y, -y, +z, -z, four vertices each.
  for (let face = 0; face < 6; face += 1) {
    for (let i = 0; i < 4; i += 1) {
      const k = face * 4 + i;
      if (face === 2 || face === 3) uv.setXY(k, 0, 0);
      else uv.setXY(k, uv.getX(k) * (face < 2 ? cellsD : cellsW), uv.getY(k) * cellsY);
    }
  }
  const index = Array.from(geometry.index!.array);
  geometry.setIndex([...index.slice(0, 12), ...index.slice(18), ...index.slice(12, 18)]);
  geometry.clearGroups();
  return { geometry, roofIndices: 6 };
}

/** The same for a round silo. */
export function towerShell(cellsAround: number, cellsY: number, segments = 20): Shell {
  const geometry = new CylinderGeometry(0.5, 0.5, 1, segments).translate(0, 0.5, 0);
  const uv = geometry.getAttribute('uv');
  const side = (segments + 1) * 2;
  for (let k = 0; k < uv.count; k += 1) {
    if (k < side) uv.setXY(k, uv.getX(k) * cellsAround, uv.getY(k) * cellsY);
    else uv.setXY(k, 0, 0);
  }
  // Indices come as wall, top cap, bottom cap.
  const index = Array.from(geometry.index!.array);
  const wallCount = segments * 6;
  const cap = segments * 3;
  geometry.setIndex([...index.slice(0, wallCount), ...index.slice(wallCount + cap), ...index.slice(wallCount, wallCount + cap)]);
  geometry.clearGroups();
  return { geometry, roofIndices: cap };
}

/** Draws a building with or without its roof. */
export function setRoofOpen(shell: Shell, open: boolean): void {
  shell.geometry.setDrawRange(0, open ? shell.geometry.index!.count - shell.roofIndices : Infinity);
}

/**
 * Pointer rays always meet the whole building, roof included, even while the
 * roof is not drawn: otherwise a pinch aimed into an open building would fall
 * through to the ground under it.
 */
export function keepWholeForRays(mesh: Mesh): void {
  const base = mesh.raycast;
  mesh.raycast = function raycastWhole(raycaster, hits) {
    const range = this.geometry.drawRange;
    const count = range.count;
    range.count = Infinity;
    base.call(this, raycaster, hits);
    range.count = count;
  };
}

function paint(geometry: BufferGeometry, color: Color): void {
  const n = geometry.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
}

/** Gives a geometry one flat colour, for meshes merged under a vertex-colour material. */
export function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
  paint(geometry, color);
  return geometry;
}

/**
 * Thin glowing bars: the neon edges of every building and plinth, collected
 * and then merged into a single mesh.
 */
export class BeamBatch {
  private parts: Mesh[] = [];

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color): void {
    const geometry = new BoxGeometry(sx, sy, sz);
    paint(geometry, color);
    const mesh = new Mesh(geometry);
    mesh.position.set(x, y, z);
    this.parts.push(mesh);
  }

  /** A flat ring (an ellipse when `w` and `d` differ), for round roofs. */
  ring(x: number, y: number, z: number, w: number, d: number, thickness: number, color: Color): void {
    const geometry = new TorusGeometry(0.5, thickness / (w + d), 6, 28);
    paint(geometry, color);
    const mesh = new Mesh(geometry);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.set(w, d, (w + d) / 2);
    mesh.position.set(x, y, z);
    this.parts.push(mesh);
  }

  /** The top edges of a footprint, and its four corners down to `base` when `walls` is set. */
  outline(rect: Rect, base: number, top: number, thickness: number, color: Color, walls: boolean): void {
    const { x, z, w, d } = rect;
    const t = thickness;
    this.box(x + w / 2, top, z, w + t, t, t, color);
    this.box(x + w / 2, top, z + d, w + t, t, t, color);
    this.box(x, top, z + d / 2, t, t, d + t, color);
    this.box(x + w, top, z + d / 2, t, t, d + t, color);
    if (!walls) return;
    const h = top - base;
    for (const cx of [x, x + w]) for (const cz of [z, z + d]) this.box(cx, base + h / 2, cz, t, h, t, color);
  }

  build(): Mesh | null {
    const geometry = mergeGeometries(this.parts);
    for (const p of this.parts) p.geometry.dispose();
    this.parts = [];
    if (!geometry) return null;
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
    mesh.name = 'neon';
    return ignoreRays(mesh);
  }
}

export interface Pool {
  rect: Rect;
  y: number;
  /** The light may not spill past this (the plinth or board it lies on). */
  clip: Rect;
  color: Color;
}

/**
 * Light pooling on the ground around each building: a soft border in the
 * building's colour, brightest at the wall and gone a little way out. All
 * pools are one mesh.
 */
export function buildPools(pools: Pool[]): Mesh | null {
  if (pools.length === 0) return null;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  for (const p of pools) {
    const { x, z, w, d } = p.rect;
    const m = Math.min(0.02, Math.max(0.006, Math.min(w, d) * 0.5));
    const clampX = (v: number) => Math.min(p.clip.x + p.clip.w, Math.max(p.clip.x, v));
    const clampZ = (v: number) => Math.min(p.clip.z + p.clip.d, Math.max(p.clip.z, v));
    // A 4x4 grid of points: the footprint in the middle, the spill around it.
    const xs = [clampX(x - m), x, x + w, clampX(x + w + m)];
    const zs = [clampZ(z - m), z, z + d, clampZ(z + d + m)];
    const first = positions.length / 3;
    for (let j = 0; j < 4; j += 1) {
      for (let i = 0; i < 4; i += 1) {
        positions.push(xs[i], p.y, zs[j]);
        const lit = i > 0 && i < 3 && j > 0 && j < 3;
        colors.push(lit ? p.color.r : 0, lit ? p.color.g : 0, lit ? p.color.b : 0);
      }
    }
    for (let j = 0; j < 3; j += 1) {
      for (let i = 0; i < 3; i += 1) {
        if (i === 1 && j === 1) continue; // under the building
        const a = first + j * 4 + i;
        index.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(index);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  mesh.name = 'pools';
  mesh.renderOrder = 1;
  return ignoreRays(mesh);
}

/**
 * The tray's floor: a dark circuit board, with traces that carry a little
 * light. Tiles without a seam, since no trace reaches the edge.
 */
export function circuitTexture(): CanvasTexture {
  const size = 512;
  const step = 16;
  const { c, ctx } = canvas(size);
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#0e141c';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += step * 2) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }
  const rand = seeded(20261118);
  const cellsAcross = size / step - 2;
  const at = (n: number) => (1 + n) * step;
  for (let i = 0; i < 46; i += 1) {
    const bright = rand() < 0.22;
    const color = bright ? (rand() < 0.3 ? '#a8642a' : '#2a8fb0') : '#143242';
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = bright ? 2.5 : 2;
    let x = Math.floor(rand() * cellsAcross);
    let y = Math.floor(rand() * cellsAcross);
    ctx.beginPath();
    ctx.moveTo(at(x), at(y));
    const startX = x;
    const startY = y;
    let horizontal = rand() < 0.5;
    for (let leg = 0; leg < 3; leg += 1) {
      const run = Math.round((rand() - 0.5) * 14);
      if (horizontal) x = Math.min(cellsAcross - 1, Math.max(0, x + run));
      else y = Math.min(cellsAcross - 1, Math.max(0, y + run));
      ctx.lineTo(at(x), at(y));
      horizontal = !horizontal;
    }
    ctx.stroke();
    for (const [px, py] of [[startX, startY], [x, y]]) {
      ctx.beginPath();
      ctx.arc(at(px), at(py), bright ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return finish(c);
}

/** A soft-edged dark patch: the tray's shadow on a real table, in mixed reality. */
export function shadowTexture(): CanvasTexture {
  const { c, ctx } = canvas(128);
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#000000';
  ctx.fillRect(14, 14, 100, 100);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A warm glow that fades toward the ceiling, for the inside walls of an open building. */
export function interiorTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#8a5a36');
  g.addColorStop(0.55, '#e0a060');
  g.addColorStop(1, '#ffe2b0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
