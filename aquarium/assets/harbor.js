// aquarium/assets/harbor.js — the cove's working waterfront: a little
// red sloop that sails the deep water generatively, and a striped
// channel buoy bobbing near the dock lane.
//
// The sloop is the cove-scale "real" counterpart of two indoor props:
// the toy pirate ship sunk in the fishbowl, and the kid's crayon
// sailboat drawing on the fridge (same red hull + white sail — the
// drawing come true). Two Items (hull + rig) share one mutable pose;
// their SDFs read the pose's cos/sin fields through closures, so
// per-frame animation is position mutation + four trig writes — no
// closure rebuilds, no allocation (bubblePump's recycling idea applied
// to orientation).
//
// Wander behavior: heading eases toward a slowly-drifting sine blend,
// with a home-pull that fades in past the cruise range so the boat
// meanders indefinitely without beaching itself or ramming the dome.
// Bob + roll are layered incommensurate sines — no state, no phase
// management, reads as swell.

import {
  boxSDF, cylinderSDF, sphereSDF, planeSDF,
  unionSDF, smoothUnionSDF, intersectionSDF,
  translateSDF, rotateXSDF, rotateZSDF,
} from '../../core/scene.js';

/** @typedef {import('../../core/scene.js').Item} Item */

// ─────────────────────────── pose state ───────────────────────────

// Shared mutable pose. SDF closures and colorFns read the trig fields;
// update() rewrites them once per frame. heading follows the repo's
// rotateYSDF convention (shape yawed by +heading ⇒ local +Z bow points
// along world [sin, 0, cos]).
const S = {
  x: 40, z: 310,
  heading: 2.4,
  cy: Math.cos(2.4), sy: Math.sin(2.4),
  cr: 1, sr: 0,                              // roll
};

// Boat query frame: world-relative → boat-local (un-yaw, then un-roll).
// Mirrors bowl.js's shipFrame pattern with mutable trig instead of
// baked constants.
const boatFrame = (sdf) => (px, py, pz) => {
  const x1 = px * S.cy - pz * S.sy;
  const z1 = px * S.sy + pz * S.cy;
  return sdf(
    x1 * S.cr + py * S.sr,
    -x1 * S.sr + py * S.cr,
    z1,
  );
};

// ─────────────────────────── sloop geometry ───────────────────────────
// Local frame: bow toward +Z, deck up, y = 0 near the waterline.

const hullShape = smoothUnionSDF(0.35,
  translateSDF([0, 0.00, -0.4], boxSDF([2.30, 1.15, 5.0])),
  translateSDF([0, 0.10, +5.3], boxSDF([1.55, 1.00, 1.5])),
  translateSDF([0, 0.20, +6.5], boxSDF([0.80, 0.85, 1.0])),
  translateSDF([0, 0.10, -5.9], boxSDF([1.90, 1.00, 1.1])),
  translateSDF([0, 1.90, -2.2], boxSDF([1.50, 0.90, 1.9])),   // cabin
);

// Rig, in the same hull-local coords: mast, boom, mainsail (thin box
// intersected with the leech plane → triangle), masthead pennant. The
// rig registers as its own Item positioned RIG_DY above the hull so
// its AABB hugs the sail instead of spanning keel-to-masthead.
const RIG_DY = 6;
const sailLeechPlane = (() => {
  // Leech runs masthead (y 11.05, z +0.45) → boom end (y 2.35, z -4.15).
  const inv = 1 / Math.hypot(8.7, 4.6);
  return planeSDF([0, 4.6 * inv, -8.7 * inv], (4.6 * 11.05 - 8.7 * 0.45) * inv);
})();
const rigShape = unionSDF(
  translateSDF([0, 6.10, +0.60], cylinderSDF(5.2, 0.16)),                    // mast
  translateSDF([0, 2.10, -2.00], rotateXSDF(Math.PI / 2, cylinderSDF(2.6, 0.10))), // boom
  intersectionSDF(
    translateSDF([0, 6.70, -1.85], boxSDF([0.055, 4.35, 2.30])),
    sailLeechPlane,
  ),
  translateSDF([0, 11.50, -0.10], boxSDF([0.03, 0.25, 0.50])),               // pennant
);

const hullColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * S.cy - lpz * S.sy;                        // boat-local (yaw only;
  const bz = lpx * S.sy + lpz * S.cy;                        // roll is visually nil here)
  if (lpy > 1.12) {
    // Cabin — warm wood with a lit portlight band along each side.
    if (lpy > 1.55 && lpy < 2.45 && Math.abs(bz + 2.2) < 1.55 && Math.abs(bx) > 1.05) {
      return [340, 310, 205];
    }
    return [150, 118, 78];
  }
  if (lpy > 0.82) {                                          // deck planks
    const p = Math.floor(bx / 0.5) & 1;
    return p === 0 ? [168, 132, 86] : [148, 114, 74];
  }
  if (Math.abs(lpy + 0.62) < 0.11) return [236, 231, 219];   // waterline stripe
  if (lpy < -0.62) return [66, 42, 38];                      // hull bottom
  const stripe = Math.floor(lpy / 0.40) & 1;                 // red topside planks
  return stripe === 0 ? [182, 56, 46] : [156, 45, 38];
};

// Sail + pennant are over-bright: the mainsail is a VERTICAL surface
// under the cove's straight-up sun (ndotl = 0 → ambient-only), so at
// native tint it would read as a gray silhouette from across the
// water. ~1.75× keeps it canvas-white at ambient without clamping.
const rigColorFn = (lpx, lpy, lpz) => {
  const bz = lpx * S.sy + lpz * S.cy;
  if (lpy > 5.15) return [350, 98, 82];                      // pennant
  if (bz > 0.47 || lpy < -3.55) return [122, 92, 60];        // mast / boom wood
  const seam = Math.floor(lpy / 1.1) & 1;                    // sail cloth seams
  return seam === 0 ? [424, 420, 408] : [399, 395, 381];
};

