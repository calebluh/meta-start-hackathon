import {
  type AnimationAction,
  AnimationMixer,
  AssetManager,
  type Bone,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LoopOnce,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from '@iwsdk/core';

/**
 * A worker character: the CC0 "RobotExpressive" model by Tomás Laulhé
 * (Quaternius), with Don McCurdy's facial morphs, from the three.js examples.
 * Tinted per room, scaled to about 1.15 m so it never looms over a seated
 * viewer, and animated with the model's own clips: Idle and Walking as base
 * loops, Wave / Yes / ThumbsUp / Punch as one-shot gestures, plus a little
 * procedural head motion and mouth movement while talking.
 */

export const ROBOT_ASSET = 'worker-robot';
const TARGET_HEIGHT = 1.15;
/** Walking clip covers roughly this many metres per second at timeScale 1. */
const CLIP_WALK_SPEED = 0.95;

export type Mood = 'idle' | 'talking' | 'thinking' | 'listening';
/** What the room asks for; mapped onto the robot's own clips. */
export type Gesture = 'Wave' | 'Yes' | 'No' | 'ThumbsUp' | 'Point' | 'Interact' | 'Throw';
const GESTURE_CLIPS: Record<Gesture, string | null> = {
  Wave: 'Wave',
  Yes: 'Yes',
  No: 'No',
  ThumbsUp: 'ThumbsUp',
  Point: 'Wave', // a wave toward the tube reads as "over there"
  Interact: 'Yes', // a nod over the workstation
  Throw: 'Punch', // the forward swing tosses the packet into the tube
};
const ONE_SHOTS = ['Wave', 'Yes', 'No', 'ThumbsUp', 'Punch'];

let modelScale: number | null = null;

/**
 * Merges the robot's body into one skinned mesh per material: 18 draw calls
 * down to about 6 (the animated face stays separate). The model's rest pose
 * becomes a fresh bind pose over all its bones. Skinned parts are baked at
 * that pose with their weights remapped; rigid parts hanging off a bone get
 * full weight on it. Animation drives the same bones, so it is unchanged.
 */
function mergeBody(model: Object3D): void {
  model.updateWorldMatrix(true, true);
  const bones: Bone[] = [];
  model.traverse((o) => {
    if ((o as Bone).isBone) bones.push(o as Bone);
  });
  if (bones.length === 0) return;
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const skeleton = new Skeleton(bones); // inverses from the current (rest) pose

  // Gather parts by material.
  const parts = new Map<Material, Mesh[]>();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length) return;
    let bone: Object3D | null = mesh.parent;
    while (bone && !(bone as Bone).isBone) bone = bone.parent;
    if (!(mesh as SkinnedMesh).isSkinnedMesh && !bone) return;
    const list = parts.get(mesh.material as Material) ?? [];
    list.push(mesh);
    parts.set(mesh.material as Material, list);
  });

  const v = new Vector3();
  for (const [material, meshes] of parts) {
    if (meshes.length < 2) continue;
    const count = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const indices: number[] = [];
    let base = 0;
    for (const m of meshes) {
      const g = m.geometry;
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      const skinned = (m as SkinnedMesh).isSkinnedMesh ? (m as SkinnedMesh) : null;
      skinned?.skeleton.update();
      let parentBone: Object3D | null = m.parent;
      while (parentBone && !(parentBone as Bone).isBone) parentBone = parentBone.parent;
      const rigidIndex = parentBone ? (boneIndex.get(parentBone as Bone) ?? 0) : 0;
      const srcIndex = g.getAttribute('skinIndex');
      const srcWeight = g.getAttribute('skinWeight');
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i);
        if (skinned) skinned.applyBoneTransform(i, v);
        v.applyMatrix4(m.matrixWorld);
        positions.set([v.x, v.y, v.z], (base + i) * 3);
        if (uv) uvs.set([uv.getX(i), uv.getY(i)], (base + i) * 2);
        if (skinned && srcIndex && srcWeight) {
          for (let k = 0; k < 4; k += 1) {
            const b = skinned.skeleton.bones[srcIndex.getComponent(i, k)];
            skinIndex[(base + i) * 4 + k] = b ? (boneIndex.get(b) ?? 0) : 0;
            skinWeight[(base + i) * 4 + k] = srcWeight.getComponent(i, k);
          }
        } else {
          skinIndex[(base + i) * 4] = rigidIndex;
          skinWeight[(base + i) * 4] = 1;
        }
      }
      if (g.index) for (let i = 0; i < g.index.count; i += 1) indices.push(g.index.getX(i) + base);
      else for (let i = 0; i < pos.count; i += 1) indices.push(i + base);
      base += pos.count;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `body:${material.name}`;
    mesh.frustumCulled = false;
    model.add(mesh);
    mesh.updateWorldMatrix(true, false);
    mesh.bind(skeleton, mesh.matrixWorld.clone());
    for (const m of meshes) m.removeFromParent();
  }
}

