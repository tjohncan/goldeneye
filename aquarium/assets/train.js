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

// Painted-arc ends (the tunnel mouths), in atan2(z, x) terms. The
// anchor must sit ON each mountain's visible SKIN, not where the track
// pierces deep material: a heightfield's flank at horizontal distance
// d from its center only rises to h(d), so a mouth anchored where the
// bore is fully swallowed (h ≈ 23) sits ~15 under the slope surface
// and never paints. Instead anchor where the skirt stands about
// train-height (h ≈ 11): matterhorn at d ≈ 352 → Δ22.9° off its 220°
// bearing; mont-blanc at d ≈ 261 → Δ17.4° off 307°. The train's crown
// briefly overtops the low outer skirt right where the dark arch is
// painted, which reads as "entering the bore."
const PORTAL_A_TH = -117.1 * DEG;             // matterhorn side
const PORTAL_B_TH = -72.6 * DEG;              // mont-blanc side

// Turnaround angles — deeper inside each mountain than its portal, so
// the whole consist (≈46 long ≈ 3° of arc) is hidden before pausing.
const TURN_A_TH = -127.5 * DEG;
const TURN_B_TH = -62.0 * DEG;

/** Tunnel-mouth world points, exported for mountains.js to paint dark
 *  arches on the right flanks. Y sits above the rail line so most of
 *  the mouth sphere lands on visible skin instead of below grade. */
export const TUNNEL_PORTALS = [
  [TRACK_R * Math.cos(PORTAL_A_TH), -5, TRACK_R * Math.sin(PORTAL_A_TH)],
  [TRACK_R * Math.cos(PORTAL_B_TH), -5, TRACK_R * Math.sin(PORTAL_B_TH)],
];

// Ribbon paint dimensions (radial offsets from the arc centerline).
const RAIL_OFFSET  = 2.2;
const RAIL_HALF_W  = 0.5;
const TIE_HALF_R   = 3.4;
const TIE_PERIOD   = 5.6;                     // arc-length between tie starts
const TIE_WIDTH    = 1.8;
const BED_HALF_R   = 4.4;

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
  // Painted through to the TURN angles, well inside each mountain —
  // the rising skirt occludes the deep part naturally, so the rails
  // run visually all the way into the dark of the arch instead of
  // stopping short on open grass.
  if (th < TURN_A_TH || th > TURN_B_TH) return null;
  const dr = r - TRACK_R;
  if (Math.abs(Math.abs(dr) - RAIL_OFFSET) < RAIL_HALF_W) return [88, 92, 98];  // steel
  const s = th * TRACK_R;                                  // arc length coordinate
  const tie = ((s % TIE_PERIOD) + TIE_PERIOD) % TIE_PERIOD;
  if (tie < TIE_WIDTH && Math.abs(dr) < TIE_HALF_R) return [96, 72, 48];        // sleepers
  if (Math.abs(dr) < BED_HALF_R) return [126, 120, 112];                        // ballast
  return null;
};

// ─────────────────────────── schedule ───────────────────────────

const RUN_SECONDS   = 118;                    // one traverse (~5.7 u/s — chaseable)
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

// Locomotive, nose +Z, ~1.35× the first cut (it read toy-scale against
// the house-scale village): deep frame skirt, boiler, cab, chimney.
// Wheels + livery live in the colorFn; the frame runs deep enough that
// the full wheel discs fit on its flanks.
const locoShape = unionSDF(
  translateSDF([0, -3.7, 0.0], boxSDF([3.2, 2.2, 9.5])),                       // frame + skirt
  translateSDF([0, 0.4, 2.2], rotateXSDF(Math.PI / 2, cylinderSDF(6.2, 3.0))), // boiler
  translateSDF([0, 0.8, -6.2], boxSDF([3.5, 3.5, 3.0])),                       // cab
  translateSDF([0, 4.6, 6.2], cylinderSDF(1.75, 1.0)),                         // chimney
);

const locoColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * T.cy - lpz * T.sy;
  const bz = lpx * T.sy + lpz * T.cy;
  // Painted wheels on the frame's flanks — three per side.
  if (Math.abs(bx) > 3.05 && lpy < -2.0) {
    for (const wz of [4.6, 0.3, -4.05]) {
      const dz = bz - wz, dy = lpy + 3.9;
      const d2 = dz * dz + dy * dy;
      if (d2 < 0.36) return [180, 152, 64];                // hub
      if (d2 < 4.4) return [30, 30, 34];                   // wheel
    }
    return [48, 44, 42];
  }
  if (lpy > 3.4) return [26, 26, 28];                      // chimney + cab roof
  if (bz < -3.2) {
    // Cab — barn red with a lit window band.
    if (lpy > 1.2 && lpy < 3.1 && Math.abs(bz + 6.2) < 1.8) return [420, 380, 240];
    return [138, 52, 40];
  }
  if (bz > 7.3) return [30, 30, 32];                       // smokebox door
  if (Math.abs(bz - 3.0) < 0.34) return [180, 152, 64];    // brass boiler band
  if (lpy > -2.3) return [44, 58, 52];                     // boiler green-black
  return [40, 38, 40];                                     // frame
};

