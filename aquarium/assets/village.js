// aquarium/assets/village.js — static structures in the cove: a small
// fishing village on the back plateau (cottages + a fishmonger's shop),
// a striped lighthouse on the beach knoll, scattered trees, and the
// wooden dock reaching from the beach into the water on the shack
// door's X column.
//
// SCALE: everything here is sized against the SHACK (62 wide, ridge at
// +33) — a cottage is a real building beside it, the lighthouse
// overtops it, trees reach past the cottage eaves. First draft had the
// village at ~45% of this and it read as a toy train-set diorama next
// to the building you exit.
//
// Everything here is inert — no per-frame update. Each structure is ONE
// Item built from a handful of primitives, with all visual richness
// (doors, glowing windows, shingle rows, the painted goldfish shop
// sign, plank stripes) carried by colorFns — the repo's pattern for
// detail that costs only at ray hits, not per march step.
//
// Buildings are yaw-rotated for an organic, unplanned-village read. The
// rotation is baked into each SDF at build time (rotateYSDF); colorFns
// mirror the same query transform via shared per-building trig, exactly
// like bowl.js's shipFrame / shipPlankColorFn pairing. AABBs use the
// worst-case rotated footprint.
//
// Returns the list of PERCH points (roof ridges, treetops, lighthouse
// gallery, dock end, mesa rim) that skyLife.js's flying goldfish land
// on. Each perch carries a staging offset (`ax, ay, az`) — an approach
// point safely clear of walls — so a descending fish never has to fly
// through geometry to reach it.

import {
  boxSDF, cylinderSDF, sphereSDF, capsuleBetweenSDF, triPrismSDF,
  unionSDF, smoothUnionSDF, translateSDF, rotateYSDF,
} from '../../core/scene.js';

/** @typedef {import('../../core/scene.js').Item} Item */

/**
 * @typedef {{
 *   x: number, y: number, z: number,  // where the fish sits
 *   yaw: number,                      // heading the fish faces while perched
 *   ax: number, ay: number, az: number, // staging offset — approach point at
 *                                       // perch + (ax, ay, az), clear of walls
 * }} Perch
 */

// World-axis half-extents of a yaw-rotated hx × hz footprint.
const yawFootprint = (hx, hz, yaw) => {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  return [hx * c + hz * s, hx * s + hz * c];
};

// Perch facing the world origin (the shack) — the natural "look at the
// village green" pose for a perched fish.
const perchFacingHome = (x, y, z, ax, ay, az) =>
  ({ x, y, z, yaw: Math.atan2(-x, -z), ax, ay, az });


// ─────────────────────────── cottages ───────────────────────────

// One cottage = plaster body box + overhanging gable roof (triPrism).
// Local origin at the building's mid-height so the AABB centers there.
const ROOF_OVERHANG = 1.5;

const makeCottageSdf = ({ hx, bodyHalfH, hz, roofH, yaw }) => {
  const H = 2 * bodyHalfH + roofH;             // total height, base to ridge
  const baseY = -H / 2;
  const shape = unionSDF(
    translateSDF([0, baseY + bodyHalfH, 0], boxSDF([hx, bodyHalfH, hz])),
    translateSDF([0, baseY + 2 * bodyHalfH, 0],
      triPrismSDF(hx + ROOF_OVERHANG, hz + ROOF_OVERHANG, roofH)),
  );
  return rotateYSDF(yaw, shape);
};

