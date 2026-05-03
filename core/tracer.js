// core/tracer.js — lens ray batch + scene → per-lens-point shaded colors.
//
// Sphere-trace each ray through the scene's union SDF until either:
//   - it hits an opaque surface (returns the accumulated color), OR
//   - it accumulates enough translucent contributions that the remaining
//     alpha falls below ALPHA_STOP, OR
//   - it marches past MAX_DIST or runs out of MAX_STEPS (returns whatever
//     accumulated, mixed with background for the leftover alpha).
//
// At each hit: lambertian shading (color modulated by surface-normal · light)
// gets multiplied by the item's opacity and the ray's remaining alpha, then
// accumulated front-to-back. For translucent hits, the item is added to an
// `inside` list so subsequent SDF queries skip it — that's what lets the
// ray continue past the surface without immediately re-hitting it. Once the
// ray clears the item (its SDF goes positive again at the current position),
// the item is removed from the list.
//
// Two stacked filters reduce per-step item iteration:
//   1. Per-ray bounding-sphere filter (before marching): drop items whose
//      bounding sphere doesn't intersect the ray. Items without
//      `boundingRadius` always pass through.
//   2. Per-step region filter (during marching): if the scene supplies a
//      `regionFn(px, py, pz)`, look up the current point's region once per
//      step and skip items whose `regionKey` doesn't match. Items without
//      `regionKey` always pass through (they span regions, like the
//      enclosing room walls).
//
// Hot-loop allocations (output buffer, candidates list, inside list) are
// hoisted to module-level reusable typed arrays / arrays — zero per-frame
// allocations in the steady state.

import { sdfGrad } from './scene.js';

/** @typedef {import('./r3.js').Vec3} Vec3 */
/** @typedef {import('./scene.js').Scene} Scene */
/** @typedef {import('./scene.js').Item}  Item  */

/**
 * @typedef {{
 *   lightDir?:   Vec3,
 *   ambient?:    number,
 *   background?: Vec3,
 *   maxDist?:    number,
 * }} LightingPartial   per-region override; only set the fields you change
 */

/**
 * @typedef {{
 *   lightDir:   Vec3,    // unit vector from surface toward the light source
 *   ambient:    number,  // 0..1 baseline brightness for surfaces facing away
 *   background: Vec3,    // [r, g, b] 0..255 mixed in for unaccumulated alpha
 *   maxDist?:   number,  // optional override for the ray distance cap; defaults
 *                        // to the module-level MAX_DIST. Useful when a scene's
 *                        // largest dimension exceeds the default (e.g. a very
 *                        // large bounding shell that rays need to traverse).
 *   byRegion?:  Record<string, LightingPartial>,
 *                        // optional per-region overrides applied at two
 *                        // granularities: maxDist is per-trace, keyed by
 *                        // the ray origin's region (a ray-distance cap
 *                        // can't sensibly vary mid-march); lightDir +
 *                        // ambient are per-hit, keyed by the hit point's
 *                        // region (so shading tracks the surface's space,
 *                        // not the camera's, and stays continuous across
 *                        // region boundaries). Requires scene.regionFn;
 *                        // ignored otherwise. Keys without an entry fall
 *                        // through to the base lighting.
 * }} Lighting
 */

const MAX_STEPS    = 44;
const HIT_EPSILON  = 0.001;
const MAX_DIST     = 1000;      // default safety cap; per-call override via lighting.maxDist
const NORMAL_EPS   = 0.0015;
const STEP_PAST    = 0.003;     // small forward step after a translucent hit
const EXIT_EPS     = 0.001;     // SDF must exceed this to consider us "out"
const ALPHA_STOP   = 0.02;      // bail when remaining alpha drops below this

/** @type {Lighting} sun straight up, dim ambient, black miss-color. */
const DEFAULT_LIGHTING = {
  lightDir:   [0, 1, 0],
  ambient:    0.35,
  background: [0, 0, 0],
};

// ─────────────── module-level reusable buffers (no per-frame allocation) ───────────────

/** Output Float32Array, length 3 × max ever lens count. Lazily grown. */
let _outBuffer = null;

