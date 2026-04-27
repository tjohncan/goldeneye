// core/camera.js — Camera class + lens-shape factories.
//
// A LensShape is a point cloud on the camera's optical surface, described in
// camera-local space with each point as a unit vector pointing outward from
// the focal center. The Camera composes a LensShape with a world position and
// orientation (a quaternion, so loop-de-loops work without gimbal lock),
// bakes the screen-to-lens weight table once at construction, and exposes
// per-frame rays() (for tracing) and blend() (for collapsing per-lens-point
// colors into per-screen-cell colors).
//
// Convention: Y-up, right-handed. Camera-local forward is -Z, so the
// hemisphere lens opens toward -Z.

import * as r3 from './r3.js';

/** @typedef {import('./r3.js').Vec3} Vec3 */
/** @typedef {import('./r3.js').Quat} Quat */
/** @typedef {{ points: Vec3[] }} LensShape */
/** @typedef {[number, number]} ScreenCell */
/** @typedef {Array<[number, number]>} CellWeights */

// Closeness function: score = (alpha - dist)^beta, where dist is Euclidean
// distance (in cell units) from the screen cell to a lens point's projection.
// Constants are aesthetic, not first-principles.
const NEIGHBORHOOD_RADIUS = 0.50001;
const CLOSENESS_ALPHA = Math.SQRT2 / 2;             // ≈ 0.707
const CLOSENESS_BETA  = (1 + Math.sqrt(5)) / 2;      // golden ratio ≈ 1.618

/**
 * Hemisphere lens-shape via spherical Fibonacci spiral. Points are unit
 * vectors distributed roughly uniformly across the hemisphere; the dome opens
 * toward -Z (camera-local forward).
 *
 * @param {{ points: number }} opts
 * @returns {LensShape}
 */
export const hemisphere = ({ points }) => {
  const out = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < points; i++) {
    const z = (i + 0.5) / points;                    // 0 to ~1; rim → apex
    const r = Math.sqrt(1 - z * z);
    const theta = goldenAngle * i;
    out.push([r * Math.cos(theta), r * Math.sin(theta), -z]);
  }
  return { points: out };
};

/**
 * Disk-projected lens. Like hemisphere() but the points are distributed
 * uniformly on the projected XY disk rather than uniformly on the hemisphere
 * surface. Trades some peripheral sampling density for much more even screen
 * coverage — eliminates the dark mid-radius holes from rim-clustering.
 *
 * @param {{ points: number }} opts
 * @returns {LensShape}
 */
export const disk = ({ points }) => {
  const out = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < points; i++) {
    const u = (i + 0.5) / points;                    // 0 to 1
    const r = Math.sqrt(u);                          // disk radius for uniform area
    const z = -Math.sqrt(1 - u);                     // hemisphere depth
    const theta = goldenAngle * i;
    out.push([r * Math.cos(theta), r * Math.sin(theta), z]);
  }
  return { points: out };
};

export class Camera {
  /**
   * @param {{ lens: LensShape, screenW: number, screenH: number }} opts
   */
  constructor({ lens, screenW, screenH }) {
    /** @type {Vec3[]} unit-length outward normals in camera-local space */
    this.lensPoints = lens.points;
    /** @type {number} */
    this.screenW = screenW;
    /** @type {number} */
    this.screenH = screenH;

    // Mutable per-frame state.
    /** @type {Vec3} world-space focal point */
    this.position = [0, 0, 0];
    /** @type {Quat} world-space orientation (identity = camera looks down -Z) */
    this.orientation = r3.quatId();

    /** @type {{ activeCells: ScreenCell[], weights: CellWeights[] }} baked once */
    this.screen = bakeScreen(this.lensPoints, screenW, screenH);

    // Pre-allocated per-cell color buffer ([r0, g0, b0, r1, g1, b1, ...]),
    // reused across blend() calls so the hot path doesn't allocate per frame.
    /** @type {Float32Array} */
    this._cellColors = new Float32Array(3 * this.screen.activeCells.length);

    // Pre-allocated per-frame ray-direction buffer. rays() rotates lens
    // points into this in place and returns it — owned by the Camera, reused
    // across frames (consume before the next rays() call).
    /** @type {Vec3[]} */
    this._directions = this.lensPoints.map(() => [0, 0, 0]);
  }

  /**
   * Apply a rotation in the camera's LOCAL frame (i.e., relative to current
   * orientation). For input deltas like "yaw left a bit" or "pitch up a bit"
   * — exactly what pointer controls produce. Renormalizes after composition
   * to prevent drift.
   *
   * @param {Quat} deltaQuat
   */
  rotateLocal(deltaQuat) {
    this.orientation = r3.quatNormalize(r3.quatMul(this.orientation, deltaQuat));
  }

