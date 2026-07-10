// aquarium/assets/village.js — static structures in the cove: the
// fishing village on the far side of the mesa (cottages, a fishmonger's
// shop, and a proper manor), a lighthouse out on the +X headland, trees
// at two scales, and the wooden dock reaching from the beach into the
// water on the shack door's X column.
//
// SCALE + PLACEMENT: the shack is a ONE-ROOM kitchen — real houses
// dwarf it. The manor's ridge (+57) runs double the shack's (+33);
// even the shop out-tops it. And the village lives BEYOND the mesa
// now (z ≈ -290..-440, the unused back-bowl between the mountain
// ranges), so the shack stands alone at the center and discovering
// the village means rounding the mesa — separation sells the size.
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

// Perch facing the world origin (the shack) — the natural "look back
// toward the center of the bowl" pose for a perched fish.
const perchFacingHome = (x, y, z, ax, ay, az) =>
  ({ x, y, z, yaw: Math.atan2(-x, -z), ax, ay, az });


// ─────────────────────────── the lane ───────────────────────────

// The village's organizing spine: a dirt lane running from the mesa's
// east skirt down through the settlement, painted into the ground
// exactly like the railway (zero Items, hit-time cost only, behind a
// cheap bounds reject). Buildings sit alternately left and right of
// it, facades turned toward it. One straight segment reads fine at
// this length; the fisheye supplies the curve.
const LANE_AX = 75,   LANE_AZ = -245;
const LANE_BX = -125, LANE_BZ = -475;
const LANE_DX = LANE_BX - LANE_AX;
const LANE_DZ = LANE_BZ - LANE_AZ;
const LANE_LEN2 = LANE_DX * LANE_DX + LANE_DZ * LANE_DZ;

/**
 * Paint sample for the lane at a ground point; [r, g, b] on the lane,
 * null elsewhere. Same contract as train.js's paintTrack.
 * @param {number} lpx @param {number} lpz
 * @returns {number[] | null}
 */
export const paintLane = (lpx, lpz) => {
  if (lpx < LANE_BX - 12 || lpx > LANE_AX + 12 ||
      lpz < LANE_BZ - 12 || lpz > LANE_AZ + 12) return null;
  let t = ((lpx - LANE_AX) * LANE_DX + (lpz - LANE_AZ) * LANE_DZ) / LANE_LEN2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const d = Math.hypot(lpx - (LANE_AX + LANE_DX * t), lpz - (LANE_AZ + LANE_DZ * t));
  if (d > 6.5) return null;
  if (d > 5.2) return [126, 138, 92];                      // worn grass verge
  if (Math.abs(d - 2.2) < 0.5) return [168, 148, 108];     // wheel ruts
  return [150, 132, 96];                                   // packed dirt
};


// ─────────────────────────── cottages ───────────────────────────

