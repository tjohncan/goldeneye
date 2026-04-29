// aquarium/world.js — bowl + ship + kitchen scene composition.
//
// Inside the bowl: rocks, plants, half-buried treasure chest, and a pirate
// ship — multi-stage tapered hull with the deck top held flat across all
// stages, mast with brass masthead and Jolly Roger flag, broken bowsprit
// jutting from the prow, anatomical mermaid figurehead at the bow.
//
// Outside the bowl: kitchen — chessboard floor, separate ceiling plane,
// four-legged light-wood table the bowl sits on, white runner, glass vase
// with a chunky symmetric flower, full-height black fridge + freezer with a
// kid's sailboat drawing on a paper sheet pinned to the door, kitchen
// counter spanning the back wall, sink + faucet beneath the window, big
// window with frame + sill on the back wall, framed Dutch-masters maritime
// painting and a tall closed door on the opposite wall, ceiling potlights.
//
// Items get a `boundingRadius` where it makes sense (props, ship/mermaid
// parts, kitchen pieces) so the tracer's per-ray bounding-sphere filter can
// drop them when a ray's path doesn't intersect their bounding sphere.
// Items also get a `regionKey` of 'bowl' or 'kitchen' where they live in
// exactly one region; the scene's `regionFn` maps any (px, py, pz) to its
// region. Items spanning regions (room walls, floor/ceiling planes, the
// fishbowl glass, the potlights cluster) are tagged with neither — they're
// always considered.

import {
  createScene, registerItem,
  sphereSDF, boxSDF, planeSDF, capsuleSDF, capsuleBetweenSDF, cylinderSDF, openTopBowlSDF,
  unionSDF, intersectionSDF, smoothUnionSDF, cutSDF, invertSDF,
  translateSDF, rotateXSDF, rotateYSDF, rotateZSDF,
} from '../core/scene.js';

/** Y-coordinate of the water surface (= bowl rim). */
export const WATER_SURFACE_Y = 6.25;

/** Lighting: sun straight up, gentle ambient. */
export const LIGHTING = {
  lightDir:   [0, 1, 0],
  ambient:    0.35,
  background: [0, 0, 0],
};

const BOWL_OUTER_R = 8.5;
const BOWL_INNER_R = 7.3;
const SAND_Y       = -1.5;
const ROOM_HALF_X  = 22;
const ROOM_HALF_Y  = 13;
const ROOM_HALF_Z  = 22;
const FLOOR_Y      = -13;

const REGION_BOWL    = 'bowl';
const REGION_KITCHEN = 'kitchen';

/** Maps a world-space point to a region key. The bowl region is the open
 *  interior of the fishbowl (below the rim, inside the inner radius);
 *  everything else is kitchen. The wall material itself reports 'kitchen'
 *  on either side, but the fishbowl Item carries no `regionKey` so it's
 *  considered everywhere — we don't actually rely on the wall's region. */
const regionFn = (px, py, pz) => {
  if (py < WATER_SURFACE_Y &&
      px * px + py * py + pz * pz < BOWL_INNER_R * BOWL_INNER_R) {
    return REGION_BOWL;
  }
  return REGION_KITCHEN;
};


// Ship orientation. Lifted to module scope so shipPlankColorFn can apply
// the same rotation to its query point — the tracer hands the colorFn a
// translation-local (but rotation-untouched) point, since rotation lives
// inside the SDF. Without this, plank stripes would track world-Y instead
// of deck-Y and tilt off the deck plane as the ship pitches.
const SHIP_PITCH = -25 * Math.PI / 180;
const SHIP_YAW   = -3 * Math.PI / 4;

// Runner geometry. Lifted to module scope so runnerColorFn can paint the
// stitched border + sewn-anchor stamps in the runner's pre-rotation frame.
const RUNNER_HALF_DIAG = 8.7;
const RUNNER_HALF_EDGE = RUNNER_HALF_DIAG / Math.SQRT2;
const RUNNER_ANCHOR_R  = 7.5;


// ─────────────────────────── colorFns ───────────────────────────

const shipPlankColorFn = (lpx, lpy, lpz) => {
  // Mirror shipFrame's query-point transformation (rotateYSDF(SHIP_YAW, ·)
  // then rotateXSDF(SHIP_PITCH, ·)) so we sample stripes in deck-local Y.
  const cy = Math.cos(SHIP_YAW), sy = Math.sin(SHIP_YAW);
  const x1 = lpx * cy - lpz * sy;
  const z1 = lpx * sy + lpz * cy;
  const cx = Math.cos(SHIP_PITCH), sx = Math.sin(SHIP_PITCH);
  const deckY = lpy * cx + z1 * sx;
  const stripe = (Math.floor(deckY / 0.16)) & 1;
  return stripe === 0 ? [115, 75, 38] : [85, 55, 26];
};

