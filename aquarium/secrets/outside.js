// aquarium/secrets/outside.js — third secret zone, reached through the
// keyhole bored through the kitchen front door's brass knob. Inside is
// a concentric, vastly-larger fishbowl-shaped dome (open-top bowl, like
// the kitchen's, just huger and centered at the same world origin) — a
// meta callback: the kitchen we came from is itself one toy inside a
// much bigger fishbowl. The cove ground is one continuous slope in X:
// deep underwater far -X, beach at the door's X column, mountains far
// +X — single-axis ramp, leaving plenty of horizontal room for boats,
// rocks, roads, etc. in later iterations.
//
// First-pass architecture: dome shell + linear ground slope + staff
// shack (the building we exit, with the bore cut through it) + keyhole-
// through-knob + region veils.

import {
  registerItem,
  sphereSDF, boxSDF,
  cutSDF, unionSDF, openTopBowlSDF,
  translateSDF,
} from '../../core/scene.js';

import { REGION_KITCHEN } from '../world.js';
import { mouseholeAirSdf } from './mousehole.js';
import { chamberAirSdf }   from './chamber.js';

export const REGION_OUTSIDE = 'outside';


// ─────────────────────────── geometry ───────────────────────────

// Door registered in zones/kitchen.js: position (+15, -2, +21.95),
// half-extents [3.5, 11, 0.05]. The keyhole bores through the door at
// the -X side, mid-vertical — where a real doorknob sits, on the
// table/fridge side from a viewer standing inside facing the door
// (right-handed coords with forward=+Z, up=+Y → viewer's right = -X).
const DOOR_X    = +15;
const KEYHOLE_X = +12.5;                       // 1.0 from the door's -X edge
const KEYHOLE_Y =   -2;                        // door's vertical center

// House and kitchen half-extents. Hoisted here because the bore +
// plate Z positions below derive from HOUSE_HALF_Z. Wall thicknesses
// are sized so a boosted-speed cove fish (max per-frame displacement
// 1.44) can't tunnel through the wall into a secret pocket — must
// exceed 2× displacement past each pocket's inner-most boundary:
//   - mousehole interior back at x=-27.8 → outer-X must be ≤ -30.68
//   - chamber back at z=-26.5            → outer-Z must be ≤ -29.38
//   - kitchen ceiling at y=±13 → wall ≥ 2.88 in Y suffices; bumped to
//     6 for symmetry and to avoid past top-wall clipping.
const KITCHEN_HALF_X = 22;
const KITCHEN_HALF_Y = 13;
const KITCHEN_HALF_Z = 22;
const HOUSE_HALF_X   = 31;
const HOUSE_HALF_Y   = 19;
const HOUSE_HALF_Z   = 31;

// Classic skeleton-key shape: a circle on top with a vertical slot
// below ("circle with a dress on"). Same shape extruded along Z is the
// bore through the door and shack; same shape cut through a brass
// rectangular plate is the visible escutcheon. Circle is CENTERED on
// the plate so the natural fish-aim (toward door center, world y=-2)
// puts the fish in the deepest part of the circle with 0.35 clearance
// rather than near the upper boundary. Slot extends below the circle
// for the visual key-shape.
const KEY_CIRCLE_R    = 0.55;
const KEY_CIRCLE_CY   = 0;                     // circle center = plate center
const KEY_SLOT_HALF_W = 0.35;
const KEY_SLOT_TOP_Y  = KEY_CIRCLE_CY;         // slot top meets circle center
const KEY_SLOT_BOT_Y  = -0.65;