// One building = plaster body box + overhanging gable roof (triPrism).
// Local origin at the building's mid-height so the AABB centers there.
const ROOF_OVERHANG = 1.8;

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
// the human-sized fittings with the building. Structure:
//   - roof: shingle rows in alternating shades
//   - front face (+z): door with brass-dot knob, FRAMED 4-pane windows
//     with a wood sill (so they read as windows, never doorways), and
//     an optional painted-goldfish shop sign
//   - side faces: one framed window per storey
//   - walls: a material texture per building (`wallStyle`: clapboard
//     shadow lines / offset brick courses / coursed stone), corner
//     quoins, footing course, and an optional climbing vine — all
//     drawn from the building's own palette so tints stay coherent
const _vhash = (a, b) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const makeCottageColorFn = ({ hx, bodyHalfH, hz, roofH, yaw, pal, stories,
                              fishSign, sc, wallStyle = 'clapboard', vine = false }) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const H     = 2 * bodyHalfH + roofH;
  const baseY = -H / 2;
  const eaveY = baseY + 2 * bodyHalfH;
  const GLOW  = [560, 440, 230];             // over-bright amber; reads lit at wall-ambient
  const TRIM  = pal.trim;
  const SILL  = [120, 92, 60];
  // Walls are VERTICAL, so under the cove's straight-up sun they shade
  // ambient-only (~0.35) — plaster tints would read near-black and the
  // new material texture would vanish. B lifts every wall-face return
  // to roughly roof brightness (angled roofs catch ~0.72), the same
  // over-bright trick the sail and lighthouse use. The glowing panes
  // and the deliberately-dark door stay unboosted for contrast.
  const B = 1.6;
  const lit = (col) => [col[0] * B, col[1] * B, col[2] * B];
  // Storey window-row heights (local Y).
  const rows = stories === 2
    ? [baseY + 2 * bodyHalfH * 0.32, baseY + 2 * bodyHalfH * 0.72]
    : [baseY + 2 * bodyHalfH * 0.60];
  const doorX = fishSign ? -hx * 0.42 : 0;

  // Framed 4-pane window at (u, v) offset from its center; null off it.
  const windowAt = (u, v, halfU, halfV) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (v <= -halfV && v > -halfV - 0.24 * sc && au < halfU + 0.12 * sc) return lit(SILL);
    if (au > halfU || av > halfV) return null;
    const fr = 0.15 * sc;
    if (au > halfU - fr || av > halfV - fr) return lit(TRIM);   // outer frame
    if (au < 0.07 * sc || av < 0.07 * sc) return lit(TRIM);     // muntin cross
    return GLOW;                                                // lit pane
  };

  // Wall material at horizontal face-coord `a`, height `yr` above base.
  const wallTex = (a, yr) => {
    if (wallStyle === 'brick') {
      const Bh = 0.66 * sc, Bl = 1.4 * sc, M = 0.13 * sc;
      const course = Math.floor(yr / Bh);
      const off = (course & 1) ? Bl * 0.5 : 0;
      const col = Math.floor((a + off) / Bl);
      if (yr - course * Bh < M || (a + off) - col * Bl < M) return lit(pal.wallDark);
      const j = _vhash(course, col), base = j > 0.5 ? pal.wall : pal.wallLight;
      const d = (j - 0.5) * 14;
      return [(base[0] + d) * B, (base[1] + d) * B, (base[2] + d) * B];
    }
    if (wallStyle === 'stone') {
      const G = 0.95 * sc, M = 0.15 * sc;
      const cr = Math.floor(yr / G), jr = _vhash(cr, 7) * 0.5 * sc;
      const cc = Math.floor((a + jr) / G), jit = _vhash(cr, cc);
      if (yr - cr * G < M * (0.7 + jit) || (a + jr) - cc * G < M * (0.7 + jit)) return lit(pal.wallDark);
      const base = jit > 0.55 ? pal.wallLight : pal.wall, d = (_vhash(cc, cr) - 0.5) * 20;
      return [(base[0] + d) * B, (base[1] + d) * B, (base[2] + d) * B];
    }
    // clapboard — horizontal boards, a shadow groove at each board base
    const P = 1.0 * sc, b = ((yr % P) + P) % P;
    if (b < 0.12 * sc) return lit(pal.wallDark);
    const idx = Math.floor(yr / P), base = (idx & 1) ? pal.wall : pal.wallLight;
    const grain = Math.sin(a * 2.3 / sc + idx) * 5;
    return [(base[0] + grain) * B, (base[1] + grain) * B, (base[2] + grain) * B];
  };

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
      // Door — vertical planks, brass knob dot. Reaches the ground, so
      // it stays unmistakably a door against the mid-wall windows.
      if (Math.abs(x - doorX) < 1.05 * sc && lpy < baseY + 3.1 * sc) {
        const kx = x - (doorX + 0.62 * sc), ky = lpy - (baseY + 1.55 * sc);
        if (kx * kx + ky * ky < 0.02 * sc * sc) return [205, 170, 75];
        const grain = Math.sin(x * 7 / sc) * 0.35;
        return [96 + 18 * grain, 66 + 12 * grain, 42 + 8 * grain];
      }
      // Front windows — framed panes, one each side of the door.
      const wxs = fishSign ? [hx * 0.38] : [-hx * 0.52, hx * 0.52];
      const hU = fishSign ? 1.2 * sc : 0.72 * sc, hV = fishSign ? 0.72 * sc : 0.60 * sc;
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < wxs.length; j++) {
          const cW = windowAt(x - wxs[j], lpy - rows[i], hU, hV);
          if (cW !== null) return cW;
        }
      }
    } else if (Math.abs(x) > hx - 0.3) {
      // Side windows — one framed pane per storey.
      for (let i = 0; i < rows.length; i++) {
        const cW = windowAt(z, lpy - rows[i], 0.6 * sc, 0.58 * sc);
        if (cW !== null) return cW;
      }
    }

    // Footing course, then corner quoins.
    if (lpy < baseY + 0.5 * sc) return lit(pal.wallDark);
    if (Math.abs(x) > hx - 0.35 * sc && Math.abs(z) > hz - 0.35 * sc) return lit(TRIM);

    // Climbing vine on a front corner (wavy stem + hashed leaf blobs).
    if (vine && onFront) {
      const yr = lpy - baseY;
      const wob = Math.sin(yr * 0.9 / sc) * 0.6 * sc + Math.sin(yr * 2.7 / sc + 1) * 0.25 * sc;
      const cx = -hx + 1.4 * sc + wob;
      if (Math.abs(x - cx) < 0.16 * sc) return lit([58, 92, 44]);  // stem
      const li = Math.floor(yr / (0.7 * sc));
      const lx = cx + (_vhash(li, 3) - 0.5) * 2.2 * sc;
      const ly = baseY + (li + 0.5) * 0.7 * sc;
      const dx = x - lx, dy = lpy - ly;
      if (dx * dx + dy * dy < 0.42 * sc * 0.42 * sc) {
        return lit(_vhash(li, 5) > 0.5 ? [70, 110, 52] : [52, 86, 42]);
      }
    }

    // Wall material.
    const onSide = Math.abs(x) > hx - 0.3;
    return wallTex(onSide ? z : x, lpy - baseY);
  };
};


