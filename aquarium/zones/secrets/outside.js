// aquarium/zones/secrets/outside.js — third secret zone, reached by swimming
// through the keyhole bored through the kitchen front door (and the
// brass escutcheon plate around it; the brass knob above the keyhole
// is a separate decorative sphere). Inside is a concentric, vastly-
// larger fishbowl-shaped dome (open-top bowl, like the kitchen's, just
// huger and centered at the same world origin) — a meta callback: the
// kitchen we came from is itself one toy inside a much bigger
// fishbowl. The cove ground is one continuous slope in X: lower far
// -X, beach near the door's X column, mountains far +X — single-axis
// ramp, leaving plenty of horizontal room for boats, rocks, roads,
// etc. in later iterations.
//
// First-pass architecture: dome shell + linear ground slope + shack
// (the building we exit, with the bore cut through it) + keyhole +
// brass plates + brass knobs + region veils.

import {
  registerItem,
  sphereSDF, boxSDF,
  cutSDF, cutSDFCullableBox, unionSDF,
  translateSDF,
} from '../../../core/scene.js';

import {
  REGION_KITCHEN,
  ROOM_HALF_X as KITCHEN_HALF_X,
  ROOM_HALF_Y as KITCHEN_HALF_Y,
  ROOM_HALF_Z as KITCHEN_HALF_Z,
} from '../kitchen.js';
import {
  mouseholeAirSdf,
  MOUSEHOLE_AIR_BOUND_CENTER,
  MOUSEHOLE_AIR_BOUND_HALF,
} from './mousehole.js';
import {
  chamberAirSdf,
  CHAMBER_AIR_BOUND_CENTER,
  CHAMBER_AIR_BOUND_HALF,
} from './chamber.js';
import { sampleClouds }    from '../../assets/clouds.js';
import * as mountains      from '../../assets/mountains.js';
import { frameTime }       from '../../../core/tracer.js';
import { MIN_TRAVERSAL_OVERLAP, FISH_RADIUS } from '../../physics.js';

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
//   - kitchen ceiling at y=±13 → wall ≥ 2.88 in Y suffices; set to 6
//     for symmetry and a wide top-wall clipping margin.
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

// Bore extends past the kitchen front wall (z=+22), through the
// house wall, and past the cove-side plate (knob is off-axis so it
// doesn't constrain the bore extent). Both end overlaps satisfy
// MIN_TRAVERSAL_OVERLAP for fish traversal plus a 0.6 visual margin.
// Outside extent derived from HOUSE_HALF_Z so the bore follows the
// outer-Z face if it ever moves.
const KEYHOLE_Z_KITCHEN = +22.0          - (MIN_TRAVERSAL_OVERLAP + 0.6);  // +21 with default fishRadius
const KEYHOLE_Z_OUTSIDE = HOUSE_HALF_Z   + (MIN_TRAVERSAL_OVERLAP + 0.6);  // outer face + 1.0
const KEYHOLE_HALF_Z    = (KEYHOLE_Z_OUTSIDE - KEYHOLE_Z_KITCHEN) / 2;
const KEYHOLE_CENTER_Z  = (KEYHOLE_Z_OUTSIDE + KEYHOLE_Z_KITCHEN) / 2;

const keyholeBoreWorldSdf = translateSDF(
  [KEYHOLE_X, KEYHOLE_Y, KEYHOLE_CENTER_Z],
  keyholeExtrudedSdf(KEYHOLE_HALF_Z),
);

// Bounding box for cullable cuts on items the keyhole bore passes
// through (kitchen door, kitchen room, house exterior). The bore is
// VERY elongated — Z half-length 5.5 vs XY footprint ~0.7 — so an AABB
// bound is much tighter than a sphere here (sphere would have to
// enclose the diagonal). Symmetric around (KEYHOLE_X, KEYHOLE_Y) even
// though the keyhole shape is asymmetric in Y (slot extends further
// down than the circle extends up); the small slop on the +Y side is
// far cheaper than the keyhole shape's elongation. Margin past the
// material extent on each axis is FISH_RADIUS — physics-traversed cut
// (see cutSDFCullableBox doc in core/scene.js for the mover-radius
// rule).
const KEYHOLE_BORE_BOUND_CENTER = [KEYHOLE_X, KEYHOLE_Y, KEYHOLE_CENTER_Z];
const KEYHOLE_BORE_BOUND_HALF   = [
  0.55 + FISH_RADIUS,            // circle radius (= max of circle R, slot half-W)
  0.65 + FISH_RADIUS,            // |slot bottom| (covers asymmetric Y, with slop on +Y side)
  KEYHOLE_HALF_Z + FISH_RADIUS,  // extrusion half-length
];

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