// 2D keyhole shape SDF in the XY plane (returns negative inside the
// silhouette). Combines: distance to the top circle, and distance to
// the slot rectangle, then takes the min (= 2D union).
const keyhole2DSdf = (lpx, lpy) => {
  const cx = lpx, cy = lpy - KEY_CIRCLE_CY;
  const dCircle = Math.sqrt(cx * cx + cy * cy) - KEY_CIRCLE_R;

  const sDx = Math.abs(lpx) - KEY_SLOT_HALF_W;
  const sDy = Math.max(lpy - KEY_SLOT_TOP_Y, KEY_SLOT_BOT_Y - lpy);
  const sOx = Math.max(sDx, 0), sOy = Math.max(sDy, 0);
  const dSlot = Math.min(Math.max(sDx, sDy), 0) + Math.sqrt(sOx * sOx + sOy * sOy);

  return Math.min(dCircle, dSlot);
};

// Extrude the 2D keyhole shape along Z by `halfZ`. Local origin is at
// the keyhole shape's center.
const keyholeExtrudedSdf = (halfZ) => (lpx, lpy, lpz) => {
  const d2d = keyhole2DSdf(lpx, lpy);
  const dz  = Math.abs(lpz) - halfZ;
  const ox  = Math.max(d2d, 0), oz = Math.max(dz, 0);
  return Math.min(Math.max(d2d, dz), 0) + Math.sqrt(ox * ox + oz * oz);
};

// Bore extends from 1.0 inside the kitchen, all the way through the
// house wall, and past the cove-side plate (knob is off-axis so it
// doesn't constrain the bore extent). Outside extent derived from
// HOUSE_HALF_Z so the bore follows whenever the outer-Z face moves.
const KEYHOLE_Z_KITCHEN = +21.0;
const KEYHOLE_Z_OUTSIDE = HOUSE_HALF_Z + 1.0;
const KEYHOLE_HALF_Z    = (KEYHOLE_Z_OUTSIDE - KEYHOLE_Z_KITCHEN) / 2;
const KEYHOLE_CENTER_Z  = (KEYHOLE_Z_OUTSIDE + KEYHOLE_Z_KITCHEN) / 2;

const keyholeBoreWorldSdf = translateSDF(
  [KEYHOLE_X, KEYHOLE_Y, KEYHOLE_CENTER_Z],
  keyholeExtrudedSdf(KEYHOLE_HALF_Z),
);

// Brass escutcheon plate — thin rectangular plate on each side of the
// door with the keyhole shape cut clean through, sized so the keyhole
// sits in the lower half and the upper half stays clear for the round
// knob mounted on top.
const PLATE_HALF_W    = 0.80;                  // plate width 1.60
const PLATE_HALF_H    = 1.00;                  // plate height 2.00
const PLATE_HALF_Z    = 0.04;
const KITCHEN_PLATE_Z = +21.65;                // 0.25 in front of kitchen face (z=+21.90)
// Outside plate sits ON the building's cove-facing door surface (house
// outer +Z face is at z=+HOUSE_HALF_Z). Derived so it follows whenever
// the outer-Z half-extent moves.
const OUTSIDE_PLATE_Z = HOUSE_HALF_Z + 0.25;

const plateBoxSdf = boxSDF([PLATE_HALF_W, PLATE_HALF_H, PLATE_HALF_Z]);
// Plate with the keyhole cut through. The cut tool's extrusion half-Z
// must be MUCH bigger than the plate's half-Z, otherwise cutSDF reports
// the extrusion's cap distance (= plate's half-Z) rather than the true
// 2D keyhole-boundary distance, and physics push-back blocks the fish
// at the center of the hole even though the geometry says it's open.
// Rule of thumb: cut half-Z > max inscribed 2D distance of the cut
// shape (here, the circle's radius 0.65). 2.0 is comfortably past that.
const PLATE_CUT_HALF_Z = 2.0;
const plateSdf = cutSDF(keyholeExtrudedSdf(PLATE_CUT_HALF_Z), plateBoxSdf);

