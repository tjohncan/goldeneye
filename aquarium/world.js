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
import { ROOM_HALF_X, ROOM_HALF_Y, ROOM_HALF_Z } from './zones/kitchen.js';
import * as mousehole from './zones/secrets/mousehole.js';
import * as chamber   from './zones/secrets/chamber.js';
import * as outside   from './zones/secrets/outside.js';

/** Y-coordinate of the water surface (= bowl rim). */
export const WATER_SURFACE_Y = 6.25;

/** Y-coordinate above which the camera teleports — set in the outside
 * zone (the cove sun sits high in the dome) and consumed by main.js.
 * Re-exported here so main.js doesn't reach into secret modules
 * directly. */
export { SUN_TRIGGER_Y } from './zones/secrets/outside.js';

/** Lighting: sun straight up, gentle ambient. Background is black —
 * silhouette-edge rays that exhaust MAX_STEPS without fully accumulating
 * opacity mix toward background, so coloring it non-black bleeds into
 * edges everywhere.
 *
 * `byRegion` overrides the base — see Lighting typedef in core/tracer.js.
 * Two granularities for that lookup:
 *   - maxDist: per-trace, keyed by the ray origin's region (a ray-distance
 *     cap can't sensibly vary mid-march). Used to give cove rays the long
 *     cap they need for the dome at radius 1000 without paying for it
 *     elsewhere.
 *   - lightDir + ambient: per-HIT, keyed by the hit point's region. So a
 *     kitchen surface stays sun-up-lit even when the camera is in the
 *     mousehole looking back through the tunnel; only surfaces inside the
 *     secret zone pick up its alternative light direction. Avoids the
 *     portal-flip artifact that origin-region shading would produce.
 *
 * The bowl region intentionally inherits base — fish-in-water under the
 * kitchen's overhead sun is the right read; no override needed.
 */
export const LIGHTING = {
  lightDir:   [0, 1, 0],
  ambient:    0.35,
  background: [0, 0, 0],
  // Self-derived cap: full kitchen diagonal (corner-to-corner) plus a
  // 30-unit buffer. Covers any legitimate kitchen/bowl/mousehole/chamber
  // ray (the outside-keyhole peek is blocked by the door veil so kitchen
  // rays never reach the cove). If kitchen extents ever change, this
  // tracks them. Outside overrides up to reach the dome.
  maxDist:    Math.hypot(ROOM_HALF_X, ROOM_HALF_Y, ROOM_HALF_Z) * 2 + 30,
  byRegion: {
    [outside.REGION_OUTSIDE]: {
      // Cove dome at radius 1000 — needs the long ray cap to render
      // its sky gradient through to the equator.
      maxDist: 10000,
    },
    [mousehole.REGION_MOUSEHOLE]: {
      // Light comes from the +X side (the doorway and TV are both
      // there). Surfaces with normals pointing +X — i.e., the back
      // wall opposite the entrance — catch the light, mimicking how
      // a TV in a dark room throws its glow on the far wall while
      // its own face stays in silhouette. Ambient kept moderate so
      // the lit-vs-unlit disparity reads as atmosphere, not blackout;
      // the room-glow translucent box (mousehole.js) carries the
      // additional blue-cathode wash on top.
      lightDir: [1, 0, 0],
      ambient:  0.40,
    },
    [chamber.REGION_CHAMBER]: {
      // Light comes from the back wall (-Z side, where the marquee
      // sits). The opposite +Z wall (front, near the entry pipe)
      // catches the light; the marquee wall itself stays dim apart
      // from its own glowing colorFn — reads as "the marquee IS the
      // light source." Ambient moderate for atmosphere; the chamber-
      // glow box adds the psychedelic wash.
      lightDir: [0, 0, -1],
      ambient:  0.30,
    },
  },
};