export class RobotCharacter {
  /** Move and turn this; the model sits inside it, facing +Z. */
  readonly root = new Group();
  /**
   * Carried items and packets go here: held in front of the chest, like a box
   * carried in both hands. (Pinned to the palm bone they swung below the hand
   * and into the legs, since that bone's axes point down the arm.)
   */
  readonly hands = new Object3D();
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private base = 'Idle';
  private gesturing = false;
  private head: Object3D | null = null;
  private face: Mesh | null = null;
  private mouthIndex = -1;
  private browIndex = -1;
  private materials: Material[] = [];
  private clock = Math.random() * 10;
  /** Loudness of the voice, 0-1, to open the mouth by; negative to animate it alone. */
  mouthLevel = -1;

  constructor(accent: string, shade = 0) {
    const gltf = AssetManager.getGLTF(ROBOT_ASSET);
    if (!gltf) throw new Error(`Model "${ROBOT_ASSET}" is not loaded`);
    const model = gltf.scene;
    this.root.add(model);
    mergeBody(model);

    // Each worker gets its own tint of the room colour on the robot's body.
    const tint = new Color(accent).offsetHSL(0, 0, shade);
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (material?.name === 'Main') {
        const own = material.clone();
        own.color.copy(tint);
        mesh.material = own;
        this.materials.push(own);
      }
      if (mesh.morphTargetDictionary && 'Surprised' in mesh.morphTargetDictionary) {
        this.face = mesh;
        this.mouthIndex = mesh.morphTargetDictionary.Surprised;
        this.browIndex = mesh.morphTargetDictionary.Sad ?? -1;
      }
    });
    this.head = model.getObjectByName('Head') ?? null;
    this.root.add(this.hands);
    this.hands.position.set(0, TARGET_HEIGHT * 0.5, 0.26);

    this.mixer = new AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOTS.includes(clip.name)) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    this.mixer.addEventListener('finished', () => {
      this.gesturing = false;
      this.fadeTo(this.base, 0.3);
    });
    this.fadeTo('Idle', 0);

    // Measure in the posed Idle frame from the skeleton: this skinned model's
    // bounding box reports its bind pose in unscaled armature units.
    this.mixer.update(Math.random() * 2);
    if (modelScale === null) {
      this.root.updateWorldMatrix(true, true);
      const top = model.getObjectByName('Head_end') ?? this.head;
      const headY = top ? top.getWorldPosition(new Vector3()).y : 0;
      const boxY = new Box3().setFromObject(model, true).getSize(new Vector3()).y;
      modelScale = TARGET_HEIGHT / Math.max(headY > 0 ? headY * 1.12 : boxY, 1e-3);
    }
    model.scale.setScalar(modelScale);
  }

  /** Plays a one-shot gesture, then returns to walking or idling. */
  gesture(name: Gesture): void {
    const clip = GESTURE_CLIPS[name];
    if (!clip || !this.actions.has(clip)) return;
    this.gesturing = true;
    this.fadeTo(clip, 0.2, true);
  }

  private fadeTo(name: string, seconds: number, restart = false): void {
    const next = this.actions.get(name);
    if (!next || (next === this.current && !restart)) return;
    if (restart) next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, seconds, false);
    this.current = next;
  }

  /**
   * Called every frame. `speed` is how fast the worker is moving (m/s) so the
   * walk cycle matches its feet to the floor.
   */
  update(delta: number, walking: boolean, speed: number, mood: Mood, _carrying = false): void {
    this.clock += delta;
    const base = walking ? 'Walking' : 'Idle';
    if (base !== this.base) {
      this.base = base;
      if (!this.gesturing || walking) {
        this.gesturing = false;
        this.fadeTo(base, 0.25);
      }
    }
    const walk = this.actions.get('Walking');
    if (walk) walk.timeScale = walking ? speed / CLIP_WALK_SPEED : 1;
    this.mixer.update(delta);

    // On top of the clips: head motion and face per mood.
    const t = this.clock;
    if (this.head && !walking) {
      if (mood === 'talking') this.head.rotation.x += Math.sin(t * 5.5) * 0.06;
      if (mood === 'thinking') {
        this.head.rotation.z += 0.28;
        this.head.rotation.x -= 0.12;
      }
      if (mood === 'listening') this.head.rotation.z -= 0.18;
    }
    if (this.face?.morphTargetInfluences) {
      const mouth =
        mood !== 'talking' ? 0 : this.mouthLevel >= 0 ? Math.min(0.75, this.mouthLevel) : 0.15 + 0.35 * Math.abs(Math.sin(t * 13));
      if (this.mouthIndex >= 0) this.face.morphTargetInfluences[this.mouthIndex] = mouth;
      if (this.browIndex >= 0) this.face.morphTargetInfluences[this.browIndex] = mood === 'thinking' ? 0.35 : 0;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose();
  }
}