/** Per-trace pre-cull buffer. When `scene.visibleRegions` is supplied,
 *  trace() builds a smaller subset of items reachable from the camera's
 *  region into this array (items with regionKey in the camera region's
 *  visible set, plus items with no regionKey). The per-ray bounding-
 *  sphere loop then iterates this subset instead of the full scene.
 *  Reused across calls to avoid per-frame allocation. */
const _visibleItems = [];

/** Per-ray candidate list — items whose bounding sphere intersects the ray.
 *  Valid prefix length is passed into marchRay alongside the array. */
const _candidates = [];

/** Per-ray "inside" list — translucent items the ray is currently passing
 *  through. Length tracked separately as `_insideLen`. */
const _inside = [];
let _insideLen = 0;

/** Active region-mapping function for the current trace() call (or null if
 *  the scene didn't supply one). Set in trace(), consumed by marchRay(). */
let _regionFn = null;

/** Active ray distance cap for the current trace() call. Set from
 *  lighting.maxDist (with module-level MAX_DIST fallback) in trace(),
 *  consumed by marchRay(). */
let _maxDist = MAX_DIST;

/** Pre-merged per-region shading table for per-hit lookups. Each entry
 *  holds the shading-relevant fields (lx/ly/lz/ambient) of the merged
 *  base+override Lighting for that region. Built once per trace() and
 *  consulted at each hit in marchRay() so per-region lighting tracks
 *  the SURFACE being shaded (not the camera). Surfaces in regions
 *  without an override fall back to base shading; result is that
 *  shading stays continuous across region boundaries — no hard flip
 *  when the camera crosses from one region's "lit space" into
 *  another's. Null when lighting.byRegion or scene.regionFn is absent. */
let _byRegionShading = null;

/** Frame time in milliseconds, sampled once at the start of each trace().
 *  Time-varying SDFs and colorFns read this instead of calling Date.now() /
 *  performance.now() per query — a single ray traverses thousands of SDF
 *  evaluations, and they all want the same frame timestamp. Exported as a
 *  live binding so consumers `import { frameTime } from '../core/tracer.js'`
 *  and read the current value each call. */
export let frameTime = 0;


/**
 * March a single ray through a pre-filtered scene; write the front-to-back
 * composited color into `output[outIdx..outIdx+2]`. Single exit point so we
 * never allocate a Vec3 for the return.
 *
 * @param {number} ox @param {number} oy @param {number} oz  ray origin
 * @param {number} dx @param {number} dy @param {number} dz  unit-length direction
 * @param {Item[]} scene                  per-ray candidate items (already filtered;
 *                                        no `invisible` items, items with
 *                                        non-intersecting bounding spheres dropped)
 * @param {number} sceneLen               valid prefix length of `scene`
 * @param {number} lx @param {number} ly @param {number} lz  unit lightDir
 * @param {number} ambient
 * @param {number} bgR @param {number} bgG @param {number} bgB  background color
 * @param {Float32Array} output           output color buffer
 * @param {number} outIdx                 base index in `output` for this ray's [r, g, b]
 */