// ─────────────────────────── lighthouse ───────────────────────────

// Red/white striped tower + gallery disc + lamp room + dome cap, one
// item — out on the +X headland now (the plateau bluff overlooking the
// water), farther down-shore and grown to a real seamark: base -14,
// cap top ≈ +72, more than double the shack's ridge. The lamp-room
// band paints over-bright so the light reads lit from every angle
// without a separate glow item; the tower stripes are over-bright too
// (a vertical cylinder under a straight-up sun shades ambient-only —
// native tint would read near-black from the dock).
const LH_TOWER_HH   = 35;
const LH_TOWER_R    = 7.0;
const LH_GALLERY_R  = 9.4;
const LH_POS_Y      = 29;                     // item origin: mid of base..cap top
const LH_HALF_Y     = 43;

const lighthouseSdf = unionSDF(
  translateSDF([0, -8.0, 0], cylinderSDF(LH_TOWER_HH, LH_TOWER_R)),   // -14 .. +56 world
  translateSDF([0, +27.8, 0], cylinderSDF(1.0, LH_GALLERY_R)),        // gallery disc
  translateSDF([0, +32.6, 0], cylinderSDF(4.0, 5.4)),                 // lamp room
  translateSDF([0, +37.0, 0], sphereSDF(5.9)),                        // dome cap
);