  /**
   * Per-frame ray batch. Every ray shares the focal point as origin and a
   * direction equal to the lens normal rotated by the camera's orientation.
   * The directions array is owned by the Camera and reused across frames —
   * consume before the next rays() call.
   *
   * @returns {{ origin: Vec3, directions: Vec3[] }}
   */
  rays() {
    const [qw, qx, qy, qz] = this.orientation;
    const lens = this.lensPoints;
    const out  = this._directions;
    for (let i = 0; i < lens.length; i++) {
      const [vx, vy, vz] = lens[i];
      const tx = 2 * (qy * vz - qz * vy);
      const ty = 2 * (qz * vx - qx * vz);
      const tz = 2 * (qx * vy - qy * vx);
      const d = out[i];
      d[0] = vx + qw * tx + (qy * tz - qz * ty);
      d[1] = vy + qw * ty + (qz * tx - qx * tz);
      d[2] = vz + qw * tz + (qx * ty - qy * tx);
    }
    return { origin: this.position, directions: out };
  }

  /**
   * Collapse per-lens-point colors into per-active-screen-cell colors via the
   * baked weight table.
   *
   * @param {Float32Array} lensColors   flat per-lens-point [r0,g0,b0,r1,...]
   * @returns {{ cells: ScreenCell[], colors: Float32Array }}  colors is
   *          [r0,g0,b0,r1,g1,b1,...], one triple per active cell, aligned
   *          with `cells`. The buffer is owned by the Camera and reused
   *          across calls — consume before the next blend().
   */
  blend(lensColors) {
    const cells   = this.screen.activeCells;
    const weights = this.screen.weights;
    const colors  = this._cellColors;
    const cellsLen = cells.length;
    for (let ci = 0; ci < cellsLen; ci++) {
      const cellWeights = weights[ci];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < cellWeights.length; k++) {
        const pair = cellWeights[k];
        const li = pair[0] * 3;
        const w  = pair[1];
        r += lensColors[li]     * w;
        g += lensColors[li + 1] * w;
        b += lensColors[li + 2] * w;
      }
      const out = ci * 3;
      colors[out]     = r;
      colors[out + 1] = g;
      colors[out + 2] = b;
    }
    return { cells, colors };
  }
}

/**
 * Bake the screen-to-lens weight table.
 *
 * For each screen cell within the unit-disk FoV, find lens points whose
 * orthographic XY projection lands within a 1×1 box around the cell, and
 * assign each a weight via the (alpha - dist)^beta closeness function.
 *
 * Iterates a (W+1)×(H+1) grid — cells are indexed by integer corners, not
 * centers. Returns only cells with at least one lens neighbor; the rest
 * paint as background.
 *
 * @param {Vec3[]} lensPoints
 * @param {number} W
 * @param {number} H
 * @returns {{ activeCells: ScreenCell[], weights: CellWeights[] }}
 */
const bakeScreen = (lensPoints, W, H) => {
  const projected = lensPoints.map(([x, y]) => [
    ((x + 1) / 2) * W,
    ((1 - y) / 2) * H,
  ]);

  /** @type {ScreenCell[]} */
  const activeCells = [];
  /** @type {CellWeights[]} */
  const weights = [];

  for (let cy = 0; cy <= H; cy++) {
    for (let cx = 0; cx <= W; cx++) {
      const nx = (2 * cx - W) / W;
      const ny = (2 * cy - H) / H;
      if (nx * nx + ny * ny > 1) continue;

      /** @type {Array<[number, number]>} */
      const neighborhood = [];
      let total = 0;
      for (let i = 0; i < projected.length; i++) {
        const [px, py] = projected[i];
        const dx = Math.abs(cx - px);
        const dy = Math.abs(cy - py);
        if (dx > NEIGHBORHOOD_RADIUS || dy > NEIGHBORHOOD_RADIUS) continue;
        const t = CLOSENESS_ALPHA - Math.sqrt(dx * dx + dy * dy);
        if (t <= 0) continue;
        const score = Math.pow(t, CLOSENESS_BETA);
        total += score;
        neighborhood.push([i, score]);
      }

      if (total < 1e-5) continue;

      activeCells.push([cx, cy]);
      weights.push(neighborhood.map(([idx, score]) => [idx, score / total]));
    }
  }

  return { activeCells, weights };
};
