// aquarium/assets/seaLife.js — life under the cove's water: an orca
// that cruises a wide deep circuit and surfaces on a slow breath
// cycle (dorsal fin + back breaking the waves before sounding again),
// a reef shark tracing tighter, shallower laps whose raked fin slices
// above the surface at the crest of each pass, and an octopus walking
// a slow patrol around its seafloor den — directly beneath the
// shark's ring, which passes within a body-length of it. Drama, free
// of charge.
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
  boxSDF, sphereSDF, capsuleBetweenSDF,
  unionSDF, smoothUnionSDF,
  translateSDF, rotateXSDF,
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

const orcaShape = unionSDF(
  smoothUnionSDF(1.0,
    capsuleBetweenSDF([0, 0, -10], [0, 0, 10], 5.2),
    translateSDF([0, 0.3, 11.5], sphereSDF(5.4)),
    capsuleBetweenSDF([0, 0.4, -10], [0, 1.8, -17.5], 2.0),
  ),
  translateSDF([0, 2.0, -19.5], boxSDF([6.5, 0.5, 2.2])),            // horizontal flukes
  translateSDF([0, 8.0, 1.0], rotateXSDF(-0.25, boxSDF([0.28, 3.2, 1.4]))), // tall dorsal
  translateSDF([0, -3.4, 6.5], boxSDF([5.0, 0.35, 1.8])),            // pectoral paddles
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
  // Gray saddle behind the dorsal fin.
  if (by > 2.0 && bz > -6 && bz < -1 && ax > 1.2) return [150, 155, 165];
  // White belly + chin.
  if (by < -2.6) return [235, 238, 240];
  if (by < -1.0 && bz > 8) return [235, 238, 240];
  return [28, 30, 36];                                               // black body
};

// ─────────────────────────── shark ───────────────────────────

const SHARK = makePose(0);

const sharkShape = unionSDF(
  smoothUnionSDF(0.5,
    capsuleBetweenSDF([0, 0, -4.2], [0, 0, 4.2], 1.55),
    translateSDF([0, -0.1, 5.5], sphereSDF(1.15)),
  ),
  translateSDF([0, 2.6, 0.2], rotateXSDF(-0.5, boxSDF([0.16, 1.5, 1.0]))),  // raked dorsal
  translateSDF([0, 0.9, -6.2], rotateXSDF(-0.55, boxSDF([0.14, 2.2, 1.1]))), // tail (vertical)
  translateSDF([0, -1.0, 1.8], boxSDF([2.6, 0.14, 0.9])),                    // pectorals
);

const sharkColorFn = (lpx, lpy, lpz) => {
  const x1 = lpx * SHARK.cy - lpz * SHARK.sy;
  const z1 = lpx * SHARK.sy + lpz * SHARK.cy;
  const by = lpy * SHARK.cp - z1 * SHARK.sp;
  const bz = lpy * SHARK.sp + z1 * SHARK.cp;
  // Eye dots either side of the snout.
  const edx = Math.abs(x1) - 1.15, edy = by - 0.35, edz = bz - 4.6;
  if (edx * edx + edy * edy + edz * edz < 0.12) return [15, 15, 18];
  // Fins share the back's gray — a distinct tip tone blended oddly
  // with bright water/sky at this resolution (fins are ~1px wide, so
  // any third tone reads as mismatch, not detail).
  if (by > 0.4) return [104, 116, 130];                              // back + fins
  if (by < -0.4) return [225, 228, 230];                             // white belly
  return [160, 168, 178];                                            // flank band
};

// ─────────────────────────── octopus ───────────────────────────

const OCTO = makePose(0);

