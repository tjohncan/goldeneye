// aquarium/physics.js — SDF-gradient collision sliding for the fish.
//
// Each frame, after controls.update has applied movement, query each item's
// SDF at the fish's position. If any surface is closer than fishRadius, push
// the fish out along the SDF gradient by the overlap distance — gives
// sliding-along-walls behavior for free. Iterates a few times so the fish
// resolves cleanly in concave regions (e.g., wedged between a rock and the
// floor, or jammed into a corner of the bowl near a prop).
//
// Region cull: if the scene supplies a regionFn, sample regions at 7 probe
// points (the camera plus ±fishRadius along each axis) and only consider
// items whose regionKey is in that set. Items without a regionKey span
// regions and are always considered (room walls, floor, ceiling, the bowl
// glass). Cost of 7 regionFn calls per iteration is negligible; the win is
// skipping per-item SDF evaluations for items in regions far from the fish.
//
// What the 6 axis probes measure: any region within fishRadius along an
// axis from the camera. That covers axis-aligned boundaries and roughly
// radial ones (like the bowl sphere) cleanly. Caveat for the geometrically
// curious: for a boundary whose normal points at a cube corner (1,1,1)/√3,
// effective probe reach along that normal drops to fishRadius/√3 ≈ 0.115,
// so the fish surface can poke up to ~fishRadius into a region no probe
// sees. Doesn't affect the current scene: the bowl boundary is radial
// (probes catch it cleanly), and from inside, the always-considered bowl
// glass blocks the fish from getting close enough for the oblique-probe
// gap to matter — the table top, for instance, sits exactly fishRadius
// below the bowl's lowest interior point, but the glass intervenes first.
// If a future region's boundaries are awkwardly oriented, the upgrade is
// either (a) probe at fishRadius·√3 along the same 6 axes — bulletproof
// but coarser cull, or (b) sample more directions, e.g. 14-vertex
// Fibonacci sphere — better angular coverage at modest extra cost.
//
// Temporal safety: re-sampling each iteration plus per-frame displacement
// staying under fishRadius means any region the fish *will* enter next
// frame was probed this frame, so no "hop across a boundary" pathology.
// With current params (speed 1.44, dt clamped to 0.1 in controls.js,
// fishRadius 0.2), worst-case displacement ≈ 0.144 < 0.2. Region partitions
// must be clean (regionFn a deterministic function of position) for this to
// hold; design new regions with that constraint in mind.

/** @typedef {import('../core/r3.js').Vec3} Vec3 */
/** @typedef {import('../core/scene.js').Scene} Scene */
/** @typedef {import('../core/scene.js').Item}  Item  */

import { sdfGrad } from '../core/scene.js';

const NORMAL_EPS     = 0.001;
const MAX_ITERATIONS = 4;

// Probe directions for the per-iteration region sample (center + 6 axis-
// aligned). Multiplied by fishRadius at sample time.
const PROBE_OFFSETS = [
  [ 0,  0,  0],
  [+1,  0,  0], [-1,  0,  0],
  [ 0, +1,  0], [ 0, -1,  0],
  [ 0,  0, +1], [ 0,  0, -1],
];

/**
 * Bind collision physics to a Camera + Scene.
 *
 * @param {{
 *   camera:      import('../core/camera.js').Camera,
 *   scene:       Scene,
 *   fishRadius?: number,  // collision radius (effective fish "size")
 * }} opts
 * @returns {{ update: () => void }}
 */
export const bindPhysics = ({ camera, scene, fishRadius = 0.2 }) => {
  // Reusable scratch — region keys touched by the fish this iteration.
  // At most 7 entries (one per probe), but typically 1-2 in steady state.
  const touchedRegions = [];

  return {
    update() {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const [px, py, pz] = camera.position;

        // Sample regions at the camera + 6 axis probes. Re-sampled each
        // iteration because overlap push-outs move the camera between iters.
        // Items with a regionKey not in this set are skipped below.
        let nRegions = 0;
        if (scene.regionFn) {
          for (let p = 0; p < 7; p++) {
            const off = PROBE_OFFSETS[p];
            const k = scene.regionFn(
              px + off[0] * fishRadius,
              py + off[1] * fishRadius,
              pz + off[2] * fishRadius,
            );
            let dup = false;
            for (let j = 0; j < nRegions; j++) {
              if (touchedRegions[j] === k) { dup = true; break; }
            }
            if (!dup) touchedRegions[nRegions++] = k;
          }
        }

        // Find the closest item surface to the fish.
        let minD = Infinity;
        /** @type {Item | null} */
        let minItem = null;
        for (let i = 0; i < scene.length; i++) {
          const item = scene[i];
          if (item.collides === false) continue;   // fish swims through
          if (nRegions > 0 && item.regionKey != null) {
            const rk = item.regionKey;
            let inRegion = false;
            if (Array.isArray(rk)) {
              for (let j = 0; j < nRegions && !inRegion; j++) {
                if (rk.indexOf(touchedRegions[j]) >= 0) inRegion = true;
              }
            } else {
              for (let j = 0; j < nRegions; j++) {
                if (touchedRegions[j] === rk) { inRegion = true; break; }
              }
            }
            if (!inRegion) continue;
          }
          const ip = item.position;
          const d = item.sdf(px - ip[0], py - ip[1], pz - ip[2]);
          if (d < minD) {
            minD = d;
            minItem = item;
          }
        }

        if (minD >= fishRadius) return;  // resolved (no overlap with any item)

        // SDF gradient at the fish position via forward finite differences.
        const ip = minItem.position;
        const lpx = px - ip[0], lpy = py - ip[1], lpz = pz - ip[2];
        const [gx, gy, gz] = sdfGrad(minItem.sdf, lpx, lpy, lpz, minD, NORMAL_EPS);
        const glen = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (glen < 1e-9) return;  // degenerate gradient; bail rather than NaN

        // Push along normalized gradient by the overlap distance. The gradient
        // direction works for both regular SDFs (push outward away from prop)
        // and inverted-shell SDFs like the room walls (push inward away from
        // the wall surface back into the room interior).
        const overlap = fishRadius - minD;
        const scale = overlap / glen;
        camera.position = [
          px + gx * scale,
          py + gy * scale,
          pz + gz * scale,
        ];
      }
    },
  };
};