// Round brass knob — a sphere mounted on the upper portion of each
// plate, protruding outward. Plate-local position is (0, KNOB_LPY) —
// above the keyhole circle's top edge with a small visual gap.
const KNOB_R          = 0.18;
const KNOB_LPY        = +0.78;                 // plate-local Y; just above keyhole circle (top at +0.55)
const knobSdf         = sphereSDF(KNOB_R);
const KITCHEN_KNOB_Z  = KITCHEN_PLATE_Z - PLATE_HALF_Z - KNOB_R;
const OUTSIDE_KNOB_Z  = OUTSIDE_PLATE_Z + PLATE_HALF_Z + KNOB_R;

// Bounding radius covering the keyhole shape's full silhouette + plate
// thickness. The circle reaches its lowest point at lpy = CY - R, the
// slot reaches lpy = SLOT_BOT_Y; the corner of the slot (±SLOT_HALF_W,
// SLOT_BOT_Y) is the most distant point from the shape's local origin.
const KEYHOLE_BOUND_R = Math.hypot(
  Math.max(KEY_CIRCLE_R, KEY_SLOT_HALF_W),
  Math.max(Math.abs(KEY_CIRCLE_CY) + KEY_CIRCLE_R, Math.abs(KEY_SLOT_BOT_Y)),
);

// Sky dome — open-top bowl concentric with the kitchen's fishbowl
// (which sits at world origin), vastly larger (≈120× the kitchen
// bowl's radius). With the 10× outside-region speed multiplier, this
// makes the cove feel about 1000× the linear units of the kitchen so
// it reads as truly massive. Inner/outer shell shape mirrors
// openTopBowlSDF in zones/bowl.js. The rim is set above the outer
// radius so the SDF is effectively a closed sphere — keeps the
// "fishbowl" silhouette but stops swim-up rays from escaping into
// background. Could be lowered later (with a sky-cap item above) when
// the open-top reveal is desired.
const DOME_OUTER_R = 1000;
const DOME_INNER_R =  998;
const DOME_RIM_Y   = 2000;

// Ground base curve — flat annular plateau around the building (so the
// staff-shack/marina sits on level land), then linear slope along X
// outside the plateau (-X drops below water, +X climbs to mountains).
// Plateau radius is well past the building's outer extent (~40 from
// origin); the BLEND_R smoothstep avoids a cliff at the plateau edge.
// More plateaus / terraces can be layered in later.
const SLOPE           = 0.6;
const WATER_LEVEL_Y   = -13;                   // = kitchen floor; door bottom sits at shoreline
const PLATEAU_R       = 60;                    // flat plateau out to here
const PLATEAU_BLEND_R = 80;                    // slope fully kicked in past here
const groundHeight = (px, pz) => {
  const r = Math.sqrt(px * px + pz * pz);
  if (r < PLATEAU_R) return WATER_LEVEL_Y;
  const slopeY = WATER_LEVEL_Y + SLOPE * (px - DOOR_X);
  const t = Math.min(1, (r - PLATEAU_R) / (PLATEAU_BLEND_R - PLATEAU_R));
  const tSmooth = t * t * (3 - 2 * t);
  return WATER_LEVEL_Y * (1 - tSmooth) + slopeY * tSmooth;
};

// House exterior — the visible building from the cove. Wraps the entire
// kitchen and all its secret zones (mousehole pokes -X past the kitchen
// wall; chamber pokes -Z past the back wall) inside one outside-tagged
// shell. Built as the WALL between two boxes: an inner box matching the
// kitchen's interior, and an outer box wide enough that the wall around
// each secret pocket is tunnel-proof against boosted cove speed (see
// HOUSE_HALF_* comments at top of file). The keyhole bore is cut
// through it, plus the secret pockets' air shapes (so the wall reports
// air where pockets live; otherwise their boundaries' physics push
// fish onto the cove). Subsumes the old free-standing staff shack.

