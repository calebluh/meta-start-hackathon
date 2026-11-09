import {
  type AnimationAction,
  AnimationMixer,
  AssetManager,
  Box3,
  Color,
  Group,
  LoopOnce,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
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

export class RobotCharacter {
  /** Move and turn this; the model sits inside it, facing +Z. */
  readonly root = new Group();
  /** Carried items and packets go here; it sits in the right palm. */
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

  constructor(accent: string, shade = 0) {
    const gltf = AssetManager.getGLTF(ROBOT_ASSET);
    if (!gltf) throw new Error(`Model "${ROBOT_ASSET}" is not loaded`);
    const model = gltf.scene;
    this.root.add(model);

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
    const palm = model.getObjectByName('Palm2R') ?? model.getObjectByName('Palm2.R') ?? model.getObjectByName('HandR');
    (palm ?? this.root).add(this.hands);
    if (!palm) this.hands.position.set(0, 0.62, 0.3);

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
    if (palm) {
      // Undo the bone's inherited scale so items keep their real size.
      this.root.updateWorldMatrix(true, true);
      this.hands.scale.setScalar(1 / palm.getWorldScale(new Vector3()).x);
    }
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
      const mouth = mood === 'talking' ? 0.15 + 0.35 * Math.abs(Math.sin(t * 13)) : 0;
      if (this.mouthIndex >= 0) this.face.morphTargetInfluences[this.mouthIndex] = mouth;
      if (this.browIndex >= 0) this.face.morphTargetInfluences[this.browIndex] = mood === 'thinking' ? 0.35 : 0;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose();
  }
}
