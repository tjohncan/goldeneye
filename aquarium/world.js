// aquarium/world.js — orchestrator for the kitchen + fish-bowl scene.
//
// Owns the cross-region pieces: regionFn (the world's partitioning of
// space into named regions), shared dimensions (bowl + water), and
// lighting. Also registers the only items that are genuinely region-
// spanning — visible from multiple regions and so left without a
// regionKey: today, just the translucent fishbowl glass (seen from
// inside the bowl AND from the kitchen looking at the bowl from
// outside).
//
// All other items live in their zone module under `zones/`, tagged with
// that zone's regionKey. Zone modules add themselves to the scene via
// `addToScene(scene)`.
//
// To add a new region, add a key constant + a regionFn predicate here,
// and a new zone module that registers items with that key. Items
// without a regionKey are always considered by the tracer/physics
// region cull — use that ONLY for surfaces that genuinely span more
// than one region (e.g., a translucent boundary visible from both sides).

import {
  createScene, registerItem,
  openTopBowlSDF,
} from '../core/scene.js';

import * as bowl      from './zones/bowl.js';
import * as kitchen   from './zones/kitchen.js';
import * as mousehole from './secrets/mousehole.js';
import * as chamber   from './secrets/chamber.js';
import * as outside   from './secrets/outside.js';

/** Y-coordinate of the water surface (= bowl rim). */
export const WATER_SURFACE_Y = 6.25;

/** Lighting: sun straight up, gentle ambient. Background is black —
 * silhouette-edge rays that exhaust MAX_STEPS without fully accumulating
 * opacity mix toward background, so coloring it non-black bleeds into
 * edges everywhere. */
export const LIGHTING = {
  lightDir:   [0, 1, 0],
  ambient:    0.35,
  background: [0, 0, 0],
  maxDist:    10000,
};

// Bowl geometry. BOWL_INNER_R is also imported by zones/bowl.js (sand SDF).
export const BOWL_INNER_R = 7.3;
const BOWL_OUTER_R        = 8.5;

// Kitchen interior half-extents — mirrors ROOM_HALF_* in zones/kitchen.js.
// Used by regionFn to mark only points genuinely inside the kitchen box
// as kitchen region; anywhere else falls through to outside, so the
// kitchen 'room' item (whose invertSDF-box material extends to infinity)
// can't bleed beige walls into the cove.
const KITCHEN_HALF_X = 22;
const KITCHEN_HALF_Y = 13;
const KITCHEN_HALF_Z = 22;

// Region keys — exported for zone modules to tag their items, and consumed
// by regionFn below.
export const REGION_BOWL    = 'bowl';
export const REGION_KITCHEN = 'kitchen';

/**
 * Maps a world-space point to a region key. Checks are ordered by
 * specificity: bowl interior first, then each secret zone's predicate,
 * then kitchen ONLY if inside the kitchen box, else outside.
 *
 * Outside is the catch-all (rather than kitchen) because the kitchen
 * 'room' shell's material extends to infinity outside its box; if
 * far-away points were tagged kitchen, that infinite material would
 * surface as beige walls in the cove.
 *
 * @type {(px: number, py: number, pz: number) => string}
 */
const regionFn = (px, py, pz) => {
  if (py < WATER_SURFACE_Y &&
      px * px + py * py + pz * pz < BOWL_INNER_R * BOWL_INNER_R) {
    return REGION_BOWL;
  }
  if (mousehole.isInMousehole(px, py, pz)) return mousehole.REGION_MOUSEHOLE;
  if (chamber.isInChamber(px, py, pz))     return chamber.REGION_CHAMBER;
  if (Math.abs(px) < KITCHEN_HALF_X &&
      Math.abs(py) < KITCHEN_HALF_Y &&
      Math.abs(pz) < KITCHEN_HALF_Z) {
    return REGION_KITCHEN;
  }
  return outside.REGION_OUTSIDE;
};

/**
 * Per-region forward-speed multiplier on the controls' base speed. The
 * map is keyed by region key; missing keys default to 1×. Lives here
 * (rather than in main.js) so the orchestrator owns all per-region
 * tuning, and main.js doesn't have to name any specific zone — keeps
 * each secret discrete to its own file.
 *
 * @type {Record<string, number>}
 */
const SPEED_MUL_BY_REGION = {
  [outside.REGION_OUTSIDE]: 10,
};


// ──────────────────────────── world build ────────────────────────────

/**
 * Build the kitchen + fish-bowl scene. Region-spanning items are
 * registered here; per-region items are added by their zone modules.
 *
 * Returns the scene plus a `speedMul(pos)` callback for the controls
 * layer — kept off the Scene type itself, since the tracer/physics
 * have no use for it and shouldn't have to ignore an extra field.
 *
 * @returns {{
 *   scene:    import('../core/scene.js').Scene,
 *   speedMul: (pos: import('../core/r3.js').Vec3) => number,
 * }}
 */
export const createWorld = () => {
  const scene = createScene();
  scene.regionFn = regionFn;

  // Fishbowl glass — visible from inside (bowl rays) AND from outside
  // (kitchen rays), so genuinely region-spanning. No regionKey.
  registerItem(scene, {
    name:     'fishbowl',
    color:    [40, 55, 85],
    position: [0, 0, 0],
    sdf:      openTopBowlSDF({ outerR: BOWL_OUTER_R, innerR: BOWL_INNER_R, rimY: WATER_SURFACE_Y }),
    opacity:  0.75,
    boundingRadius: BOWL_OUTER_R + 0.2,
  });

  // Per-region items. Order matters: kitchen registers the 'room',
  // 'window', and 'door' items, and the secret zones mutate them in
  // place to carve their entrances — so kitchen must come first.
  bowl.addToScene(scene);
  kitchen.addToScene(scene);
  mousehole.addToScene(scene);
  chamber.addToScene(scene);
  outside.addToScene(scene);

  const speedMul = ([px, py, pz]) => SPEED_MUL_BY_REGION[regionFn(px, py, pz)] ?? 1;
  return { scene, speedMul };
};