// Two freight wagons as one rigid Item (see header on why that's
// safe), centered between them; oxide-red slats, painted wheels on
// bodies deep enough to carry them. Two low drawbars bridge the gaps
// (wagon→loco ahead, wagon→wagon between) so the consist reads as
// coupled rather than floating apart — the forward bar reaches toward
// the loco's separate Item, which trails at the same fixed offset.
const wagonsShape = unionSDF(
  translateSDF([0, -2.3, +9.3], boxSDF([3.1, 3.3, 7.3])),
  translateSDF([0, -2.3, -9.3], boxSDF([3.1, 3.3, 7.3])),
  translateSDF([0, -2.5, +17.8], boxSDF([0.32, 0.32, 1.5])),   // drawbar → loco
  translateSDF([0, -2.5, 0.0],   boxSDF([0.32, 0.32, 2.3])),   // drawbar wagon↔wagon
);

const wagonsColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * T.cy - lpz * T.sy;
  const bz = lpx * T.sy + lpz * T.cy;
  if (Math.abs(bx) > 2.95 && lpy < -2.4) {
    for (const wz of [12.8, 5.8, -5.8, -12.8]) {
      const dz = bz - wz, dy = lpy + 3.85;
      const d2 = dz * dz + dy * dy;
      if (d2 < 0.3) return [170, 144, 60];
      if (d2 < 3.3) return [30, 30, 34];
    }
    return [46, 42, 40];
  }
  // Drawbars — dark iron, isolated to the inter-body gaps at axle height.
  if (Math.abs(bx) < 0.5 && lpy < -2.0 && lpy > -3.0
      && (bz > 16.7 || Math.abs(bz) < 2.1)) return [42, 40, 44];
  if (lpy > 0.7) return [96, 44, 34];                      // wagon roofline
  const slat = Math.floor(bz * 1.5) & 1;
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
  // Item origin height: sets painted wheel-bottoms (local -5.8) a hair
  // INTO the ballast rather than hovering over it.
  const RAIL_TOP_Y = plateauY + 5.65;

  const loco = add({
    name:     'cove-train-loco',
    color:    [44, 58, 52],
    colorFn:  locoColorFn,
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y, TUNNEL_PORTALS[0][2]],
    sdf:      trainFrame(locoShape),
    // Frame corner (3.2, 9.5) sweeps to √(3.2² + 9.5²) ≈ 10.02 at a
    // diagonal yaw.
    boundingBox: [10.2, 6.6, 10.2],
  });
  const wagons = add({
    name:     'cove-train-cars',
    color:    [128, 58, 44],
    colorFn:  wagonsColorFn,
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y, TUNNEL_PORTALS[0][2]],
    sdf:      trainFrame(wagonsShape),
    // Forward drawbar reaches to z ≈ 19.3; diagonal yaw sweeps the
    // (3.1, 19.3) corner to ≈ 19.5.
    boundingBox: [19.7, 5.8, 19.7],
  });
  const smoke = add({
    name:     'cove-train-smoke',
    color:    [214, 214, 218],
    position: [TUNNEL_PORTALS[0][0], RAIL_TOP_Y + 10, TUNNEL_PORTALS[0][2]],
    sdf:      smokeSdf,
    opacity:  0.5,
    collides: false,
    boundingBox: [7.0, 8.5, 7.0],
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
      wagons.position[0] = lx - tanX * 28.5;
      wagons.position[2] = lz - tanZ * 28.5;

      // Smoke rides above the chimney while running; parked invisible
      // during mountain pauses (dropped at the tracer's pack step).
      smoke.invisible = !moving;
      if (moving) {
        smoke.position[0] = lx + tanX * 6.2;
        smoke.position[1] = RAIL_TOP_Y + 10;
        smoke.position[2] = lz + tanZ * 6.2;
        const ts = timeMs / 1000;
        for (let i = 0; i < 3; i++) {
          const age = ((ts * 0.5 + i / 3) % 1 + 1) % 1;
          const p = _puffs[i];
          p.x = Math.sin(age * 7 + i * 2.1) * 1.0 - tanX * age * 5.5;
          p.y = age * 10 - 5;
          p.z = Math.cos(age * 5 + i * 1.3) * 1.0 - tanZ * age * 5.5;
          p.r = 0.5 + Math.sin(age * Math.PI) * 2.0;
        }
      }
    },
  };
};
