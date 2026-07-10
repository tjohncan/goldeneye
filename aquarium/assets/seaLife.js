// aquarium/assets/seaLife.js — life under the cove's water: an orca
// that cruises a wide deep circuit and surfaces on a slow breath
// cycle (dorsal fin + back breaking the waves before sounding again),
// a reef shark tracing tighter, shallower laps whose raked fin slices
// above the surface at the crest of each pass, and an octopus drifting
// a slow patrol a body-height above its seafloor den — directly
// beneath the shark's ring, which passes within a body-length of it.
// Drama, free of charge.
//
// Both swim ANALYTIC paths — position is a closed-form function of
// time (circle with slowly-breathing radius + sinusoidal depth), so
// there's no integration drift and a backgrounded tab resumes exactly
// on-path. Heading and pitch come from the frame-to-frame position
// delta (finite difference), which stays correct under any combination
// of radius drift + depth cycle without path-specific math.
//
// Pose pattern matches harbor.js: one mutable pose object per creature,
// SDF + colorFn closures read its cos/sin fields, update() rewrites
// them once per frame. Orientation = yaw ∘ pitch (climb tilts the nose
// up); colorFns un-rotate through the same trig so the belly/back
// split and eye patches stay glued to the body at any attitude.

import {
  boxSDF, sphereSDF, capsuleBetweenSDF, roundedConeSDF, triPrismSDF,
  unionSDF, smoothUnionSDF, cutSDF,
  translateSDF, rotateXSDF, rotateYSDF, rotateZSDF,
} from '../../core/scene.js';
import { frameTimeSec } from '../../core/tracer.js';

/** @typedef {import('../../core/scene.js').Item} Item */

// ─────────────────────────── pose + frame ───────────────────────────

const makePose = (heading) => ({
  x: 0, y: 0, z: 0,
  heading,
  cy: Math.cos(heading), sy: Math.sin(heading),
  cp: 1, sp: 0,                                // pitch (positive = climbing)
});

// World-relative → creature-local: un-yaw, then un-pitch. Local +Z is
// the nose; pitch > 0 tips the nose toward +Y (climb).
const creatureFrame = (P, sdf) => (px, py, pz) => {
  const x1 = px * P.cy - pz * P.sy;
  const z1 = px * P.sy + pz * P.cy;
  return sdf(
    x1,
    py * P.cp - z1 * P.sp,
    py * P.sp + z1 * P.cp,
  );
};

// ─────────────────────────── orca ───────────────────────────

const ORCA = makePose(0);

// Flukes — one CONTINUOUS fan: two wide-chord lobes whose bases overlap
// solid across the centre (no gap), swept aft, with only a SHALLOW notch
// bitten from the trailing centre. Reads as a real orca fan, not two
// separate blades. Each lobe is a triPrism laid flat (rotateZ) and swept
// aft (rotateY); a small 45°-rotated box carves the notch. The lobes'
// front centre is filled by the tail-stock cone when unioned.
const orcaFlukeLobe = (side) => translateSDF([0, 2.0, -17.0],
  rotateYSDF(side * 0.40,
    rotateZSDF(-side * Math.PI / 2, triPrismSDF(0.45, 2.9, 7.8))));
const orcaFlukes = cutSDF(
  translateSDF([0, 2.0, -20.5], rotateYSDF(Math.PI / 4, boxSDF([1.3, 1.2, 1.3]))),
  unionSDF(orcaFlukeLobe(1), orcaFlukeLobe(-1)),
);

// Pectoral paddles — broad tapering blades laid flat (rotateZ) and
// swept aft (rotateY). A wide chord keeps them oar-like paddles rather
// than spikes; one per side, replacing the old flat spanning slab.
const orcaPectoral = (side) => translateSDF([side * 0.8, -3.4, 6.2],
  rotateYSDF(side * 0.45,
    rotateZSDF(-side * Math.PI / 2, triPrismSDF(0.32, 2.0, 5.2))));

