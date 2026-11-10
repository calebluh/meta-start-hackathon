import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  createSystem,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Points,
  PointsMaterial,
  BufferAttribute,
  BufferGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { KIND_COLORS } from './colors.js';
import type { GraphData } from './maps/types.js';
import { ignoreRays } from './rays.js';
import { app } from './state.js';

/**
 * The space around the desk, so the tabletop does not float in a void:
 * - a slow ripple of light across the floor, centred on the desk;
 * - a distant skyline of tall columns, one per biggest file in the codebase,
 *   its height from the file's size and its light strip from its part's kind;
 * - dust drifting in the air.
 * Plus a small pop when a panel's content changes or a panel appears.
 *
 * Everything is a handful of draw calls (instanced columns, one points
 * cloud, one shader disc) and it hides inside rooms, which have their own.
 */

const COLUMNS = 36;
const SKYLINE_RADIUS = 7.5;
const DUST = 360;
const POP_SECONDS = 0.32;

const RIPPLE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RIPPLE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;           // 0 at the desk, 1 at the rim
    float rings = smoothstep(0.92, 1.0, sin(r * 40.0 - uTime * 1.2) * 0.5 + 0.5);
    float wave = smoothstep(0.12, 0.0, abs(r - fract(uTime * 0.08)));  // a pulse rolling outward
    float fade = smoothstep(1.0, 0.25, r) * smoothstep(0.08, 0.2, r);
    float a = (rings * 0.10 + wave * 0.18) * fade;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

interface Pop {
  object: Object3D;
  base: number;
  t: number;
}

export class AtmosphereSystem extends createSystem({}) {
  private root = new Group();
  private ripple!: ShaderMaterial;
  private rippleMesh!: Mesh;
  private columns!: InstancedMesh;
  private strips!: InstancedMesh;
  private dust!: Points;
  private graph: GraphData | null = null;

  private pops: Pop[] = [];
  private lastSelected: string | null | undefined = undefined;
  private askWasVisible = false;

  private matrix = new Matrix4();
  private position = new Vector3();
  private scale = new Vector3();
  private color = new Color();
  private desk = new Vector3();

  init(): void {
    this.root.name = 'atmosphere';

    this.ripple = new ShaderMaterial({
      vertexShader: RIPPLE_VERTEX,
      fragmentShader: RIPPLE_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#5ad1ff') } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.rippleMesh = new Mesh(new CircleGeometry(4.5, 64), this.ripple);
    this.rippleMesh.rotation.x = -Math.PI / 2;
    this.rippleMesh.position.y = 0.003;
    this.root.add(this.rippleMesh);

    // The skyline: dark columns with a coloured light strip facing the desk.
    const columnGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.columns = new InstancedMesh(
      columnGeometry,
      new MeshStandardMaterial({ color: '#141821', roughness: 0.6, metalness: 0.3 }),
      COLUMNS,
    );
    this.strips = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
      COLUMNS,
    );
    this.root.add(this.columns, this.strips);

    // Dust: soft round motes, slowly turning around the desk.
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const g = dot.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const positions = new Float32Array(DUST * 3);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < DUST; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = 0.8 + rand() * 4.5;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = 0.2 + rand() * 3;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.dust = new Points(
      dustGeometry,
      new PointsMaterial({
        size: 0.018,
        map: new CanvasTexture(dot),
        color: '#9fd8ff',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.root.add(this.dust);

    ignoreRays(this.root);
    for (const m of [this.rippleMesh, this.columns, this.strips, this.dust]) m.frustumCulled = false;
    this.world.createTransformEntity(this.root, { persistent: true });
  }

  /** One column per biggest file: taller for more lines, lit in its part's colour. */
  private buildSkyline(graph: GraphData): void {
    const files = [...graph.files].sort((a, b) => b.loc - a.loc).slice(0, COLUMNS);
    const most = Math.max(1, files[0]?.loc ?? 1);
    const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
    for (let i = 0; i < COLUMNS; i += 1) {
      const file = files[i % Math.max(files.length, 1)];
      const share = file ? Math.sqrt(file.loc / most) : 0.3;
      const height = 1.2 + share * 4.2;
      // Spread around the circle, leaving a gap behind the viewer.
      const angle = Math.PI * 0.5 + ((i + 0.5) / COLUMNS - 0.5) * Math.PI * 1.6 + Math.sin(i * 7.3) * 0.04;
      const radius = SKYLINE_RADIUS + Math.sin(i * 3.1) * 1.2;
      const x = Math.cos(angle) * radius;
      const z = -Math.sin(angle) * radius;
      const width = 0.5 + (i % 3) * 0.2;
      this.matrix.makeRotationY(Math.atan2(x, z) + Math.PI);
      this.matrix.scale(this.scale.set(width, height, width));
      this.matrix.setPosition(x, 0, z);
      this.columns.setMatrixAt(i, this.matrix);

      // The strip sits on the face toward the desk.
      this.position.set(x, 0, z).multiplyScalar(1 - (width * 0.52) / radius);
      this.matrix.makeRotationY(Math.atan2(x, z) + Math.PI);
      this.matrix.scale(this.scale.set(0.05, height * 0.85, 0.02));
      this.matrix.setPosition(this.position.x, height * 0.06, this.position.z);
      this.strips.setMatrixAt(i, this.matrix);
      const kind = file ? kinds.get(file.n) : undefined;
      this.strips.setColorAt(i, this.color.set(kind ? KIND_COLORS[kind] : '#5ad1ff'));
    }
    this.columns.instanceMatrix.needsUpdate = true;
    this.strips.instanceMatrix.needsUpdate = true;
    if (this.strips.instanceColor) this.strips.instanceColor.needsUpdate = true;
  }

  private pop(object: Object3D | undefined): void {
    if (!object) return;
    const existing = this.pops.find((p) => p.object === object);
    if (existing) existing.t = 0;
    else this.pops.push({ object, base: object.scale.x, t: 0 });
  }

  update(delta: number, time: number): void {
    if (this.graph !== app.graph) {
      this.graph = app.graph;
      this.buildSkyline(app.graph);
    }
    this.root.visible = app.mode === 'table';

    if (this.root.visible) {
      this.ripple.uniforms.uTime.value = time;
      // The skyline and ripple stay centred on the desk, wherever it is.
      const workspace = this.world.getSceneObject('workspace');
      if (workspace) {
        workspace.getWorldPosition(this.desk);
        this.root.position.set(this.desk.x, 0, this.desk.z);
      }
      this.dust.rotation.y = time * 0.01;
      this.dust.position.y = Math.sin(time * 0.2) * 0.05;
    }

    // Panels pop a little when what they show changes.
    if (app.selected !== this.lastSelected) {
      if (this.lastSelected !== undefined) this.pop(this.world.getSceneObject('inspector-panel'));
      this.lastSelected = app.selected;
    }
    const ask = this.world.getSceneObject('ask-panel');
    if (ask && ask.visible !== this.askWasVisible) {
      this.askWasVisible = ask.visible;
      if (ask.visible) this.pop(ask);
    }
    for (let i = this.pops.length - 1; i >= 0; i -= 1) {
      const p = this.pops[i];
      p.t = Math.min(1, p.t + delta / POP_SECONDS);
      // Ease out with a slight overshoot: 0.9 -> 1.03 -> 1.
      const k = p.t - 1;
      const s = 1 + k * k * k * 0.1 + Math.sin(p.t * Math.PI) * 0.03;
      p.object.scale.setScalar(p.base * s);
      if (p.t >= 1) {
        p.object.scale.setScalar(p.base);
        this.pops.splice(i, 1);
      }
    }
  }
}

