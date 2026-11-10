import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { ignoreRays } from '../rays.js';

/**
 * A speech bubble on a canvas texture. `setText` redraws it; the plane keeps
 * a fixed width and grows in height with the number of wrapped lines.
 */
export class Bubble {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private texture: CanvasTexture;
  private material: MeshBasicMaterial;
  private text = '';

  constructor(
    private widthMeters: number,
    private accent: string,
    private maxLines = 6,
  ) {
    this.canvas.width = 640;
    this.canvas.height = 256;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    // Bubbles hang over workers (who are pointable); they must not catch rays.
    this.mesh = ignoreRays(new Mesh(new PlaneGeometry(1, 1), this.material));
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  setText(text: string, title?: string): void {
    const key = `${title ?? ''}|${text}`;
    if (key === this.text) return;
    this.text = key;
    if (!text) {
      this.mesh.visible = false;
      return;
    }
    const w = this.canvas.width;
    const ctx = this.canvas.getContext('2d')!;
    const font = '500 34px Inter, "Segoe UI", system-ui, sans-serif';
    const titleFont = '700 26px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.font = font;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - 64 && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, this.maxLines);
    const top = title ? 70 : 32;
    const h = top + shown.length * 44 + 30;
    const resized = this.canvas.height !== h;
    if (resized) this.canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(13, 17, 23, 0.92)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 28);
    ctx.fill();
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textBaseline = 'top';
    if (title) {
      ctx.font = titleFont;
      ctx.fillStyle = this.accent;
      ctx.fillText(title.toUpperCase(), 32, 30);
    }
    ctx.font = font;
    ctx.fillStyle = '#f0f3f6';
    shown.forEach((l, i) => ctx.fillText(l, 32, top + i * 44));
    // A new canvas size needs a new GPU texture; the same size is just re-uploaded
    // (text types out a few characters at a time, so this runs many times a line).
    if (resized) this.texture.dispose();
    this.texture.needsUpdate = true;
    this.mesh.scale.set(this.widthMeters, (this.widthMeters * h) / w, 1);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
