// aquarium/assets/train.js — the back-country railway: a little steam
// consist that emerges from a tunnel in one mountain, crosses the far
// plateau behind the village, and disappears into the other mountain —
// pauses inside, then comes back the other way. Forever.
//
// The economics that make a railway affordable in this renderer:
//   - The TRACK is zero Items. It's painted into the ground's colorFn
//     (via paintTrack below) as a ballast-ties-rails ribbon along a
//     circular arc — costs only at ground-hit time, behind a cheap
//     radius guard.
//   - The TUNNELS are zero Items and zero carves. The track arc simply
//     continues INTO each mountain's material; the mountain surface
//     occludes the train, and a painted tunnel-mouth on the flank
//     (mountains.js, fed by TUNNEL_PORTALS) sells the entrance.
//   - The TRAIN is three Items: locomotive, wagons (one Item — at
//     radius 870 the arc's sagitta over a wagon length is ~0.03, so a
//     rigid two-wagon body is indistinguishable from articulated), and
//     a smoke plume (one Item, three pooled puffs whose offsets/radii
//     animate through shared state). Wheels are PAINTED on the body
//     sides by the colorFns — twelve wheels, zero primitives.
//
// Track geometry: a circle of radius TRACK_R about the world origin,
// painted only along the arc between the two tunnel mouths (both on
// the -Z back side, one flank of each big mountain). The train's
// turnaround angles sit deeper inside each mountain than the painted
// portals, so it is always fully swallowed before it stops.

import {
  boxSDF, cylinderSDF,
  unionSDF, translateSDF, rotateXSDF,
} from '../../core/scene.js';

/** @typedef {import('../../core/scene.js').Item} Item */

const DEG = Math.PI / 180;

// ─────────────────────────── track ───────────────────────────

const TRACK_R = 870;

// Painted-arc ends (the tunnel mouths), in atan2(z, x) terms. Derived
// from where the arc pierces each mountain's surface at train height:
// matterhorn (center 900∠220°, bell reach ~318 at h≈23) → 240.6°;
// mont-blanc (center 850∠307°, reach ~248) → 290.5°. In atan2 range
// those are negative angles.
const PORTAL_A_TH = -119.4 * DEG;             // matterhorn side
const PORTAL_B_TH = -69.5 * DEG;              // mont-blanc side

// Turnaround angles — deeper inside each mountain than its portal, so
// the whole consist (≈34 long ≈ 2.2° of arc) is hidden before pausing.
const TURN_A_TH = -127.5 * DEG;
const TURN_B_TH = -62.0 * DEG;

/** Tunnel-mouth world points, exported for mountains.js to paint dark
 *  arches on the right flanks. Y is mouth-center height. */
export const TUNNEL_PORTALS = [
  [TRACK_R * Math.cos(PORTAL_A_TH), -7, TRACK_R * Math.sin(PORTAL_A_TH)],
  [TRACK_R * Math.cos(PORTAL_B_TH), -7, TRACK_R * Math.sin(PORTAL_B_TH)],
];

// Ribbon paint dimensions (radial offsets from the arc centerline).
const RAIL_OFFSET  = 1.6;
const RAIL_HALF_W  = 0.45;
const TIE_HALF_R   = 2.6;
const TIE_PERIOD   = 4.6;                     // arc-length between tie starts
const TIE_WIDTH    = 1.5;
const BED_HALF_R   = 3.6;

/**
 * Paint sample for the railway ribbon at a ground point. Returns an
 * [r, g, b] triple on the ribbon, null elsewhere — callers fall
 * through to their own ground coloring. Cheap-reject first: one
 * hypot against the arc's radial band, then the angular range.
 *
 * @param {number} lpx @param {number} lpz  ground-item local (= world) XZ
 * @returns {number[] | null}
 */
export const paintTrack = (lpx, lpz) => {
  const r = Math.hypot(lpx, lpz);
  if (r < TRACK_R - BED_HALF_R - 0.6 || r > TRACK_R + BED_HALF_R + 0.6) return null;
  const th = Math.atan2(lpz, lpx);
  if (th < PORTAL_A_TH || th > PORTAL_B_TH) return null;
  const dr = r - TRACK_R;
  if (Math.abs(Math.abs(dr) - RAIL_OFFSET) < RAIL_HALF_W) return [88, 92, 98];  // steel
  const s = th * TRACK_R;                                  // arc length coordinate
  const tie = ((s % TIE_PERIOD) + TIE_PERIOD) % TIE_PERIOD;
  if (tie < TIE_WIDTH && Math.abs(dr) < TIE_HALF_R) return [96, 72, 48];        // sleepers
  if (Math.abs(dr) < BED_HALF_R) return [126, 120, 112];                        // ballast
  return null;
};

