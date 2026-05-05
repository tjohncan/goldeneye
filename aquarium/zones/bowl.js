// aquarium/zones/bowl.js — items inside the open-topped fishbowl: sand,
// rocks, plants, the half-buried chest, and the multi-part pirate ship
// with carved mermaid figurehead. Every item registered here carries
// `regionKey: 'bowl'` so the tracer's per-step region filter and physics's
// per-iteration region cull skip them when the camera and probes are
// outside the bowl.

import {
  registerItem,
  sphereSDF, boxSDF, planeSDF, capsuleSDF, capsuleBetweenSDF, cylinderSDF,
  unionSDF, intersectionSDF, smoothUnionSDF, cutSDF,
  translateSDF, rotateXSDF, rotateYSDF, rotateZSDF,
} from '../../core/scene.js';
import * as r3 from '../../core/r3.js';

import { BOWL_INNER_R } from '../world.js';

export const REGION_BOWL = 'bowl';

const SAND_Y = -1.5;

// Ship orientation. shipPlankColorFn applies the same rotation to its query
// point — the tracer hands the colorFn a translation-local (but rotation-
// untouched) point, since rotation lives inside the SDF. Without this,
// plank stripes would track world-Y instead of deck-Y and tilt off the deck
// plane as the ship pitches.
const SHIP_PITCH = -25 * Math.PI / 180;
const SHIP_YAW   = -3 * Math.PI / 4;
const SHIP_POS   = [+1.5, -1.2, 1.0];

const MERMAID_OFFSET_Z = 1.85;

// World position of a point given in ship-local coords (pre-rotation).
// Each ship sub-item (and mermaid piece) anchors its own position at
// the piece's actual world center via this helper, so its bounding
// sphere can fit tight to the geometry — instead of being a fuzzy
// "anywhere on the ship" sphere centered on SHIP_POS. The SDF still
// wraps shipFrame to un-rotate the query into the primitive's
// ship-aligned local frame.
const shipLocalToWorld = (localPos) =>
  r3.add(SHIP_POS, r3.rotY(r3.rotX(localPos, SHIP_PITCH), SHIP_YAW));

const MERMAID_POS = shipLocalToWorld([0, 0, MERMAID_OFFSET_Z]);


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

const chestColorFn = (lpx, lpy, lpz) => {
  // Dark lid line just above center, where lid meets body.
  if (Math.abs(lpy - 0.03) < 0.018) return [40, 25, 12];
  // Wooden planks — same shades as the ship, with a tighter stripe period.
  const stripe = (Math.floor(lpy / 0.10)) & 1;
  return stripe === 0 ? [115, 75, 38] : [85, 55, 26];
};


// ──────────────────────────── scene build ────────────────────────────

/**
 * Add all bowl-region items to the scene.
 *
 * @param {import('../../core/scene.js').Scene} scene
 */
