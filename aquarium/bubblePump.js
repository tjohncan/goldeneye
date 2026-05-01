// aquarium/bubblePump.js — column of water bubbles rising from a fixed source.
//
// Bubbles are real Items in the scene (rendered through the lens with
// fisheye distortion + lambertian shading), NOT screen-space overlays.
// Each bubble is a tiny sphere SDF with a constant rise rate, slight random
// horizontal jitter at spawn, and randomized size. Spawns periodically from
// a fixed pump position; despawns on reaching the water surface.
//
// To avoid mutating the scene array each frame, we pre-allocate a pool of
// bubble Items at init (all initially `invisible: true`) and recycle them
// — a slot becomes "active" on spawn (visibility on) and parks itself out
// of the way (visibility off) when it reaches the surface.

import { sphereSDF, registerItem } from '../core/scene.js';
import { REGION_BOWL } from './world.js';

/** @typedef {import('../core/r3.js').Vec3} Vec3 */
/** @typedef {import('../core/scene.js').Scene} Scene */
/** @typedef {import('../core/scene.js').Item}  Item  */

const BUBBLE_COLOR = [200, 220, 240];
const SPAWN_JITTER_RADIUS = 0.15;   // ± horizontal offset from pump position
const RISE_JITTER_FRAC    = 0.4;    // ± fraction of base riseRate per bubble

/**
 * @param {{
 *   scene:        Scene,
 *   position:     Vec3,    // world-space pump location
 *   surfaceY:     number,  // bubble despawn height
 *   spawnPerSec?: number,
 *   riseRate?:    number,  // base world units / second
 *   minSize?:     number,
 *   maxSize?:     number,
 *   capacity?:    number,  // pool size
 * }} opts
 * @returns {{ update: (timeMs: number) => void }}
 */
export const createBubblePump = ({
  scene,
  position,
  surfaceY,
  spawnPerSec = 1.5,
  riseRate    = 0.7,
  minSize     = 0.03,
  maxSize     = 0.07,
  capacity    = 12,
}) => {
  /** @type {Array<{ item: Item, active: boolean, vy: number }>} */
  const pool = [];
  for (let i = 0; i < capacity; i++) {
    /** @type {Item} */
    const item = {
      name:      `bubble-${i}`,
      color:     BUBBLE_COLOR,
      position:  [position[0], surfaceY + 1, position[2]],   // parked above surface
      sdf:       sphereSDF(minSize),
      invisible: true,
      collides:  false,    // fish swims through bubbles
      opacity:   0.3,      // see-through, with a hint of bubble color tinting the background
      boundingRadius: maxSize,  // tight bound — bubbles are visually tiny, so the per-ray bounding-sphere filter drops them aggressively when off-axis
      regionKey: REGION_BOWL,   // bubbles live entirely inside the bowl interior
    };
    registerItem(scene, item);
    pool.push({ item, active: false, vy: 0 });
  }

  let lastSpawnMs = 0;
  let lastTimeMs  = performance.now();

  return {
    update(timeMs) {
      // Clamp dt — when the tab is backgrounded, rAF stops; on resume the
      // gap can be many seconds and an unclamped step would teleport every
      // active bubble through the surface in one frame.
      const dt = Math.min((timeMs - lastTimeMs) / 1000, 0.1);
      lastTimeMs = timeMs;
      if (dt <= 0) return;

      // Spawn one bubble if it's been long enough since the last one.
      const spawnInterval = 1000 / spawnPerSec;
      if (timeMs - lastSpawnMs >= spawnInterval) {
        for (const slot of pool) {
          if (slot.active) continue;
          slot.active = true;
          slot.item.invisible = false;
          slot.item.position[0] = position[0] + (Math.random() - 0.5) * 2 * SPAWN_JITTER_RADIUS;
          slot.item.position[1] = position[1];
          slot.item.position[2] = position[2] + (Math.random() - 0.5) * 2 * SPAWN_JITTER_RADIUS;
          slot.vy = riseRate * (1 + (Math.random() - 0.5) * 2 * RISE_JITTER_FRAC);
          slot.item.sdf = sphereSDF(minSize + Math.random() * (maxSize - minSize));
          lastSpawnMs = timeMs;
          break;
        }
      }

      // Advance all active bubbles. Despawn (park + invisible) when they
      // reach the surface.
      for (const slot of pool) {
        if (!slot.active) continue;
        const newY = slot.item.position[1] + slot.vy * dt;
        if (newY >= surfaceY) {
          slot.active = false;
          slot.item.invisible = true;
        } else {
          slot.item.position[1] = newY;
        }
      }
    },
  };
};