// ─────────────────────────── schedule ───────────────────────────

const RUN_SECONDS   = 95;                     // one traverse
const PAUSE_SECONDS = 25;                     // rest inside the mountain
const PERIOD        = 2 * (RUN_SECONDS + PAUSE_SECONDS);
const PHASE_OFFSET  = RUN_SECONDS / 2;        // page load catches it mid-arc

// ─────────────────────────── pose + shapes ───────────────────────────

// Yaw-only pose (the track is flat), shared by loco + wagons.
const T = { cy: 1, sy: 0 };
const trainFrame = (sdf) => (px, py, pz) => sdf(
  px * T.cy - pz * T.sy,
  py,
  px * T.sy + pz * T.cy,
);

// Locomotive, nose +Z, origin at rail-top + 5.5: frame deck, boiler,
// cab, chimney. Wheels + livery live in the colorFn.
const locoShape = unionSDF(
  translateSDF([0, -2.6, 0.0], boxSDF([2.4, 0.9, 7.0])),                       // frame
  translateSDF([0, 0.3, 1.6], rotateXSDF(Math.PI / 2, cylinderSDF(4.6, 2.2))), // boiler
  translateSDF([0, 0.6, -4.6], boxSDF([2.6, 2.6, 2.2])),                       // cab
  translateSDF([0, 3.4, 4.6], cylinderSDF(1.3, 0.75)),                         // chimney
);

const locoColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * T.cy - lpz * T.sy;
  const bz = lpx * T.sy + lpz * T.cy;
  // Painted wheels on the frame's flanks — three per side.
  if (Math.abs(bx) > 2.25 && lpy < -1.6) {
    for (const wz of [3.4, 0.2, -3.0]) {
      const dz = bz - wz, dy = lpy + 3.0;
      const d2 = dz * dz + dy * dy;
      if (d2 < 0.2) return [180, 152, 64];                 // hub
      if (d2 < 2.4) return [30, 30, 34];                   // wheel
    }
    return [48, 44, 42];
  }
  if (lpy > 2.4) return [26, 26, 28];                      // chimney
  if (bz < -2.4) {
    // Cab — barn red with a lit window band.
    if (lpy > 0.9 && lpy < 2.3 && Math.abs(bz + 4.6) < 1.3) return [420, 380, 240];
    return [138, 52, 40];
  }
  if (bz > 5.4) return [30, 30, 32];                       // smokebox door
  if (Math.abs(bz - 2.2) < 0.25) return [180, 152, 64];    // brass boiler band
  if (lpy > -1.7) return [44, 58, 52];                     // boiler green-black
  return [40, 38, 40];                                     // frame
};

// Two freight wagons as one rigid Item (see header on why that's
// safe), centered between them; oxide-red slats, painted wheels.
const wagonsShape = unionSDF(
  translateSDF([0, -1.2, +6.9], boxSDF([2.3, 2.0, 5.4])),
  translateSDF([0, -1.2, -6.9], boxSDF([2.3, 2.0, 5.4])),
);

const wagonsColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * T.cy - lpz * T.sy;
  const bz = lpx * T.sy + lpz * T.cy;
  if (Math.abs(bx) > 2.15 && lpy < -1.9) {
    for (const wz of [9.5, 4.3, -4.3, -9.5]) {
      const dz = bz - wz, dy = lpy + 3.0;
      const d2 = dz * dz + dy * dy;
      if (d2 < 0.16) return [170, 144, 60];
      if (d2 < 1.9) return [30, 30, 34];
    }
    return [46, 42, 40];
  }
  if (lpy > 0.55) return [96, 44, 34];                     // wagon roofline
  const slat = Math.floor(bz * 2.0) & 1;
  return slat === 0 ? [128, 58, 44] : [110, 48, 38];
};