export const addToScene = (scene) => {
  // Tag every item registered here with regionKey: 'bowl'. Spread keeps
  // the per-call literals tight without repeating the regionKey at each
  // call site.
  const add = (item) => registerItem(scene, { ...item, regionKey: REGION_BOWL });

  add({
    name:     'sand',
    color:    [180, 160, 120],
    position: [0, 0, 0],
    sdf:      intersectionSDF(
      planeSDF([0, 1, 0], SAND_Y),
      sphereSDF(BOWL_INNER_R - 0.05),
    ),
    boundingRadius: BOWL_INNER_R,
  });

  add({
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
  add({
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
  add({
    name:     'plant-small',
    color:    [90, 170, 90],
    position: [1, -1, -4],
    sdf:      capsuleSDF(0.4, 0.1),
    boundingRadius: 0.6,
  });
  add({
    name:     'chest',
    color:    [110, 70, 35],
    colorFn:  chestColorFn,
    position: [-1, -1.5, 2.5],
    sdf:      rotateYSDF(0.6, boxSDF([0.5, 0.3, 0.35])),
    boundingRadius: 0.8,
  });
  add({
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

  add({
    name:     'ship-hull',
    color:    [100, 65, 32],
    colorFn:  shipPlankColorFn,
    position: SHIP_POS,
    sdf:      shipFrame(hullCarved),
    boundingRadius: 2.25,
  });

  add({
    name:     'ship-mast',
    color:    [70, 45, 22],
    position: shipLocalToWorld([0, 1.9, -0.345]),
    sdf:      shipFrame(cylinderSDF(2.6, 0.05)),
    boundingRadius: 2.65,
  });

  add({
    name:     'ship-masthead',
    color:    [205, 165, 75],
    position: shipLocalToWorld([0, 4.5, -0.345]),
    sdf:      shipFrame(sphereSDF(0.10)),
    boundingRadius: 0.12,
  });

  add({
    name:     'ship-flag',
    color:    [25, 25, 25],
    position: shipLocalToWorld([0.30, 3.90, -0.345]),
    sdf:      shipFrame(boxSDF([0.25, 0.4, 0.02])),
    boundingRadius: 0.50,
  });
  add({
    name:     'ship-flag-skull',
    color:    [245, 245, 240],
    position: shipLocalToWorld([0.30, 4.00, -0.345]),
    sdf:      shipFrame(sphereSDF(0.07)),
    boundingRadius: 0.09,
  });
  const crossbones = unionSDF(
    rotateZSDF(+Math.PI / 4, boxSDF([0.18, 0.012, 0.05])),
    rotateZSDF(-Math.PI / 4, boxSDF([0.18, 0.012, 0.05])),
  );
  add({
    name:     'ship-flag-crossbones',
    color:    [245, 245, 240],
    position: shipLocalToWorld([0.30, 3.78, -0.345]),
    sdf:      shipFrame(crossbones),
    boundingRadius: 0.22,
  });

  const sinCut = Math.sin(0.5), cosCut = Math.cos(0.5);
  const bowspritShape = cutSDF(
    planeSDF([0, -sinCut, -cosCut], -0.30 * cosCut),
    rotateXSDF(Math.PI / 2, cylinderSDF(0.4, 0.06)),
  );
  add({
    name:     'ship-bowsprit',
    color:    [70, 45, 22],
    position: shipLocalToWorld([0, 0.7, 2.10]),
    sdf:      shipFrame(bowspritShape),
    boundingRadius: 0.50,
  });


  // ────────── Mermaid figurehead ──────────

  const mermaidBody = smoothUnionSDF(0.15,
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
  );
  add({
    name:     'mermaid-body',
    color:    [205, 165, 75],
    position: MERMAID_POS,
    sdf:      shipFrame(mermaidBody),
    boundingRadius: 1.20,
  });

  const mermaidTail = smoothUnionSDF(0.18,
    translateSDF([ 0,    0.00, -0.05], sphereSDF(0.115)),
    translateSDF([+0.05, -0.12, -0.15], sphereSDF(0.105)),
    translateSDF([-0.05, -0.25, -0.25], sphereSDF(0.095)),
    translateSDF([+0.05, -0.40, -0.35], sphereSDF(0.085)),
    translateSDF([-0.07, -0.55, -0.45], sphereSDF(0.070)),
    translateSDF([-0.20, -0.65, -0.45], sphereSDF(0.040)),     // port fluke
    translateSDF([+0.06, -0.65, -0.45], sphereSDF(0.040)),     // starboard fluke
  );
  add({
    name:     'mermaid-tail',
    color:    [85, 145, 130],
    position: MERMAID_POS,
    sdf:      shipFrame(mermaidTail),
    boundingRadius: 1.10,
  });

  const mermaidHair = smoothUnionSDF(0.04,
    translateSDF([ 0,    0.55, 0.18], sphereSDF(0.050)),
    translateSDF([ 0,    0.50, 0.15], sphereSDF(0.045)),
    translateSDF([-0.02, 0.45, 0.12], sphereSDF(0.040)),
    translateSDF([+0.02, 0.40, 0.08], sphereSDF(0.035)),
    translateSDF([ 0,    0.36, 0.05], sphereSDF(0.030)),
  );
  add({
    name:     'mermaid-hair',
    color:    [165, 115, 35],
    position: MERMAID_POS,
    sdf:      shipFrame(mermaidHair),
    boundingRadius: 0.70,
  });

  const mermaidTop = unionSDF(
    translateSDF([+0.06, 0.245, 0.22], sphereSDF(0.0515)),
    translateSDF([-0.06, 0.245, 0.22], sphereSDF(0.0515)),
  );
  add({
    name:     'mermaid-top',
    color:    [240, 220, 175],
    position: MERMAID_POS,
    sdf:      shipFrame(mermaidTop),
    boundingRadius: 0.40,
  });
};
