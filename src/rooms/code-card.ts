import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { ignoreRays } from '../rays.js';
import type { TokenKind } from './code-syntax.js';
import type { CodeRow } from './code-unit.js';

/**
 * A card of code: what a robot holds up when asked to show a function, a
 * class or a line. Drawn once on a canvas, like a speech bubble, in an
 * editor's colours: line numbers down the side, each kind of word in its own
 * colour, the line being talked about lit, folded blocks as a dim line.
 *
 * Every character is the same width, so the card is sized from its text: a
 * character always looks the same size to the visitor, and a card of short
 * lines is a narrow card.
 */

export interface CodeView {
  /** The small line above the title: the file's plain name and its language. */
  eyebrow: string;
  /** What is shown: "runBilling()", "class Bubble", or the file's own name. */
  title: string;
  /** Where it is: the path and the lines. */
  where: string;
  rows: CodeRow[];
  /** The widest row, in characters. */
  cols: number;
  /** The file, the last of its lines on the card, and whether the card holds less than the whole unit. */
  path: string;
  shownTo: number;
  more: boolean;
}

/** The colours of a dark editor theme, one per kind of token. */
const COLOURS: Record<TokenKind, string> = {
  plain: '#e6edf3',
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#8b949e',
  function: '#d2a8ff',
  type: '#ffa657',
  key: '#7ee787',
  punct: '#b6c2cf',
  meta: '#ffa657',
};
const DIM = '#6e7681';

const MONO = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", "Roboto Mono", "Droid Sans Mono", monospace';
const SANS = 'Inter, "Segoe UI", system-ui, sans-serif';
/** Sizes on the canvas, in pixels. */
const CODE_PX = 28;
const ROW = 34;
const PAD = 30;
const WELL_SIDE = 16;
const WELL_PAD = 14;
/** A card never narrower than this many characters, so its heading has room. */
const MIN_COLS = 38;
/** Writing the headset may have no font for (Chinese, Japanese, Korean), shown as an ellipsis. */
const NO_FONT = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]+/g;
/** How long the card takes to pop up, in seconds. */
const POP_SECONDS = 0.22;

export class CodeCard {
  readonly mesh: Mesh;
  /** The card's size once it has popped up, in metres. */
  readonly width: number;
  readonly height: number;
  private texture: CanvasTexture;
  private material: MeshBasicMaterial;
  private age = 0;

  /** `charWidth` is how wide one character of code is, in metres. */
  constructor(view: CodeView, accent: string, charWidth: number) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const code = `500 ${CODE_PX}px ${MONO}`;
    ctx.font = code;
    const cell = ctx.measureText('0').width;
    const cols = Math.max(view.cols, MIN_COLS);
    const digits = Math.max(3, ...view.rows.map((r) => String(r.no ?? '').length));
    const gutter = (digits + 2) * cell;
    const codeLeft = WELL_SIDE + WELL_PAD + gutter;
    const headTop = PAD;
    const wellTop = headTop + 110;
    const wellHeight = view.rows.length * ROW + WELL_PAD * 2;
    canvas.width = Math.ceil(codeLeft + cols * cell + WELL_PAD + WELL_SIDE);
    canvas.height = Math.ceil(wellTop + wellHeight + PAD - 8);
    const w = canvas.width;
    const h = canvas.height;

    // The card.
    ctx.fillStyle = 'rgba(13, 17, 23, 0.97)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 26);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.stroke();

    // The heading: what this is, in words; then its name; then where it lives.
    const clip = (text: string, room: number): string => {
      let out = text;
      while (out.length > 4 && ctx.measureText(out).width > room) out = `${out.slice(0, -2)}…`;
      return out;
    };
    ctx.textBaseline = 'top';
    ctx.font = `700 22px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText(clip(view.eyebrow.toUpperCase(), w - PAD * 2), PAD, headTop);
    ctx.font = `600 36px ${MONO}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(clip(view.title, w - PAD * 2), PAD, headTop + 27);
    ctx.font = `500 22px ${SANS}`;
    ctx.fillStyle = '#9aa4af';
    ctx.fillText(clip(view.where, w - PAD * 2), PAD, headTop + 72);

    // The code, in a darker well.
    ctx.fillStyle = '#05080c';
    ctx.beginPath();
    ctx.roundRect(WELL_SIDE, wellTop, w - WELL_SIDE * 2, wellHeight, 14);
    ctx.fill();
    ctx.textBaseline = 'middle';
    view.rows.forEach((row, i) => {
      const top = wellTop + WELL_PAD + i * ROW;
      const y = top + ROW / 2 + 1;
      if (row.marked) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.24;
        ctx.fillRect(WELL_SIDE, top, w - WELL_SIDE * 2, ROW);
        ctx.globalAlpha = 1;
      }
      ctx.font = code;
      if (row.no !== null) {
        ctx.fillStyle = row.marked ? accent : DIM;
        ctx.textAlign = 'right';
        ctx.fillText(String(row.no), codeLeft - cell * 1.5, y);
        ctx.textAlign = 'left';
      }
      // Each token starts on its column, so the code lines up whatever the font's quirks.
      let col = 0;
      for (const token of row.tokens) {
        const text = token.text.replace(NO_FONT, '…');
        if (text.trim()) {
          ctx.font = row.kind === 'fold' ? `italic 500 ${CODE_PX}px ${MONO}` : code;
          ctx.fillStyle = row.kind === 'fold' ? DIM : COLOURS[token.kind];
          ctx.fillText(text, codeLeft + col * cell, y);
        }
        col += text.length;
      }
    });

    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    // Like a speech bubble, a card takes no rays: it hangs in front of things that do.
    this.mesh = ignoreRays(new Mesh(new PlaneGeometry(1, 1), this.material));
    this.mesh.renderOrder = 22;
    const metres = charWidth / cell;
    this.width = w * metres;
    this.height = h * metres;
    this.mesh.scale.set(this.width, this.height, 1);
  }

  /** Call every frame: the card pops up over a moment instead of blinking in. */
  grow(delta: number): void {
    if (this.age >= 1) return;
    this.age = Math.min(1, this.age + delta / POP_SECONDS);
    const eased = 1 - (1 - this.age) ** 3;
    const size = 0.84 + 0.16 * eased;
    this.mesh.scale.set(this.width * size, this.height * size, 1);
    this.material.opacity = Math.min(1, this.age * 2.5);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
