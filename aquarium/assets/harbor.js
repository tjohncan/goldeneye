// aquarium/assets/harbor.js — the cove's working waterfront: a little
// red sloop that sails the deep water generatively, and a striped
// channel buoy bobbing near the dock lane.
//
// The sloop is the cove-scale "real" counterpart of two indoor props:
// the toy pirate ship sunk in the fishbowl, and the kid's crayon
// sailboat drawing on the fridge (same red hull + white sail — the
// drawing come true). Sized against the shack and the scaled-up dock:
// ~28 from stern to bow tip, masthead ~21 over the waterline — a real
// working boat, not a bathtub toy.
//
// Two Items (hull + rig) share one mutable pose; their SDFs read the
// pose's cos/sin fields through closures, so per-frame animation is
// position mutation + four trig writes — no closure rebuilds, no
// allocation (bubblePump's recycling idea applied to orientation).
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

const hullShape = smoothUnionSDF(0.65,
  translateSDF([0, 0.00, -0.7], boxSDF([4.30, 2.10, 9.3])),
  translateSDF([0, 0.20, +9.8], boxSDF([2.90, 1.85, 2.8])),
  translateSDF([0, 0.35, +12.0], boxSDF([1.50, 1.55, 1.85])),
  translateSDF([0, 0.20, -10.9], boxSDF([3.50, 1.85, 2.0])),
  translateSDF([0, 3.50, -4.1], boxSDF([2.80, 1.70, 3.5])),   // cabin
);

// Rig, in the same hull-local coords: mast, boom, mainsail (thin box
// intersected with the leech plane → triangle), masthead pennant. The
// rig registers as its own Item positioned RIG_DY above the hull so
// its AABB hugs the sail instead of spanning keel-to-masthead.
const RIG_DY = 11;
const sailLeechPlane = (() => {
  // Leech runs masthead (y 20.3, z +0.9) → boom end (y 4.3, z -7.7).
  const inv = 1 / Math.hypot(16.0, 8.6);
  return planeSDF([0, 8.6 * inv, -16.0 * inv], (8.6 * 20.3 - 16.0 * 0.9) * inv);
})();
const rigShape = unionSDF(
  translateSDF([0, 11.30, +1.10], cylinderSDF(9.6, 0.30)),                    // mast
  translateSDF([0, 3.90, -3.70], rotateXSDF(Math.PI / 2, cylinderSDF(4.8, 0.19))), // boom
  intersectionSDF(
    translateSDF([0, 12.30, -3.40], boxSDF([0.10, 8.0, 4.3])),
    sailLeechPlane,
  ),
  translateSDF([0, 21.30, -0.20], boxSDF([0.06, 0.46, 0.93])),               // pennant
);

const hullColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * S.cy - lpz * S.sy;                        // boat-local (yaw only;
  const bz = lpx * S.sy + lpz * S.cy;                        // roll is visually nil here)
  if (lpy > 2.05) {
    // Cabin — warm wood with a lit portlight band along each side.
    if (lpy > 2.9 && lpy < 4.5 && Math.abs(bz + 4.1) < 2.9 && Math.abs(bx) > 1.95) {
      return [340, 310, 205];
    }
    return [150, 118, 78];
  }
  if (lpy > 1.50) {                                          // deck planks
    const p = Math.floor(bx / 0.9) & 1;
    return p === 0 ? [168, 132, 86] : [148, 114, 74];
  }
  if (Math.abs(lpy + 1.15) < 0.20) return [236, 231, 219];   // waterline stripe
  if (lpy < -1.15) return [66, 42, 38];                      // hull bottom
  const stripe = Math.floor(lpy / 0.74) & 1;                 // red topside planks
  return stripe === 0 ? [182, 56, 46] : [156, 45, 38];
};

// Sail + pennant are over-bright: the mainsail is a VERTICAL surface
// under the cove's straight-up sun (ndotl = 0 → ambient-only), so at
// native tint it would read as a gray silhouette from across the
// water. ~1.75× keeps it canvas-white at ambient without clamping.
const rigColorFn = (lpx, lpy, lpz) => {
  const bz = lpx * S.sy + lpz * S.cy;
  if (lpy > 9.6) return [350, 98, 82];                       // pennant
  if (bz > 0.9 || lpy < -6.6) return [122, 92, 60];          // mast / boom wood
  const seam = Math.floor(lpy / 2.0) & 1;                    // sail cloth seams
  return seam === 0 ? [424, 420, 408] : [399, 395, 381];
};