// Closed spherical shell — material between innerR and outerR at all
// orientations. Used by the cove's dome and firmament; both want a
// real closed sphere (no open top), so this skips the rim term that
// openTopBowlSDF carries. Single sqrt per call.
const sphereShellSdf = (innerR, outerR) => (px, py, pz) => {
  const r = Math.sqrt(px * px + py * py + pz * pz);
  return Math.max(innerR - r, r - outerR);
};

// Sky dome — closed spherical shell concentric with the kitchen's
// fishbowl (which sits at world origin), vastly larger (≈137× the
// kitchen bowl's radius). With the 10× outside-region speed
// multiplier, the cove feels about 1000× the linear units of the
// kitchen so it reads as truly massive.
//
// Shell thickness sized to the cove's max forward displacement.
// Forward speed in the cove = base 1.44 × speedMul 10 = 14.4 units/sec
// → 1.108 units per frame at 13 fps. Plus 0.20 fishRadius, max
// per-frame clipping risk ≈ 1.5 units. Shell of 32 units (998 →
// 1030) gives ~20× headroom — comfortable safety margin without
// adding meaningful inside-dome marching cost for grazing rays.
const DOME_OUTER_R = 1030;
const DOME_INNER_R =  998;

// Sky firmament — opaque shell wrapping outside the (translucent)
// physics dome. The dome itself is bowl-glass colored, mirroring the
// kitchen fishbowl pattern; the sky + painted distant-mountain
// silhouette are rendered on the firmament behind it. From inside
// the cove a ray hits the translucent dome (picks up bowl-glass
// tint), passes through the air gap, and lands on the firmament —
// dome reads as a real bowl with sky outside, same way the kitchen
// fishbowl reads as a glass bowl with the kitchen behind it.
//
// Firmament inner sits one sun diameter past the sun's upper edge
// (sun apex y = 1098, firmament inner at 1300 = ~200 units past).
// Tight inner radius keeps cove rays from running long distances at
// the dome periphery and exhausting MAX_STEPS before hitting any
// surface (which paints background black). Outer radius is generous
// (700-unit thickness) so grazing-angle rays that step shallow near
// the inner boundary still land inside the shell volume on the next
// step rather than overshooting through a thin surface. Sky gradient
// is normalized by FIRMAMENT_INNER_R so visible color is identical
// at any radius — the choice of radii is purely about marcher-catch
// reliability. Closed spherical shell.
const FIRMAMENT_OUTER_R = 2000;
const FIRMAMENT_INNER_R = 1300;

// Sun — over-bright sphere parked half-in / half-out of the dome at
// the apex (perfectly above the shack at world origin). Center at
// y=DOME_INNER_R=998 means exactly half the sun's volume sits inside
// the cove (y < 998) and half pokes past the dome (y > 998). With
// the translucent dome glass, the lower hemisphere reads at full
// brightness and the upper hemisphere reads bowl-tinted-through-
// glass — gives the dramatic "sun corked into the bowl" silhouette.
//
// Color is the kitchen sun-cover [255, 235, 120] scaled 3× so
// over-bright magnitudes clamp R + G to 255 at any angle while
// leaving B short of clamp — vibrant yellow disc, distinct from
// the cloud field, callback to the painted-sun on the kitchen
// window.
const SUN_POSITION = [0, 998, 0];
const SUN_RADIUS   = 100;
// Camera teleports back to spawn when Y exceeds this. Set 7 units
// past the sun's lower edge — at cove forward speed (14.4 units/sec),
// that's about 0.5s of flight into the sun, matching the controls
// lockout window so the teleport fires just as the screen is fully
// engulfed in yellow.
export const SUN_TRIGGER_Y = SUN_POSITION[1] - SUN_RADIUS + 7;

