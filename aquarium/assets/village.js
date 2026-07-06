// aquarium/assets/village.js — static structures in the cove: a small
// fishing village on the back plateau (cottages + a fishmonger's shop),
// a striped lighthouse on the beach knoll, scattered trees, and the
// wooden dock reaching from the beach into the water on the shack
// door's X column.
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
const ROOF_OVERHANG = 0.7;

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
// doors and windows stay glued to their faces at any yaw. Structure:
//   - roof: shingle rows in alternating shades
//   - front face (+z): door with brass-dot knob, glowing windows with
//     dark muntin cross, optional painted-goldfish shop sign
//   - side faces: one glowing window per storey
//   - walls: plaster with darker corner trim
const makeCottageColorFn = ({ hx, bodyHalfH, hz, roofH, yaw, pal, stories, fishSign }) => {
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
    if (lpy > eaveY - 0.06) {
      const onGable = Math.abs(x) > hx - 0.15 && Math.abs(z) < hz + 0.02;
      if (!onGable) {
        const row = Math.floor((lpy - eaveY) / 0.8) & 1;
        return row === 0 ? pal.roof : pal.roofDark;
      }
      // Gable-end plaster with a small trim-ringed attic vent.
      const ax = z, ay = lpy - (eaveY + roofH * 0.38);
      const d2 = ax * ax + ay * ay;
      if (d2 < 0.30 * 0.30) return TRIM;
      return pal.wallLight;
    }

    const onFront = z > hz - 0.12;
    if (onFront) {
      // Shop sign — painted goldfish on a dark board above the door.
      if (fishSign) {
        const fx = x - doorX, fy = lpy - (baseY + 2 * bodyHalfH * 0.80);
        if (Math.abs(fx) < 2.3 && Math.abs(fy) < 1.0) {
          const bodyD = (fx + 0.5) * (fx + 0.5) / (1.30 * 1.30) + fy * fy / (0.52 * 0.52);
          if (bodyD < 1) {
            // Eye dot near the nose.
            const ex = fx + 1.45, ey = fy - 0.12;
            if (ex * ex + ey * ey < 0.012) return [25, 22, 20];
            return [238, 128, 42];
          }
          // Tail — triangle flaring off the body's +x end.
          if (fx > 0.7 && fx < 1.9 && Math.abs(fy) < (fx - 0.7) * 0.62) {
            return [238, 128, 42];
          }
          return [66, 48, 34];               // sign board
        }
      }
      // Door — vertical planks, brass knob dot.
      if (Math.abs(x - doorX) < 1.05 && lpy < baseY + 3.1) {
        const kx = x - (doorX + 0.62), ky = lpy - (baseY + 1.55);
        if (kx * kx + ky * ky < 0.016) return [205, 170, 75];
        const grain = Math.sin(x * 7) * 0.35;
        return [96 + 18 * grain, 66 + 12 * grain, 42 + 8 * grain];
      }
      // Front windows — one each side of the door (skip the door slot).
      for (let i = 0; i < rows.length; i++) {
        const wy = rows[i];
        if (Math.abs(lpy - wy) < 0.78) {
          const wxs = fishSign ? [hx * 0.38] : [-hx * 0.52, hx * 0.52];
          for (let j = 0; j < wxs.length; j++) {
            const dx = x - wxs[j];
            if (Math.abs(dx) < (fishSign ? 1.35 : 0.80)) {
              if (Math.abs(dx) < 0.07 || Math.abs(lpy - wy) < 0.07) return TRIM;
              return GLOW;
            }
          }
        }
      }
    } else if (Math.abs(x) > hx - 0.12) {
      // Side windows — one per storey, centered along the side.
      for (let i = 0; i < rows.length; i++) {
        const wy = rows[i];
        if (Math.abs(lpy - wy) < 0.72 && Math.abs(z) < 0.75) {
          if (Math.abs(z) < 0.07 || Math.abs(lpy - wy) < 0.07) return TRIM;
          return GLOW;
        }
      }
    }

    // Plaster walls, darker band at the footing, trim at the corners.
    if (lpy < baseY + 0.5) return pal.wallDark;
    if (Math.abs(x) > hx - 0.35 && Math.abs(z) > hz - 0.35) return TRIM;
    const mottle = Math.sin(x * 1.7 + lpy * 2.3) * Math.cos(z * 1.9);
    return mottle > 0.55 ? pal.wallLight : pal.wall;
  };
};


// ─────────────────────────── lighthouse ───────────────────────────

// Red/white striped tower + gallery disc + lamp room + dome cap, one
// item. The lamp-room band paints over-bright so the light reads lit
// from every angle without a separate glow item.
const LH_TOWER_HH   = 9.0;
const LH_TOWER_R    = 2.6;
const LH_GALLERY_R  = 3.4;
const LH_LAMP_HH    = 1.3;
const LH_LAMP_R     = 1.9;