// ─────────────────────────── buoy ───────────────────────────

// Static shape (baked lean), animated only in bob — a buoy doesn't
// need a heading. Red/white bands via colorFn, over-bright for the
// same vertical-surface reason as the sail.
const buoyShape = rotateZSDF(0.08, unionSDF(
  cylinderSDF(2.5, 2.0),
  translateSDF([0, 3.6, 0], sphereSDF(1.05)),
  translateSDF([0, 4.95, 0], cylinderSDF(0.95, 0.13)),
));
const buoyColorFn = (lpx, lpy, lpz) => {
  if (lpy > 4.1) return [50, 48, 50];                        // antenna
  if (lpy > 2.6) return [326, 93, 77];                       // top ball
  const band = Math.floor((lpy + 2.5) / 1.25) & 1;
  return band === 0 ? [326, 93, 77] : [381, 374, 362];
};

// ─────────────────────────── behavior ───────────────────────────

const CRUISE_SPEED   = 6;        // world units / sec
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
    position: [S.x, seaLevelY + 0.5, S.z],
    sdf:      boatFrame(hullShape),
    // Worst-case yaw: hull reaches z +13.9 / x ±4.3 → 14.2 both axes;
    // cabin top 5.2 plus roll sway.
    boundingBox: [14.2, 5.7, 14.2],
  });
  const framedRig = boatFrame(rigShape);
  const rig = add({
    name:     'cove-sloop-rig',
    color:    [242, 240, 233],
    colorFn:  rigColorFn,
    position: [S.x, seaLevelY + 0.5 + RIG_DY, S.z],
    // Rig primitives live in hull-local coords; shift the query down by
    // RIG_DY so this item's own origin can sit at the sail's center for
    // a tight AABB.
    sdf:      (px, py, pz) => framedRig(px, py + RIG_DY, pz),
    // Pennant top reaches hull-local 21.8 → +10.8 here; boom tail
    // -8.7 horizontal at worst yaw.
    boundingBox: [8.8, 11.0, 8.8],
  });
  // Sail physics pad — the visible sail is 0.2 thick and a boosted
  // fish moves 1.44/frame, so it sailed straight through the canvas
  // between physics samples. Invisible thickened slab in the same
  // boat frame (tracer drops it at pack time; physics keeps it) makes
  // the sail feel like fabric you thump into. Mast/boom stay thin —
  // clipping past a pole reads fine; a wall shouldn't.
  const framedSailPad = boatFrame(
    translateSDF([0, 12.30, -3.40], boxSDF([1.0, 8.0, 4.3])),
  );
  const sailPad = add({
    name:      'sloop-sail-pad',
    color:     [0, 0, 0],
    position:  [S.x, seaLevelY + 0.5 + RIG_DY, S.z],
    sdf:       (px, py, pz) => framedSailPad(px, py + RIG_DY, pz),
    invisible: true,
  });

  const BUOY_X = 40, BUOY_Z = 185;
  const buoy = add({
    name:     'cove-buoy',
    color:    [326, 93, 77],
    colorFn:  buoyColorFn,
    position: [BUOY_X, seaLevelY + 0.3, BUOY_Z],
    boundingBox: [2.9, 6.3, 2.9],
    sdf:      buoyShape,
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
      const bob  = 0.45 * Math.sin(t * 0.9) + 0.28 * Math.sin(t * 0.53 + 1.3);
      const roll = 0.045 * Math.sin(t * 0.8) + 0.030 * Math.sin(t * 1.7 + 0.6);
      S.cr = Math.cos(roll);
      S.sr = Math.sin(roll);

      const y = seaLevelY + 0.5 + bob;
      hull.position[0] = S.x;
      hull.position[1] = y;
      hull.position[2] = S.z;
      rig.position[0]  = S.x;
      rig.position[1]  = y + RIG_DY;
      rig.position[2]  = S.z;
      sailPad.position[0] = S.x;
      sailPad.position[1] = y + RIG_DY;
      sailPad.position[2] = S.z;

      buoy.position[1] = seaLevelY + 0.3 + 0.4 * Math.sin(t * 1.1 + 2.0);
    },
  };
};