// Ground heightfield — flat plateau around the building (where the
// shack and the village sit), with a beach slope down to the seafloor
// in the +Z (cove-front) hemisphere only. The -Z hemisphere stays
// plateau-flat all the way out, so the village can spread between the
// shack and the mountain range that rises behind it (mountains live as
// separate items in mountains.js).
//
// Vertical layout:
//   plateau Y       = SHACK_PLATEAU_Y     (= -13)
//   sea level       = SEA_LEVEL_Y         (= -25, water-surface parks here)
//   shallow seafloor= SEA_FLOOR_Y         (= -50, just past the beach)
//   deep seafloor   = DEEP_SEA_Y          (= -180, far cove)
//
// Beach goes from PLATEAU_R (60) to BEACH_END_R (160) in the +Z
// hemisphere; ground smoothsteps from plateau down to SEA_FLOOR_Y.
// Past BEACH_END_R, the seafloor continues sloping down to DEEP_SEA_Y
// at DEEP_SEA_R (600), so swimming farther from shore visibly gets
// deeper. Waterline (beach crossing SEA_LEVEL_Y) lands roughly mid-beach.
const SHACK_PLATEAU_Y = -13;
const SEA_LEVEL_Y     = -25;
const SEA_FLOOR_Y     = -50;
const DEEP_SEA_Y      = -180;
const PLATEAU_R       = 60;
const BEACH_END_R     = 160;
const DEEP_SEA_R      = 600;
const groundHeight = (px, pz) => {
  const r = Math.sqrt(px * px + pz * pz);
  if (r < PLATEAU_R) return SHACK_PLATEAU_Y;
  // Cove side (+Z): plateau → shallow seafloor → deep seafloor as r grows.
  if (pz > 0) {
    if (r > DEEP_SEA_R) return DEEP_SEA_Y;
    if (r > BEACH_END_R) {
      // Past beach: smooth slope shallow → deep.
      const t = (r - BEACH_END_R) / (DEEP_SEA_R - BEACH_END_R);
      const tSmooth = t * t * (3 - 2 * t);
      return SEA_FLOOR_Y * (1 - tSmooth) + DEEP_SEA_Y * tSmooth;
    }
    // Beach: plateau → shallow seafloor.
    const t = (r - PLATEAU_R) / (BEACH_END_R - PLATEAU_R);
    const tSmooth = t * t * (3 - 2 * t);
    return SHACK_PLATEAU_Y * (1 - tSmooth) + SEA_FLOOR_Y * tSmooth;
  }
  // Mountain side (-Z): plateau extends all the way to the dome wall.
  // Mountains rise from this plateau as their own items.
  return SHACK_PLATEAU_Y;
};

// Water surface — thin translucent slab parked at SEA_LEVEL_Y across
// the cove (+Z) hemisphere. The slab is wider than the dome so a player
// looking out at any angle sees water meeting horizon; the SDF is a
// straight box, so the visible "shoreline" is naturally where the
// rising beach surface pokes up through the water plane and occludes
// the slab from below. Underwater fog (separate item) tints the volume
// beneath. Both items are collides:false — fish swims through.
const WATER_HALF_X    = 1000;
const WATER_HALF_Y    = 0.05;
const WATER_HALF_Z    = 460;                   // half-depth of cove water
const WATER_CENTER_Z  = +540;                  // pushed +Z so the slab spans z ≈ [80, 1000]
// Underwater fog box — large translucent volume below the water surface
// in the cove hemisphere. Camera below sea level picks up the tint at
// step zero. Top at sea level, bottom well below the deep seafloor (so
// deep rays still pick up the wash). Centered in +Z so the tint never
// bleeds over land in the -Z mountain hemisphere.
const FOG_HALF_X      = 1000;
const FOG_HALF_Y      = 150;                   // covers down to y ≈ -325
const FOG_HALF_Z      = WATER_HALF_Z;
const FOG_CENTER_Y    = SEA_LEVEL_Y - FOG_HALF_Y;
const FOG_CENTER_Z    = WATER_CENTER_Z;

// House exterior — the visible building from the cove. Wraps the entire
// kitchen and all its secret zones (mousehole pokes -X past the kitchen
// wall; chamber pokes -Z past the back wall) inside one outside-tagged
// shell. Built as the WALL between two boxes: an inner box matching the
// kitchen's interior, and an outer box wide enough that the wall around
// each secret pocket is tunnel-proof against boosted cove speed (see
// HOUSE_HALF_* comments at top of file). The keyhole bore is cut
// through it, plus the secret pockets' air shapes (so the wall reports
// air where pockets live; otherwise their boundaries' physics push
// fish onto the cove).