// Outside door on the building's +Z face. Painted on via colorFn (no
// separate SDF item) — the keyhole bore already passes through this
// area via the house cut, so no extra geometry needed. X mildly scaled
// up to match the wider outer wall (inside door X=3.5 → outside 4.5);
// Y kept close to the inside door's height so the door bottom still
// sits at the kitchen-floor / plateau line (y=-13).
const OUT_DOOR_X       = +15;
const OUT_DOOR_Y       =  -1.5;
const OUT_DOOR_HALF_X  =  4.5;
const OUT_DOOR_HALF_Y  = 11.5;

const houseInnerSdf    = boxSDF([KITCHEN_HALF_X, KITCHEN_HALF_Y, KITCHEN_HALF_Z]);
const houseOuterSdf    = boxSDF([HOUSE_HALF_X, HOUSE_HALF_Y, HOUSE_HALF_Z]);
const houseWallSdf     = cutSDF(houseInnerSdf, houseOuterSdf);

// Back-of-shack window — flush against the wall's cove-side face, NOT
// cut through the wall. The wall stays solid (which is what blocks the
// fish from clipping into kitchen / chamber). The window itself is a
// thin decorative slab pasted to the wall surface from outside, with a
// jutting frame ring around a recessed glass plate. Visual continuity
// only — pure colormap-with-relief, no penetration.
const BACK_WINDOW_HALF_X     = 6;
const BACK_WINDOW_HALF_Y     = 5;
const BACK_WINDOW_FRAME_W    = 0.5;
const BACK_WINDOW_FRAME_HZ   = 0.12;            // frame jut depth past wall (one side)
const BACK_WINDOW_GLASS_HZ   = 0.05;            // glass slab thickness, recessed inside frame
const BACK_WINDOW_CENTER_Z   = -HOUSE_HALF_Z - BACK_WINDOW_FRAME_HZ;     // frame -Z face flush past wall
const BACK_WINDOW_POS        = [+8, +2, BACK_WINDOW_CENTER_Z];

// Frame ring: outer box minus inner-cut box. Glass: separate small
// slab at the same center, thinner so it sits recessed inside the
// frame's depth.
const backWindowFrameOuterSdf = boxSDF([
  BACK_WINDOW_HALF_X,
  BACK_WINDOW_HALF_Y,
  BACK_WINDOW_FRAME_HZ,
]);
const backWindowFrameInnerSdf = boxSDF([
  BACK_WINDOW_HALF_X - BACK_WINDOW_FRAME_W,
  BACK_WINDOW_HALF_Y - BACK_WINDOW_FRAME_W,
  BACK_WINDOW_FRAME_HZ + 0.05,                  // overlaps frame Z so the cut is clean
]);
const backWindowFrameSdf = cutSDF(backWindowFrameInnerSdf, backWindowFrameOuterSdf);
const backWindowGlassSdf  = boxSDF([
  BACK_WINDOW_HALF_X - BACK_WINDOW_FRAME_W,
  BACK_WINDOW_HALF_Y - BACK_WINDOW_FRAME_W,
  BACK_WINDOW_GLASS_HZ,
]);
const backWindowSdf = unionSDF(backWindowFrameSdf, backWindowGlassSdf);

// House exterior cut: keyhole bore + the secret zones' air shapes (so
// the wall has air where the mousehole pocket and chamber pocket live,
// matching the geometry the secret-room shells already establish).
// Without these air-shape cuts, a fish near a secret-pocket boundary
// would have physics probes touch outside region, the wall's gradient
// would shove the fish toward whichever wall face is closer, and at
// the corner pockets that's the cove-side outer face → fish ends up
// on the grass outside the building. The window is NOT cut here — the
// wall stays solid behind it (window is purely decorative on top).
const houseExteriorSdf = cutSDF(
  unionSDF(keyholeBoreWorldSdf, mouseholeAirSdf, chamberAirSdf),
  houseWallSdf,
);


// ─────────────────────────── colorFns ───────────────────────────