// ─────────────────────────── buoy ───────────────────────────

// Static shape (baked lean), animated only in bob — a buoy doesn't
// need a heading. Red/white bands via colorFn.
const buoyShape = rotateZSDF(0.08, unionSDF(
  cylinderSDF(1.3, 1.05),
  translateSDF([0, 1.9, 0], sphereSDF(0.55)),
  translateSDF([0, 2.6, 0], cylinderSDF(0.5, 0.07)),
));
// Over-bright bands for the same vertical-surface reason as the sail.
const buoyColorFn = (lpx, lpy, lpz) => {
  if (lpy > 2.15) return [50, 48, 50];                       // antenna
  if (lpy > 1.35) return [326, 93, 77];                      // top ball
  const band = Math.floor((lpy + 1.3) / 0.65) & 1;
  return band === 0 ? [326, 93, 77] : [381, 374, 362];
};

// ─────────────────────────── behavior ───────────────────────────

const CRUISE_SPEED   = 4.5;      // world units / sec
const TURN_RATE      = 0.22;     // max rad / sec
const HOME           = { x: 40, z: 330 };
const CRUISE_RANGE   = 190;      // heading stays free within this radius of HOME

/**
 * Register the sloop + buoy via the outside-tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @param {{ seaLevelY: number }} opts
 * @returns {{ update: (timeMs: number) => void }}
 */
export const addToScene = (add, { seaLevelY }) => {
  const hull = add({
    name:     'cove-sloop-hull',
    color:    [182, 56, 46],
    colorFn:  hullColorFn,
    position: [S.x, seaLevelY + 0.25, S.z],
    sdf:      boatFrame(hullShape),
    // Worst-case yaw: hull reaches z +7.5 / x ±2.35 → 7.7 on both axes.
    boundingBox: [7.7, 3.0, 7.7],
  });
  const framedRig = boatFrame(rigShape);
  const rig = add({
    name:     'cove-sloop-rig',
    color:    [242, 240, 233],
    colorFn:  rigColorFn,
    position: [S.x, seaLevelY + 0.25 + RIG_DY, S.z],
    // Rig primitives live in hull-local coords; shift the query down by
    // RIG_DY so this item's own origin can sit at the sail's center for
    // a tight AABB.
    sdf:      (px, py, pz) => framedRig(px, py + RIG_DY, pz),
    // Pennant top reaches hull-local 11.75 → +5.75 here; boom tail
    // -4.7 horizontal at worst yaw.
    boundingBox: [5.6, 6.0, 5.6],
  });

  const BUOY_X = 34, BUOY_Z = 158;
  const buoy = add({
    name:     'cove-buoy',
    color:    [204, 58, 48],
    colorFn:  buoyColorFn,
    position: [BUOY_X, seaLevelY + 0.2, BUOY_Z],
    sdf:      buoyShape,
    boundingBox: [1.5, 3.3, 1.5],
  });

  let lastTimeMs = performance.now();

  return {
    update(timeMs) {
      // dt clamp mirrors bubblePump: a backgrounded tab resuming after
      // seconds would otherwise slam the boat through a giant arc.
      const dt = Math.min((timeMs - lastTimeMs) / 1000, 0.1);
      lastTimeMs = timeMs;
      if (dt <= 0) return;
      const t = timeMs / 1000;

      // Heading: free sine-meander inside the cruise range; a home pull
      // fades in linearly past it. The blend keeps turns continuous at
      // the range boundary (no snap).
      const meander = Math.sin(t * 0.043) * 1.1 + Math.sin(t * 0.019 + 2.1) * 1.6;
      const hx = HOME.x - S.x, hz = HOME.z - S.z;
      const homeDist = Math.sqrt(hx * hx + hz * hz);
      let target = meander;
      if (homeDist > CRUISE_RANGE) {
        const w = Math.min(1, (homeDist - CRUISE_RANGE) / 60);
        const homeHeading = Math.atan2(hx, hz);
        let d = homeHeading - meander;
        d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        target = meander + d * w;
      }
      let turn = target - S.heading;
      turn = ((turn + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const maxTurn = TURN_RATE * dt;
      if (turn > maxTurn) turn = maxTurn; else if (turn < -maxTurn) turn = -maxTurn;
      S.heading += turn;
      S.cy = Math.cos(S.heading);
      S.sy = Math.sin(S.heading);

      // Advance along the bow; layered-sine bob + roll.
      S.x += S.sy * CRUISE_SPEED * dt;
      S.z += S.cy * CRUISE_SPEED * dt;
      const bob  = 0.30 * Math.sin(t * 0.9) + 0.18 * Math.sin(t * 0.53 + 1.3);
      const roll = 0.045 * Math.sin(t * 0.8) + 0.030 * Math.sin(t * 1.7 + 0.6);
      S.cr = Math.cos(roll);
      S.sr = Math.sin(roll);

      const y = seaLevelY + 0.25 + bob;
      hull.position[0] = S.x;
      hull.position[1] = y;
      hull.position[2] = S.z;
      rig.position[0]  = S.x;
      rig.position[1]  = y + RIG_DY;
      rig.position[2]  = S.z;

      buoy.position[1] = seaLevelY + 0.2 + 0.25 * Math.sin(t * 1.1 + 2.0);
    },
  };
};