// Mantle pair + eight single-segment arms splayed outward-down with a
// slight swirl (each arm's foot angle leads its root by 0.35 rad, so
// the skirt reads mid-stride rather than star-symmetric). 10 primitives
// — the cost ceiling that kept it out of round one — but its AABB is
// small and seafloor-local, so rays only pay when actually looking at
// the den.
const octopusShape = (() => {
  const parts = [
    smoothUnionSDF(1.2,
      translateSDF([0, 1.8, -1.2], sphereSDF(4.2)),        // mantle
      translateSDF([0, 0.6, 1.8], sphereSDF(3.4)),         // head, eyes side (+Z)
    ),
  ];
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

// Orca: wide deep laps mid-cove, ~95 s per revolution. Depth cycle
// crests at -29 — back + dorsal above the waterline — and sounds to
// -141. Path stays over water deeper than the body everywhere.
const ORCA_PATH = {
  cx: 0, cz: 350, baseR: 170, rAmp: 25, rFreq: 0.021, rPhase: 1.0,
  angSpeed: 2 * Math.PI / 95, phi0: 0,
  baseY: -85, yAmp: 56, yFreq: 0.11, yPhase: 0,
};
const ORCA_PITCH_MAX = 0.25;

// Shark: tighter, faster, shallow — fin tip clears the surface by ~1.8
// at each depth crest, classic silhouette from the dock.
const SHARK_PATH = {
  cx: 85, cz: 235, baseR: 75, rAmp: 18, rFreq: 0.033, rPhase: 2.0,
  angSpeed: 2 * Math.PI / 42, phi0: 2.1,
  baseY: -29.5, yAmp: 2.2, yFreq: 0.9, yPhase: 0.7,
};
const SHARK_PITCH_MAX = 0.20;

// Octopus: a slow walk around its den on the shallow seafloor —
// 70 s a lap, arms brushing the sand (floor there runs -57.7..-60.2;
// arm tips reach -60.8, so the deep-side steps bury slightly — sand).
const OCTO_PATH = {
  cx: 110, cz: 200, baseR: 13, rAmp: 2, rFreq: 0.02, rPhase: 0,
  angSpeed: 2 * Math.PI / 70, phi0: 1.0,
  baseY: -54.4, yAmp: 0.5, yFreq: 0.45, yPhase: 0,
};
const OCTO_PITCH_MAX = 0.10;

// Update one creature: move to the path point, derive yaw/pitch from
// the position delta, write pose trig + item position.
const advance = (P, item, path, t, pitchMax) => {
  const p = pathAt(path, t);
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
 * Register the orca + shark via the outside-tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @returns {{ update: (timeMs: number) => void }}
 */
export const addToScene = (add) => {
  const t0 = performance.now() / 1000;
  const orcaStart  = pathAt(ORCA_PATH, t0);
  ORCA.x = orcaStart[0]; ORCA.y = orcaStart[1]; ORCA.z = orcaStart[2];
  const orca = add({
    name:     'cove-orca',
    color:    [28, 30, 36],
    colorFn:  orcaColorFn,
    position: [ORCA.x, ORCA.y, ORCA.z],
    sdf:      creatureFrame(ORCA, orcaShape),
    // Worst-case yaw+pitch: body reach 21.7, vertical extent 11.5
    // (raked dorsal top) → 21.7·sin(0.25) + 11.5·cos(0.25) ≈ 16.5 on
    // Y; 22.5 on X/Z.
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
    // The raked tail box's rotation grows its Z-reach to 6.2 +
    // 2.2·sin(0.55) + 1.1·cos(0.55) ≈ 8.3 — that, not the snout,
    // sets the horizontal bound.
    boundingBox: [8.5, 6.1, 8.5],
  });

  const octoStart = pathAt(OCTO_PATH, t0);
  OCTO.x = octoStart[0]; OCTO.y = octoStart[1]; OCTO.z = octoStart[2];
  const octopus = add({
    name:     'cove-octopus',
    color:    [168, 84, 58],
    colorFn:  octopusColorFn,
    position: [OCTO.x, OCTO.y, OCTO.z],
    sdf:      creatureFrame(OCTO, octopusShape),
    // Arm feet reach 8.5 + 0.62 radially; tips dip to -6.4 upright and
    // ~-7.3 at max pitch (the 9.1 radial reach tilted by 0.10).
    boundingBox: [9.7, 7.5, 9.7],
  });

  return {
    update(timeMs) {
      const t = timeMs / 1000;
      advance(ORCA,  orca,    ORCA_PATH,  t, ORCA_PITCH_MAX);
      advance(SHARK, shark,   SHARK_PATH, t, SHARK_PITCH_MAX);
      advance(OCTO,  octopus, OCTO_PATH,  t, OCTO_PITCH_MAX);
    },
  };
};