// Outside door on the building's +Z face. Painted on via colorFn (no
// separate SDF item) — the keyhole bore already passes through this
// area via the house cut, so no extra geometry needed. X mildly scaled
// up to match the wider outer wall (inside door X=3.5 → outside 4.5);
// Y kept close to the inside door's height so the door bottom still
// sits at the SHACK_PLATEAU_Y line.
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
//
// Equivalent to cutSDF(unionSDF(A, B, C), wall), since
//   max(-min(A,B,C), w) = max(-A, -B, -C, w)
// — but each tool gets its own AABB bound, so a step far from any
// cut volume bails to wall(p) directly with at most three cheap box
// rejects. Outside-region rays in the cove (the bulk of frames spent
// looking at the shack) hit this path almost exclusively.
const houseExteriorSdf = cutSDFCullableBox(
  keyholeBoreWorldSdf,
  cutSDFCullableBox(
    mouseholeAirSdf,
    cutSDFCullableBox(
      chamberAirSdf,
      houseWallSdf,
      CHAMBER_AIR_BOUND_CENTER, CHAMBER_AIR_BOUND_HALF,
    ),
    MOUSEHOLE_AIR_BOUND_CENTER, MOUSEHOLE_AIR_BOUND_HALF,
  ),
  KEYHOLE_BORE_BOUND_CENTER, KEYHOLE_BORE_BOUND_HALF,
);


// ─────────────────────────── colorFns ───────────────────────────

// Bowl-glass dome tint — cancel the dome's lambertian shading so its
// tint contribution to through-bowl rays is constant regardless of
// view angle. Without this, the dome's BOTTOM face (light from +Y,
// ndotl=+1) reads ~3× brighter than the TOP/SIDES (ndotl≤0, ambient
// only), making the sky read different brightness depending on which
// way you look.
//
// Trick: pre-divide by current brightness, then scale back by the
// ambient floor (0.35) so the dome reads uniformly at the dimmest
// brightness it would naturally show — matching the most common view
// (looking up/sideways from inside). After the tracer's lambertian
// multiply, dome_lit lands at [40,55,85] × 0.35 = [14,19,30] for
// every ray. ndotl ≈ -lpy / DOME_INNER_R since normal is the inward
// radial direction at the inner shell.
const domeColorFn = (lpx, lpy, lpz) => {
  const ndotl = -lpy / DOME_INNER_R;
  const brightness = 0.35 + 0.65 * Math.max(0, ndotl);
  const c = 0.35 / brightness;
  return [40 * c, 55 * c, 85 * c];
};

// Sky firmament — gradient from pale-blue near horizon up to deeper
// blue at zenith, with painted-on cloud field and distant-mountain
// silhouette. Painted on the FIRMAMENT shell (not the dome), since
// the dome reads as translucent bowl glass and the sky rendering
// needs a solid backdrop behind it. Clouds: two layers (white upper,
// grey lower) sampled per-pixel via clouds.js; grey takes priority
// on overlap so a lower cloud reads in front of an upper cloud
// behind it.
//
// SKY_BOOST: cove rays read firmament colors composited as 0.70 ×
// firmament + 0.30 × bowl-glass-tint. The dome's tint is uniform
// per domeColorFn (constant [14, 19, 30] post-shading), so a single
// boost pins firmament brightness across all view angles. Math:
// target through-bowl color ≈ direct color → SKY_BOOST ≈ (color -
// 0.30 × dome_lit) / (0.70 × color). For sky range [60..235] and
// cloud tint ~240 per channel, that lands at ~1.33–1.40 across
// channels and elevations; 1.4 sits at the upper end with a small
// uniform-brightness margin. Applied to BOTH sky gradient and cloud
// overlay below so each lands at its native tint through the dome.
//
// Firmament's inner-wall normals point toward the origin, so
// lambertian (light from +Y) dims the upper hemisphere to ambient
// and brightens the lower — pre-divide by the brightness the tracer
// will multiply by, so post-shading we land on the intended gradient.
// ndotl at hit point ≈ -lpy / FIRMAMENT_INNER_R (normal is inward
// radial direction).
const SKY_BOOST = 1.4;

