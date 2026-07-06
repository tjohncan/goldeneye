// aquarium/assets/skyLife.js — things that fly in the cove: a goldfish
// ZEPPELIN (giant balloon shaped like the resident species, wicker
// basket slung on ropes) making a slow grand circuit of the whole bowl
// at mountain-shoulder height, and a flock of six little sky-goldfish —
// this world's birds. In a world that is itself a giant fishbowl, of
// course the birds are goldfish.
//
// The zeppelin flies an analytic circle (heading = tangent, in closed
// form), so it needs no steering state. The sky-goldfish are a tiny
// per-slot state machine instead:
//
//   CRUISE — fly waypoint to waypoint in a high band that clears every
//            rooftop, treetop, and the mesa (so straight-line legs can
//            never pass through geometry);
//   STAGE  — descend to a perch's staging point (perch + its approach
//            offset, always in open air);
//   FINAL  — short slow glide from staging point onto the perch;
//   SIT    — perch a while (roof ridges, treetops, the lighthouse
//            gallery, the dock end, the mesa rim, the shack's outside
//            doorknob), then launch back along the approach corridor.
//
// Steering is exponential velocity easing toward the current target —
// no waypoint lists to allocate, no pathfinding. Perch occupancy is a
// parallel int array so two fish never claim the same spot.
//
// Pose/animation pattern as in harbor.js/seaLife.js: mutable pose
// objects read by SDF + colorFn closures; update() rewrites trig and
// positions in place. Fish are collides:false — they're song-bird
// scale, and getting body-checked by one would be rude.

import {
  boxSDF, sphereSDF, capsuleBetweenSDF,
  unionSDF, smoothUnionSDF,
  translateSDF, rotateXSDF, rotateYSDF,
} from '../../core/scene.js';

/** @typedef {import('../../core/scene.js').Item}  Item  */
/** @typedef {import('./village.js').Perch} Perch */

// ─────────────────────────── zeppelin ───────────────────────────

// Circuit: radius 430 around the world origin — crossing over water,
// beach, village, and mesa alike ("around a cross-section of the
// bowl") — at y ≈ 175: above the mesa, below the snow line, framed
// against the big mountains' rocky midriffs. One lap every 4 minutes.
const ZEP_R      = 430;
const ZEP_BASE_Y = 175;
const ZEP_OMEGA  = 2 * Math.PI / 240;

const ZEP = { cy: 1, sy: 0 };                 // yaw-only pose

const zepFrame = (sdf) => (px, py, pz) => sdf(
  px * ZEP.cy - pz * ZEP.sy,
  py,
  px * ZEP.sy + pz * ZEP.cy,
);

// Envelope — fat goldfish teardrop + splayed tail fan + dorsal fin.
// Nose toward local +Z. ~50 long, ~28 tall with fins.
const zepEnvelopeShape = unionSDF(
  smoothUnionSDF(3.0,
    translateSDF([0, 0, +2],    sphereSDF(14.0)),
    translateSDF([0, 0.5, +11], sphereSDF(11.5)),
    translateSDF([0, -0.5, -9], sphereSDF(9.5)),
  ),
  translateSDF([0, 0, -23], rotateYSDF(+0.45, boxSDF([0.6, 7.5, 5.0]))),  // tail fan
  translateSDF([0, 0, -23], rotateYSDF(-0.45, boxSDF([0.6, 7.5, 5.0]))),
  translateSDF([0, 13, +1], rotateXSDF(-0.3, boxSDF([0.6, 5.0, 4.5]))),   // dorsal fin
);