const lighthouseSdf = unionSDF(
  translateSDF([0, -2.9, 0], cylinderSDF(LH_TOWER_HH, LH_TOWER_R)),
  translateSDF([0, +6.35, 0], cylinderSDF(0.35, LH_GALLERY_R)),
  translateSDF([0, +7.95, 0], cylinderSDF(LH_LAMP_HH, LH_LAMP_R)),
  translateSDF([0, +9.6, 0], sphereSDF(2.15)),
);

// Tower stripes are over-bright (~1.8×): the tower is a vertical
// cylinder under the straight-up sun — ambient-only shading — and at
// native tint the red bands would read near-black from the dock.
const lighthouseColorFn = (lpx, lpy, lpz) => {
  if (lpy > +9.9) return [150, 45, 40];                     // dome cap
  if (lpy > +6.6) return [660, 610, 390];                   // lamp room — over-bright
  if (lpy > +5.9) return [58, 54, 58];                      // gallery ring
  // Door at the tower base, facing the village (-Z side).
  if (lpy < -9.2 && lpz < -1.6 && Math.abs(lpx) < 0.95) return [70, 50, 34];
  const band = Math.floor((lpy + 11.9) / 2.9) & 1;          // tower stripes
  return band === 0 ? [385, 119, 94] : [439, 432, 414];
};


// ─────────────────────────── trees ───────────────────────────

// Trunk + three-lobe canopy, mid-height local origin. Two size
// variants; per-tree tint seed varies the leaf mottle.
const makeTreeSdf = (sc) => smoothUnionSDF(0.8 * sc,
  capsuleBetweenSDF([0, -5.5 * sc, 0], [0, 0.5 * sc, 0], 0.55 * sc),
  translateSDF([0, 2.0 * sc, 0],            sphereSDF(2.8 * sc)),
  translateSDF([1.5 * sc, 3.4 * sc, 0.8 * sc],  sphereSDF(2.2 * sc)),
  translateSDF([-1.4 * sc, 3.3 * sc, -0.6 * sc], sphereSDF(2.0 * sc)),
);

const makeTreeColorFn = (seed) => (lpx, lpy, lpz) => {
  if (lpy > -1.2) {
    const mottle = Math.sin(lpx * 1.9 + seed) * Math.cos(lpy * 1.6 + seed * 0.7)
                 + Math.sin(lpz * 2.1 - seed) * 0.5;
    if (mottle >  0.7) return [96, 148, 64];
    if (mottle < -0.5) return [48, 92, 44];
    return [66, 120, 54];
  }
  const bark = Math.sin(lpy * 4.2 + seed) * 0.5;
  return [92 + 14 * bark, 66 + 10 * bark, 44 + 6 * bark];
};

// Tree extents (× scale): canopy side reach 3.7; canopy top +5.6; the
// trunk capsule's END CAP dips to -(5.5 + 0.55) = -6.05 — buried below
// grade, which is what roots do, but the bound must still cover it.
const TREE_LOCAL_TOP = 5.6;   // canopy top in local Y (× scale)


// ─────────────────────────── dock ───────────────────────────

// Deck slab on three post pairs. The deck's shore end buries into the
// rising beach (the sand simply covers it — that's how docks root);
// the sea end floats 2.6 above the water. Post bottoms all land below
// the local beach surface.
const DOCK_DECK_HALF = [2.4, 0.2, 22];
const DOCK_POST_HH   = 11;
const dockSdf = (() => {
  const parts = [translateSDF([0, +11.0, 0], boxSDF(DOCK_DECK_HALF))];
  for (const pz of [-14, 0, +14]) {
    for (const px of [-1.8, +1.8]) {
      parts.push(translateSDF([px, -0.2, pz], cylinderSDF(DOCK_POST_HH, 0.45)));
    }
  }
  return unionSDF(...parts);
})();

