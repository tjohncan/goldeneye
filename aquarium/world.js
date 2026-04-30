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

/** Y-coordinate of the water surface (= bowl rim). */
export const WATER_SURFACE_Y = 6.25;

/** Lighting: sun straight up, gentle ambient. */
export const LIGHTING = {
  lightDir:   [0, 1, 0],
  ambient:    0.35,
  background: [0, 0, 0],
};

// Bowl geometry. BOWL_INNER_R is also imported by zones/bowl.js (sand SDF).
export const BOWL_INNER_R = 7.3;
const BOWL_OUTER_R        = 8.5;

// Region keys — exported for zone modules to tag their items, and consumed
// by regionFn below.
export const REGION_BOWL    = 'bowl';
export const REGION_KITCHEN = 'kitchen';

/**
 * Maps a world-space point to a region key. Checks are ordered by
 * specificity: bowl interior first (a small sphere inside the kitchen),
 * then each secret zone's predicate, then kitchen as the catch-all.
 *
 * @type {(px: number, py: number, pz: number) => string}
 */
const regionFn = (px, py, pz) => {
  if (py < WATER_SURFACE_Y &&
      px * px + py * py + pz * pz < BOWL_INNER_R * BOWL_INNER_R) {
    return REGION_BOWL;
  }
  if (mousehole.isInMousehole(px, py, pz)) return mousehole.REGION_MOUSEHOLE;
  return REGION_KITCHEN;
};


// ──────────────────────────── world build ────────────────────────────

/**
 * Build the kitchen + fish-bowl scene. Region-spanning items are
 * registered here; per-region items are added by their zone modules.
 *
 * @returns {import('../core/scene.js').Scene}
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

  // Per-region items. Order matters: kitchen registers the 'room' item,
  // and the mousehole's addToScene mutates it in place to carve the
  // entrance tunnel — so kitchen must come first.
  bowl.addToScene(scene);
  kitchen.addToScene(scene);
  mousehole.addToScene(scene);

  return scene;
};