const zepEnvelopeColorFn = (lpx, lpy, lpz) => {
  const bx = lpx * ZEP.cy - lpz * ZEP.sy;
  const bz = lpx * ZEP.sy + lpz * ZEP.cy;
  const ax = Math.abs(bx);
  // Cartoon goldfish eyes — black disc with a white glint, both sides.
  const edx = ax - 8.0, edy = lpy - 2.5, edz = bz - 18.5;
  if (edx * edx + edy * edy + edz * edz < 4.8) {
    const gdx = ax - 7.6, gdy = lpy - 3.2, gdz = bz - 19.3;
    if (gdx * gdx + gdy * gdy + gdz * gdz < 0.6) return [250, 250, 250];
    return [24, 22, 26];
  }
  // Fins + tail — pale flame gradient with streaks.
  if (bz < -17.5 || lpy > 12.0) {
    const streak = Math.sin((lpy + bx) * 0.8 + bz * 0.5);
    return streak > 0.3 ? [340, 262, 128] : [326, 216, 78];
  }
  // Body — deep-orange back, golden belly, subtle scale shimmer.
  // ~1.45× over-bright: the envelope is mostly seen from below and
  // the side (ambient-shaded) against bright sky; at native tint it
  // silhouettes to brown. The sunlit top clamps a little — a fair
  // trade for the flanks reading goldfish-orange in flight.
  const shimmer = Math.sin(bz * 0.55 + ax * 0.5) * Math.sin(lpy * 0.6);
  const lift = shimmer > 0.55 ? 23 : 0;
  if (lpy >  4) return [336 + lift, 133 + lift, 41];
  if (lpy < -6) return [370, 290 + lift, 160];
  return [360, 215 + lift, 75];
};

// Basket + rigging — wicker gondola on four rope capsules reaching up
// into the envelope's belly. Own Item, positioned below the envelope,
// so its AABB hugs the gondola instead of inflating the balloon's.
const ZEP_BASKET_DY = -17.5;                  // item origin below envelope center
const zepBasketShape = (() => {
  const parts = [translateSDF([0, -4.5, 0], boxSDF([2.6, 2.0, 2.6]))];
  for (const sx of [-1, +1]) {
    for (const sz of [-1, +1]) {
      parts.push(capsuleBetweenSDF(
        [sx * 2.3, -2.6, sz * 2.3],
        [sx * 5.0,  6.5, sz * 5.0],
        0.12,
      ));
    }
  }
  return unionSDF(...parts);
})();
const zepBasketColorFn = (lpx, lpy, lpz) => {
  if (lpy > -2.4) return [190, 168, 128];                   // ropes
  const bx = lpx * ZEP.cy - lpz * ZEP.sy;
  const weave = (Math.floor(bx * 2.2) + Math.floor(lpy * 2.2)) & 1;
  return weave === 0 ? [172, 132, 82] : [148, 110, 64];
};

// ─────────────────────────── sky-goldfish ───────────────────────────

const FISH_COUNT = 6;

// Cruise-band + steering constants. The band floor clears the tallest
// static obstacle (mesa tree top ≈ 56), so cruise legs never intersect
// geometry; only STAGE/FINAL descend below it, along per-perch
// corridors chosen to be open air.
const CRUISE_Y_MIN = 58, CRUISE_Y_MAX = 95;
const CRUISE_R_MIN = 60, CRUISE_R_MAX = 320;
const CRUISE_SPEED = 16;
const FINAL_SPEED  = 3.5;
const STEER_TAU    = 0.7;

const MODE_CRUISE = 0, MODE_STAGE = 1, MODE_FINAL = 2, MODE_SIT = 3;

// Fish body — one sphere + tail fan; the flock is 6 items so each
// SDF stays 2 primitives. boundingRadius (not box) — for a shape this
// small the sphere test is the cheaper reject.
const makeFishShape = () => unionSDF(
  translateSDF([0, 0, 0.1], sphereSDF(0.52)),
  translateSDF([0, 0, -0.75], boxSDF([0.05, 0.42, 0.38])),
);

// Over-bright (~1.5×) like the zeppelin: tiny fliers seen against
// bright sky need their flanks to read warm, not silhouette-dark.
const makeFishColorFn = (P) => (lpx, lpy, lpz) => {
  const x1 = lpx * P.cy - lpz * P.sy;
  const z1 = lpx * P.sy + lpz * P.cy;
  const by = lpy * P.cp - z1 * P.sp;
  const bz = lpy * P.sp + z1 * P.cp;
  if (bz < -0.5) return [383, 315, 195];                    // tail
  const edx = Math.abs(x1) - 0.40, edy = by - 0.16, edz = bz - 0.38;
  if (edx * edx + edy * edy + edz * edz < 0.018) return [20, 18, 22];
  if (by < -0.2) return [383, 270, 135];                    // belly
  return [368, 195, 60];                                    // goldfish orange
};

/**
 * Register the zeppelin + flock via the outside-tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @param {{ perches: Perch[] }} opts   landing spots (village roofs,
 *        trees, lighthouse, dock, mesa rim, shack ridge + doorknob…)
 * @returns {{ update: (timeMs: number) => void }}
 */