// Painted distant-mountain silhouette on the firmament — fills the
// dome's lower band along the LAND hemisphere so the cove's horizon
// reads as continuous land along the back, with an open-water gap
// straight out the door. Rolling hills tapering up into alpine
// ridges, blending behind the modeled matterhorn + mont-blanc duo.
//
// paintedSilhouetteEl(azimuth) returns the silhouette's elevation
// cap (radians above horizon) at a given azimuth. Profile: low (~2°)
// at the +Z (water/door) direction so a player exiting the keyhole
// sees water continuing to the horizon, smoothstep-rising toward -Z
// (back land) where it caps at ~32°. Multi-octave noise gives an
// irregular ridge silhouette across the rest of the dome.
//
// Inside firmamentColorFn, pixels below the cap render as painted
// mountain (forest/rocky/slate gradient by frac-up); pixels above
// render the existing sky. Modeled mountain items sit IN FRONT of
// the firmament and naturally occlude the painted backdrop where
// they cover the same direction.
const WATER_AZIMUTH       = 90 * Math.PI / 180;   // +Z direction — water out the door
const PAINTED_SIL_MIN_EL  = 0.04;                  // elevation cap at the water direction
const PAINTED_SIL_MAX_EL  = 0.55;                  // elevation cap opposite (back land)
const paintedSilhouetteEl = (azimuth) => {
  let toWater = Math.abs(azimuth - WATER_AZIMUTH);
  if (toWater > Math.PI) toWater = 2 * Math.PI - toWater;
  const baseFrac = toWater / Math.PI;
  const smoothFrac = baseFrac * baseFrac * (3 - 2 * baseFrac);
  const baseEl = PAINTED_SIL_MIN_EL + (PAINTED_SIL_MAX_EL - PAINTED_SIL_MIN_EL) * smoothFrac;
  const noise  = Math.sin(azimuth *  7) * 0.05
               + Math.sin(azimuth * 13 + 1.7) * 0.03
               + Math.sin(azimuth * 23 - 0.9) * 0.015;
  return baseEl + noise;
};

const firmamentColorFn = (lpx, lpy, lpz) => {
  const inv = 1 / FIRMAMENT_INNER_R;
  const nx = lpx * inv, ny = lpy * inv, nz = lpz * inv;

  // Lambertian pre-divide — applies to both painted-mountain and sky
  // branches below so each lands at its intended brightness post-shading.
  const ndotl = -ny;
  const brightness = 0.35 + 0.65 * Math.max(0, ndotl);
  const c = 1 / brightness;

  // Painted distant mountain — pixels below the silhouette cap.
  const elevation   = Math.asin(Math.max(-1, Math.min(1, ny)));
  const azimuth     = Math.atan2(nz, nx);
  const silhouette  = paintedSilhouetteEl(azimuth);
  if (elevation > 0 && elevation < silhouette) {
    const fracUp = elevation / silhouette;       // 0 at horizon, 1 at silhouette top
    let mr, mg, mb;
    if (fracUp > 0.85) {
      // High slate — caps the tallest sections.
      mr = 200; mg = 195; mb = 195;
    } else if (fracUp > 0.45) {
      // Rocky body — brown-gray gradient up toward slate.
      const t = (fracUp - 0.45) / 0.40;
      mr = 100 + 100 * t;
      mg =  90 + 105 * t;
      mb =  80 + 115 * t;
    } else {
      // Forest band near silhouette base.
      const t = fracUp / 0.45;
      mr = 60 + 35 * t;
      mg = 95 + 10 * t;
      mb = 50 + 30 * t;
    }
    return [mr * c, mg * c, mb * c];
  }

  // Below horizon — paint as beach-beige ground so the firmament's
  // lower hemisphere reads as "earth/sand continuing past the horizon"
  // anywhere a ray might slip through the cove's heightfield ground
  // (rare but possible at grazing angles or after MAX_STEPS exhaustion).
  if (elevation <= 0) {
    return [180 * c, 165 * c, 130 * c];
  }

  // Cloud overlay — two layers in priority order. Grey (lower) wins
  // over white when both overlap, so a grey patch reads in front of a
  // white patch behind it. Each layer's pixel passes a radial
  // materialization gate iff the pixel's depth into the cloud is
  // "early enough" relative to the cloud's current fade level — gating
  // per-pixel grows the silhouette center-out on fade-in and shrinks
  // it the same on fade-out, no translucent transition through the
  // cloud body.
  //
  //   threshold = (1 - normalizedDepth) × 0.95 + 0.05
  //
  // Math: cloudOp = lobeOp × fade (single-cloud case), so gate
  // `fade ≥ threshold` becomes `cloudOp ≥ lobeOp × threshold`.
  // sampleClouds returns alpha-premultiplied [op, R, G, B, lobeOp,
  // depth] in a shared scratch buffer — read each layer's values
  // before the next call overwrites them. Final color is multiplied
  // by SKY_BOOST so the cloud's native tint reads at full brightness
  // through the translucent dome (same compensation as the sky).
  const grey = sampleClouds(nx, ny, nz, 1);
  if (grey[4] >= 0.005) {
    const dC = grey[5] > 1 ? 1 : grey[5];
    const threshold = (1 - dC) * 0.95 + 0.05;
    if (grey[0] >= grey[4] * threshold) {
      const op = grey[0];
      const m  = 0.85 * SKY_BOOST * c;              // grey-layer mul × through-glass boost
      return [(grey[1] / op) * m, (grey[2] / op) * m, (grey[3] / op) * m];
    }
  }
  const white = sampleClouds(nx, ny, nz, 0);
  if (white[4] >= 0.005) {
    const dC = white[5] > 1 ? 1 : white[5];
    const threshold = (1 - dC) * 0.95 + 0.05;
    if (white[0] >= white[4] * threshold) {
      const op = white[0];
      const m  = SKY_BOOST * c;
      return [(white[1] / op) * m, (white[2] / op) * m, (white[3] / op) * m];
    }
  }

  // Sky gradient — pale-blue near horizon → deeper blue at zenith.
  const t = Math.max(0, Math.min(1, ny));
  const r = (130 - 70 * t) * SKY_BOOST;
  const g = (180 - 60 * t) * SKY_BOOST;
  const b = (235 - 35 * t) * SKY_BOOST;

  return [r * c, g * c, b * c];
};