// Cottage colorFn — paints in the PRE-ROTATION frame (x, z below) so
// doors and windows stay glued to their faces at any yaw. `sc` scales
// the human-sized fittings (door, windows, sign, trim) with the
// building. Structure:
//   - roof: shingle rows in alternating shades
//   - front face (+z): door with brass-dot knob, glowing windows with
//     dark muntin cross, optional painted-goldfish shop sign
//   - side faces: one glowing window per storey
//   - walls: plaster with darker corner trim
const makeCottageColorFn = ({ hx, bodyHalfH, hz, roofH, yaw, pal, stories, fishSign, sc }) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const H     = 2 * bodyHalfH + roofH;
  const baseY = -H / 2;
  const eaveY = baseY + 2 * bodyHalfH;
  const GLOW  = [560, 440, 230];             // over-bright amber; reads lit at wall-ambient
  const TRIM  = pal.trim;
  // Storey window-row heights (local Y).
  const rows = stories === 2
    ? [baseY + 2 * bodyHalfH * 0.32, baseY + 2 * bodyHalfH * 0.72]
    : [baseY + 2 * bodyHalfH * 0.60];
  const doorX = fishSign ? -hx * 0.42 : 0;

  return (lpx, lpy, lpz) => {
    const x = lpx * c - lpz * s;
    const z = lpx * s + lpz * c;

    // Roof (anything above the eave line — the prism's faces + gables).
    if (lpy > eaveY - 0.12) {
      const onGable = Math.abs(x) > hx - 0.3 && Math.abs(z) < hz + 0.05;
      if (!onGable) {
        const row = Math.floor((lpy - eaveY) / (0.75 * sc)) & 1;
        return row === 0 ? pal.roof : pal.roofDark;
      }
      // Gable-end plaster with a small trim-ringed attic vent.
      const ax = z, ay = lpy - (eaveY + roofH * 0.38);
      const d2 = ax * ax + ay * ay;
      if (d2 < 0.32 * sc * 0.32 * sc) return TRIM;
      return pal.wallLight;
    }

    const onFront = z > hz - 0.25;
    if (onFront) {
      // Shop sign — painted goldfish on a dark board above the door.
      if (fishSign) {
        const fx = x - doorX, fy = lpy - (baseY + 2 * bodyHalfH * 0.80);
        if (Math.abs(fx) < 2.3 * sc && Math.abs(fy) < 1.0 * sc) {
          const bodyD = (fx + 0.5 * sc) * (fx + 0.5 * sc) / (1.30 * sc * 1.30 * sc)
                      + fy * fy / (0.52 * sc * 0.52 * sc);
          if (bodyD < 1) {
            // Eye dot near the nose.
            const ex = fx + 1.45 * sc, ey = fy - 0.12 * sc;
            if (ex * ex + ey * ey < 0.012 * sc * sc) return [25, 22, 20];
            return [238, 128, 42];
          }
          // Tail — triangle flaring off the body's +x end.
          if (fx > 0.7 * sc && fx < 1.9 * sc && Math.abs(fy) < (fx - 0.7 * sc) * 0.62) {
            return [238, 128, 42];
          }
          return [66, 48, 34];               // sign board
        }
      }
      // Door — vertical planks, brass knob dot.
      if (Math.abs(x - doorX) < 1.05 * sc && lpy < baseY + 3.1 * sc) {
        const kx = x - (doorX + 0.62 * sc), ky = lpy - (baseY + 1.55 * sc);
        if (kx * kx + ky * ky < 0.02 * sc * sc) return [205, 170, 75];
        const grain = Math.sin(x * 7 / sc) * 0.35;
        return [96 + 18 * grain, 66 + 12 * grain, 42 + 8 * grain];
      }
      // Front windows — one each side of the door (skip the door slot).
      for (let i = 0; i < rows.length; i++) {
        const wy = rows[i];
        if (Math.abs(lpy - wy) < 0.78 * sc) {
          const wxs = fishSign ? [hx * 0.38] : [-hx * 0.52, hx * 0.52];
          for (let j = 0; j < wxs.length; j++) {
            const dx = x - wxs[j];
            if (Math.abs(dx) < (fishSign ? 1.35 : 0.80) * sc) {
              if (Math.abs(dx) < 0.08 * sc || Math.abs(lpy - wy) < 0.08 * sc) return TRIM;
              return GLOW;
            }
          }
        }
      }
    } else if (Math.abs(x) > hx - 0.25) {
      // Side windows — one per storey, centered along the side.
      for (let i = 0; i < rows.length; i++) {
        const wy = rows[i];
        if (Math.abs(lpy - wy) < 0.72 * sc && Math.abs(z) < 0.75 * sc) {
          if (Math.abs(z) < 0.08 * sc || Math.abs(lpy - wy) < 0.08 * sc) return TRIM;
          return GLOW;
        }
      }
    }

    // Plaster walls, darker band at the footing, trim at the corners.
    if (lpy < baseY + 0.5 * sc) return pal.wallDark;
    if (Math.abs(x) > hx - 0.35 * sc && Math.abs(z) > hz - 0.35 * sc) return TRIM;
    const mottle = Math.sin(x * 1.7 / sc + lpy * 2.3 / sc) * Math.cos(z * 1.9 / sc);
    return mottle > 0.55 ? pal.wallLight : pal.wall;
  };
};


// ─────────────────────────── lighthouse ───────────────────────────