// Livery: old-world whitewashed stone rather than candy stripes —
// warm white shaft (over-bright ~1.7×; a vertical cylinder under a
// straight-up sun shades ambient-only), faint weathering, a stone
// plinth, a cornice under the gallery, narrow window slits climbing
// the inland face, wrought-iron gallery, and a verdigris copper dome.
const lighthouseColorFn = (lpx, lpy, lpz) => {
  if (lpy > +34.9) return [128, 205, 172];                  // copper dome, patina
  if (lpy > +28.8) return [660, 610, 390];                  // lamp room — over-bright
  if (lpy > +26.6) return [58, 54, 58];                     // wrought-iron gallery
  if (lpy > +25.2) return [318, 306, 288];                  // cornice course
  // Door at the tower base, facing inland (-Z side).
  if (lpy < -36.6 && lpz < -4.3 && Math.abs(lpx) < 2.6) return [70, 50, 34];
  if (lpy < -36.0) return [300, 290, 274];                  // stone plinth
  // Window slits climbing the inland face.
  if (lpz < -3.0 && Math.abs(lpx) < 1.2) {
    if (Math.abs(lpy + 22) < 2.4 || Math.abs(lpy + 6) < 2.4 ||
        Math.abs(lpy - 10) < 2.4) return [42, 40, 46];
  }
  // Whitewashed shaft with faint weathering drift.
  const wear = Math.sin(lpy * 0.5) * 6 + Math.sin(lpx * 0.8 + lpz * 0.6) * 5;
  return [408 + wear, 398 + wear, 380 + wear];
};


// ─────────────────────────── trees ───────────────────────────

