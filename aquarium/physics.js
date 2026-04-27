// aquarium/physics.js — SDF-gradient collision sliding for the fish.
//
// Each frame, after controls.update has applied movement, query each item's
// SDF at the fish's position. If any surface is closer than fishRadius, push
// the fish out along the SDF gradient by the overlap distance — gives
// sliding-along-walls behavior for free. Iterates a few times so the fish
// resolves cleanly in concave regions (e.g., wedged between a rock and the
// floor, or jammed into a corner of the bowl near a prop).

/** @typedef {import('../core/r3.js').Vec3} Vec3 */
/** @typedef {import('../core/scene.js').Scene} Scene */
/** @typedef {import('../core/scene.js').Item}  Item  */

import { sdfGrad } from '../core/scene.js';

const NORMAL_EPS     = 0.001;
const MAX_ITERATIONS = 4;

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
  return {
    update() {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const [px, py, pz] = camera.position;

        // Find the closest item surface to the fish.
        let minD = Infinity;
        /** @type {Item | null} */
        let minItem = null;
        for (let i = 0; i < scene.length; i++) {
          const item = scene[i];
          if (item.collides === false) continue;   // fish swims through
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
        // and inverted SDFs like fishbowlSDF (push inward away from wall).
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