const marchRay = (ox, oy, oz, dx, dy, dz, scene, sceneLen,
                  lx, ly, lz, ambient, bgR, bgG, bgB,
                  output, outIdx) => {
  let t = 0;
  let accR = 0, accG = 0, accB = 0;
  let remaining = 1.0;
  _insideLen = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (remaining < ALPHA_STOP) break;

    const px = ox + t * dx;
    const py = oy + t * dy;
    const pz = oz + t * dz;

    // Un-mark items the ray has fully exited (their SDF here is back to
    // positive). Swap-remove to avoid splice's allocation.
    if (_insideLen > 0) {
      for (let i = _insideLen - 1; i >= 0; i--) {
        const item = _inside[i];
        const ip = item.position;
        const d = item.sdf(px - ip[0], py - ip[1], pz - ip[2]);
        if (d > EXIT_EPS) {
          _inside[i] = _inside[--_insideLen];
        }
      }
    }

    // Resolve the current point's region once for this step (if the scene
    // supplied a regionFn). Items with a regionKey that doesn't match are
    // skipped below; items without a regionKey are always considered.
    const region = _regionFn !== null ? _regionFn(px, py, pz) : null;

    // Find nearest non-inside surface among candidates.
    let nearestD = Infinity;
    let nearestItem = null;
    for (let i = 0; i < sceneLen; i++) {
      const item = scene[i];
      // Region filter. Single-key items mismatch out fast; array-keyed
      // items (registered to multiple regions) take an extra membership
      // check. Items with no regionKey always pass.
      const rk = item.regionKey;
      if (region !== null && rk != null && rk !== region) {
        if (!Array.isArray(rk) || rk.indexOf(region) < 0) continue;
      }
      // Manual scan of the (typically tiny) inside list — faster than
      // Array.prototype.includes and avoids its iterator allocation.
      let isInside = false;
      for (let k = 0; k < _insideLen; k++) {
        if (_inside[k] === item) { isInside = true; break; }
      }
      if (isInside) continue;
      const ip = item.position;
      const d = item.sdf(px - ip[0], py - ip[1], pz - ip[2]);
      if (d < nearestD) {
        nearestD = d;
        nearestItem = item;
      }
    }

    if (nearestD < HIT_EPSILON) {
      const ip = nearestItem.position;
      const lpx = px - ip[0], lpy = py - ip[1], lpz = pz - ip[2];
      const [gx, gy, gz] = sdfGrad(nearestItem.sdf, lpx, lpy, lpz, nearestD, NORMAL_EPS);
      const glen = Math.sqrt(gx * gx + gy * gy + gz * gz);

      // Per-hit shading: if the hit's region has a byRegion override,
      // use that region's lightDir/ambient. The surface picks up its
      // own region's shading regardless of where the camera is, so
      // shading stays continuous across boundaries — no hard flip when
      // the camera crosses into another region. Falls back to base
      // shading (passed through marchRay params) when the hit region
      // has no override or no key at all.
      let hLx = lx, hLy = ly, hLz = lz, hAmbient = ambient;
      if (_byRegionShading !== null && region !== null) {
        const r = _byRegionShading[region];
        if (r !== undefined) {
          hLx = r.lx; hLy = r.ly; hLz = r.lz; hAmbient = r.ambient;
        }
      }

      let brightness = hAmbient;
      if (glen > 1e-9) {
        const ndotl = (gx * hLx + gy * hLy + gz * hLz) / glen;
        if (ndotl > 0) brightness += (1 - hAmbient) * ndotl;
      }

      const c = nearestItem.colorFn
        ? nearestItem.colorFn(lpx, lpy, lpz)
        : nearestItem.color;
      const opacity = nearestItem.opacity ?? 1;
      const w = opacity * remaining;
      accR += c[0] * brightness * w;
      accG += c[1] * brightness * w;
      accB += c[2] * brightness * w;
      remaining *= 1 - opacity;

      if (opacity >= 1) {
        // Opaque — accumulated final color; remaining is irrelevant past
        // here, so the bg-mix at the bottom collapses to just (acc).
        output[outIdx]     = accR;
        output[outIdx + 1] = accG;
        output[outIdx + 2] = accB;
        return;
      }

      // Translucent — skip this item on subsequent steps until we've
      // marched out of it, and step forward a hair to clear its surface.
      _inside[_insideLen++] = nearestItem;
      t += STEP_PAST;
    } else {
      t += nearestD;
    }

    if (t > _maxDist) break;
  }

  // Background mix for unaccumulated alpha.
  output[outIdx]     = accR + bgR * remaining;
  output[outIdx + 1] = accG + bgG * remaining;
  output[outIdx + 2] = accB + bgB * remaining;
};


/**
 * Trace a full ray batch from a single origin through a Scene under the
 * given lighting. Returns a Float32Array of length 3 × directions.length —
 * `[r0, g0, b0, r1, g1, b1, ...]`. The buffer is module-level and reused
 * across calls; treat it as borrowed (consume before the next trace call).
 *
 * @param {{ origin: Vec3, directions: Vec3[] }} rays
 * @param {Scene} scene
 * @param {Lighting} [lighting]
 * @returns {Float32Array}  flat per-lens-point [r, g, b] triples
 */
