import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { app } from './state.js';

const MOVE_SPEED = 0.9; // metres a second
const TURN_SPEED = 1.6; // radians a second, arrow keys
const DRAG_TURN = 0.004; // radians a pixel, right-mouse drag
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Walking and looking around in the flat desktop preview, game-style:
 * WASD to move, Q and E to go down and up, arrow keys or a right-mouse drag
 * to look, the mouse wheel to move forward and back. A left click still
 * picks buildings, robots and buttons. Nothing here runs in a headset.
 */
export class DesktopControlsSystem extends createSystem({}) {
  private held = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private forward = new Vector3();
  private right = new Vector3();
  private step = new Vector3();
  private aimed = false;

  init(): void {
    const canvas = this.world.renderer.domElement;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (!this.flat() || typing(e) || !MOVE_KEYS.has(e.code)) return;
      this.held.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    const blur = () => this.held.clear();
    const pointerDown = (e: PointerEvent) => {
      if (e.button !== 2 || !this.flat()) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const pointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.turn((e.clientX - this.lastX) * DRAG_TURN, (e.clientY - this.lastY) * DRAG_TURN);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const pointerUp = () => (this.dragging = false);
    const menu = (e: MouseEvent) => {
      if (this.flat()) e.preventDefault();
    };
    const wheel = (e: WheelEvent) => {
      if (!this.flat()) return;
      this.syncAim();
      this.flatForward();
      this.world.camera.position.addScaledVector(this.forward, -Math.sign(e.deltaY) * 0.12);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    canvas.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('contextmenu', menu);
    canvas.addEventListener('wheel', wheel, { passive: true });
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('contextmenu', menu);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  /** Only in the flat browser view, never in a headset. */
  private flat(): boolean {
    return this.world.visibilityState.peek() === VisibilityState.NonImmersive;
  }

  /** Starts from wherever the authored camera looks, the first time it moves. */
  private syncAim(): void {
    if (this.aimed) return;
    this.aimed = true;
    const camera = this.world.camera;
    camera.rotation.reorder('YXZ');
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;
  }

  private turn(dYaw: number, dPitch: number): void {
    this.syncAim();
    this.yaw -= dYaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dPitch));
    this.world.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private flatForward(): void {
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  update(delta: number): void {
    if (this.held.size === 0 || !this.flat()) return;
    const h = this.held;
    const turnX = (h.has('ArrowLeft') ? -1 : 0) + (h.has('ArrowRight') ? 1 : 0);
    const turnY = (h.has('ArrowUp') ? -1 : 0) + (h.has('ArrowDown') ? 1 : 0);
    if (turnX || turnY) this.turn(turnX * TURN_SPEED * delta, turnY * TURN_SPEED * delta);
    this.syncAim();
    this.flatForward();
    const ahead = (h.has('KeyW') ? 1 : 0) - (h.has('KeyS') ? 1 : 0);
    const side = (h.has('KeyD') ? 1 : 0) - (h.has('KeyA') ? 1 : 0);
    const lift = (h.has('KeyE') ? 1 : 0) - (h.has('KeyQ') ? 1 : 0);
    if (!ahead && !side && !lift) return;
    this.step.set(0, 0, 0).addScaledVector(this.forward, ahead).addScaledVector(this.right, side);
    if (this.step.lengthSq() > 0) this.step.normalize();
    this.step.y = lift;
    // Streets are life size: cover the ground faster there.
    this.world.camera.position.addScaledVector(this.step, MOVE_SPEED * (app.street ? 5 : 1) * delta);
  }
}