// Smoke — three pooled puffs; offsets/radii animate through this
// shared state, read by the SDF closure (no per-frame closure
// rebuilds). Sharp union; radius swells then shrinks over each puff's
// cycle so recycling is invisible.
const _puffs = [
  { x: 0, y: 0, z: 0, r: 0.5 },
  { x: 0, y: 0, z: 0, r: 0.5 },
  { x: 0, y: 0, z: 0, r: 0.5 },
];
const smokeSdf = (px, py, pz) => {
  let d = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = _puffs[i];
    const dx = px - p.x, dy = py - p.y, dz = pz - p.z;
    const di = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r;
    if (di < d) d = di;
  }
  return d;
};

// ─────────────────────────── scene build ───────────────────────────

/**
 * Register the consist via the outside-tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @param {{ plateauY: number }} opts
 * @returns {{ update: (timeMs: number) => void }}
 */
export const addToScene = (add, { plateauY }) => {
  const RAIL_TOP_Y = plateauY + 5.5;          // item origin height over the rails

  const loco = add({
    name:     'cove-train-loco',
    color:    [44, 58, 52],
    colorFn:  locoColorFn,
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y, TUNNEL_PORTALS[0][2]],
    sdf:      trainFrame(locoShape),
    boundingBox: [7.5, 4.9, 7.5],
  });
  const wagons = add({
    name:     'cove-train-cars',
    color:    [128, 58, 44],
    colorFn:  wagonsColorFn,
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y, TUNNEL_PORTALS[0][2]],
    sdf:      trainFrame(wagonsShape),
    boundingBox: [12.6, 3.4, 12.6],
  });
  const smoke = add({
    name:     'cove-train-smoke',
    color:    [214, 214, 218],
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y + 8, TUNNEL_PORTALS[0][2]],
    sdf:      smokeSdf,
    opacity:  0.5,
    collides: false,
    boundingBox: [6.0, 7.0, 6.0],
  });

  return {
    update(timeMs) {
      const t = timeMs / 1000 + PHASE_OFFSET;
      const tt = ((t % PERIOD) + PERIOD) % PERIOD;

      let theta, moving, dir;
      if (tt < RUN_SECONDS) {
        theta = TURN_A_TH + (TURN_B_TH - TURN_A_TH) * (tt / RUN_SECONDS);
        moving = true; dir = +1;
      } else if (tt < RUN_SECONDS + PAUSE_SECONDS) {
        theta = TURN_B_TH; moving = false; dir = +1;
      } else if (tt < 2 * RUN_SECONDS + PAUSE_SECONDS) {
        theta = TURN_B_TH + (TURN_A_TH - TURN_B_TH)
              * ((tt - RUN_SECONDS - PAUSE_SECONDS) / RUN_SECONDS);
        moving = true; dir = -1;
      } else {
        theta = TURN_A_TH; moving = false; dir = -1;
      }

      // Heading = arc tangent in the direction of travel.
      const cth = Math.cos(theta), sth = Math.sin(theta);
      const heading = Math.atan2(-sth * dir, cth * dir);
      T.cy = Math.cos(heading);
      T.sy = Math.sin(heading);

      const lx = TRACK_R * cth;
      const lz = TRACK_R * sth;
      loco.position[0] = lx;
      loco.position[2] = lz;
      // Wagons trail the loco along the tangent (rigid consist).
      const tanX = Math.sin(heading), tanZ = Math.cos(heading);
      wagons.position[0] = lx - tanX * 21.1;
      wagons.position[2] = lz - tanZ * 21.1;

      // Smoke rides above the chimney while running; parked invisible
      // during mountain pauses (dropped at the tracer's pack step).
      smoke.invisible = !moving;
      if (moving) {
        smoke.position[0] = lx + tanX * 4.6;
        smoke.position[1] = RAIL_TOP_Y + 8;
        smoke.position[2] = lz + tanZ * 4.6;
        const ts = timeMs / 1000;
        for (let i = 0; i < 3; i++) {
          const age = ((ts * 0.5 + i / 3) % 1 + 1) % 1;
          const p = _puffs[i];
          p.x = Math.sin(age * 7 + i * 2.1) * 0.8 - tanX * age * 4.5;
          p.y = age * 8 - 4;
          p.z = Math.cos(age * 5 + i * 1.3) * 0.8 - tanZ * age * 4.5;
          p.r = 0.4 + Math.sin(age * Math.PI) * 1.5;
        }
      }
    },
  };
};