// Sky: gradient from light pale-blue near horizon up to deeper blue at
// zenith. The dome's inner-wall normals all point toward the origin, so
// lambertian (light from +Y) dims the upper hemisphere to ambient (35%)
// and brightens the lower hemisphere to 100% — that creates a hard
// "dark cliff" seam at the equator. To make the dome read as uniform
// sky from any viewing angle, pre-divide each color by the brightness
// the tracer is going to multiply by, so post-shading we land on the
// intended gradient. ndotl at hit point ≈ -lpy / DOME_INNER_R since
// the normal is the inward radial direction.
const domeColorFn = (lpx, lpy, lpz) => {
  const t = Math.max(0, Math.min(1, lpy / DOME_INNER_R));
  const r = 130 - 70 * t;
  const g = 180 - 60 * t;
  const b = 235 - 35 * t;
  const ndotl = -lpy / DOME_INNER_R;
  const brightness = 0.35 + 0.65 * Math.max(0, ndotl);
  const c = 1 / brightness;
  return [r * c, g * c, b * c];
};

// Ground: deep sand → shallow sand → beach → grass → rock → snow,
// keyed off world Y (item position is origin so local = world).
const groundColorFn = (lpx, lpy, lpz) => {
  if (lpy < WATER_LEVEL_Y - 25) return [180, 165, 130];
  if (lpy < WATER_LEVEL_Y - 10) return [200, 185, 150];
  if (lpy < WATER_LEVEL_Y)      return [225, 205, 145];
  if (lpy < WATER_LEVEL_Y + 5)  return [85, 130, 60];
  if (lpy < WATER_LEVEL_Y + 20) return [115, 100, 75];
  return [200, 200, 205];
};

// House exterior: weathered wood plank stripes for most of the building,
// with a paneled door painted onto the +Z (cove-facing) face in the
// door footprint, and a yellow "STAFF" sign band above the door.
// The door panel structure mirrors the kitchen door's interior colorFn,
// scaled to the outside door's size — so the door reads as the same
// door from both sides.
const houseExteriorColorFn = (lpx, lpy, lpz) => {
  const onCoveFace = lpz > HOUSE_HALF_Z - 0.1;

  if (onCoveFace) {
    // STAFF sign band, above the door's top.
    if (lpy > 13 && lpy < 16) return [225, 195, 60];

    // Door area — paneled wood, mirroring the kitchen door's structure.
    const doorDx = lpx - OUT_DOOR_X;
    const doorDy = lpy - OUT_DOOR_Y;
    if (Math.abs(doorDx) < OUT_DOOR_HALF_X && Math.abs(doorDy) < OUT_DOOR_HALF_Y) {
      const FRAME_W = 0.55;
      const STILE_W = 0.22;
      const RAIL_W  = 0.22;
      const DARK    = [70, 45, 25];
      if (Math.abs(doorDx) > OUT_DOOR_HALF_X - FRAME_W ||
          Math.abs(doorDy) > OUT_DOOR_HALF_Y - FRAME_W) return DARK;
      if (Math.abs(doorDx) < STILE_W) return DARK;
      const innerHalfY = OUT_DOOR_HALF_Y - FRAME_W;
      if (Math.abs(doorDy - innerHalfY * (1/3)) < RAIL_W) return DARK;
      if (Math.abs(doorDy + innerHalfY * (1/3)) < RAIL_W) return DARK;
      const grain = Math.sin(doorDy * 6 + doorDx * 1.5) * 0.4 + Math.sin(doorDx * 12) * 0.15;
      return [115 + 25 * grain, 80 + 16 * grain, 50 + 10 * grain];
    }
  }

  // Default: weathered wood plank stripes.
  const stripe = (Math.floor(lpy / 0.6)) & 1;
  return stripe === 0 ? [110, 75, 45] : [85, 55, 30];
};