const runnerColorFn = (lpx, lpy, lpz) => {
  // Undo the runner's 45° Y-rotation to get axis-aligned (pre-rotation)
  // coords. The SDF wraps the box with rotateYSDF(π/4, ·), which transforms
  // the query by (lpx*c - lpz*s, lpy, lpx*s + lpz*c) with c = s = 1/√2 —
  // mirror that here.
  const k = Math.SQRT1_2;
  const x = lpx * k - lpz * k;
  const z = lpx * k + lpz * k;
  const ax = Math.abs(x), az = Math.abs(z);

  // Sewn anchor at each pre-rotation corner (4 corners, one per quadrant).
  // We work in the absolute octant (|x|, |z|) — symmetric for all 4 anchors —
  // then rotate into the anchor's local frame, where +Z is the diagonal-
  // outward direction (heavy bottom / flukes) and -Z is inward (eye / ring).
  const ec  = RUNNER_ANCHOR_R / Math.SQRT2;
  const dx  = ax - ec, dz = az - ec;
  const aZ  = (dx + dz) * k;       // anchor-local +Z = outward (toward corner)
  const aX  = (dx - dz) * k;       // anchor-local X  = perpendicular
  const baX = Math.abs(aX);        // anchor is symmetric across its X axis
  // Eye (filled circle as 2D slice of the 3D sphere)
  const eyeDz = aZ + 0.30;
  if (baX*baX + eyeDz*eyeDz < 0.045*0.045) return [25, 25, 25];
  // Stock crossbar
  if (baX < 0.16  && Math.abs(aZ + 0.20) < 0.022) return [25, 25, 25];
  // Shaft
  if (baX < 0.025 && Math.abs(aZ + 0.02) < 0.22)  return [25, 25, 25];
  // Base where flukes meet shaft
  if (baX < 0.05  && Math.abs(aZ - 0.22) < 0.020) return [25, 25, 25];
  // Fluke barb
  const bbx = baX - 0.16, bbz = aZ - 0.10;
  if (bbx*bbx + bbz*bbz < 0.022*0.022) return [25, 25, 25];
  // Fluke arm — 2D point-to-segment distance from (0.045, 0.22) to (0.16, 0.10)
  const sax = 0.045, saz = 0.22, adx = 0.115, adz = -0.12;
  let t = ((baX - sax) * adx + (aZ - saz) * adz) / (adx*adx + adz*adz);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cAx = baX - (sax + adx * t), cAz = aZ - (saz + adz * t);
  if (cAx*cAx + cAz*cAz < 0.012*0.012) return [25, 25, 25];

  // Stitching band along the perimeter — alternating navy / light blue.
  if (RUNNER_HALF_EDGE - Math.max(ax, az) < 0.18) {
    const along = (ax > az) ? z : x;
    const stripe = Math.floor(along / 0.4) & 1;
    return stripe === 0 ? [25, 50, 110] : [110, 165, 220];
  }

  return [248, 248, 244];
};

const chestColorFn = (lpx, lpy, lpz) => {
  // Dark lid line just above center, where lid meets body.
  if (Math.abs(lpy - 0.03) < 0.018) return [40, 25, 12];
  // Wooden planks — same shades as the ship, with a tighter stripe period.
  const stripe = (Math.floor(lpy / 0.10)) & 1;
  return stripe === 0 ? [115, 75, 38] : [85, 55, 26];
};

const chessboardColorFn = (lpx, lpy, lpz) => {
  const cell = (Math.floor(lpx / 3) + Math.floor(lpz / 3)) & 1;
  return cell === 0 ? [235, 235, 230] : [25, 25, 30];
};

const roomColorFn = (lpx, lpy, lpz) => {
  // Ceiling is rendered by the separate kitchen-ceiling plane Item.
  if (Math.abs(lpy - (-3.5)) < 0.18) return [180, 175, 165];
  if (lpy > -3.0 && lpy < -2.0) return [220, 210, 200];
  if (lpy > -3.5) return [232, 218, 188];
  return [195, 168, 120];
};