// Trunk + three-lobe canopy, mid-height local origin. Village trees
// run sc 3.0–3.6 (proportioned to the big houses); the beach pair
// stays modest; the mesa keeps its statement tree.
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

  // ── the village, beyond the mesa ──
  // Organized along THE LANE (see paintLane below) — the composition's
  // spine. Buildings alternate sides of it with facades turned toward
  // it, neighbors ~100-135 apart: a settlement that grew along a road,
  // not dice rolled from a cup. The fishmonger's shop anchors the
  // mesa-side end where the lane arrives; the manor presides mid-lane
  // behind a deeper setback. `ridgePerches` > 1 spreads extra landing
  // spots along big roofs.
  const cottages = [
    { name: 'village-shop',         x: 83, z: -300, yaw: -0.74, sc: 2.8,
      hx: 22.0, bodyHalfH: 14.0, hz: 17.0, roofH: 14.0, stories: 2, fishSign: true, ridgePerches: 2,
      wallStyle: 'brick', vine: false,
      pal: { wall: [242, 230, 202], wallLight: [252, 242, 218], wallDark: [188, 172, 148],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-cottage-tall', x: -52, z: -297, yaw: +2.42, sc: 3.2,
      hx: 17.0, bodyHalfH: 19.0, hz: 15.0, roofH: 15.0, stories: 2, fishSign: false, ridgePerches: 2,
      wallStyle: 'clapboard', vine: true,
      pal: { wall: [232, 208, 150], wallLight: [244, 222, 168], wallDark: [186, 164, 116],
             roof: [186, 96, 64], roofDark: [158, 78, 52], trim: [96, 70, 48] } },
    { name: 'village-manor',        x: -8, z: -424, yaw: -0.95, sc: 4.0,
      hx: 28.0, bodyHalfH: 24.0, hz: 22.0, roofH: 22.0, stories: 2, fishSign: false, ridgePerches: 2,
      wallStyle: 'stone', vine: false,
      pal: { wall: [226, 219, 202], wallLight: [240, 233, 216], wallDark: [178, 170, 152],
             roof: [88, 94, 108], roofDark: [72, 78, 92], trim: [92, 78, 58] } },
    { name: 'village-cottage-sage', x: -115, z: -403, yaw: +2.17, sc: 2.6,
      hx: 15.0, bodyHalfH: 11.5, hz: 13.5, roofH: 11.5, stories: 1, fishSign: false, ridgePerches: 1,
      wallStyle: 'clapboard', vine: true,
      pal: { wall: [200, 210, 180], wallLight: [216, 224, 196], wallDark: [156, 166, 140],
             roof: [104, 110, 122], roofDark: [86, 92, 104], trim: [88, 76, 58] } },
    { name: 'village-cottage-blue', x: -96, z: -500, yaw: -0.70, sc: 2.4,
      hx: 13.5, bodyHalfH: 10.0, hz: 12.0, roofH: 10.0, stories: 1, fishSign: false, ridgePerches: 1,
      wallStyle: 'brick', vine: false,
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
    // Roof physics pad — same two blocks as the shack (see outside.js):
    // an eave fill for the concave under-eave soffit trap, and a thin
    // ridge cap so the peak/gable tip can't be tunnelled into. Built in
    // the cottage's rotated frame.
    const eaveY = b.bodyHalfH - b.roofH / 2;
    add({
      name:      b.name + '-pad',
      color:     [0, 0, 0],
      position:  [b.x, plateauY + H / 2, b.z],
      sdf:       rotateYSDF(b.yaw, unionSDF(
        translateSDF([0, eaveY - 3, 0], boxSDF([b.hx + ROOF_OVERHANG, 3, b.hz + ROOF_OVERHANG])),
        translateSDF([0, eaveY + b.roofH * 0.42, 0],
          boxSDF([b.hx + ROOF_OVERHANG, b.roofH * 0.42, (b.hz + ROOF_OVERHANG) * 0.13])),
      )),
      invisible: true,
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

  // ── lighthouse on the +X headland ──
  // pz < 0 keeps it on the dry plateau bluff, right at the coast where
  // the beach hemisphere begins — visible down-shore from the dock.
  const LH_X = 150, LH_Z = -12;
  add({
    name:     'village-lighthouse',
    color:    [408, 398, 380],
    colorFn:  lighthouseColorFn,
    position: [LH_X, LH_POS_Y, LH_Z],
    sdf:      lighthouseSdf,
    boundingBox: [LH_GALLERY_R + 0.2, LH_HALF_Y + 0.2, LH_GALLERY_R + 0.2],
  });
  // Top-assembly physics pad: the gallery disc is 2 thin and the
  // lamp/cap junction is grazeable — a boosted fish could clip in near
  // the top at the right angle. One invisible solid (tracer drops it
  // at pack time) makes the whole crown a convex blocker; the gallery
  // rim stays a legal LANDING spot since sky-goldfish are scripted,
  // not physical.
  add({
    name:      'lighthouse-crown-pad',
    color:     [0, 0, 0],
    position:  [LH_X, LH_POS_Y, LH_Z],
    sdf:       unionSDF(
      translateSDF([0, +27.8, 0], cylinderSDF(1.8, LH_GALLERY_R + 0.2)),
      translateSDF([0, +35.0, 0], cylinderSDF(8.2, 7.0)),
    ),
    invisible: true,
  });
  // Gallery-rim perch facing the water; cap-top perch facing home.
  perches.push({ x: LH_X, y: LH_POS_Y + 29.2, z: LH_Z + LH_GALLERY_R - 0.8,
                 yaw: 0, ax: 0, ay: 13, az: +11 });
  perches.push(perchFacingHome(LH_X, LH_POS_Y + 43.3, LH_Z, 0, 13, 0));

  // ── trees ──
  // Big ones line the lane between buildings; the beach pair stays
  // modest; one statement tree on the mesa top.
  const trees = [
    { x: 112, z: -252, sc: 3.4, seed: 1.3, baseY: plateauY, perch: true  },
    { x: 0,   z: -290, sc: 3.0, seed: 3.7, baseY: plateauY, perch: false },
    { x: -48, z: -468, sc: 3.2, seed: 5.1, baseY: plateauY, perch: true  },
    { x: -160, z: -430, sc: 3.6, seed: 7.9, baseY: plateauY, perch: false },
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
  // deck height (z ≈ 92).
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
  // Physics pad under the deck: the visible deck is 0.56 thick and a
  // boosted cove fish moves 1.44/frame — it used to pass straight
  // through between physics samples. This invisible slab thickens the
  // COLLIDER to 2.4 (> displacement + 2·fishRadius) without touching
  // the visible proportions. invisible:true drops it from the tracer
  // at pack time; physics still sees it (collides defaults true). It
  // hugs the deck's underside so swimming beneath the dock, between
  // the posts, still works below y ≈ -24.8.
  add({
    name:      'village-dock-pad',
    color:     [0, 0, 0],
    position:  [DOCK_X, -23.45, DOCK_Z],
    sdf:       boxSDF([3.4, 1.15, 30]),
    invisible: true,
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
