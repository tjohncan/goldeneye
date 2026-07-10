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
// Temporal safety: per-iteration re-probing plus per-frame displacement
// staying under fishRadius means any region the fish *will* enter next
// frame was probed this frame, so no "hop across a boundary" pathology.
// With current params (speed 1.44, dt clamped to 0.1 in controls.js,
// fishRadius 0.2), the kitchen's per-frame displacement ~0.144 sits
// safely below fishRadius. The cove's speedMul=10 pushes peak
// displacement to 1.44 — well above — but the cove stays safe via a
// different invariant: the house-exterior wall (~9 units thick)
// buffers the only directly-traversable boundary into another
// region's domain, the cove dome at r≈1000 walls off the rest, and
// the sun-teleport handles the upper limit at the controls layer
// before any boundary cross can fire. Region partitions must be clean
// (regionFn a deterministic function of position) for either invariant
// to hold; design new regions with that constraint in mind, and
// either keep peak displacement under fishRadius or buffer the
// boundary with wall thickness > displacement.

/** @typedef {import('../core/r3.js').Vec3} Vec3 */
/** @typedef {import('../core/scene.js').Scene} Scene */
/** @typedef {import('../core/scene.js').Item}  Item  */

import { sdfGrad } from '../core/scene.js';

const NORMAL_EPS     = 0.001;
const MAX_ITERATIONS = 4;

/** Default fish (collision) radius. Module-level so MIN_TRAVERSAL_OVERLAP
 * tracks it. */
export const FISH_RADIUS = 0.2;

/** Minimum overlap required between a cut tool and the volume it carves
 *  through, when the carve must permit a fish-sized mover to traverse it.
 *  cutSDF (core/scene.js) returns the non-negative max(-tool, base) at
 *  shared boundaries, so without this overlap the SDF dip in the carve
 *  region (depth = overlap / 2 at minimum) can fall below fishRadius and
 *  push the fish back at the carve entrance. Carve sites pad past this
 *  number — typically by 0.1–0.6 — for safety margin and rendering
 *  cleanliness; reference this constant in their derivations so any
 *  fishRadius tuning propagates. */
export const MIN_TRAVERSAL_OVERLAP = 2 * FISH_RADIUS;

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
export const bindPhysics = ({ camera, scene, fishRadius = FISH_RADIUS }) => {
  // Reusable scratch — region keys touched by the fish this iteration.
  // At most 7 entries (one per probe), but typically 1-2 in steady state.
  const touchedRegions = [];
  // Last position that resolved cleanly (nothing closer than fishRadius).
  // Seeded to the spawn; used to undo a frame that tunnels into a solid.
  const lastSafe = [camera.position[0], camera.position[1], camera.position[2]];
  /** @type {Item | null} owning item of the nearest surface, set by probe(). */
  let minItem = null;

  // Region-culled nearest-surface distance at a world point. Records the
  // owning item in `minItem` so the caller can push out of it.
  const probe = (px, py, pz) => {
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
    let minD = Infinity;
    minItem = null;
    for (let i = 0; i < scene.length; i++) {
      const item = scene[i];
      if (item.collides === false) continue;   // fish swims through
      if (nRegions > 0 && item.regionKey !== null) {
        const rk = item.regionKey;
        const set = item._regionKeySet;
        let inRegion = false;
        if (set !== null) {
          for (let j = 0; j < nRegions; j++) {
            if (set.has(touchedRegions[j])) { inRegion = true; break; }
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
      if (d < minD) { minD = d; minItem = item; }
    }
    return minD;
  };

  return {
    update() {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const px = camera.position[0], py = camera.position[1], pz = camera.position[2];
        // Re-probed each iteration because push-outs move the camera between iters.
        const minD = probe(px, py, pz);
        if (minD >= fishRadius) {          // resolved — nothing within fishRadius
          lastSafe[0] = px; lastSafe[1] = py; lastSafe[2] = pz;
          return;
        }

        // SDF gradient at the fish position via forward finite differences.
        const ip = minItem.position;
        const [gx, gy, gz] = sdfGrad(minItem.sdf, px - ip[0], py - ip[1], pz - ip[2], minD, NORMAL_EPS);
        const glen = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (glen < 1e-9) break;            // degenerate gradient — let the revert below catch it

        // Push along normalized gradient by the overlap distance. Works for
        // regular SDFs (push outward off a prop) and inverted-shell SDFs like
        // the room walls (push back into the room interior).
        const scale = (fishRadius - minD) / glen;
        camera.position = [px + gx * scale, py + gy * scale, pz + gz * scale];
      }

      // Out of iterations (or a degenerate gradient) still overlapping. If the
      // fish has actually tunnelled INSIDE a solid — a fast dive punching
      // through thin geometry (a roof tip, an eave soffit) faster than the
      // push-out could eject — snap back to the last cleanly-resolved spot so
      // the solid's interior never renders (physics runs before paint). Merely
      // grazing a surface (positive distance) is fine; leave it be.
      if (probe(camera.position[0], camera.position[1], camera.position[2]) < 0) {
        camera.position = [lastSafe[0], lastSafe[1], lastSafe[2]];
      } else {
        lastSafe[0] = camera.position[0];
        lastSafe[1] = camera.position[1];
        lastSafe[2] = camera.position[2];
      }
    },
  };
};