// Ground strata, keyed off world Y relative to the shack plateau:
// deep seafloor sand below; lighter sand mid; beach tan right at the
// plateau line; grass green just above; brown dirt higher; pale gray
// rock past that. The mid-and-darker bands now read as the cove's
// underwater seafloor and beach, since the +Z hemisphere groundHeight
// slopes through them.
const groundColorFn = (lpx, lpy, lpz) => {
  if (lpy < SHACK_PLATEAU_Y - 25) return [180, 165, 130];
  if (lpy < SHACK_PLATEAU_Y - 10) return [200, 185, 150];
  if (lpy < SHACK_PLATEAU_Y)      return [225, 205, 145];
  if (lpy < SHACK_PLATEAU_Y + 5)  return [85, 130, 60];
  if (lpy < SHACK_PLATEAU_Y + 20) return [115, 100, 75];
  return [200, 200, 205];
};

// Water surface — multi-octave wave noise driven by frameTime so the
// waves drift slowly across the cove. Layered sin/cos gives blob
// crest+trough patterns banded into foam/light/mid/deep tints. A
// high-frequency sparkle pass on top punches in occasional bright
// pixels gated to wave crests, simulating sun-catch glints across
// the surface; the gating keeps sparkles concentrated on highlights
// rather than spread evenly. Pure colorFn — no actual displacement.
const waterColorFn = (lpx, lpy, lpz) => {
  const t = frameTime / 1000;
  const w = Math.sin(lpx * 0.15 + t * 0.40) * Math.cos(lpz * 0.18 + t * 0.30)
          + Math.sin(lpx * 0.42 - t * 0.70) * Math.cos(lpz * 0.36 + t * 0.50) * 0.5
          + Math.sin((lpx + lpz) * 0.85 + t * 1.10) * 0.3;
  // Sun sparkles — high-freq noise gated to wave-crest regions so the
  // glints sit on highlights rather than peppered uniformly.
  if (w > 0.40) {
    const sparkle = Math.sin(lpx * 5.7 + t * 2.3) * Math.cos(lpz * 6.3 - t * 1.7)
                  * Math.sin((lpx - lpz) * 4.2 + t * 1.5);
    if (sparkle > 0.85) return [255, 252, 235];
  }
  if (w >  1.10) return [240, 248, 248];
  if (w >  0.55) return [125, 180, 200];
  if (w >  0.00) return [60, 140, 170];
  if (w > -0.50) return [40, 100, 140];
  return [25, 70, 110];
};

