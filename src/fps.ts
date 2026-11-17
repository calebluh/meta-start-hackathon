import { createSystem } from '@iwsdk/core';
import { app } from './state.js';

/**
 * Development only: every five seconds the page reports its frame rate, and
 * where the visitor is, to the dev server (GET /api/fps lists the reports).
 * This measures a real headset over Wi-Fi, with no USB cable or debugger.
 */
const REPORT_SECONDS = 5;

export class FpsSystem extends createSystem({}) {
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  update(delta: number): void {
    this.frames += 1;
    this.elapsed += delta;
    if (delta > this.worst) this.worst = delta;
    if (this.elapsed < REPORT_SECONDS) return;
    const report = {
      fps: Math.round((this.frames / this.elapsed) * 10) / 10,
      worstMs: Math.round(this.worst * 1000),
      xr: this.world.renderer.xr.isPresenting,
      where: app.menu ? 'menu' : app.mode === 'room' ? `room ${app.roomNode}` : app.street ? 'street' : 'table',
      map: app.mapId,
      device: /Quest 3S/.test(navigator.userAgent) ? 'Quest 3S' : /Quest 3/.test(navigator.userAgent) ? 'Quest 3' : /Quest 2/.test(navigator.userAgent) ? 'Quest 2' : /Quest/.test(navigator.userAgent) ? 'Quest' : 'desktop',
    };
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    void fetch('/api/fps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
  }
}
