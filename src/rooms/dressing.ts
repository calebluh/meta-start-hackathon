import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  type Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Palette, Theme } from './themes.js';
import { unitBox } from './themes.js';

/**
 * Set dressing shared by every room: ceiling and lights, floor markings that
 * suit the room's job, wall pilasters, swirling tube mouths and a light trail
 * behind moving packets. All primitives and canvas textures, no downloads.
 */

function box(parent: Group, material: MeshStandardMaterial | MeshBasicMaterial, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0): Mesh {
  const m = new Mesh(unitBox, material);
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = yaw;
  parent.add(m);
  return m;
}

export function addCeiling(group: Group, theme: Theme, palette: Palette, radius: number, height: number): void {
  const ceiling = new Mesh(
    new CircleGeometry(radius, 48),
    new MeshStandardMaterial({ color: new Color(theme.wall).multiplyScalar(0.8), roughness: 0.95 }),
  );
  ceiling.rotation.x = Math.PI / 2; // faces down
  ceiling.position.y = height;
  group.add(ceiling);
  // A ring of light panels, plus one over the stations.
  const light = new MeshBasicMaterial({ color: '#fff4e0' });
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    box(group, light, 0.9, 0.03, 0.35, Math.sin(a) * radius * 0.55, height - 0.04, -Math.cos(a) * radius * 0.55, -a);
  }
  box(group, palette.glow, 1.6, 0.03, 0.12, 0, height - 0.05, -radius * 0.62);
}

/** Wall pilasters every 30 degrees break up the curved wall. */
export function addPilasters(group: Group, theme: Theme, radius: number, height: number): void {
  const material = new MeshStandardMaterial({ color: new Color(theme.wall).multiplyScalar(0.7), roughness: 0.8 });
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    box(group, material, 0.3, height, 0.18, Math.sin(a) * (radius - 0.06), 0, -Math.cos(a) * (radius - 0.06), -a);
  }
}

/** Floor markings by room type: lanes, rugs or tiles. */
export function addFloorMarkings(group: Group, theme: Theme, palette: Palette): void {
  const lane = new MeshBasicMaterial({ color: '#d4a72c' });
  switch (theme.id) {
    case 'warehouse':
    case 'factory':
      // Painted forklift lanes with dashed edges.
      for (const x of [-1.25, 1.25]) {
        for (let i = 0; i < 8; i += 1) box(group, lane, 0.08, 0.004, 0.45, x, 0.003, -0.6 - i * 0.6);
      }
      for (const z of [-2.2, -4.0]) box(group, lane, 3.6, 0.004, 0.08, 0, 0.003, z);
      break;
    case 'lab':
    case 'controlroom':
    case 'postoffice':
    case 'utility': {
      // Tile grid.
      const grout = new MeshBasicMaterial({ color: new Color(theme.floor).multiplyScalar(0.6) });
      for (let i = -4; i <= 4; i += 1) {
        box(group, grout, 0.02, 0.003, 9, i * 1.0, 0.003, 0);
        box(group, grout, 9, 0.003, 0.02, 0, 0.003, i * 1.0);
      }
      break;
    }
    default: {
      // A rug in front of the stations, in a dark shade of the room colour.
      const rug = new Mesh(
        new CircleGeometry(2.4, 40, Math.PI * 0.15, Math.PI * 0.7),
        new MeshStandardMaterial({ color: new Color(theme.accent).multiplyScalar(0.28), roughness: 1 }),
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.004;
      group.add(rug);
      const edge = new Mesh(new CircleGeometry(2.45, 40, Math.PI * 0.15, Math.PI * 0.7), palette.accent);
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.003;
      group.add(edge);
    }
  }
}

const swirlTextures = new Map<string, CanvasTexture>();

/** A glowing spiral texture for tube mouths, one per colour. */
function swirlTexture(color: string): CanvasTexture {
  const cached = swirlTextures.get(color);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, '#05060a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  for (let arm = 0; arm < 4; arm += 1) {
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const r = t * size * 0.48;
      const a = arm * (Math.PI / 2) + t * Math.PI * 2.2;
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  swirlTextures.set(color, texture);
  return texture;
}

/** The inside of a tube mouth: a slowly turning spiral in the target room's colour. */
export function makeSwirl(color: string, radius: number): Mesh {
  return new Mesh(new CircleGeometry(radius, 32), new MeshBasicMaterial({ map: swirlTexture(color) }));
}

/** A short glowing trail that follows a moving packet. */
export class Trail {
  private dots: Mesh[] = [];
  private points: Vector3[] = [];
  private material: MeshBasicMaterial;
  private clock = 0;

  constructor(group: Group, color: string, count = 10) {
    this.material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const geometry = new SphereGeometry(0.05, 8, 6);
    for (let i = 0; i < count; i += 1) {
      const dot = new Mesh(geometry, this.material);
      dot.visible = false;
      group.add(dot);
      this.dots.push(dot);
      this.points.push(new Vector3());
    }
  }

  /** Call every frame with the packet's room-local position while it flies. */
  update(delta: number, position: Vector3 | null): void {
    this.clock += delta;
    if (position && this.clock > 0.035) {
      this.clock = 0;
      // Shift the history along and record the newest point.
      const last = this.points.pop()!;
      last.copy(position);
      this.points.unshift(last);
    }
    this.dots.forEach((dot, i) => {
      dot.visible = position !== null;
      dot.position.copy(this.points[i]);
      dot.scale.setScalar(1 - i / this.dots.length);
    });
  }

  reset(position: Vector3): void {
    for (const p of this.points) p.copy(position);
  }
}