// Underwater fog — depth-graded blue tint. Box-local lpy spans
// [-FOG_HALF_Y, +FOG_HALF_Y]; surface (top) at +FOG_HALF_Y, deep
// (bottom) at -FOG_HALF_Y. depthT = 0 at surface, 1 at deep.
const fogColorFn = (lpx, lpy, lpz) => {
  const depthT = (FOG_HALF_Y - lpy) / (2 * FOG_HALF_Y);
  return [60 - 40 * depthT, 110 - 50 * depthT, 145 - 30 * depthT];
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
 * Add the outside zone to the scene. Carves the keyhole bore through
 * the caller-supplied kitchen `door` and `room` handles.
 *
 * @param {import('../../../core/scene.js').Scene} scene
 * @param {{
 *   room: import('../kitchen.js').KitchenHandle,
 *   door: import('../kitchen.js').KitchenHandle,
 * }} kitchen   Handles to kitchen surfaces this zone extends.
 */
export const addToScene = (scene, { room: kitchenRoom, door }) => {
  const add = (item) => registerItem(scene, { ...item, regionKey: REGION_OUTSIDE });

  // Carve the keyhole through BOTH the kitchen door AND the kitchen
  // room. The room is invertSDF(box) — solid material extends to
  // infinity past the front wall plane (z=+22). The door is just a
  // thin slab in front of the wall; carving only the door leaves the
  // room wall intact behind it, blocking the bore. Mousehole and
  // chamber cut through the room too — same pattern.
  door       .addCut(keyholeBoreWorldSdf, KEYHOLE_BORE_BOUND_CENTER, KEYHOLE_BORE_BOUND_HALF);
  kitchenRoom.addCut(keyholeBoreWorldSdf, KEYHOLE_BORE_BOUND_CENTER, KEYHOLE_BORE_BOUND_HALF);

  // Brass escutcheon plates — one each side of the door, with the
  // keyhole shape cut clean through. The plates frame the keyhole with
  // brass margin all around. Region-tagged so each is visible only
  // from its own side. AABB matches the plate box; the keyhole cut
  // never extends past it.
  const PLATE_BOUND_HALF = [PLATE_HALF_W, PLATE_HALF_H, PLATE_HALF_Z];
  registerItem(scene, {
    name:     'door-plate-kitchen',
    color:    [180, 145, 50],
    position: [KEYHOLE_X, KEYHOLE_Y, KITCHEN_PLATE_Z],
    sdf:      plateSdf,
    boundingBox: PLATE_BOUND_HALF,
    regionKey: REGION_KITCHEN,
  });
  add({
    name:     'door-plate-outside',
    color:    [180, 145, 50],
    position: [KEYHOLE_X, KEYHOLE_Y, OUTSIDE_PLATE_Z],
    sdf:      plateSdf,
    boundingBox: PLATE_BOUND_HALF,
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

  // Bowl-glass dome — translucent shell. Opacity tuned LOW (0.30) so
  // the bowl is just a "slightly visible barrier" rather than heavy
  // glass — mountains extending past it remain mostly visible and
  // sky reads near its direct brightness through it. Same color as
  // the kitchen fishbowl for visual continuity (the world IS another
  // bowl). Shell is intentionally THICK (32 units) for clip-proof
  // physics at cove speeds. domeColorFn pre-divides the lambertian
  // so the bowl's tint is uniform across view angles (avoids
  // direction-dependent sky brightness through the glass).
  add({
    name:     'outside-dome',
    color:    [40, 55, 85],
    colorFn:  domeColorFn,
    position: [0, 0, 0],
    sdf:      sphereShellSdf(DOME_INNER_R, DOME_OUTER_R),
    opacity:  0.30,
  });

  // Sky firmament — opaque shell just past the dome, paints the
  // gradient + cloud field. Cove rays passing through the translucent
  // dome land here and pick up the sky color; the dome's bowl-glass
  // tint stacks over it so the sky reads as "behind the glass."
  add({
    name:     'sky-firmament',
    color:    [130, 180, 235],
    colorFn:  firmamentColorFn,
    position: [0, 0, 0],
    sdf:      sphereShellSdf(FIRMAMENT_INNER_R, FIRMAMENT_OUTER_R),
  });

  // Sun — over-bright sphere up near the dome's apex. Visual anchor
  // and teleport trigger (camera Y > SUN_TRIGGER_Y → reset to spawn,
  // wired through world.js's TELEPORT.triggerY). collides:false so the
  // camera passes through; the teleport fires before the camera reaches
  // the dome wall behind the sun.
  add({
    name:     'outside-sun',
    color:    [765, 705, 360],
    position: SUN_POSITION,
    sdf:      sphereSDF(SUN_RADIUS),
    collides: false,
    boundingRadius: SUN_RADIUS + 0.05,
  });

  // Ground base curve — heightfield with a +Z-hemisphere beach slope
  // and a flat -Z-hemisphere plateau (mountains will rise from the
  // plateau as separate items). * 0.6 keeps the SDF conservative for
  // the marcher (beach slope's max grad ≈ (PLATEAU_Y - SEA_FLOOR_Y) /
  // (BEACH_END_R - PLATEAU_R) ≈ 37/100 = 0.37; safety factor 0.6 sits
  // well under 1/sqrt(1 + 0.37²) ≈ 0.94).
  const groundSdf = (px, py, pz) => (py - groundHeight(px, pz)) * 0.6;
  add({
    name:     'outside-ground',
    color:    [120, 100, 75],
    colorFn:  groundColorFn,
    position: [0, 0, 0],
    sdf:      groundSdf,
  });

  // Water surface — translucent slab parked at SEA_LEVEL_Y across the
  // cove. Where the rising beach pokes up through the slab, the
  // visible shoreline emerges naturally; far past the beach (past
  // BEACH_END_R), the slab covers the seafloor. collides:false so the
  // camera can dive through to swim underwater. AABB matches the slab
  // exactly — Y half is just 0.05 even though X/Z reach 1000+, so any
  // ray not pointing at the water plane gets dropped at the cull.
  add({
    name:     'water-surface',
    color:    [60, 140, 170],
    colorFn:  waterColorFn,
    position: [0, SEA_LEVEL_Y, WATER_CENTER_Z],
    sdf:      boxSDF([WATER_HALF_X, WATER_HALF_Y, WATER_HALF_Z]),
    opacity:  0.5,
    collides: false,
    boundingBox: [WATER_HALF_X, WATER_HALF_Y, WATER_HALF_Z],
  });

  // Underwater fog — translucent box filling the cove's underwater
  // volume with a depth-graded blue tint. Camera below sea level
  // picks up the wash at step zero (box SDF negative inside).
  // collides:false. The box is confined to +Z so the tint never
  // bleeds onto land in the mountain hemisphere. AABB matches the
  // box; back-land rays drop at the X/Z slabs without reaching this
  // item's per-step loop.
  add({
    name:     'underwater-fog',
    color:    [50, 100, 130],
    colorFn:  fogColorFn,
    position: [0, FOG_CENTER_Y, FOG_CENTER_Z],
    sdf:      boxSDF([FOG_HALF_X, FOG_HALF_Y, FOG_HALF_Z]),
    opacity:  0.25,
    collides: false,
    boundingBox: [FOG_HALF_X, FOG_HALF_Y, FOG_HALF_Z],
  });

  // House exterior — the visible building from the cove. Wraps the
  // kitchen + all secret zones in one shell, with the keyhole bore cut
  // through. AABB matches the shack's outer extents exactly; cove rays
  // not pointing at the shack skip the chained cutSDFCullableBox chain
  // entirely, which is the heaviest cull-eligible SDF in the outside
  // zone.
  add({
    name:     'house-exterior',
    color:    [110, 75, 45],
    colorFn:  houseExteriorColorFn,
    position: [0, 0, 0],
    sdf:      houseExteriorSdf,
    boundingBox: [HOUSE_HALF_X, HOUSE_HALF_Y, HOUSE_HALF_Z],
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
    boundingBox: [BACK_WINDOW_HALF_X, BACK_WINDOW_HALF_Y, BACK_WINDOW_FRAME_HZ],
  });

  // Keyhole veil pair. Each veil is a thin opaque dark slab matching the
  // keyhole's full silhouette (circle + slot), parked inside the bore on
  // its region's side of the door. Region-tagged so each is invisible to
  // the other side; collides:false so the fish swims through. AABB
  // covers the 2D keyhole silhouette in XY plus the slab thickness in Z;
  // half-Y rounds up to the slot-bottom distance so the bound is
  // symmetric around `position`.
  const VEIL_HALF_Z = 0.0025;
  const veilSdf = keyholeExtrudedSdf(VEIL_HALF_Z);
  const VEIL_BOUND_HALF = [
    Math.max(KEY_CIRCLE_R, KEY_SLOT_HALF_W),
    Math.max(Math.abs(KEY_CIRCLE_CY) + KEY_CIRCLE_R, Math.abs(KEY_SLOT_BOT_Y)),
    VEIL_HALF_Z,
  ];
  registerItem(scene, {
    name:     'keyhole-veil-kitchen',
    color:    [10, 10, 12],
    position: [KEYHOLE_X, KEYHOLE_Y, +21.85],
    sdf:      veilSdf,
    collides: false,
    boundingBox: VEIL_BOUND_HALF,
    regionKey: REGION_KITCHEN,
  });
  add({
    name:     'keyhole-veil-outside',
    color:    [10, 10, 12],
    position: [KEYHOLE_X, KEYHOLE_Y, +22.15],
    sdf:      veilSdf,
    collides: false,
    boundingBox: VEIL_BOUND_HALF,
  });

  // Mountain range + foothill — registered via the same outside-tagged
  // `add` helper so mountain items participate in the cove's region
  // cull. mountains.js owns layout + colorFn; outside.js hands the
  // helper through plus the cove's plateau elevation (single source
  // of truth for ground Y).
  mountains.addToScene(add, { plateauY: SHACK_PLATEAU_Y });
};
