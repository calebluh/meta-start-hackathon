import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { ignoreRays } from '../rays.js';
import type { HealthIssue } from '../maps/types.js';

/** Lines of code under a card's text: `mark` is the index of the flagged line, -1 for none. */
export interface CodeBlock {
  lines: string[];
  numbers: string[];
  mark: number;
}

const CODE_FONT = '500 22px "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Roboto Mono", monospace';
const CODE_LINE = 30;
/** Room for the line numbers, in canvas pixels. */
const CODE_GUTTER = 64;
/** Code lines shown on a card, centred on the flagged one. */
const CODE_LINES = 9;
/** Writing the headset may have no font for (Chinese, Japanese, Korean), shown as an ellipsis. */
const NO_FONT = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]+/g;

/**
 * A warning's excerpt from the map ("  41 code", flagged line ">43 code") as
 * a card's code block: a window centred on the flagged line, the shared
 * indent taken off, writing without a font replaced.
 */
export function codeBlock(excerpt: string): CodeBlock | undefined {
  const rows = excerpt
    .split('\n')
    .map((l) => /^([ >])\s*(\d+) ?(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  const at = rows.findIndex((m) => m[1] === '>');
  if (at < 0) return undefined;
  const from = Math.max(0, Math.min(at - Math.floor(CODE_LINES / 2), rows.length - CODE_LINES));
  const window = rows.slice(from, from + CODE_LINES);
  const indent = Math.min(...window.filter((m) => m[3].trim()).map((m) => /^\s*/.exec(m[3])![0].length));
  return {
    lines: window.map((m) => m[3].slice(Number.isFinite(indent) ? indent : 0).replace(NO_FONT, '…')),
    numbers: window.map((m) => m[2]),
    mark: at - from,
  };
}

/**
 * Of a file's warnings, the one a robot's words are about: its line number
 * said ("line 499"), or else the most names from its flagged line said
 * ("parallel_profile_count"). The first when nothing matches.
 */
export function warningTalkedAbout(issues: HealthIssue[], said: string): HealthIssue | undefined {
  if (issues.length < 2) return issues[0];
  const words = new Set((said.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((x) => x.length > 3 || /^\d+$/.test(x)));
  let best = issues[0];
  let bestScore = 0;
  for (const issue of issues) {
    const line = issue.locations?.[0]?.line;
    const flagged = issue.excerpt?.split('\n').find((l) => l.startsWith('>')) ?? '';
    const names = (flagged.toLowerCase().replace(/^>\s*\d+/, '').match(/[a-z_][a-z0-9_]{3,}/g) ?? []).filter((n) => words.has(n));
    const score = (line && words.has(String(line)) ? 10 : 0) + names.length;
    if (score > bestScore) {
      bestScore = score;
      best = issue;
    }
  }
  return best;
}

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

  setText(text: string, title?: string, code?: CodeBlock): void {
    const key = `${title ?? ''}|${text}|${code?.lines.join('\n') ?? ''}`;
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
    const codeTop = top + shown.length * 44 + 14;
    const h = code ? codeTop + code.lines.length * CODE_LINE + 30 : top + shown.length * 44 + 30;
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
    if (code) this.drawCode(ctx, code, codeTop, w);
    // A new canvas size needs a new GPU texture; the same size is just re-uploaded
    // (text types out a few characters at a time, so this runs many times a line).
    if (resized) this.texture.dispose();
    this.texture.needsUpdate = true;
    this.mesh.scale.set(this.widthMeters, (this.widthMeters * h) / w, 1);
    this.mesh.visible = true;
  }

  /** Code lines as written (never wrapped): a dark well, line numbers, the flagged line lit in the accent colour. */
  private drawCode(ctx: CanvasRenderingContext2D, code: CodeBlock, top: number, w: number): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(20, top - 8, w - 40, code.lines.length * CODE_LINE + 12, 12);
    ctx.fill();
    ctx.font = CODE_FONT;
    const room = w - 64 - CODE_GUTTER;
    code.lines.forEach((line, i) => {
      const y = top + i * CODE_LINE;
      const marked = i === code.mark;
      if (marked) {
        ctx.fillStyle = this.accent;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(24, y - 3, w - 48, CODE_LINE);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = marked ? this.accent : '#7d8590';
      ctx.fillText(`${marked ? '>' : ' '}${code.numbers[i]}`, 28, y);
      ctx.fillStyle = marked ? '#ffffff' : '#c9d1d9';
      let text = line;
      if (ctx.measureText(text).width > room) {
        while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
        text += '…';
      }
      ctx.fillText(text, 32 + CODE_GUTTER, y);
    });
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