const orcaShape = unionSDF(
  smoothUnionSDF(1.0,
    capsuleBetweenSDF([0, 0, -10], [0, 0, 10], 5.2),
    translateSDF([0, 0.3, 11.5], sphereSDF(5.4)),
    // Tail stock as a tapered cone (was a constant-radius tube): eases
    // the body down to the peduncle so the pre-tail narrowing is smooth.
    roundedConeSDF([0, 1.8, -17.5], [0, 0.4, -10], 1.3, 4.5),
  ),
  orcaFlukes,                                                      // forked, notched flukes
  translateSDF([0, 4.9, 1.0], rotateXSDF(-0.2, triPrismSDF(0.26, 1.5, 6.6))), // tall dorsal, tapered to a point
  orcaPectoral(1), orcaPectoral(-1),                               // broad swept pectoral paddles
);

const orcaColorFn = (lpx, lpy, lpz) => {
  // Un-rotate to body frame so the markings ride the body.
  const x1 = lpx * ORCA.cy - lpz * ORCA.sy;
  const z1 = lpx * ORCA.sy + lpz * ORCA.cy;
  const by = lpy * ORCA.cp - z1 * ORCA.sp;
  const bz = lpy * ORCA.sp + z1 * ORCA.cp;
  const ax = Math.abs(x1);
  // White postocular patch — the orca's signature.
  const pdy = by - 2.4, pdz = bz - 9.0;
  if (ax > 2.5 && pdy * pdy / (1.1 * 1.1) + pdz * pdz / (2.4 * 2.4) < 1) {
    return [230, 232, 235];
  }
  // Fluke fan — dark on top, pale underside, split at the thin blade's
  // mid-plane (y ≈ 2). Only the fan lives this far aft (bz < -17.5), so
  // colour by which face a ray struck, not by body height.
  if (bz < -17.5) return by > 2.0 ? [28, 30, 36] : [235, 238, 240];
  // Gray saddle behind the dorsal — an oval blaze rather than a hard
  // box, so it reads as a natural marking from above.
  const sz = bz + 3.5;
  if (by > 2.0 && sz * sz / (2.8 * 2.8) + ax * ax / (3.6 * 3.6) < 1) return [150, 155, 165];
  // Pectoral paddles ride LOW (belly height) but are fins, not belly —
  // colour by fin, not by height, so their tops don't read white from
  // above. They alone reach past ax 4.4 down here.
  if (by < -2.6 && ax > 4.4 && bz > 3 && bz < 9) return [28, 30, 36];
  // White belly + chin.
  if (by < -2.6) return [235, 238, 240];
  if (by < -1.0 && bz > 8) return [235, 238, 240];
  return [28, 30, 36];                                               // black body
};

// ─────────────────────────── shark ───────────────────────────

const SHARK = makePose(0);

// Pectoral — a thin triangle laid flat (rotateZ) so it tapers to the
// tip, swept aft by rotateY. One per side, replacing the old flat
// spanning slab.
const sharkPectoral = (side) => translateSDF([side * 0.5, -1.0, 1.8],
  rotateYSDF(side * 0.55,
    rotateZSDF(-side * Math.PI / 2, triPrismSDF(0.12, 0.62, 2.4))));

const sharkShape = unionSDF(
  smoothUnionSDF(0.6,
    // Wide mid-body, then ONE tapered cone easing back to the slim
    // peduncle — a single conic segment (roundedConeSDF) reads as a
    // smooth continuous taper and is cheaper than stacking capsules.
    capsuleBetweenSDF([0, 0, -0.8], [0, 0, 4.2], 1.55),
    roundedConeSDF([0, 0.35, -6.6], [0, 0, -0.8], 0.6, 1.55),   // reaches UNDER the caudal so the fin roots flush, no gap
    translateSDF([0, -0.1, 5.5], sphereSDF(1.15)),
  ),
  translateSDF([0, 1.4, 0.2], rotateXSDF(-0.5, triPrismSDF(0.15, 1.05, 2.8))),    // raked dorsal, tapered to a point
  translateSDF([0, 0.4, -6.0], rotateXSDF(-0.6, triPrismSDF(0.13, 0.95, 2.9))),   // caudal — long upper lobe, rooted into the peduncle
  translateSDF([0, 0.35, -6.0], rotateXSDF(Math.PI + 0.5, triPrismSDF(0.13, 0.6, 1.5))), // caudal — short lower lobe
  sharkPectoral(1), sharkPectoral(-1),                                            // swept, tapered pectorals
);