// Back-of-shack window: cove-side hits split by xy. Outside the inner
// glass area = frame ring (jutting 0.12 past wall) → wood. Inside = the
// recessed glass plate → dark blue-gray gradient + diagonal glare
// streaks. lpz is approximately -frameHZ (= -0.12) at frame face and
// -glassHZ (= -0.05) at glass face — both negative on cove-facing side.
const backWindowColorFn = (lpx, lpy, lpz) => {
  const halfX = BACK_WINDOW_HALF_X, halfY = BACK_WINDOW_HALF_Y;
  const innerHalfX = halfX - BACK_WINDOW_FRAME_W;
  const innerHalfY = halfY - BACK_WINDOW_FRAME_W;
  const inGlassXy  = Math.abs(lpx) < innerHalfX && Math.abs(lpy) < innerHalfY;

  if (lpz < -0.01) {                                     // cove-facing side
    if (inGlassXy) {
      const diag = lpx - lpy * 0.7;
      if (Math.abs(diag - 1.5) < 0.20) return [225, 235, 245];
      if (Math.abs(diag + 2.6) < 0.12) return [200, 215, 230];
      const t = Math.max(0, Math.min(1, (lpy + halfY) / (2 * halfY)));
      return [30 + 25 * t, 45 + 35 * t, 75 + 35 * t];
    }
    return [120, 85, 55];                                // wood frame
  }
  return [60, 40, 25];                                   // wall-facing back / sides
};


// ─────────────────────────── scene build ───────────────────────────

/**
 * Add the outside zone to the scene. Mutates the kitchen 'door' item
 * to carve the keyhole bore — call after kitchen.addToScene.
 *
 * @param {import('../../core/scene.js').Scene} scene
 */