export const trace = ({ origin, directions }, scene, lighting = DEFAULT_LIGHTING) => {
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const N = directions.length;

  // Per-region lighting setup. Two distinct concerns:
  //   - maxDist is a per-RAY cap, can't sensibly vary mid-march, so the
  //     ray-origin's region picks it (one regionFn call per trace).
  //   - lightDir + ambient affect SHADING, which only matters at the
  //     hit point; using the camera's region for them produces a jarring
  //     flip when crossing a boundary. Pre-merge each region's shading
  //     into _byRegionShading and let marchRay look up at each hit by
  //     the HIT POINT's region instead.
  // background is per-trace too (it modulates leftover-alpha on the ray
  // as a whole; not worth a per-region nuance).
  let originMaxDist = lighting.maxDist;
  if (lighting.byRegion && scene.regionFn) {
    const region = scene.regionFn(ox, oy, oz);
    const override = lighting.byRegion[region];
    if (override && override.maxDist !== undefined) originMaxDist = override.maxDist;

    _byRegionShading = {};
    for (const key in lighting.byRegion) {
      const merged = { ...lighting, ...lighting.byRegion[key] };
      const ld = merged.lightDir;
      _byRegionShading[key] = {
        lx: ld[0], ly: ld[1], lz: ld[2],
        ambient: merged.ambient,
      };
    }
  } else {
    _byRegionShading = null;
  }

  // Base shading — used at hits in regions without a byRegion entry.
  const lightDir = lighting.lightDir;
  const lx = lightDir[0], ly = lightDir[1], lz = lightDir[2];
  const bg = lighting.background;
  const bgR = bg[0], bgG = bg[1], bgB = bg[2];
  const ambient = lighting.ambient;

  if (_outBuffer === null || _outBuffer.length < 3 * N) {
    _outBuffer = new Float32Array(3 * N);
  }

  _regionFn = scene.regionFn || null;
  _maxDist  = originMaxDist ?? MAX_DIST;
  frameTime = performance.now();

  // Per-trace pre-cull: if the scene declares which regions are reachable
  // from each region (visibleRegions), drop items whose regionKey is not
  // in the camera region's visible set before running the per-ray loops.
  // Items with no regionKey always pass; items with an array regionKey
  // pass if any of their keys is in the visible set. Falls through to
  // the full scene when visibleRegions or regionFn is absent.
  let activeScene = scene;
  let activeLen   = scene.length;
  if (scene.visibleRegions && scene.regionFn) {
    const visibleSet = scene.visibleRegions[scene.regionFn(ox, oy, oz)];
    if (visibleSet) {
      let n = 0;
      for (let i = 0; i < scene.length; i++) {
        const item = scene[i];
        const rk = item.regionKey;
        if (rk == null) {
          _visibleItems[n++] = item;
        } else if (Array.isArray(rk)) {
          for (let j = 0; j < rk.length; j++) {
            if (visibleSet.indexOf(rk[j]) >= 0) {
              _visibleItems[n++] = item;
              break;
            }
          }
        } else if (visibleSet.indexOf(rk) >= 0) {
          _visibleItems[n++] = item;
        }
      }
      activeScene = _visibleItems;
      activeLen   = n;
    }
  }

  for (let i = 0; i < N; i++) {
    const dir = directions[i];
    const dx = dir[0], dy = dir[1], dz = dir[2];

    // Per-ray bounding-sphere filter. Line-sphere intersection: project the
    // item's center onto the ray, check the closest-point distance against
    // the bounding radius. Items without a bounding radius are kept (they're
    // large/infinite and could be hit by any ray).
    let nc = 0;
    for (let j = 0; j < activeLen; j++) {
      const item = activeScene[j];
      if (item.invisible) continue;
      const r = item.boundingRadius;
      if (r == null) {
        _candidates[nc++] = item;
        continue;
      }
      const ip = item.position;
      const cx = ip[0] - ox;
      const cy = ip[1] - oy;
      const cz = ip[2] - oz;
      const tProj = cx * dx + cy * dy + cz * dz;
      if (tProj < -r) continue;                        // sphere fully behind ray origin
      const ex = cx - tProj * dx;
      const ey = cy - tProj * dy;
      const ez = cz - tProj * dz;
      if (ex * ex + ey * ey + ez * ez > r * r) continue;  // ray misses sphere
      _candidates[nc++] = item;
    }

    marchRay(ox, oy, oz, dx, dy, dz, _candidates, nc,
             lx, ly, lz, ambient, bgR, bgG, bgB,
             _outBuffer, 3 * i);
  }

  return _outBuffer;
};
