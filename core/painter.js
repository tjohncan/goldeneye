// core/painter.js — paint a screen signal onto a CSS-grid container.
//
// The Painter binds to a host DOM element (which it converts into a CSS grid
// of circular cells), and on each frame writes per-cell background colors
// from the screen signal produced by a Camera. An optional `shimmer` effect
// applies a per-cell per-frame random ±X% RGB jitter — twinkling water.

/** @typedef {[number, number]} ScreenCell */
/** @typedef {import('./r3.js').Vec3} Vec3 */

const STYLE_ID = 'goldeneye-painter-styles';
const STYLE = `
.goldeneye-grid {
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  gap: 0;
  background-color: #000;
}
.goldeneye-grid > .goldeneye-cell {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-color: transparent;
}
`;

const ensureStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
};

export class Painter {
  /**
   * @param {{
   *   host: HTMLElement,
   *   screenW: number,
   *   screenH: number,
   *   shimmer?: number,    // per-cell per-frame RGB jitter strength (0..1, try 0.04)
   * }} opts
   */
  constructor({ host, screenW, screenH, shimmer = 0 }) {
    ensureStyles();
    this.host = host;
    this.screenW = screenW;
    this.screenH = screenH;
    this.shimmer = shimmer;

    host.classList.add('goldeneye-grid');
    host.style.gridTemplateColumns = `repeat(${screenW + 1}, 1fr)`;
    host.style.gridTemplateRows = `repeat(${screenH + 1}, 1fr)`;
    host.replaceChildren();

    /** @type {HTMLDivElement[][]} indexed [cx][cy] */
    this.cells = [];
    for (let cx = 0; cx <= screenW; cx++) this.cells[cx] = [];

    const frag = document.createDocumentFragment();
    for (let cy = 0; cy <= screenH; cy++) {
      for (let cx = 0; cx <= screenW; cx++) {
        const cell = document.createElement('div');
        cell.className = 'goldeneye-cell';
        cell.style.gridColumn = `${cx + 1}`;
        cell.style.gridRow = `${cy + 1}`;
        frag.appendChild(cell);
        this.cells[cx][cy] = cell;
      }
    }
    host.appendChild(frag);

    // Cache of `cell.style` refs aligned with the activeCells array a
    // caller passes to paint() — built lazily on first paint, reused
    // every frame after. Lets the hot loop do `_styles[i].backgroundColor
    // = ...` instead of double-indirection through the [cx][cy] grid.
    /** @type {CSSStyleDeclaration[] | null} */
    this._styles = null;
    /** @type {ScreenCell[] | null} */
    this._stylesFor = null;
  }

  /**
   * Paint the active cells with the given colors. Applies shimmer (per-frame
   * RGB jitter) if enabled. Inactive cells stay at their previous color
   * (typically transparent → grid background shows through).
   *
   * @param {{ cells: ScreenCell[], colors: Float32Array }} signal  colors is
   *        a flat [r0,g0,b0,r1,g1,b1,...] aligned with `cells`.
   */
  paint({ cells, colors }) {
    if (this._stylesFor !== cells) {
      const cells2D = this.cells;
      const styles = new Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        styles[i] = cells2D[cells[i][0]][cells[i][1]].style;
      }
      this._styles = styles;
      this._stylesFor = cells;
    }

    const sh = this.shimmer;
    const styles = this._styles;
    const cellsLen = cells.length;

    for (let i = 0; i < cellsLen; i++) {
      const ci = i * 3;
      let r = colors[ci], g = colors[ci + 1], b = colors[ci + 2];

      if (sh > 0) {
        r *= 1 + (Math.random() - 0.5) * 2 * sh;
        g *= 1 + (Math.random() - 0.5) * 2 * sh;
        b *= 1 + (Math.random() - 0.5) * 2 * sh;
      }

      if (r > 255) r = 255; else if (r < 0) r = 0;
      if (g > 255) g = 255; else if (g < 0) g = 0;
      if (b > 255) b = 255; else if (b < 0) b = 0;

      styles[i].backgroundColor = `rgb(${r | 0},${g | 0},${b | 0})`;
    }
  }
}