const sharkColorFn = (lpx, lpy, lpz) => {
  const x1 = lpx * SHARK.cy - lpz * SHARK.sy;
  const z1 = lpx * SHARK.sy + lpz * SHARK.cy;
  const by = lpy * SHARK.cp - z1 * SHARK.sp;
  const bz = lpy * SHARK.sp + z1 * SHARK.cp;
  const ax = Math.abs(x1);
  // Eye dots either side of the snout.
  const edx = ax - 1.15, edy = by - 0.35, edz = bz - 4.6;
  if (edx * edx + edy * edy + edz * edz < 0.12) return [15, 15, 18];
  // Fins share the back's gray — a distinct tip tone blended oddly
  // with bright water/sky at this resolution (fins are ~1px wide, so
  // any third tone reads as mismatch, not detail).
  // Pectorals + the caudal's lower lobe ride low but are fins, not
  // belly — paint them the back-gray so their tops don't read white.
  if (bz < -5.5) return [104, 116, 130];                             // tail / caudal region
  if (by < -0.4 && ax > 1.5 && bz > -0.5 && bz < 4) return [104, 116, 130]; // pectorals
  if (by > 0.4) return [104, 116, 130];                              // back + fins
  if (by < -0.4) return [225, 228, 230];                             // white belly
  return [160, 168, 178];                                            // flank band
};

// ─────────────────────────── octopus ───────────────────────────

const OCTO = makePose(0);
OCTO.ps = 1;                                   // arm-splay pulse scale

// Mantle pair + eight single-segment arms splayed outward-down with a
// slight swirl (each arm's foot angle leads its root by 0.35 rad, so
// the skirt reads mid-stride rather than star-symmetric). 10 primitives
// — the cost ceiling that kept it out of round one — but its AABB is
// small and seafloor-local, so rays only pay when actually looking at
// the den.
//
// The arm bundle is kept SEPARATE from the mantle so the jet-pulse can
// breathe it: the SDF below scales the arms' horizontal frame by the
// mutable OCTO.ps (bunch in quick, splay out slow) — exact scaled-SDF
// form d = s·sdf(p/s), no per-frame closure rebuilds.
const octoMantleShape = smoothUnionSDF(1.2,
  translateSDF([0, 1.8, -1.2], sphereSDF(4.2)),          // mantle
  translateSDF([0, 0.6, 1.8], sphereSDF(3.4)),           // head, eyes side (+Z)
);
const octoArmsShape = (() => {
  const parts = [];
  for (let k = 0; k < 8; k++) {
    const a  = (k + 0.5) * Math.PI / 4;
    const a2 = a + 0.35;
    parts.push(capsuleBetweenSDF(
      [2.2 * Math.cos(a), -2.0, 2.2 * Math.sin(a)],
      [8.5 * Math.cos(a2), -5.8, 8.5 * Math.sin(a2)],
      0.62,
    ));
  }
  return unionSDF(...parts);
})();
const octopusSdf = (lpx, lpy, lpz) => {
  const x1 = lpx * OCTO.cy - lpz * OCTO.sy;
  const z1 = lpx * OCTO.sy + lpz * OCTO.cy;
  const by = lpy * OCTO.cp - z1 * OCTO.sp;
  const bz = lpy * OCTO.sp + z1 * OCTO.cp;
  const dMantle = octoMantleShape(x1, by, bz);
  const s = OCTO.ps;
  const dArms = octoArmsShape(x1 / s, by, bz / s) * s;
  return dMantle < dArms ? dMantle : dArms;
};

