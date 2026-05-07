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
   *   host:    HTMLElement,
   *   screenW: number,
   *   screenH: number,
   *   cells:   ScreenCell[],   // active cells from camera.screen.activeCells
   *                            // — pinned at construction so the hot path
   *                            // can pre-resolve cell.style references.
   *                            // A Painter is therefore tied to one Camera
   *                            // (or one lens shape) for its lifetime;
   *                            // construct a new Painter for a new lens.
   *   shimmer?: number,        // per-cell per-frame RGB jitter strength (0..1, try 0.04)
   * }} opts
   */
  constructor({ host, screenW, screenH, cells, shimmer = 0 }) {
    ensureStyles();
    this.host = host;
    this.screenW = screenW;
    this.screenH = screenH;
    this.shimmer = shimmer;

    host.classList.add('goldeneye-grid');
    host.style.gridTemplateColumns = `repeat(${screenW + 1}, 1fr)`;
    host.style.gridTemplateRows = `repeat(${screenH + 1}, 1fr)`;
    host.replaceChildren();

    // Build the [cx][cy] grid as constructor-local scratch — used only to
    // resolve cell.style refs for the active cells, then discarded along
    // with the rest of the constructor frame.
    /** @type {HTMLDivElement[][]} */
    const grid = [];
    for (let cx = 0; cx <= screenW; cx++) grid[cx] = [];

    const frag = document.createDocumentFragment();
    for (let cy = 0; cy <= screenH; cy++) {
      for (let cx = 0; cx <= screenW; cx++) {
        const cell = document.createElement('div');
        cell.className = 'goldeneye-cell';
        cell.style.gridColumn = `${cx + 1}`;
        cell.style.gridRow = `${cy + 1}`;
        frag.appendChild(cell);
        grid[cx][cy] = cell;
      }
    }
    host.appendChild(frag);

    // Pre-resolve cell.style refs aligned with the active-cells array.
    // The hot paint loop reads `_styles[i].backgroundColor = ...` without
    // any indirection through the grid, and the grid itself goes out of
    // scope at constructor exit — only the active subset of div refs
    // (held by `_styles`) survives.
    /** @type {CSSStyleDeclaration[]} */
    this._styles = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      this._styles[i] = grid[cells[i][0]][cells[i][1]].style;
    }
  }

  /**
   * Paint the active cells with the given colors. Applies shimmer (per-frame
   * RGB jitter) if enabled. Inactive cells stay at their previous color
   * (typically transparent → grid background shows through).
   *
   * Only `colors` is read. The `cells` field of the signal is ignored —
   * the active-cells layout is fixed at construction.
   *
   * @param {{ colors: Float32Array }} signal  colors is a flat
   *        [r0,g0,b0,r1,g1,b1,...], one triple per active cell, aligned
   *        with the `cells` array passed to the Painter constructor.
   */
  paint({ colors }) {
    const sh = this.shimmer;
    const styles = this._styles;
    const cellsLen = styles.length;

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