// Red/white striped tower + gallery disc + lamp room + dome cap, one
// item. Sized like a real lighthouse against the shack: base -21.6,
// cap top +42.8 — it overtops the shack's ridge (+33) by a storey.
// The lamp-room band paints over-bright so the light reads lit from
// every angle without a separate glow item; the tower stripes are
// over-bright too (vertical cylinder under a straight-up sun shades
// ambient-only — native tint would read near-black from the dock).
const LH_TOWER_HH   = 26;
const LH_TOWER_R    = 5.2;
const LH_GALLERY_R  = 7.0;
const LH_BASE_Y     = -21.6;                  // embeds ~1 into the knoll
const LH_POS_Y      = 10.6;                   // item origin: mid of base..cap top
const LH_HALF_Y     = 32.4;

const lighthouseSdf = unionSDF(
  translateSDF([0, -6.2, 0], cylinderSDF(LH_TOWER_HH, LH_TOWER_R)),   // base..+30.4
  translateSDF([0, +20.2, 0], cylinderSDF(0.8, LH_GALLERY_R)),        // gallery disc
  translateSDF([0, +24.0, 0], cylinderSDF(3.0, 4.0)),                 // lamp room
  translateSDF([0, +27.8, 0], sphereSDF(4.4)),                        // dome cap
);

const lighthouseColorFn = (lpx, lpy, lpz) => {
  if (lpy > +26.2) return [150, 45, 40];                    // dome cap
  if (lpy > +21.0) return [660, 610, 390];                  // lamp room — over-bright
  if (lpy > +19.3) return [58, 54, 58];                     // gallery ring
  // Door at the tower base, facing the village (-Z side).
  if (lpy < -25.4 && lpz < -3.2 && Math.abs(lpx) < 1.9) return [70, 50, 34];
  const band = Math.floor((lpy + LH_HALF_Y) / 6.5) & 1;     // tower stripes
  return band === 0 ? [385, 119, 94] : [439, 432, 414];
};


// ─────────────────────────── trees ───────────────────────────

// Trunk + three-lobe canopy, mid-height local origin. Scales run
// ~2.0–2.6 so a village tree tops out around a cottage's ridge.
const makeTreeSdf = (sc) => smoothUnionSDF(0.8 * sc,
  capsuleBetweenSDF([0, -5.5 * sc, 0], [0, 0.5 * sc, 0], 0.55 * sc),
  translateSDF([0, 2.0 * sc, 0],            sphereSDF(2.8 * sc)),
  translateSDF([1.5 * sc, 3.4 * sc, 0.8 * sc],  sphereSDF(2.2 * sc)),
  translateSDF([-1.4 * sc, 3.3 * sc, -0.6 * sc], sphereSDF(2.0 * sc)),
);

const makeTreeColorFn = (seed, sc) => (lpx, lpy, lpz) => {
  if (lpy > -1.2 * sc) {
    const mottle = Math.sin(lpx * 1.9 / sc + seed) * Math.cos(lpy * 1.6 / sc + seed * 0.7)
                 + Math.sin(lpz * 2.1 / sc - seed) * 0.5;
    if (mottle >  0.7) return [96, 148, 64];
    if (mottle < -0.5) return [48, 92, 44];
    return [66, 120, 54];
  }
  const bark = Math.sin(lpy * 4.2 / sc + seed) * 0.5;
  return [92 + 14 * bark, 66 + 10 * bark, 44 + 6 * bark];
};

// Tree extents (× scale): canopy side reach 3.7; canopy top +5.6; the
// trunk capsule's END CAP dips to -(5.5 + 0.55) = -6.05 — buried below
// grade, which is what roots do, but the bound must still cover it.
const TREE_LOCAL_TOP = 5.6;   // canopy top in local Y (× scale)


// ─────────────────────────── dock ───────────────────────────

// Deck slab on three post pairs. The deck's shore end buries into the
// rising beach (that's how docks root); the sea end floats 2.8 above
// the water. Post bottoms all land below the local beach surface.
// Item origin at y = -36 (mid of post-bottom .. deck-top).
const DOCK_DECK_HALF = [3.4, 0.28, 30];
const dockSdf = (() => {
  const parts = [translateSDF([0, +13.5, 0], boxSDF(DOCK_DECK_HALF))];
  for (const pz of [-20, 0, +20]) {
    for (const px of [-2.5, +2.5]) {
      parts.push(translateSDF([px, -0.3, pz], cylinderSDF(13.5, 0.65)));
    }
  }
  return unionSDF(...parts);
})();