const octopusColorFn = (lpx, lpy, lpz) => {
  const x1 = lpx * OCTO.cy - lpz * OCTO.sy;
  const z1 = lpx * OCTO.sy + lpz * OCTO.cy;
  const by = lpy * OCTO.cp - z1 * OCTO.sp;
  const bz = lpy * OCTO.sp + z1 * OCTO.cp;
  // Eyes — pale discs with a horizontal slit pupil, both sides of the
  // head.
  const edx = Math.abs(x1) - 2.1, edy = by - 2.6, edz = bz - 1.9;
  if (edx * edx + edy * edy + edz * edz < 0.72) {
    if (Math.abs(edy) < 0.24) return [22, 20, 22];         // slit pupil
    return [212, 200, 176];
  }
  // Underside — pale sucker tone.
  if (by < -2.4) return [206, 164, 128];
  // Chromatophore mottle, drifting slowly — octopuses shimmer.
  const t = frameTimeSec;
  const mottle = Math.sin(x1 * 0.9 + t * 0.3) * Math.cos(bz * 1.1 - t * 0.23)
               + Math.sin(by * 1.3 + 1.7) * 0.5;
  if (mottle >  0.7) return [188, 102, 70];
  if (mottle < -0.5) return [128, 60, 44];
  return [168, 84, 58];
};

// ─────────────────────────── circuits ───────────────────────────

// Closed-form swim path: circle around (cx, cz) whose radius breathes
// slowly, plus a sinusoidal depth cycle. Returns nothing — writes into
// the shared scratch triple.
const _pos = [0, 0, 0];
const pathAt = (c, t) => {
  const r   = c.baseR + c.rAmp * Math.sin(t * c.rFreq + c.rPhase);
  const phi = c.phi0 + t * c.angSpeed;
  _pos[0] = c.cx + r * Math.sin(phi);
  _pos[1] = c.baseY + c.yAmp * Math.sin(t * c.yFreq + c.yPhase);
  _pos[2] = c.cz + r * Math.cos(phi);
  return _pos;
};

// All circuits tuned a touch SLOW of the first draft — the player
// should be able to chase anything down for a close look.

// Orca: wide deep laps mid-cove, ~2 min per revolution. Depth cycle
// crests at -29 — back + dorsal above the waterline — and sounds
// toward -141, with update() clamping the dive to the seafloor's
// actual depth (the fixed cycle used to bury it nose-first in the
// shallower reaches). Circuit recentered clear of the octopus den.
const ORCA_PATH = {
  cx: -40, cz: 400, baseR: 175, rAmp: 20, rFreq: 0.021, rPhase: 1.0,
  angSpeed: 2 * Math.PI / 125, phi0: 0,
  baseY: -85, yAmp: 56, yFreq: 0.085, yPhase: 0,
};
const ORCA_PITCH_MAX = 0.25;

// Shark: tighter, quicker than the orca, shallow. Crest raised ~0.5 so
// the raked dorsal cuts a decisive ~2.5 above the surface (was reading
// as a marginal breach) — the back's top still sits 0.25 UNDER at
// crest, so it's a fin slicing the water, not a surfboarding hull.
const SHARK_PATH = {
  cx: 85, cz: 235, baseR: 75, rAmp: 18, rFreq: 0.033, rPhase: 2.0,
  angSpeed: 2 * Math.PI / 56, phi0: 2.1,
  baseY: -29.0, yAmp: 2.2, yFreq: 0.7, yPhase: 0.7,
};
const SHARK_PITCH_MAX = 0.20;

// Octopus: floating a body-height off the seafloor now (buried-in-the-
// sand was the first draft; a drifting hover reads better and shows
// off the arms), riding a gentle vertical breath around its den.
const OCTO_PATH = {
  cx: 110, cz: 200, baseR: 13, rAmp: 2, rFreq: 0.02, rPhase: 0,
  angSpeed: 2 * Math.PI / 95, phi0: 1.0,
  baseY: -47.5, yAmp: 2.2, yFreq: 0.3, yPhase: 0,
};
const OCTO_PITCH_MAX = 0.12;