const dockColorFn = (lpx, lpy, lpz) => {
  if (lpy > 10.5) {
    // Deck planks — boards run across the walkway, dark seams between.
    const seam = Math.abs(((lpz % 1.4) + 1.4) % 1.4 - 0.7);
    if (seam > 0.62) return [72, 52, 34];
    const board = Math.floor(lpz / 1.4) & 1;
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
  // (fishSign) anchors the row nearest the shack.
  const cottages = [
    { name: 'village-shop',        x: -48, z: -72, yaw: +0.18,
      hx: 9.0, bodyHalfH: 5.5, hz: 7.0, roofH: 5.5, stories: 2, fishSign: true,
      pal: { wall: [242, 230, 202], wallLight: [252, 242, 218], wallDark: [188, 172, 148],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-cottage-sage', x: -14, z: -94, yaw: -0.26,
      hx: 6.0, bodyHalfH: 4.5, hz: 5.5, roofH: 4.5, stories: 1, fishSign: false,
      pal: { wall: [200, 210, 180], wallLight: [216, 224, 196], wallDark: [156, 166, 140],
             roof: [104, 110, 122], roofDark: [86, 92, 104], trim: [88, 76, 58] } },
    { name: 'village-cottage-tall', x: +22, z: -80, yaw: +0.42,
      hx: 6.5, bodyHalfH: 7.0, hz: 6.0, roofH: 5.5, stories: 2, fishSign: false,
      pal: { wall: [232, 208, 150], wallLight: [244, 222, 168], wallDark: [186, 164, 116],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-cottage-blue', x: +48, z: -100, yaw: -0.55,
      hx: 5.5, bodyHalfH: 4.2, hz: 5.0, roofH: 4.2, stories: 1, fishSign: false,
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
    // Roof-ridge perch, centered.
    perches.push(perchFacingHome(b.x, plateauY + H + 0.4, b.z, 0, 12, 0));
  }

  // ── lighthouse on the beach knoll (+Z, still above the waterline) ──
  // Ground at (55, 70) sits ≈ -20.6; base embeds 0.5 into the sand.
  const LH_X = 55, LH_Z = 70;
  const LH_BASE_Y = -21.1;
  const LH_POS_Y  = LH_BASE_Y + 11.9;       // local Y 0 at tower mid-reference
  add({
    name:     'village-lighthouse',
    color:    [214, 66, 52],
    colorFn:  lighthouseColorFn,
    position: [LH_X, LH_POS_Y, LH_Z],
    sdf:      lighthouseSdf,
    boundingBox: [LH_GALLERY_R + 0.1, 12.0, LH_GALLERY_R + 0.1],
  });
  // Gallery-rim perch facing the open sea; cap-top perch facing home.
  perches.push({ x: LH_X, y: LH_POS_Y + 6.9, z: LH_Z + LH_GALLERY_R - 0.3,
                 yaw: 0, ax: 0, ay: 9, az: +7 });
  perches.push(perchFacingHome(LH_X, LH_POS_Y + 11.9, LH_Z, 0, 10, 0));

  // ── trees ──
  // Village green + beach pair + one statement tree on the mesa top.
  const trees = [
    { x: +3,  z: -62, sc: 1.0, seed: 1.3, baseY: plateauY, perch: true  },
    { x: -33, z: -88, sc: 0.9, seed: 3.7, baseY: plateauY, perch: false },
    { x: +38, z: -64, sc: 1.1, seed: 5.1, baseY: plateauY, perch: true  },
    { x: -58, z: -106, sc: 0.95, seed: 7.9, baseY: plateauY, perch: false },
    { x: +42, z: +48, sc: 1.05, seed: 2.4, baseY: plateauY - 0.3, perch: false },
    { x: -38, z: +40, sc: 0.9, seed: 6.2, baseY: plateauY - 0.1, perch: false },
    { x: mesa.x + 15, z: mesa.z + 9, sc: 1.25, seed: 4.4,
      baseY: mesa.surfaceY(mesa.x + 15, mesa.z + 9), perch: true },
  ];
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const midY = t.baseY + 5.5 * t.sc;
    add({
      name:     `village-tree-${i}`,
      color:    [66, 120, 54],
      colorFn:  makeTreeColorFn(t.seed),
      position: [t.x, midY, t.z],
      sdf:      makeTreeSdf(t.sc),
      boundingBox: [3.8 * t.sc, 6.2 * t.sc, 3.8 * t.sc],
    });
    if (t.perch) {
      perches.push(perchFacingHome(t.x, midY + TREE_LOCAL_TOP * t.sc + 0.35, t.z, 0, 9, 0));
    }
  }

  // ── dock ──
  // Aligned with the shack door's X column; deck top 2.6 above sea
  // level. Boosted-speed fish can hop through the 0.4-thick deck
  // between frames — harmless (no region boundary involved), same as
  // the collides:false water surface.
  const DOCK_X = 15, DOCK_Z = 112;
  const DOCK_POS_Y = seaLevelY + 2.4 - 11.2;  // deck top at seaLevel+2.6; local +11.2
  add({
    name:     'village-dock',
    color:    [140, 105, 68],
    colorFn:  dockColorFn,
    position: [DOCK_X, DOCK_POS_Y, DOCK_Z],
    sdf:      dockSdf,
    boundingBox: [2.5, 11.5, DOCK_DECK_HALF[2] + 0.2],
  });
  // Two perches on the sea-end corners of the deck, facing out.
  const deckTopY = DOCK_POS_Y + 11.2;
  perches.push({ x: DOCK_X - 1.9, y: deckTopY + 0.3, z: DOCK_Z + 21.2,
                 yaw: 0, ax: 0, ay: 8, az: +10 });
  perches.push({ x: DOCK_X + 1.9, y: deckTopY + 0.3, z: DOCK_Z + 21.2,
                 yaw: 0, ax: 0, ay: 8, az: +10 });

  // ── mesa-rim perches ──
  // Two spots near the flat top's edge, seated on the exact rendered
  // surface via mesa.surfaceY.
  const rim = [
    { x: mesa.x + 2,  z: mesa.z + 28 },
    { x: mesa.x + 26, z: mesa.z - 12 },
  ];
  for (const r of rim) {
    perches.push(perchFacingHome(r.x, mesa.surfaceY(r.x, r.z) + 0.35, r.z, 0, 12, 0));
  }

  return { perches };
};