const dockColorFn = (lpx, lpy, lpz) => {
  if (lpy > 13.0) {
    // Deck planks — boards run across the walkway, dark seams between.
    const seam = Math.abs(((lpz % 2.0) + 2.0) % 2.0 - 1.0);
    if (seam > 0.86) return [72, 52, 34];
    const board = Math.floor(lpz / 2.0) & 1;
    return board === 0 ? [150, 112, 72] : [132, 98, 62];
  }
  return [88, 72, 52];                                      // weathered posts
};


// ──────────────────────────── scene build ────────────────────────────

/**
 * Register all village structures via the caller-supplied outside-
 * tagged `add` helper.
 *
 * @param {(item: Item) => Item} add
 * @param {{
 *   plateauY: number,
 *   seaLevelY: number,
 *   mesa: { x: number, z: number, topR: number,
 *           surfaceY: (px: number, pz: number) => number },
 * }} opts
 * @returns {{ perches: Perch[] }}
 */
export const addToScene = (add, { plateauY, seaLevelY, mesa }) => {
  /** @type {Perch[]} */
  const perches = [];

  // ── cottages on the back plateau ──
  // Yaws vary so the lane between them bends; the fishmonger's shop
  // (fishSign) anchors the row nearest the shack. `ridgePerches` > 1
  // spreads extra landing spots along the bigger roofs.
  const cottages = [
    { name: 'village-shop',        x: -62, z: -84, yaw: +0.18, sc: 2.2,
      hx: 19.0, bodyHalfH: 12.0, hz: 15.0, roofH: 12.0, stories: 2, fishSign: true, ridgePerches: 2,
      pal: { wall: [242, 230, 202], wallLight: [252, 242, 218], wallDark: [188, 172, 148],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-cottage-sage', x: -14, z: -104, yaw: -0.26, sc: 2.2,
      hx: 13.0, bodyHalfH: 10.0, hz: 12.0, roofH: 10.0, stories: 1, fishSign: false, ridgePerches: 1,
      pal: { wall: [200, 210, 180], wallLight: [216, 224, 196], wallDark: [156, 166, 140],
             roof: [104, 110, 122], roofDark: [86, 92, 104], trim: [88, 76, 58] } },
    { name: 'village-cottage-tall', x: +34, z: -92, yaw: +0.42, sc: 2.3,
      hx: 14.0, bodyHalfH: 15.5, hz: 13.0, roofH: 12.0, stories: 2, fishSign: false, ridgePerches: 2,
      pal: { wall: [232, 208, 150], wallLight: [244, 222, 168], wallDark: [186, 164, 116],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-cottage-blue', x: +72, z: -118, yaw: -0.55, sc: 2.0,
      hx: 12.0, bodyHalfH: 9.0, hz: 11.0, roofH: 9.0, stories: 1, fishSign: false, ridgePerches: 1,
      pal: { wall: [176, 194, 210], wallLight: [192, 208, 222], wallDark: [138, 156, 174],
             roof: [96, 102, 114], roofDark: [80, 86, 98], trim: [80, 72, 62] } },
  ];

  for (const b of cottages) {
    const H = 2 * b.bodyHalfH + b.roofH;
    const [fx, fz] = yawFootprint(b.hx + ROOF_OVERHANG, b.hz + ROOF_OVERHANG, b.yaw);
    add({
      name:     b.name,
      color:    b.pal.wall,
      colorFn:  makeCottageColorFn(b),
      position: [b.x, plateauY + H / 2, b.z],
      sdf:      makeCottageSdf(b),
      boundingBox: [fx, H / 2, fz],
    });
    // Roof-ridge perches. The ridge runs along the building's pre-
    // rotation X axis; off-center perches rotate with the yaw.
    const ridgeY = plateauY + H + 0.4;
    if (b.ridgePerches === 1) {
      perches.push(perchFacingHome(b.x, ridgeY, b.z, 0, 14, 0));
    } else {
      const d = b.hx * 0.55;
      const rc = Math.cos(b.yaw), rs = Math.sin(b.yaw);
      perches.push(perchFacingHome(b.x + d * rc, ridgeY, b.z - d * rs, 0, 14, 0));
      perches.push(perchFacingHome(b.x - d * rc, ridgeY, b.z + d * rs, 0, 14, 0));
    }
  }

  // ── lighthouse on the beach knoll (+Z, still above the waterline) ──
  // Ground at (55, 70) sits ≈ -20.6; base embeds ~1 into the sand.
  const LH_X = 55, LH_Z = 70;
  add({
    name:     'village-lighthouse',
    color:    [385, 119, 94],
    colorFn:  lighthouseColorFn,
    position: [LH_X, LH_POS_Y, LH_Z],
    sdf:      lighthouseSdf,
    boundingBox: [LH_GALLERY_R + 0.2, LH_HALF_Y, LH_GALLERY_R + 0.2],
  });
  // Gallery-rim perch facing the open sea; cap-top perch facing home.
  perches.push({ x: LH_X, y: LH_POS_Y + 21.4, z: LH_Z + LH_GALLERY_R - 0.6,
                 yaw: 0, ax: 0, ay: 12, az: +10 });
  perches.push(perchFacingHome(LH_X, LH_POS_Y + 32.6, LH_Z, 0, 12, 0));

  // ── trees ──
  // Village green + beach pair + one statement tree on the mesa top.
  const trees = [
    { x: +8,  z: -64,  sc: 2.2, seed: 1.3, baseY: plateauY, perch: true  },
    { x: -32, z: -72,  sc: 2.0, seed: 3.7, baseY: plateauY, perch: true  },
    { x: +44, z: -62,  sc: 2.4, seed: 5.1, baseY: plateauY, perch: true  },
    { x: -64, z: -116, sc: 2.1, seed: 7.9, baseY: plateauY, perch: false },
    { x: +46, z: +46,  sc: 2.3, seed: 2.4, baseY: plateauY - 0.3, perch: true },
    { x: -40, z: +38,  sc: 2.0, seed: 6.2, baseY: plateauY - 0.1, perch: false },
    { x: mesa.x + 15, z: mesa.z + 9, sc: 2.6, seed: 4.4,
      baseY: mesa.surfaceY(mesa.x + 15, mesa.z + 9), perch: true },
  ];
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const midY = t.baseY + 5.5 * t.sc;
    add({
      name:     `village-tree-${i}`,
      color:    [66, 120, 54],
      colorFn:  makeTreeColorFn(t.seed, t.sc),
      position: [t.x, midY, t.z],
      sdf:      makeTreeSdf(t.sc),
      boundingBox: [3.8 * t.sc, 6.2 * t.sc, 3.8 * t.sc],
    });
    if (t.perch) {
      perches.push(perchFacingHome(t.x, midY + TREE_LOCAL_TOP * t.sc + 0.35, t.z, 0, 11, 0));
    }
  }

  // ── dock ──
  // Aligned with the shack door's X column; deck top 2.8 above sea
  // level, shore end rooted right where the beach surface crosses
  // deck height (z ≈ 92). Boosted-speed fish can hop through the
  // 0.56-thick deck between frames — harmless (no region boundary
  // involved), same as the collides:false water surface.
  const DOCK_X = 15, DOCK_Z = 122;
  const DOCK_POS_Y = -36;                     // deck top = seaLevelY + 2.8 = -22.2
  add({
    name:     'village-dock',
    color:    [140, 105, 68],
    colorFn:  dockColorFn,
    position: [DOCK_X, DOCK_POS_Y, DOCK_Z],
    sdf:      dockSdf,
    boundingBox: [3.5, 14.1, DOCK_DECK_HALF[2] + 0.3],
  });
  // Two perches on the sea-end corners of the deck, facing out.
  const deckTopY = seaLevelY + 2.8;
  perches.push({ x: DOCK_X - 2.7, y: deckTopY + 0.3, z: DOCK_Z + 28.5,
                 yaw: 0, ax: 0, ay: 9, az: +12 });
  perches.push({ x: DOCK_X + 2.7, y: deckTopY + 0.3, z: DOCK_Z + 28.5,
                 yaw: 0, ax: 0, ay: 9, az: +12 });

  // ── mesa-rim perches ──
  // Three spots near the flat top's edge, seated on the exact rendered
  // surface via mesa.surfaceY.
  const rim = [
    { x: mesa.x + 2,  z: mesa.z + 28 },
    { x: mesa.x + 26, z: mesa.z - 12 },
    { x: mesa.x - 24, z: mesa.z + 14 },
  ];
  for (const r of rim) {
    perches.push(perchFacingHome(r.x, mesa.surfaceY(r.x, r.z) + 0.35, r.z, 0, 12, 0));
  }

  return { perches };
};