// Update one creature: move to the path point (optionally clamped
// above the seafloor via `floorY` — the analytic depth cycle knows
// nothing about the terrain under it), derive yaw/pitch from the
// position delta, write pose trig + item position. A clamped stretch
// reads as the animal following the bottom.
const advance = (P, item, path, t, pitchMax, floorY) => {
  const p = pathAt(path, t);
  if (floorY !== undefined) {
    const floor = floorY(p[0], p[2]) + 10;
    if (p[1] < floor) p[1] = floor;
  }
  const dx = p[0] - P.x, dy = p[1] - P.y, dz = p[2] - P.z;
  const h2 = dx * dx + dz * dz;
  if (h2 > 1e-8) {
    P.heading = Math.atan2(dx, dz);
    let pitch = Math.atan2(dy, Math.sqrt(h2));
    if (pitch > pitchMax) pitch = pitchMax;
    else if (pitch < -pitchMax) pitch = -pitchMax;
    P.cy = Math.cos(P.heading);
    P.sy = Math.sin(P.heading);
    P.cp = Math.cos(pitch);
    P.sp = Math.sin(pitch);
  }
  P.x = p[0]; P.y = p[1]; P.z = p[2];
  item.position[0] = p[0];
  item.position[1] = p[1];
  item.position[2] = p[2];
};

/**
 * Register the sea life via the outside-tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @param {{ floorY: (px: number, pz: number) => number }} opts
 *        seafloor height lookup (outside.js's groundHeight) — clamps
 *        the orca's dives above the terrain.
 * @returns {{ update: (timeMs: number) => void }}
 */
export const addToScene = (add, { floorY }) => {
  const t0 = performance.now() / 1000;
  const orcaStart  = pathAt(ORCA_PATH, t0);
  ORCA.x = orcaStart[0]; ORCA.y = orcaStart[1]; ORCA.z = orcaStart[2];
  const orca = add({
    name:     'cove-orca',
    color:    [28, 30, 36],
    colorFn:  orcaColorFn,
    position: [ORCA.x, ORCA.y, ORCA.z],
    sdf:      creatureFrame(ORCA, orcaShape),
    // Body reach (≈21.7) drives the horizontal bound again — the fan
    // flukes tuck inside it (tip radial ≈ 21.3). Y set by the dorsal +
    // pitch (≈16.5).
    boundingBox: [22.5, 17, 22.5],
  });

  const sharkStart = pathAt(SHARK_PATH, t0);
  SHARK.x = sharkStart[0]; SHARK.y = sharkStart[1]; SHARK.z = sharkStart[2];
  const shark = add({
    name:     'cove-shark',
    color:    [104, 116, 130],
    colorFn:  sharkColorFn,
    position: [SHARK.x, SHARK.y, SHARK.z],
    sdf:      creatureFrame(SHARK, sharkShape),
    // Caudal upper lobe (rooted lower/forward now): apex ≈ (Y 2.8, Z-7.6)
    // in level flight (6.0 + 2.9·sin0.6). Its radial √(2.8² + 7.6²) ≈ 8.1
    // tips toward horizontal under the ±0.20 pitch (Z reaches ≈ 8.0) —
    // that, not the snout (6.7), sets the bound; 8.5 keeps a little margin.
    boundingBox: [8.5, 6.1, 8.5],
  });

  const octoStart = pathAt(OCTO_PATH, t0);
  OCTO.x = octoStart[0]; OCTO.y = octoStart[1]; OCTO.z = octoStart[2];
  const octopus = add({
    name:     'cove-octopus',
    color:    [168, 84, 58],
    colorFn:  octopusColorFn,
    position: [OCTO.x, OCTO.y, OCTO.z],
    sdf:      octopusSdf,
    // Arm feet reach (8.5 + 0.62) × max splay 1.14 ≈ 10.4 radially;
    // tips dip to ~-7.3 at max pitch.
    boundingBox: [10.7, 7.5, 10.7],
  });

  return {
    update(timeMs) {
      const t = timeMs / 1000;
      advance(ORCA,  orca,    ORCA_PATH,  t, ORCA_PITCH_MAX, floorY);
      advance(SHARK, shark,   SHARK_PATH, t, SHARK_PITCH_MAX);
      advance(OCTO,  octopus, OCTO_PATH,  t, OCTO_PITCH_MAX);
      // Jet pulse: arms snap IN over a quarter cycle, splay back out
      // over the rest — the classic cephalopod stroke.
      const phase = (t * 0.4) % 1;
      OCTO.ps = phase < 0.25
        ? 1.14 - (phase / 0.25) * 0.36
        : 0.78 + ((phase - 0.25) / 0.75) * 0.36;
    },
  };
};