const windowColorFn = (lpx, lpy, lpz) => {
  // Sill — attached to the same Item, sits below the window pane in
  // window-local Y from -4.55 to -4.05.
  if (lpy < -4) return [120, 80, 50];

  const halfX = 5, halfY = 4;
  const frameW = 0.4;
  if (Math.abs(lpx) > halfX - frameW || Math.abs(lpy) > halfY - frameW) {
    return [120, 80, 50];
  }
  if (lpy < -2.0) return [85, 130, 75];
  const hillH = -2.0 + 0.55 * Math.sin(lpx * 0.7 + 0.5)
                     + 0.30 * Math.sin(lpx * 1.6 - 0.8);
  if (lpy < hillH) return [95, 145, 85];
  const sx = lpx - 2.5, sy = lpy - 2.2;
  const sd2 = sx * sx + sy * sy;
  if (sd2 < 0.55 * 0.55) return [255, 235, 120];
  if (sd2 < 0.85 * 0.85) return [255, 220, 155];
  const c1x = lpx - (-2.2), c1y = lpy - 1.4;
  if (c1x * c1x * 1.5 + c1y * c1y < 0.45 * 0.45) return [248, 248, 252];
  const c1bx = lpx - (-1.4), c1by = lpy - 1.6;
  if (c1bx * c1bx * 1.5 + c1by * c1by < 0.35 * 0.35) return [248, 248, 252];
  const c2x = lpx - 0.5, c2y = lpy - 0.6;
  if (c2x * c2x * 1.5 + c2y * c2y < 0.40 * 0.40) return [240, 240, 248];
  const c3x = lpx - 1.4, c3y = lpy - (-0.2);
  if (c3x * c3x * 1.6 + c3y * c3y < 0.30 * 0.30) return [240, 240, 248];
  const t = (lpy + 3.5) / 7.5;
  const r = 165 - 25 * t;
  const g = 215 - 20 * t;
  const b = 248 - 5  * t;
  return [r, g, b];
};

const fridgeColorFn = (lpx, lpy, lpz) => {
  if (lpz <= 2.5) return [25, 25, 25];   // not the front face

  // Sailboat drawing on the fridge half of the unified body. Centered
  // higher on the fridge (world Y=-4, unified-local lpy=-0.25) and shrunk
  // ~14.5% relative to the original sizing (5% then another 10%). Divisor
  // 0.7524 = 0.88 × 0.95 × 0.90 scales everything inside proportionally.
  const cy = lpy + 0.25;
  if (lpx <= -2.052 || lpx >= 2.052 || cy <= -2.565 || cy >= 2.565) return [25, 25, 25];

  const a = -0.18;
  const c = Math.cos(a), s = Math.sin(a);
  const rx = (lpx * c - cy * s) / 0.7524;
  const ry = (lpx * s + cy * c) / 0.7524;

  const sx = rx - 1.4, sy = ry - 2.0;
  if (sx * sx + sy * sy < 0.4 * 0.4) return [255, 220, 80];
  if (ry > -0.3 && ry < 2.5) {
    const t = (ry + 0.3) / 2.8;
    if (rx > -1.7 * (1 - t) && rx < 0.4 * (1 - t)) return [220, 60, 50];
  }
  if (ry > -1.5 && ry < -0.3) {
    const w = 2.0 - 0.6 * Math.abs((ry + 0.9) / 0.6);
    if (Math.abs(rx + 0.2) < w) return [170, 100, 55];
  }
  if (Math.abs(rx + 0.6) < 0.07 && ry > -1.3 && ry < 2.3) return [70, 50, 30];
  if (ry > -2.4 && ry < -1.7 && Math.abs(rx) < 2.0) {
    const wave = -2.05 + 0.10 * Math.sin(rx * 3.5);
    if (Math.abs(ry - wave) < 0.07) return [60, 120, 200];
  }
  return [240, 240, 235];
};

const paintingColorFn = (lpx, lpy, lpz) => {
  const halfX = 3, halfY = 2.5;
  const frameW = 0.3;
  if (Math.abs(lpx) > halfX - frameW || Math.abs(lpy) > halfY - frameW) {
    return [85, 50, 25];
  }
  if (lpy > -0.35 && lpy < -0.10) {
    const w = 0.6 - 0.25 * Math.abs((lpy + 0.225) / 0.125);
    if (Math.abs(lpx + 0.1) < w) return [70, 45, 25];
  }
  if (lpy > -0.10 && lpy < 0.85) {
    const t = (lpy + 0.10) / 0.95;
    if (Math.abs(lpx - 0.05) < 0.30 * (1 - t)) return [220, 215, 195];
  }
  if (Math.abs(lpx + 0.20) < 0.025 && lpy > -0.2 && lpy < 0.80) {
    return [55, 40, 25];
  }
  if (lpy < -0.10) {
    const wave = -0.5 + 0.04 * Math.sin(lpx * 4);
    if (Math.abs(lpy - wave) < 0.035) return [180, 195, 200];
    if (lpy < -0.5) return [25, 45, 65];
    return [50, 75, 95];
  }
  const skyT = (lpy + 0.10) / (halfY - frameW + 0.10);
  const r = 200 - 90 * skyT;
  const g = 195 - 60 * skyT;
  const b = 200 - 35 * skyT;
  return [r, g, b];
};