// Bowl geometry. BOWL_INNER_R is also imported by zones/bowl.js (sand SDF).
export const BOWL_INNER_R = 7.3;
const BOWL_OUTER_R        = 8.5;

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
    return bowl.REGION_BOWL;
  }
  if (mousehole.isInMousehole(px, py, pz)) return mousehole.REGION_MOUSEHOLE;
  if (chamber.isInChamber(px, py, pz))     return chamber.REGION_CHAMBER;
  // Kitchen ONLY if inside the room box — anywhere else falls through
  // to outside, so the kitchen 'room' item (whose invertSDF-box material
  // extends to infinity) can't bleed beige walls into the cove.
  if (Math.abs(px) < ROOM_HALF_X &&
      Math.abs(py) < ROOM_HALF_Y &&
      Math.abs(pz) < ROOM_HALF_Z) {
    return kitchen.REGION_KITCHEN;
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

/**
 * Region-adjacency map: for a camera in region X, which region's items
 * could a ray possibly reach? The tracer uses this to pre-cull items
 * whose region isn't reachable, before the per-ray bounding-sphere
 * filter. Coarser than the per-step cull but earlier in the pipeline.
 *
 *   - bowl ↔ kitchen: through the translucent fishbowl glass and the
 *     bowl's open top.
 *   - kitchen ↔ mousehole: through the entrance tunnel.
 *   - mousehole/bowl: through tunnel → kitchen → glass.
 *   - chamber → kitchen: chamber rays exiting through the entry pipe
 *     enter kitchen-region steps; the sun-cover (tagged BOTH chamber
 *     and kitchen via array regionKey) gets caught by the kitchen
 *     entry, so chamber's adjacency need not list bowl/mousehole.
 *   - chamber inbound: pure-chamber items (gyroid, marquee) aren't
 *     reachable from bowl/kitchen/mousehole — sun-cover blocks the
 *     pipe — so those regions don't list chamber. The sun-cover
 *     itself rides in via its kitchen tag.
 *   - outside: fully isolated (door/window/painting/veil curtains all
 *     opaque from inside; building exterior opaque from outside).
 *
 * @type {Record<string, string[]>}
 */
const VISIBLE_REGIONS = {
  [bowl.REGION_BOWL]:           [bowl.REGION_BOWL, kitchen.REGION_KITCHEN, mousehole.REGION_MOUSEHOLE],
  [kitchen.REGION_KITCHEN]:     [kitchen.REGION_KITCHEN, bowl.REGION_BOWL, mousehole.REGION_MOUSEHOLE],
  [mousehole.REGION_MOUSEHOLE]: [mousehole.REGION_MOUSEHOLE, kitchen.REGION_KITCHEN, bowl.REGION_BOWL],
  [chamber.REGION_CHAMBER]:     [chamber.REGION_CHAMBER, kitchen.REGION_KITCHEN],
  [outside.REGION_OUTSIDE]:     [outside.REGION_OUTSIDE],
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
  scene.regionFn       = regionFn;
  scene.visibleRegions = VISIBLE_REGIONS;

  // Fishbowl glass — registered to BOTH bowl and kitchen so per-step
  // cull keeps it for rays in either region (translucent: visible from
  // inside the bowl AND from kitchen looking at the bowl from outside),
  // and drops it for unrelated regions (mousehole/chamber/outside).
  registerItem(scene, {
    name:     'fishbowl',
    color:    [40, 55, 85],
    position: [0, 0, 0],
    sdf:      openTopBowlSDF({ outerR: BOWL_OUTER_R, innerR: BOWL_INNER_R, rimY: WATER_SURFACE_Y }),
    opacity:  0.75,
    boundingRadius: BOWL_OUTER_R + 0.2,
    regionKey: [bowl.REGION_BOWL, kitchen.REGION_KITCHEN],
  });

  // Per-region items. Order matters: kitchen registers the 'room',
  // 'window', and 'door' items, and the secret zones mutate them in
  // place to carve their entrances — so kitchen must come first. The
  // handles it returns are routed to each secret instead of having the
  // secrets reach back into the scene by name.
  bowl.addToScene(scene);
  const kitchenHandles = kitchen.addToScene(scene);
  mousehole.addToScene(scene, kitchenHandles);
  chamber.addToScene(scene, kitchenHandles);
  outside.addToScene(scene, kitchenHandles);

  const speedMul = ([px, py, pz]) => SPEED_MUL_BY_REGION[regionFn(px, py, pz)] ?? 1;
  return { scene, speedMul };
};