export const addToScene = (scene) => {
  const add = (item) => registerItem(scene, { ...item, regionKey: REGION_OUTSIDE });

  // Carve the keyhole through BOTH the kitchen door AND the kitchen
  // room. The room is invertSDF(box) — solid material extends to
  // infinity past the front wall plane (z=+22). The door is just a
  // thin slab in front of the wall; carving only the door leaves the
  // room wall intact behind it, blocking the bore. Mousehole and
  // chamber cut through the room too — same pattern.
  const cutItemWith = (item, worldToolSdf) => {
    const [px, py, pz] = item.position;
    const localTool = (lx, ly, lz) => worldToolSdf(lx + px, ly + py, lz + pz);
    item.sdf = cutSDF(localTool, item.sdf);
  };
  const door = scene.find(it => it.name === 'door');
  if (door) cutItemWith(door, keyholeBoreWorldSdf);
  const kitchenRoom = scene.find(it => it.name === 'room');
  if (kitchenRoom) cutItemWith(kitchenRoom, keyholeBoreWorldSdf);

  // Brass escutcheon plates — one each side of the door, with the
  // keyhole shape cut clean through. The plates frame the keyhole with
  // brass margin all around. Region-tagged so each is visible only
  // from its own side.
  const PLATE_BOUND_R = Math.hypot(PLATE_HALF_W, PLATE_HALF_H, PLATE_HALF_Z) + 0.05;
  registerItem(scene, {
    name:     'door-plate-kitchen',
    color:    [180, 145, 50],
    position: [KEYHOLE_X, KEYHOLE_Y, KITCHEN_PLATE_Z],
    sdf:      plateSdf,
    boundingRadius: PLATE_BOUND_R,
    regionKey: REGION_KITCHEN,
  });
  add({
    name:     'door-plate-outside',
    color:    [180, 145, 50],
    position: [KEYHOLE_X, KEYHOLE_Y, OUTSIDE_PLATE_Z],
    sdf:      plateSdf,
    boundingRadius: PLATE_BOUND_R,
  });

  // Round brass knobs — spheres mounted on the upper portion of each
  // plate, protruding outward. The actual handle the player would
  // grasp; the keyhole below it is for the (mythical) key.
  registerItem(scene, {
    name:     'door-knob-kitchen',
    color:    [200, 165, 70],
    position: [KEYHOLE_X, KEYHOLE_Y + KNOB_LPY, KITCHEN_KNOB_Z],
    sdf:      knobSdf,
    boundingRadius: KNOB_R + 0.02,
    regionKey: REGION_KITCHEN,
  });
  add({
    name:     'door-knob-outside',
    color:    [200, 165, 70],
    position: [KEYHOLE_X, KEYHOLE_Y + KNOB_LPY, OUTSIDE_KNOB_Z],
    sdf:      knobSdf,
    boundingRadius: KNOB_R + 0.02,
  });

  // Sky dome — concentric with the kitchen's fishbowl, just way bigger.
  // No bounding radius: region cull is the filter.
  add({
    name:     'outside-dome',
    color:    [130, 180, 235],
    colorFn:  domeColorFn,
    position: [0, 0, 0],
    sdf:      openTopBowlSDF({ outerR: DOME_OUTER_R, innerR: DOME_INNER_R, rimY: DOME_RIM_Y }),
  });

  // Ground base curve — heightfield with a single-axis (X) linear slope.
  // * 0.6 keeps the SDF conservative for the marcher (heightfield
  // Lipschitz factor is sqrt(1+SLOPE²) ≈ 1.17, so 1/1.17 ≈ 0.85; 0.6 is
  // well under and safe).
  const groundSdf = (px, py, pz) => (py - groundHeight(px, pz)) * 0.6;
  add({
    name:     'outside-ground',
    color:    [120, 100, 75],
    colorFn:  groundColorFn,
    position: [0, 0, 0],
    sdf:      groundSdf,
  });

  // House exterior — the visible building from the cove. Wraps the
  // kitchen + all secret zones in one shell, with the keyhole bore cut
  // through. No bounding radius: this thing is huge and the region cull
  // already filters it for kitchen-region rays.
  add({
    name:     'house-exterior',
    color:    [110, 75, 45],
    colorFn:  houseExteriorColorFn,
    position: [0, 0, 0],
    sdf:      houseExteriorSdf,
  });

  // Back-of-shack window — visual continuity with the kitchen window
  // inside. Pasted on the cove side of the (uncut) back wall: thin
  // frame ring jutting 0.12 past the wall, glass plate recessed inside
  // the frame. The wall stays solid behind it, so the fish bumps the
  // wall normally (or the frame, whichever it hits first).
  add({
    name:     'back-shack-window',
    color:    [55, 75, 105],
    colorFn:  backWindowColorFn,
    position: BACK_WINDOW_POS,
    sdf:      backWindowSdf,
    boundingRadius: Math.hypot(BACK_WINDOW_HALF_X, BACK_WINDOW_HALF_Y, BACK_WINDOW_FRAME_HZ) + 0.05,
  });

  // Keyhole veil pair. Each veil is a thin opaque dark slab matching the
  // keyhole's full silhouette (circle + slot), parked inside the bore on
  // its region's side of the door. Region-tagged so each is invisible to
  // the other side; collides:false so the fish swims through.
  const VEIL_HALF_Z = 0.0025;
  const veilSdf = keyholeExtrudedSdf(VEIL_HALF_Z);
  const VEIL_BOUND_R = KEYHOLE_BOUND_R + 0.02;
  registerItem(scene, {
    name:     'keyhole-veil-kitchen',
    color:    [10, 10, 12],
    position: [KEYHOLE_X, KEYHOLE_Y, +21.85],
    sdf:      veilSdf,
    collides: false,
    boundingRadius: VEIL_BOUND_R,
    regionKey: REGION_KITCHEN,
  });
  add({
    name:     'keyhole-veil-outside',
    color:    [10, 10, 12],
    position: [KEYHOLE_X, KEYHOLE_Y, +22.15],
    sdf:      veilSdf,
    collides: false,
    boundingRadius: VEIL_BOUND_R,
  });
};