export const addToScene = (add, { perches }) => {
  // ── zeppelin ──
  const envelope = add({
    name:     'goldfish-zeppelin',
    color:    [248, 148, 52],
    colorFn:  zepEnvelopeColorFn,
    position: [0, ZEP_BASE_Y, ZEP_R],
    sdf:      zepFrame(zepEnvelopeShape),
    // Worst-case yaw: nose +22.5 / splayed tail -27.8 → 28.5 X/Z. The
    // raked dorsal's rotated box reaches 13 + 5·cos(0.3) + 4.5·sin(0.3)
    // ≈ 19.1 up → 19.6 Y.
    boundingBox: [28.5, 19.6, 28.5],
  });
  const basket = add({
    name:     'zeppelin-basket',
    color:    [160, 122, 74],
    colorFn:  zepBasketColorFn,
    position: [0, ZEP_BASE_Y + ZEP_BASKET_DY, ZEP_R],
    sdf:      zepFrame(zepBasketShape),
    // Rope tops at (±5, ·, ±5) swing to radius √50 ≈ 7.07 at a 45° yaw.
    boundingBox: [7.3, 7.3, 7.3],
  });

  // ── flock state ──
  /** Per-slot pose read by that fish's SDF/colorFn closures. */
  const poses = [];
  /** Per-slot steering/behavior state. */
  const fish = [];
  /** perchOwner[i] = slot index sitting/heading there, or -1. */
  const perchOwner = new Int8Array(perches.length).fill(-1);

  const randomWaypoint = (f) => {
    const r   = CRUISE_R_MIN + Math.random() * (CRUISE_R_MAX - CRUISE_R_MIN);
    const phi = Math.random() * 2 * Math.PI;
    f.tx = r * Math.sin(phi);
    f.ty = CRUISE_Y_MIN + Math.random() * (CRUISE_Y_MAX - CRUISE_Y_MIN);
    f.tz = r * Math.cos(phi);
  };

  // Pick a random unclaimed perch; returns index or -1. Two passes to
  // stay allocation-free (count, then walk to the k-th free one).
  const claimPerch = (slot) => {
    let free = 0;
    for (let i = 0; i < perchOwner.length; i++) if (perchOwner[i] < 0) free++;
    if (free === 0) return -1;
    let k = (Math.random() * free) | 0;
    for (let i = 0; i < perchOwner.length; i++) {
      if (perchOwner[i] < 0 && k-- === 0) { perchOwner[i] = slot; return i; }
    }
    return -1;
  };

  for (let i = 0; i < FISH_COUNT; i++) {
    const P = { cy: 1, sy: 0, cp: 1, sp: 0 };
    poses.push(P);
    const f = {
      mode: MODE_CRUISE,
      x: 0, y: 70, z: 0,
      vx: 0, vy: 0, vz: 0,
      tx: 0, ty: 70, tz: 0,
      perchIdx: -1,
      sitUntil: 0,
      item: null,
    };
    randomWaypoint(f);
    // Start scattered mid-air, already underway toward the waypoint.
    f.x = f.tx + (Math.random() - 0.5) * 80;
    f.y = f.ty + (Math.random() - 0.5) * 20;
    f.z = f.tz + (Math.random() - 0.5) * 80;
    f.vx = 4; f.vz = 4;
    const shape = makeFishShape();
    f.item = add({
      name:     `sky-goldfish-${i}`,
      color:    [245, 130, 40],
      colorFn:  makeFishColorFn(P),
      position: [f.x, f.y, f.z],
      sdf:      (px, py, pz) => {
        const x1 = px * P.cy - pz * P.sy;
        const z1 = px * P.sy + pz * P.cy;
        return shape(x1, py * P.cp - z1 * P.sp, py * P.sp + z1 * P.cp);
      },
      collides: false,
      // Tail-box corner sits at |(-1.13, ±0.42, 0.05)| ≈ 1.21 from the
      // origin at worst attitude; sphere bound covers any rotation.
      boundingRadius: 1.45,
    });
    fish.push(f);
  }

  let lastTimeMs = performance.now();

  return {
    update(timeMs) {
      const dt = Math.min((timeMs - lastTimeMs) / 1000, 0.1);
      lastTimeMs = timeMs;
      if (dt <= 0) return;
      const t = timeMs / 1000;

      // ── zeppelin: analytic circle; heading is the tangent (φ + 90°).
      const phi = t * ZEP_OMEGA;
      const heading = phi + Math.PI / 2;
      ZEP.cy = Math.cos(heading);
      ZEP.sy = Math.sin(heading);
      const zx = ZEP_R * Math.sin(phi);
      const zz = ZEP_R * Math.cos(phi);
      const zy = ZEP_BASE_Y + 10 * Math.sin(t * 0.13) + 4 * Math.sin(t * 0.049 + 1);
      envelope.position[0] = zx;
      envelope.position[1] = zy;
      envelope.position[2] = zz;
      basket.position[0] = zx;
      basket.position[1] = zy + ZEP_BASKET_DY;
      basket.position[2] = zz;

      // ── flock ──
      const ease = 1 - Math.exp(-dt / STEER_TAU);
      for (let i = 0; i < FISH_COUNT; i++) {
        const f = fish[i];
        const P = poses[i];

        if (f.mode === MODE_SIT) {
          // Breathe in place; launch along the approach corridor when done.
          f.item.position[1] = f.y + 0.06 * Math.sin(t * 3 + i);
          if (t >= f.sitUntil) {
            const p = perches[f.perchIdx];
            const alen = Math.sqrt(p.ax * p.ax + p.ay * p.ay + p.az * p.az) || 1;
            f.vx = (p.ax / alen) * 10;
            f.vy = (p.ay / alen) * 10;
            f.vz = (p.az / alen) * 10;
            perchOwner[f.perchIdx] = -1;
            f.perchIdx = -1;
            f.mode = MODE_CRUISE;
            randomWaypoint(f);
          }
          continue;
        }

        // Distance to current target.
        const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Mode transitions on arrival.
        if (f.mode === MODE_CRUISE && dist < 12) {
          const idx = Math.random() < 0.45 ? claimPerch(i) : -1;
          if (idx >= 0) {
            const p = perches[idx];
            f.perchIdx = idx;
            f.tx = p.x + p.ax; f.ty = p.y + p.ay; f.tz = p.z + p.az;
            f.mode = MODE_STAGE;
          } else {
            randomWaypoint(f);
          }
        } else if (f.mode === MODE_STAGE && dist < 4) {
          const p = perches[f.perchIdx];
          f.tx = p.x; f.ty = p.y; f.tz = p.z;
          f.mode = MODE_FINAL;
        } else if (f.mode === MODE_FINAL && dist < 0.7) {
          const p = perches[f.perchIdx];
          f.x = p.x; f.y = p.y; f.z = p.z;
          f.vx = f.vy = f.vz = 0;
          P.cy = Math.cos(p.yaw); P.sy = Math.sin(p.yaw);
          P.cp = 1; P.sp = 0;
          f.item.position[0] = p.x;
          f.item.position[1] = p.y;
          f.item.position[2] = p.z;
          f.mode = MODE_SIT;
          f.sitUntil = t + 6 + Math.random() * 14;
          continue;
        }

        // Steer: ease velocity toward the target direction. FINAL slows
        // to a glide so the touchdown doesn't overshoot.
        const speed = f.mode === MODE_FINAL
          ? Math.max(FINAL_SPEED, Math.min(CRUISE_SPEED, dist * 1.2))
          : CRUISE_SPEED;
        if (dist > 1e-6) {
          const inv = speed / dist;
          f.vx += (dx * inv - f.vx) * ease;
          f.vy += (dy * inv - f.vy) * ease;
          f.vz += (dz * inv - f.vz) * ease;
        }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;

        // Face the velocity (yaw free, pitch clamped like a banking bird).
        const h2 = f.vx * f.vx + f.vz * f.vz;
        if (h2 > 1e-6) {
          const yaw = Math.atan2(f.vx, f.vz);
          let pitch = Math.atan2(f.vy, Math.sqrt(h2));
          if (pitch > 0.5) pitch = 0.5; else if (pitch < -0.5) pitch = -0.5;
          P.cy = Math.cos(yaw); P.sy = Math.sin(yaw);
          P.cp = Math.cos(pitch); P.sp = Math.sin(pitch);
        }
        f.item.position[0] = f.x;
        f.item.position[1] = f.y;
        f.item.position[2] = f.z;
      }
    },
  };
};