// ──────────────────────────────── world build ────────────────────────────────

/**
 * Build the bowl + ship + kitchen scene.
 *
 * @returns {import('../core/scene.js').Scene}
 */
export const createWorld = () => {
  const scene = createScene();
  scene.regionFn = regionFn;

  // Room — large/infinite, no boundingRadius (always kept).
  registerItem(scene, {
    name:     'room',
    color:    [232, 218, 188],
    colorFn:  roomColorFn,
    position: [0, 0, 0],
    sdf:      invertSDF(boxSDF([ROOM_HALF_X, ROOM_HALF_Y, ROOM_HALF_Z])),
  });

  registerItem(scene, {
    name:     'fishbowl',
    color:    [40, 55, 85],
    position: [0, 0, 0],
    sdf:      openTopBowlSDF({ outerR: BOWL_OUTER_R, innerR: BOWL_INNER_R, rimY: WATER_SURFACE_Y }),
    opacity:  0.75,
    boundingRadius: BOWL_OUTER_R + 0.2,
  });

  registerItem(scene, {
    name:      'water-surface',
    color:     [0, 0, 0],
    position:  [0, 0, 0],
    sdf:       planeSDF([0, -1, 0], -WATER_SURFACE_Y),
    invisible: true,
    collides:  false,
  });

  registerItem(scene, {
    name:     'sand',
    color:    [180, 160, 120],
    position: [0, 0, 0],
    sdf:      intersectionSDF(
      planeSDF([0, 1, 0], SAND_Y),
      sphereSDF(BOWL_INNER_R - 0.05),
    ),
    boundingRadius: BOWL_INNER_R,
  });

  registerItem(scene, {
    name:     'rock-big',
    color:    [110, 110, 115],
    position: [3, -1, -2],
    sdf: smoothUnionSDF(0.3,
      sphereSDF(0.7),
      translateSDF([ 0.5,  0.2, 0.1], sphereSDF(0.5)),
      translateSDF([-0.4, -0.1, 0.3], sphereSDF(0.55)),
    ),
    boundingRadius: 1.5,
  });
  registerItem(scene, {
    name:     'plant-tall',
    color:    [60, 140, 70],
    position: [-2, -0.5, -3],
    sdf: unionSDF(
      cylinderSDF(0.8, 0.1),
      translateSDF([ 0.0, 0.85, 0.00], sphereSDF(0.22)),
      translateSDF([ 0.1, 0.55, 0.05], sphereSDF(0.18)),
      translateSDF([-0.1, 0.25, 0.05], sphereSDF(0.20)),
    ),
    boundingRadius: 1.5,
  });
  registerItem(scene, {
    name:     'plant-small',
    color:    [90, 170, 90],
    position: [1, -1, -4],
    sdf:      capsuleSDF(0.4, 0.1),
    boundingRadius: 0.6,
  });
  registerItem(scene, {
    name:     'chest',
    color:    [110, 70, 35],
    colorFn:  chestColorFn,
    position: [-1, -1.5, 2.5],
    sdf:      rotateYSDF(0.6, boxSDF([0.5, 0.3, 0.35])),
    boundingRadius: 0.8,
  });
  registerItem(scene, {
    name:     'rock-small',
    color:    [70, 70, 80],
    position: [0, -1.3, 4],
    sdf: smoothUnionSDF(0.2,
      sphereSDF(0.4),
      translateSDF([0.3, 0.05, 0], sphereSDF(0.3)),
    ),
    boundingRadius: 0.8,
  });


  // ────────── Pirate ship ──────────

  const SHIP_POS = [+1.5, -1.2, 1.0];

  const shipFrame = (sdf) => rotateYSDF(SHIP_YAW, rotateXSDF(SHIP_PITCH, sdf));

  const hullOuter = smoothUnionSDF(0.10,
    translateSDF([0, 0.000, -0.40], boxSDF([0.575, 0.805, 1.25])),
    translateSDF([0, 0.105, +0.95], boxSDF([0.45,  0.70,  0.30])),
    translateSDF([0, 0.255, +1.30], boxSDF([0.30,  0.55,  0.20])),
    translateSDF([0, 0.405, +1.55], boxSDF([0.15,  0.40,  0.15])),
    translateSDF([0, 0.555, +1.75], boxSDF([0.05,  0.25,  0.10])),
  );
  const hullInner = translateSDF([0, 0, -0.40], boxSDF([0.483, 0.713, 1.15]));

  const cabinShell = cutSDF(
    translateSDF([0, 1.0925, -0.575], boxSDF([0.368, 0.253, 0.541])),
    translateSDF([0, 1.0925, -0.575], boxSDF([0.46,  0.345, 0.6325])),
  );

  const doorCutout     = translateSDF([0, 1.15, -0.04],     boxSDF([0.253, 0.288, 0.540]));
  const trapDoorCutout = translateSDF([0, 0.46, -0.69],     boxSDF([0.253, 0.575, 0.253]));
  const portholePort   = translateSDF([-0.575, -0.23, 0.40], sphereSDF(0.276));
  const portholeStbd   = translateSDF([+0.575, -0.23, 0.40], sphereSDF(0.276));

  const hullCarved = cutSDF(
    unionSDF(doorCutout, trapDoorCutout, portholePort, portholeStbd),
    unionSDF(cutSDF(hullInner, hullOuter), cabinShell),
  );

  // Ship/mermaid items all centered at SHIP_POS; mast extends ~4.5 from
  // SHIP_POS in Y. Bounding radius 5 covers the whole rig.
  registerItem(scene, {
    name:     'ship-hull',
    color:    [100, 65, 32],
    colorFn:  shipPlankColorFn,
    position: SHIP_POS,
    sdf:      shipFrame(hullCarved),
    boundingRadius: 5,
  });

  registerItem(scene, {
    name:     'ship-mast',
    color:    [70, 45, 22],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0, 1.9, -0.345], cylinderSDF(2.6, 0.05))),
    boundingRadius: 5,
  });

  registerItem(scene, {
    name:     'ship-masthead',
    color:    [205, 165, 75],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0, 4.5, -0.345], sphereSDF(0.10))),
    boundingRadius: 5,
  });

  registerItem(scene, {
    name:     'ship-flag',
    color:    [25, 25, 25],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0.30, 3.90, -0.345], boxSDF([0.25, 0.4, 0.02]))),
    boundingRadius: 5,
  });
  registerItem(scene, {
    name:     'ship-flag-skull',
    color:    [245, 245, 240],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0.30, 4.00, -0.345], sphereSDF(0.07))),
    boundingRadius: 5,
  });
  const crossbones = unionSDF(
    rotateZSDF(+Math.PI / 4, boxSDF([0.18, 0.012, 0.05])),
    rotateZSDF(-Math.PI / 4, boxSDF([0.18, 0.012, 0.05])),
  );
  registerItem(scene, {
    name:     'ship-flag-crossbones',
    color:    [245, 245, 240],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0.30, 3.78, -0.345], crossbones)),
    boundingRadius: 5,
  });

  const sinCut = Math.sin(0.5), cosCut = Math.cos(0.5);
  const bowspritShape = cutSDF(
    planeSDF([0, -sinCut, -cosCut], -0.30 * cosCut),
    rotateXSDF(Math.PI / 2, cylinderSDF(0.4, 0.06)),
  );
  registerItem(scene, {
    name:     'ship-bowsprit',
    color:    [70, 45, 22],
    position: SHIP_POS,
    sdf: shipFrame(translateSDF([0, 0.7, 2.10], bowspritShape)),
    boundingRadius: 5,
  });


  // ────────── Mermaid figurehead ──────────

  const MERMAID_OFFSET_Z = 1.85;

  const mermaidBody = translateSDF([0, 0, MERMAID_OFFSET_Z],
    smoothUnionSDF(0.15,
      translateSDF([0, 0.12, 0.00], sphereSDF(0.115)),     // hip
      translateSDF([0, 0.27, 0.10], sphereSDF(0.105)),     // torso

      // Each arm: a small joint sphere at the shoulder, a smooth capsule
      // running back to the railing, and a hand stub at the end.
      translateSDF([+0.10, 0.30, +0.10], sphereSDF(0.058)),
      capsuleBetweenSDF([+0.10, 0.30, +0.10], [+0.30, 0.85, -0.25], 0.044),
      translateSDF([+0.30, 0.85, -0.25], sphereSDF(0.044)),

      translateSDF([-0.10, 0.30, +0.10], sphereSDF(0.058)),
      capsuleBetweenSDF([-0.10, 0.30, +0.10], [-0.30, 0.85, -0.25], 0.044),
      translateSDF([-0.30, 0.85, -0.25], sphereSDF(0.044)),

      translateSDF([0, 0.40, 0.18], sphereSDF(0.05)),

      translateSDF([0, 0.55, 0.20], sphereSDF(0.0484)),
      translateSDF([0, 0.51, 0.27], sphereSDF(0.0484)),
      translateSDF([0, 0.48, 0.25], sphereSDF(0.0352)),
      translateSDF([0, 0.46, 0.27], sphereSDF(0.0220)),
    ),
  );
  registerItem(scene, {
    name:     'mermaid-body',
    color:    [205, 165, 75],
    position: SHIP_POS,
    sdf:      shipFrame(mermaidBody),
    boundingRadius: 3,
  });

  const mermaidTail = translateSDF([0, 0, MERMAID_OFFSET_Z],
    smoothUnionSDF(0.18,
      translateSDF([ 0,    0.00, -0.05], sphereSDF(0.115)),
      translateSDF([+0.05, -0.12, -0.15], sphereSDF(0.105)),
      translateSDF([-0.05, -0.25, -0.25], sphereSDF(0.095)),
      translateSDF([+0.05, -0.40, -0.35], sphereSDF(0.085)),
      translateSDF([-0.07, -0.55, -0.45], sphereSDF(0.070)),
      translateSDF([-0.20, -0.65, -0.45], sphereSDF(0.040)),     // port fluke
      translateSDF([+0.06, -0.65, -0.45], sphereSDF(0.040)),     // starboard fluke
    ),
  );
  registerItem(scene, {
    name:     'mermaid-tail',
    color:    [85, 145, 130],
    position: SHIP_POS,
    sdf:      shipFrame(mermaidTail),
    boundingRadius: 3,
  });

  const mermaidHair = translateSDF([0, 0, MERMAID_OFFSET_Z],
    smoothUnionSDF(0.04,
      translateSDF([ 0,    0.55, 0.18], sphereSDF(0.050)),
      translateSDF([ 0,    0.50, 0.15], sphereSDF(0.045)),
      translateSDF([-0.02, 0.45, 0.12], sphereSDF(0.040)),
      translateSDF([+0.02, 0.40, 0.08], sphereSDF(0.035)),
      translateSDF([ 0,    0.36, 0.05], sphereSDF(0.030)),
    ),
  );
  registerItem(scene, {
    name:     'mermaid-hair',
    color:    [165, 115, 35],
    position: SHIP_POS,
    sdf:      shipFrame(mermaidHair),
    boundingRadius: 3,
  });

  const mermaidBra = translateSDF([0, 0, MERMAID_OFFSET_Z],
    unionSDF(
      translateSDF([+0.06, 0.245, 0.22], sphereSDF(0.0515)),
      translateSDF([-0.06, 0.245, 0.22], sphereSDF(0.0515)),
    ),
  );
  registerItem(scene, {
    name:     'mermaid-bra',
    color:    [240, 220, 175],
    position: SHIP_POS,
    sdf:      shipFrame(mermaidBra),
    boundingRadius: 3,
  });


  // ────────────────────── Kitchen ──────────────────────

  // Floor and ceiling are infinite planes — never culled.
  registerItem(scene, {
    name:     'kitchen-floor',
    color:    [200, 200, 200],
    colorFn:  chessboardColorFn,
    position: [0, 0, 0],
    sdf:      planeSDF([0, 1, 0], FLOOR_Y + 0.01),
  });

  registerItem(scene, {
    name:     'kitchen-ceiling',
    color:    [245, 238, 215],
    position: [0, 0, 0],
    sdf:      planeSDF([0, -1, 0], -(ROOM_HALF_Y - 0.01)),
  });

  const tableLeg = (x, z) => translateSDF([x, -2.75, z], cylinderSDF(2.25, 0.4));
  registerItem(scene, {
    name:     'table',
    color:    [205, 175, 125],
    position: [0, -8, 0],
    sdf: unionSDF(
      boxSDF([13, 0.5, 9]),
      tableLeg(+11, +7),
      tableLeg(-11, +7),
      tableLeg(+11, -7),
      tableLeg(-11, -7),
    ),
    boundingRadius: 17,
  });

  // Table runner — a thin square rotated 45° around Y so its corners point
  // along world ±X and ±Z. Half-diagonal RUNNER_HALF_DIAG puts the ±Z
  // corners 0.3 from the table's Z edges (table half-Z = 9, almost
  // touching). The table is rectangular (26×18), so the ±X corners stop
  // short of the X edges; that asymmetry is the cost of a square on a
  // rectangle. The runnerColorFn paints stitched border + sewn anchors as
  // surface decoration — no separate Items, no extra ray-march cost.
  registerItem(scene, {
    name:     'table-runner',
    color:    [248, 248, 244],
    colorFn:  runnerColorFn,
    position: [0, -7.48, 0],
    sdf:      rotateYSDF(Math.PI / 4, boxSDF([RUNNER_HALF_EDGE, 0.02, RUNNER_HALF_EDGE])),
    boundingRadius: RUNNER_HALF_DIAG + 0.1,
  });

  // Vase — hollow cylindrical glass cup (same pattern as the sink basin):
  // outer cylinder minus an inner cylinder whose top extends far above the
  // outer, so cutSDF reports correct distances above the rim and physics
  // doesn't push the fish off a phantom lid. The fish can swim in through
  // the open top and around the stem.
  const VASE_OUTER_R   = 0.85;
  const VASE_INNER_R   = 0.75;
  const VASE_HALF_H    = 1.7;
  const VASE_FLOOR_TH  = 0.10;
  const VASE_INNER_HH  = 5.0;
  const vaseInnerTy    = VASE_INNER_HH - VASE_HALF_H + VASE_FLOOR_TH;
  registerItem(scene, {
    name:     'vase',
    color:    [220, 235, 245],
    position: [10, -5.8, 1.5],
    sdf: cutSDF(
      translateSDF([0, vaseInnerTy, 0], cylinderSDF(VASE_INNER_HH, VASE_INNER_R)),
      cylinderSDF(VASE_HALF_H, VASE_OUTER_R),
    ),
    opacity:  0.4,
    boundingRadius: 2,
  });
  registerItem(scene, {
    name:     'flower-stem',
    color:    [80, 150, 80],
    position: [10, -5.25, 1.5],
    sdf:      capsuleSDF(2.25, 0.08),
    boundingRadius: 2.5,
  });
  registerItem(scene, {
    name:     'flower-bloom',
    color:    [240, 130, 170],
    position: [10, -2.5, 1.5],
    sdf: smoothUnionSDF(0.20,
      sphereSDF(0.8),
      translateSDF([+1.0, 0.0, 0.0], sphereSDF(0.50)),
      translateSDF([-1.0, 0.0, 0.0], sphereSDF(0.50)),
      translateSDF([ 0.0, 0.0, +1.0], sphereSDF(0.50)),
      translateSDF([ 0.0, 0.0, -1.0], sphereSDF(0.50)),
      translateSDF([ 0.0, +0.9, 0.0], sphereSDF(0.45)),
    ),
    boundingRadius: 2.5,
  });

  // Fridge — single outer envelope with two crossed-slab carves (upper
  // gap between body and freezer, lower gap between body and floor),
  // each leaving 4 corner posts. 5 box SDF calls per eval (vs 10 in the
  // union-of-blocks form), at the cost of a subtlety: the slabs need to
  // extend slightly past the outer box in the dimensions where the carve
  // should punch through (X/Z by 0.1; lower-gap Y by 0.1 to clear the
  // outer box's bottom face). Without that overlap, both `from` and
  // `remove` SDFs report 0 at the shared boundary and cutSDF returns 0,
  // which the marcher reads as a solid hit — making the "hole" render
  // as a thin black wall instead of a real opening.
  registerItem(scene, {
    name:     'fridge',
    color:    [25, 25, 25],
    colorFn:  fridgeColorFn,
    position: [-17, -3.75, -17],
    sdf: cutSDF(
      unionSDF(
        // Upper gap — world Y -0.8 to -0.36 (0.44 thick — barely above
        // fishRadius × 2 = 0.40, so the fish has just ~0.02 of vertical
        // margin and threads through tight).
        translateSDF([0, +3.17, 0], unionSDF(
          boxSDF([2.25, 0.22, 3.5]),
          boxSDF([3.5, 0.22, 2.25]),
        )),
        // Lower gap — world Y -13 to -12.56 (0.44 thick visible). Slab
        // bottom extends to unified-local -9.35 (0.1 past the outer box's
        // bottom face).
        //
        // Slab X/Z half is 3.5 (0.5 overlap past outer half 3). The overlap
        // must exceed 2 × fishRadius (= 0.4) so the SDF dip in the overlap
        // region (min depth = overlap / 2) stays above fishRadius —
        // otherwise physics pushes the fish back out at the gap entrance.
        translateSDF([0, -9.08, 0], unionSDF(
          boxSDF([2.25, 0.27, 3.5]),
          boxSDF([3.5, 0.27, 2.25]),
        )),
      ),
      boxSDF([3, 9.25, 3]),
    ),
    boundingRadius: 10.5,
  });

  // Counter has a sink-shaped void carved out of its top so the basin
  // recesses into it. The void's X/Z extent matches the basin outer; its
  // Y extends from basin floor up to far above the counter top. The above-
  // top extension is invisible (no counter material exists there) but
  // forces cutSDF to report a true positive distance for points
  // hovering above the sink opening, so physics doesn't push the fish off
  // a phantom counter top.
  // Counter starts at X=-12 (was -14) so there's a 2-unit gap between the
  // counter's left edge and the fridge's right edge — matches the gap on
  // the opposite side of the fridge (between fridge X=-20 and the back
  // wall at X=-22).
  const sinkVoidInCounter = translateSDF([3, 6.4, 0.5], boxSDF([1.4, 3.5, 0.9]));
  registerItem(scene, {
    name:     'kitchen-counter',
    color:    [180, 175, 165],
    position: [+5, -8.1, -ROOM_HALF_Z + 2.5],
    sdf:      cutSDF(sinkVoidInCounter, boxSDF([17, 4.9, 2.5])),
    boundingRadius: 18,
  });

  // Window + sill — single Item; the sill is a translated sub-box in
  // window-local coords (down by 4.3 in Y, forward by 0.55 in Z), and
  // windowColorFn returns brown for lpy < -4 to render it as wood frame.
  registerItem(scene, {
    name:     'window',
    color:    [150, 200, 240],
    colorFn:  windowColorFn,
    position: [+8, +2, -ROOM_HALF_Z + 0.05],
    sdf: unionSDF(
      boxSDF([5, 4, 0.05]),                                          // window pane
      translateSDF([0, -4.3, 0.55], boxSDF([5.6, 0.25, 0.6])),       // sill
    ),
    boundingRadius: 8,
  });

  // Sink — hollow basin recessed into the counter, built as outer-box
  // minus inner-cut. Inner-cut bottom sits 0.1 above the outer bottom
  // (the basin floor); its top extends far above the outer's top so the
  // SDF stays positive at points hovering above the basin opening. Visible
  // dimensions: internal width 2.6, vertical drop 1.9.
  const sinkBasin = cutSDF(
    translateSDF([0, 4.1, 0], boxSDF([1.3, 5.0, 0.8])),
    boxSDF([1.4, 1.0, 0.9]),
  );
  registerItem(scene, {
    name:     'sink',
    color:    [180, 185, 190],
    position: [+8, -4.2, -19],
    sdf:      sinkBasin,
    boundingRadius: 2,
  });

  const faucet = unionSDF(
    translateSDF([0, 0.6, 0], cylinderSDF(0.6, 0.05)),
    translateSDF([0, 1.20, 0.30], rotateXSDF(Math.PI / 2, cylinderSDF(0.30, 0.04))),
  );
  registerItem(scene, {
    name:     'faucet',
    color:    [200, 205, 210],
    position: [+8, -3.2, -19.8],
    sdf:      faucet,
    boundingRadius: 2,
  });

  // Closed door on the OPPOSITE wall (front wall, +Z=22). Wider than the
  // fridge so it reads as a person-sized door.
  registerItem(scene, {
    name:     'door',
    color:    [120, 80, 50],
    position: [+15, -2, ROOM_HALF_Z - 0.05],
    sdf:      boxSDF([3.5, 11, 0.05]),
    boundingRadius: 12,
  });

  registerItem(scene, {
    name:     'painting',
    color:    [120, 80, 50],
    colorFn:  paintingColorFn,
    position: [-3, +1, ROOM_HALF_Z - 0.05],
    sdf:      boxSDF([3, 2.5, 0.05]),
    boundingRadius: 4,
  });

  // Potlights — multi-position cluster, can't represent with a single
  // bounding sphere, so left uncullable.
  const potlight = (x, z) => translateSDF([x, ROOM_HALF_Y - 0.2, z], sphereSDF(0.4));
  registerItem(scene, {
    name:     'potlights',
    // Over-bright: lambertian dims the visible underside (ndotl ≤ 0) to
    // ambient × color. With ambient = 0.35, color = [800, 800, 800] still
    // clamps to white at the painter, so the lights read full-bright from
    // any angle the camera can see.
    color:    [800, 800, 800],
    position: [0, 0, 0],
    sdf: unionSDF(
      potlight(+8, +8),
      potlight(-8, +8),
      potlight(+8, -8),
      potlight(-8, -8),
    ),
  });

  // Tag items by region. Items not in either set carry no `regionKey` and
  // are always considered (they span regions or have no clean home — room,
  // fishbowl glass, floor & ceiling planes, potlights cluster, the
  // invisible water-surface).
  const BOWL_ITEMS = new Set([
    'sand', 'rock-big', 'plant-tall', 'plant-small', 'chest', 'rock-small',
    'ship-hull', 'ship-mast', 'ship-masthead',
    'ship-flag', 'ship-flag-skull', 'ship-flag-crossbones', 'ship-bowsprit',
    'mermaid-body', 'mermaid-tail', 'mermaid-hair', 'mermaid-bra',
  ]);
  const KITCHEN_ITEMS = new Set([
    'table', 'table-runner', 'vase', 'flower-stem', 'flower-bloom',
    'fridge', 'kitchen-counter',
    'window', 'sink', 'faucet', 'door', 'painting',
  ]);
  for (const item of scene) {
    if (BOWL_ITEMS.has(item.name)) item.regionKey = REGION_BOWL;
    else if (KITCHEN_ITEMS.has(item.name)) item.regionKey = REGION_KITCHEN;
  }

  return scene;
};
