import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { KIND_COLORS } from './colors.js';
import type { District } from './layout.js';
import { ignoreRays } from './rays.js';
import { mergeStatic } from './rooms/merge.js';

/**
 * A rooftop feature per kind of part, so the city reads at a glance: a
 * glowing billboard on screens, an antenna on services, chimneys on
 * background jobs, a dome on libraries, a pitched roof on features, a cog on
 * config, a flask on tests, a water tank on infrastructure. (Data stores are
 * round silos; see diorama.ts.)
 *
 * Everything is merged into one mesh per material, so a whole city of
 * rooftops costs a handful of draw calls. Rooftops never take rays: pinching
 * one selects the building under it.
 */
export function buildRooftops(districts: Iterable<District>): Group {
  const group = new Group();
  group.name = 'rooftops';
  const trim = new MeshStandardMaterial({ color: '#d7dde6', roughness: 0.5, metalness: 0.2 });
  const door = new MeshStandardMaterial({ color: '#ffe2a8', emissive: new Color('#ffd27a'), emissiveIntensity: 1.1 });
  const glows = new Map<string, MeshStandardMaterial>();
  const glow = (kind: string): MeshStandardMaterial => {
    let m = glows.get(kind);
    if (!m) {
      const c = new Color(KIND_COLORS[kind as keyof typeof KIND_COLORS] ?? '#ffffff');
      m = new MeshStandardMaterial({ color: c.clone().multiplyScalar(0.8), emissive: c, emissiveIntensity: 0.45, roughness: 0.6 });
      glows.set(kind, m);
    }
    return m;
  };

  for (const d of districts) {
    if (!d.isLeaf) continue;
    const { w, d: depth } = d.rect;
    const s = Math.min(w, depth);
    const x = d.rect.x + w / 2;
    const z = d.rect.z + depth / 2;
    const top = d.base + d.height;
    const add = (mesh: Mesh, px: number, py: number, pz: number) => {
      mesh.position.set(px, py, pz);
      group.add(mesh);
      return mesh;
    };
    // A lit door in the front wall: in street view, where you stand to go in.
    const doorH = Math.min(0.014, d.height * 0.8);
    add(new Mesh(new BoxGeometry(Math.min(0.008, w * 0.5), doorH, 0.0008), door), x, d.base + doorH / 2, d.rect.z + depth + 0.0002);
    switch (d.kind) {
      case 'ui': {
        // A billboard screen standing on the roof, facing the viewer (+Z).
        add(new Mesh(new BoxGeometry(w * 0.7, s * 0.35, 0.002), glow('ui')), x, top + s * 0.2, z);
        add(new Mesh(new BoxGeometry(0.002, s * 0.08, 0.002), trim), x - w * 0.25, top + s * 0.02, z);
        add(new Mesh(new BoxGeometry(0.002, s * 0.08, 0.002), trim), x + w * 0.25, top + s * 0.02, z);
        break;
      }
      case 'service': {
        // A radio mast with a light on top.
        add(new Mesh(new CylinderGeometry(0.0012, 0.002, s * 0.7, 6), trim), x, top + s * 0.35, z);
        add(new Mesh(new SphereGeometry(Math.max(0.002, s * 0.06), 8, 6), glow('service')), x, top + s * 0.72, z);
        break;
      }
      case 'worker': {
        // Two chimneys, a factory roofline.
        const h = s * 0.45;
        add(new Mesh(new CylinderGeometry(s * 0.07, s * 0.09, h, 8), trim), x - w * 0.22, top + h / 2, z - depth * 0.15);
        add(new Mesh(new CylinderGeometry(s * 0.06, s * 0.08, h * 0.75, 8), trim), x + w * 0.05, top + h * 0.375, z - depth * 0.15);
        break;
      }
      case 'library': {
        const dome = new Mesh(new SphereGeometry(s * 0.38, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim);
        add(dome, x, top, z);
        break;
      }
      case 'feature': {
        // A pitched roof over the whole footprint.
        const roof = new Mesh(new ConeGeometry(0.5, 1, 4, 1), glow('feature'));
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(w * 1.02, s * 0.3, depth * 1.02);
        add(roof, x, top + s * 0.15, z);
        break;
      }
      case 'config': {
        const cog = new Mesh(new TorusGeometry(s * 0.22, s * 0.07, 6, 8), trim);
        cog.rotation.x = Math.PI / 2;
        add(cog, x, top + s * 0.07, z);
        break;
      }
      case 'test': {
        // A flask: a cone with a neck.
        add(new Mesh(new ConeGeometry(s * 0.22, s * 0.35, 10), glow('test')), x, top + s * 0.175, z);
        add(new Mesh(new CylinderGeometry(s * 0.06, s * 0.06, s * 0.15, 8), trim), x, top + s * 0.42, z);
        break;
      }
      case 'infra': {
        // A water tank on short legs.
        add(new Mesh(new CylinderGeometry(s * 0.2, s * 0.2, s * 0.25, 12), trim), x, top + s * 0.25, z);
        add(new Mesh(new ConeGeometry(s * 0.22, s * 0.1, 12), trim), x, top + s * 0.42, z);
        break;
      }
      case 'script': {
        // A small stepped block, like a rooftop machine room.
        add(new Mesh(new BoxGeometry(w * 0.4, s * 0.15, depth * 0.4), trim), x, top + s * 0.075, z);
        break;
      }
      default:
        break;
    }
  }
  mergeStatic(group);
  return ignoreRays(group);
}
