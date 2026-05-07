// aquarium/zones/secrets/mousehole.js — secret zone tucked behind the kitchen's
// front-left wall corner. Reached by swimming into a tiny mouse-hole-
// shaped arch in the left wall (x = -22) near the front (z ≈ +21).
//
// The interior is small but navigable: ~3 wide × 2.5 tall × 3 deep. Vibe:
// bachelor cave. A messy unmade bed in the corner, a small TV against
// the back wall flickering rolling static, posters and webs in the
// upper corners. The connecting tunnel is warm brown (matches kitchen-
// wall coloring so the hand-off reads as continuous), and the apartment
// interior is dirty blue-gray with peeling-wallpaper accents — a darker
// palette than the kitchen's roomColorFn, sold by colorFn alone (no
// engine lighting change).
//
// Region wiring: items registered here carry `regionKey: 'mousehole'`.
// `isInMousehole(p)` is exported for world.js's regionFn to chain.
//
// Wall carve: addToScene mutates the kitchen 'room' item's SDF in place,
// using cutSDF to subtract the entrance tunnel from its wall material so
// the fish can swim through. The kitchen room and the mousehole-room
// shells both have the tunnel as air on their respective sides; their
// regionKeys ensure only one is considered at a time, and they hand off
// cleanly at the regionFn boundary (x = -22).

import {
  registerItem,
  sphereSDF, boxSDF, planeSDF, capsuleBetweenSDF, cylinderSDF,
  unionSDF, intersectionSDF, smoothUnionSDF, cutSDF, invertSDF,
  translateSDF, rotateXSDF, rotateYSDF, rotateZSDF,
} from '../../../core/scene.js';
import { frameTime } from '../../../core/tracer.js';
import { FLOOR_Y } from '../kitchen.js';
import { MIN_TRAVERSAL_OVERLAP, FISH_RADIUS } from '../../physics.js';

export const REGION_MOUSEHOLE = 'mousehole';

// Region predicate. Bounded tightly to a box around the actual mousehole
// geometry (interior pocket + tunnel) so the mousehole-room item — whose
// invertSDF-of-air-volumes is "material everywhere except the air pocket,
// extending to infinity" — only gets considered for points genuinely in
// the mousehole zone. Without these bounds, a fast fish drifting to
// e.g. (-30, +14, 21) would be tagged mousehole and physics would shove
// it into the actual interior. Bounds chosen to cover:
//   - tunnel        x ∈ [-25.7, -21],  y ∈ [-13, -12.4], z ∈ [20.5, 21.3]
//   - interior box  x ∈ [-27.8, -25.2], y ∈ [-13, -12],   z ∈ [19.2, 21.8]
// plus a small margin in each direction.
export const isInMousehole = (px, py, pz) =>
  px >= -27.8 && px <= -22 &&
  py >= -13 && py <= -11.5 &&
  pz >= +18.5 && pz <= +22;


// ──────────────────────────── geometry ────────────────────────────

// Entrance silhouette in the YZ plane (the wall is the X = -22 plane).
// Tombstone: a rectangular bottom + a half-cylindrical cap.
const ENTRANCE_FLOOR_Y    = FLOOR_Y;   // tunnel sits flush with the kitchen floor
const ENTRANCE_RECT_TOP_Y = -12.4;     // top of the rectangular bottom
const ENTRANCE_CAP_R      = 0.4;       // half-circle cap radius (= half width)
const ENTRANCE_CENTER_Z   = +20.9;     // close to the front-left corner (front wall at z=+22)
const ENTRANCE_HALF_W     = 0.4;       // ±0.4 in z → 0.8 wide opening

// Tunnel extrusion along X. Two overlaps satisfy the cutSDF / unionSDF
// shared-boundary rule: > MIN_TRAVERSAL_OVERLAP for fish traversal, plus
// a visual / render-cleanliness margin on top.
//   - kitchen side: extends past the wall plane (x=-22) into the
//     kitchen room. The kitchen room item gets the tunnel cutSDF'd from
//     it; the extra margin makes the carve open onto the wall face cleanly.
//   - mousehole side: extends past the interior box's +X face
//     (INTERIOR_FRONT_X = -25.2) INTO the box. Without enough overlap,
//     the tunnel SDF and the box SDF both report 0 along the shared seam
//     and unionSDF does too — the marcher would treat the back of the
//     tunnel as a solid wall.
const TUNNEL_KITCHEN_END_X   = -22.0 + (MIN_TRAVERSAL_OVERLAP + 0.6);  // -21    (1.0 into kitchen with default fishRadius)
const TUNNEL_MOUSEHOLE_END_X = -25.2 - (MIN_TRAVERSAL_OVERLAP + 0.1);  // -25.7  (0.5 into interior box)
const TUNNEL_HALF_X   = (TUNNEL_KITCHEN_END_X - TUNNEL_MOUSEHOLE_END_X) / 2;
const TUNNEL_CENTER_X = (TUNNEL_KITCHEN_END_X + TUNNEL_MOUSEHOLE_END_X) / 2;

// Interior box: tucked into the front-left corner behind the wall.
// Compressed on purpose — small + cramped reads as a mouse hole.
const INTERIOR_HALF_X   = 1.3;    // 2.6 wide  (x in [-27.8, -25.2])
const INTERIOR_HALF_Y   = 0.50;   // 1.0 tall  (y in [-13, -12.0])
const INTERIOR_HALF_Z   = 1.3;    // 2.6 deep  (z in [+19.2, +21.8])
const INTERIOR_CENTER_X = -26.5;
const INTERIOR_CENTER_Y = -12.5;
const INTERIOR_CENTER_Z = +20.5;

const INTERIOR_FLOOR_Y   = INTERIOR_CENTER_Y - INTERIOR_HALF_Y;   // -13
const INTERIOR_CEILING_Y = INTERIOR_CENTER_Y + INTERIOR_HALF_Y;   // -12.0
const INTERIOR_BACK_X    = INTERIOR_CENTER_X - INTERIOR_HALF_X;   // -27.8
const INTERIOR_FRONT_X   = INTERIOR_CENTER_X + INTERIOR_HALF_X;   // -25.2 (= +X wall, the entrance side)


// Tunnel SDF: rectangular bottom + cylindrical cap, both extruded along X.
// The cap is a Y-axis cylinder rotated 90° around Z so its axis lies
// along X; its lower half overlaps the rectangular bottom and its upper
// half forms the rounded arch.
const RECT_CENTER_Y = (ENTRANCE_FLOOR_Y + ENTRANCE_RECT_TOP_Y) / 2;
const RECT_HALF_Y   = (ENTRANCE_RECT_TOP_Y - ENTRANCE_FLOOR_Y) / 2;

const tunnelSdf = unionSDF(
  // Rectangular bottom (extruded box along X)
  translateSDF(
    [TUNNEL_CENTER_X, RECT_CENTER_Y, ENTRANCE_CENTER_Z],
    boxSDF([TUNNEL_HALF_X, RECT_HALF_Y, ENTRANCE_HALF_W]),
  ),
  // Cap: cylinder along X, axis at the top of the rectangular bottom
  translateSDF(
    [TUNNEL_CENTER_X, ENTRANCE_RECT_TOP_Y, ENTRANCE_CENTER_Z],
    rotateZSDF(Math.PI / 2, cylinderSDF(TUNNEL_HALF_X, ENTRANCE_CAP_R)),
  ),
);

// Interior pocket SDF (regular box; negative inside).
const interiorBoxSdf = translateSDF(
  [INTERIOR_CENTER_X, INTERIOR_CENTER_Y, INTERIOR_CENTER_Z],
  boxSDF([INTERIOR_HALF_X, INTERIOR_HALF_Y, INTERIOR_HALF_Z]),
);

// Combined air-volume SDF (interior pocket ∪ tunnel). Exported so the
// outside zone's house-exterior shell can cut this volume out of its
// wall material — without that cut, the wall geometrically overlaps
// the secret pocket, and a fish near the pocket's back wall would have
// physics probes touch the outside region and get shoved onto the cove
// ground by the wall's gradient. The mousehole-room item itself is
// the inverted-union — material everywhere except in the air shape.
export const mouseholeAirSdf = unionSDF(interiorBoxSdf, tunnelSdf);
const mouseholeRoomSdf = invertSDF(mouseholeAirSdf);

// Bounding boxes for cullable cuts. Each fully encloses its tool's
// material with FISH_RADIUS margin past the worst-case extent on each
// axis — physics-traversed cuts need the mover-radius margin so the
// fish center can never reach a position outside the bound while the
// shortcut would still return the wrong base SDF (see cutSDFCullableBox
// doc in core/scene.js for the full reasoning).
//
// TUNNEL bounds tunnelSdf (used here, carving through the kitchen room).
// MOUSEHOLE_AIR bounds the full union (used by outside.js, carving
// through the house-exterior wall to leave air where the secret pocket
// + tunnel live).
//
// Material extents (no margin):
//   tunnel        x∈[-25.7,-21]   y∈[-13,-12.0]  z∈[20.5,21.3]
//   mousehole air x∈[-27.8,-21]   y∈[-13,-12]    z∈[19.2,21.8]
const TUNNEL_BOUND_CENTER = [-23.35, -12.5, 20.9];
const TUNNEL_BOUND_HALF   = [2.35 + FISH_RADIUS, 0.5 + FISH_RADIUS, 0.4 + FISH_RADIUS];
export const MOUSEHOLE_AIR_BOUND_CENTER = [-24.4, -12.5, 20.5];
export const MOUSEHOLE_AIR_BOUND_HALF   = [3.4 + FISH_RADIUS, 0.5 + FISH_RADIUS, 1.3 + FISH_RADIUS];


// ──────────────────────────── colorFns ────────────────────────────

const mouseholeRoomColorFn = (lpx, lpy, lpz) => {
  // The mousehole-room shell covers BOTH the tunnel volume (lpx > -25.2)
  // and the apartment interior (lpx <= -25.2). Different palettes for
  // each — tunnel keeps the original warm brown so the transition into
  // the apartment reads as crossing a threshold, not just walking through
  // sameness.
  if (lpx > INTERIOR_FRONT_X) {
    // Tunnel — warm brown, similar to the kitchen wall coloring so it
    // reads as a continuation of the human structure.
    if (lpy < INTERIOR_FLOOR_Y + 0.12) return [40, 32, 25];
    if (lpy > INTERIOR_CEILING_Y - 0.10) return [55, 45, 35];
    return [70, 55, 40];
  }

  // Apartment interior — dingier and darker, dirty blue-gray.
  if (lpy < INTERIOR_FLOOR_Y + 0.10) return [12, 12, 18];
  if (lpy > INTERIOR_CEILING_Y - 0.10) return [8, 8, 12];

  // Walls — peeling-paper effect on dim blue-gray. Where a hash spikes,
  // the "wallpaper" has come off and the lighter plaster shows through.
  const peel = Math.sin(lpx * 17 + lpy * 13) * Math.cos(lpz * 19 - lpy * 11);
  if (peel > 0.86) return [95, 80, 60];                                // exposed plaster
  if (peel > 0.78) return [50, 42, 42];                                // edge of peel
  const streak = (Math.floor(lpz * 4) + Math.floor(lpx * 4)) & 1;
  return streak === 0 ? [24, 22, 36] : [18, 16, 28];
};

// Bed sheets: rumpled gray-white pattern via sin-noise; sides darker.
const bedColorFn = (lpx, lpy, lpz) => {
  if (lpy > 0.04) {
    const wrinkle = Math.sin(lpx * 28 + lpz * 21) * 0.5 + 0.5;
    if (wrinkle > 0.55) return [232, 232, 238];
    return [210, 212, 218];
  }
  return [185, 175, 160];
};

// TV: dark cabinet body, slightly dusty plastic; -X-facing screen with
// rolling static. The TV faces -X (into the room from the entrance wall),
// so the screen is on the -X face (lpx < 0). Antenna whiskers stick up
// out of the top — anything above the body top is matte silver.
// frameTime drives the scanline drift; Math.random() gives per-hit pixel noise.
const tvColorFn = (lpx, lpy, lpz) => {
  // Antenna whiskers — capsules well above the body top
  if (lpy > 0.12) return [180, 180, 175];
  // Body back/sides — dark plasticky brown-black with subtle wood-grain
  if (lpx > -0.05) {
    const grain = Math.sin(lpz * 40 + lpy * 6);
    return grain > 0.3 ? [40, 28, 22] : [32, 22, 18];
  }
  // Screen face frame (bezel)
  if (Math.abs(lpz) > 0.10 || Math.abs(lpy) > 0.075) return [22, 18, 18];
  // Static screen
  const noise = Math.random();
  const t = (frameTime % 1500) / 1500;
  const scanlineY = 0.075 - t * 0.15;
  let brightness = 110 + 130 * noise;
  if (Math.abs(lpy - scanlineY) < 0.012) brightness *= 0.4;
  return [brightness * 0.92, brightness * 0.96, brightness];
};

// Shared TV-pulse function — a non-trivial sine-of-sine flicker driven by
// real time. Both the focused glow (in front of the TV) and the whole-
// room ambient glow (filling the interior) read from this so they pulse
// in lockstep.
const glowPulse = () => {
  const t = frameTime / 1000;
  return 0.5 + 0.5 * Math.sin(t * 7 + Math.sin(t * 13) * 2);
};

// Focused TV glow — a translucent volumetric haze in front of the screen.
// Higher-amplitude pulse than the room glow so it reads as the actual
// light source. Rays passing through pick up the tint.
const tvGlowColorFn = (lpx, lpy, lpz) => {
  const f = glowPulse();
  return [90 + 70 * f, 110 + 90 * f, 170 + 80 * f];
};

// Whole-room ambient glow — a much fainter version of the same pulse,
// filling the entire apartment with a subtle blue-cathode wash. Same
// timing function so it pulses in sync with the TV.
const roomGlowColorFn = (lpx, lpy, lpz) => {
  const f = glowPulse();
  return [25 + 25 * f, 35 + 30 * f, 60 + 35 * f];
};

// Red carpet — a long thin runner along the tunnel floor. Slight
// horizontal weave variation via sin-noise so it doesn't read as flat.
const carpetColorFn = (lpx, lpy, lpz) => {
  const weave = Math.sin(lpx * 80) * 0.5 + Math.sin(lpz * 60) * 0.5;
  if (weave > 0.5) return [195, 35, 35];
  if (weave < -0.5) return [165, 25, 25];
  return [180, 30, 30];
};

// TV remote control — black body, colorFn paints buttons on the top face
// (+Y, lpy > 0). Power button is red; volume/channel rocker pads are pale;
// number pad is a small dotted grid. The +X end has a dim IR window.
const remoteColorFn = (lpx, lpy, lpz) => {
  if (lpy < 0.005) return [22, 22, 25];
  if (lpx > 0.085) return [55, 35, 30];                                // IR window
  if ((lpx - 0.060) * (lpx - 0.060) + lpz * lpz < 0.011 * 0.011) return [185, 30, 30];
  if ((lpx - 0.020) * (lpx - 0.020) + (lpz - 0.012) * (lpz - 0.012) < 0.0055 * 0.0055) return [200, 200, 200];
  if ((lpx - 0.020) * (lpx - 0.020) + (lpz + 0.012) * (lpz + 0.012) < 0.0055 * 0.0055) return [200, 200, 200];
  if ((lpx + 0.020) * (lpx + 0.020) + (lpz - 0.012) * (lpz - 0.012) < 0.0055 * 0.0055) return [200, 200, 200];
  if ((lpx + 0.020) * (lpx + 0.020) + (lpz + 0.012) * (lpz + 0.012) < 0.0055 * 0.0055) return [200, 200, 200];
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col <= 1; col++) {
      const cx = -0.055 - row * 0.011;
      const cz = col * 0.013;
      if ((lpx - cx) * (lpx - cx) + (lpz - cz) * (lpz - cz) < 0.0035 * 0.0035) return [140, 140, 140];
    }
  }
  return [38, 38, 42];
};


// Posters live on the back wall (-Z face). The visible art side is the
// +Z-facing face of the poster box (lpz > 0). Other faces and back side
// render as dark backing material. Edges have a torn/jagged irregularity
// driven by sin-noise so the posters don't look like factory rectangles.
//
// String-light marquee around each poster's perimeter: bulbs sit just
// inside the torn-frame band so they silhouette against the dark
// edge; halos extend inward into the artwork so the artwork right
// next to each bulb reads as actively lit, falling off quadratically
// with distance. A 1.20× baseline boost across the full front face
// brightens the artwork modestly so the posters pop in the dim
// mousehole — the room's lighting is keyed to +X, so poster-front
// normals (+Z) take only the ambient term and would otherwise render
// at 40% of source colors. Bulbs themselves return overbright values
// that clamp to amber-white at the painter, reading as tiny searing
// points. Both posters share identical half-extents [0.225, 0.20], so
// the layout array is computed once and reused.
const POSTER_HALF_X = 0.225;
const POSTER_HALF_Y = 0.20;
const POSTER_LIGHT_INSET = 0.012;
const POSTER_LIGHTS = (() => {
  const lights = [];
  // 13 lights stacked along each vertical (left/right) side; the
  // horizontal sides (top/bottom) take however many match that spacing.
  const countY = 13;
  const spacing = (2 * POSTER_HALF_Y) / countY;
  const countX = Math.round((2 * POSTER_HALF_X) / spacing);
  const xSpacing = (2 * POSTER_HALF_X) / countX;
  const xL = -(POSTER_HALF_X - POSTER_LIGHT_INSET);
  const xR = +(POSTER_HALF_X - POSTER_LIGHT_INSET);
  const yB = -(POSTER_HALF_Y - POSTER_LIGHT_INSET);
  const yT = +(POSTER_HALF_Y - POSTER_LIGHT_INSET);
  for (let i = 0; i < countY; i++) {
    const y = -POSTER_HALF_Y + (i + 0.5) * spacing;
    lights.push([xL, y]);
    lights.push([xR, y]);
  }
  for (let i = 0; i < countX; i++) {
    const x = -POSTER_HALF_X + (i + 0.5) * xSpacing;
    lights.push([x, yB]);
    lights.push([x, yT]);
  }
  return lights;
})();

const POSTER_BULB_R2 = 0.005 * 0.005;
const POSTER_HALO_R  = 0.025;
const POSTER_HALO_R2 = POSTER_HALO_R * POSTER_HALO_R;

// Wrap a poster's bare-artwork colorFn so its front face picks up
// the string-light marquee. Back/sides delegate untouched.
const withPosterLights = (artworkFn) => (lpx, lpy, lpz) => {
  if (lpz < 0) return artworkFn(lpx, lpy, lpz);

  let minD2 = Infinity;
  for (let i = 0; i < POSTER_LIGHTS.length; i++) {
    const dx = lpx - POSTER_LIGHTS[i][0];
    const dy = lpy - POSTER_LIGHTS[i][1];
    const d2 = dx * dx + dy * dy;
    if (d2 < minD2) minD2 = d2;
  }

  if (minD2 < POSTER_BULB_R2) return [800, 700, 350];

  let halo = 0;
  if (minD2 < POSTER_HALO_R2) {
    const t = 1 - Math.sqrt(minD2) / POSTER_HALO_R;
    halo = t * t;
  }

  const base = artworkFn(lpx, lpy, lpz);
  const boost = 1.20 + 1.0 * halo;
  return [
    base[0] * boost + 100 * halo,
    base[1] * boost +  65 * halo,
    base[2] * boost +  20 * halo,
  ];
};

// Cowboy Mouse poster — silhouette of a rodent in a poncho-and-hat pose,
// one arm extended for a lasso, the other holding a revolver, set against
// a sun-baked sky over a desert horizon, with a saguaro cactus to one side.
const cowboyPosterColorFn = (lpx, lpy, lpz) => {
  const halfX = 0.225, halfY = 0.20;
  if (lpz < 0) return [45, 30, 22];                                    // back face / sides
  if (Math.abs(lpx) > halfX - 0.003 || Math.abs(lpy) > halfY - 0.003) return [45, 30, 22];
  const tearX = Math.sin(lpy * 38) * 0.022;
  const tearY = Math.sin(lpx * 31) * 0.022;
  if (Math.abs(lpx) > halfX - 0.025 + tearX) return [25, 18, 12];      // torn left/right edges
  if (Math.abs(lpy) > halfY - 0.025 + tearY) return [25, 18, 12];      // torn top/bottom edges

  const SIL    = [15, 10, 8];
  const CACTUS = [40, 60, 35];

  // ── silhouette (drawn on top, returns first if hit) ──

  // Hat brim — wide horizontal oval at the top of the head
  if ((lpx * lpx) / 0.018 + ((lpy - 0.105) * (lpy - 0.105)) / 0.0006 < 1) return SIL;
  // Hat crown
  if (Math.abs(lpx) < 0.04 && lpy > 0.105 && lpy < 0.155) return SIL;
  // Head
  if (lpx * lpx + (lpy - 0.045) * (lpy - 0.045) < 0.055 * 0.055) return SIL;
  // Ears
  if ((lpx - 0.05) * (lpx - 0.05) + (lpy - 0.085) * (lpy - 0.085) < 0.022 * 0.022) return SIL;
  if ((lpx + 0.05) * (lpx + 0.05) + (lpy - 0.085) * (lpy - 0.085) < 0.022 * 0.022) return SIL;
  // Body — vertical ellipse from below the head
  if ((lpx * lpx) / 0.0036 + ((lpy + 0.07) * (lpy + 0.07)) / 0.011 < 1) return SIL;
  // Right arm extended for lasso
  {
    const x1 = 0.04, y1 = -0.05, x2 = 0.16, y2 = 0.03;
    const dx = x2 - x1, dy = y2 - y1;
    let t = ((lpx - x1) * dx + (lpy - y1) * dy) / (dx * dx + dy * dy);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = lpx - (x1 + dx * t), cy = lpy - (y1 + dy * t);
    if (cx * cx + cy * cy < 0.018 * 0.018) return SIL;
  }
  // Lasso loop ring at end of right arm
  {
    const r2 = (lpx - 0.18) * (lpx - 0.18) + (lpy - 0.07) * (lpy - 0.07);
    if (r2 > 0.025 * 0.025 && r2 < 0.045 * 0.045) return SIL;
  }
  // Left arm extended for revolver
  {
    const x1 = -0.04, y1 = -0.07, x2 = -0.13, y2 = -0.05;
    const dx = x2 - x1, dy = y2 - y1;
    let t = ((lpx - x1) * dx + (lpy - y1) * dy) / (dx * dx + dy * dy);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = lpx - (x1 + dx * t), cy = lpy - (y1 + dy * t);
    if (cx * cx + cy * cy < 0.018 * 0.018) return SIL;
  }
  // Revolver — small block at end of left arm
  if (lpx > -0.18 && lpx < -0.13 && lpy > -0.07 && lpy < -0.02) return SIL;
  // Legs — two short verticals from bottom of body
  if (Math.abs(lpx - 0.025) < 0.018 && lpy > -0.18 && lpy < -0.11) return SIL;
  if (Math.abs(lpx + 0.025) < 0.018 && lpy > -0.18 && lpy < -0.11) return SIL;
  // Tail — emerges from behind the left leg as a backwards-J curl. Two
  // capsule strokes, anchored INSIDE the leg silhouette at the base so it
  // visibly attaches (not a floating arc). Body/leg checks above already
  // paint those pixels SIL — same color, no seam.
  {
    // Base segment: leg anchor → mid-curve, dropping down-left.
    const x1 = -0.035, y1 = -0.155, x2 = -0.075, y2 = -0.175;
    const dx = x2 - x1, dy = y2 - y1;
    let t = ((lpx - x1) * dx + (lpy - y1) * dy) / (dx * dx + dy * dy);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = lpx - (x1 + dx * t), cy = lpy - (y1 + dy * t);
    if (cx * cx + cy * cy < 0.013 * 0.013) return SIL;
  }
  {
    // Tip segment: curls back up toward upper-left.
    const x1 = -0.075, y1 = -0.175, x2 = -0.115, y2 = -0.140;
    const dx = x2 - x1, dy = y2 - y1;
    let t = ((lpx - x1) * dx + (lpy - y1) * dy) / (dx * dx + dy * dy);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = lpx - (x1 + dx * t), cy = lpy - (y1 + dy * t);
    if (cx * cx + cy * cy < 0.011 * 0.011) return SIL;
  }

  // Saguaro cactus on the right — vertical trunk + two upturned arms
  if (lpx > 0.13 && lpx < 0.16 && lpy > -0.16 && lpy < 0.09) return CACTUS;
  if (lpx > 0.16 && lpx < 0.18 && lpy > -0.04 && lpy < 0.01) return CACTUS;
  if (lpx > 0.18 && lpx < 0.20 && lpy > -0.04 && lpy < 0.06) return CACTUS;

  // Setting sun behind silhouette — large dim disc, upper-left
  {
    const sd = (lpx + 0.10) * (lpx + 0.10) + (lpy - 0.07) * (lpy - 0.07);
    if (sd < 0.045 * 0.045) return [240, 160, 70];                     // sun core
    if (sd < 0.060 * 0.060) return [200, 130, 55];                     // sun fade
  }

  // Horizon line — desert below, sky above. lpy ≈ -0.10 split.
  if (lpy < -0.10) {
    // Desert sand — warm tan with subtle horizontal speckle
    const speckle = Math.sin(lpx * 200 + lpy * 50);
    if (speckle > 0.8) return [165, 130, 80];
    return [180, 145, 95];
  }
  // Sky — sepia gradient from horizon up
  const skyT = (lpy + 0.10) / 0.30;
  return [200 - 65 * skyT, 150 - 65 * skyT, 90 - 40 * skyT];
};

// Starlet Mouse poster — 50s Hollywood-glamour pose. The body is one continuous
// Y-keyed half-width curve (head → neck → chest → waist → hips → flared
// skirt). Pearl necklace, polka-dot dress, cigarette holder with red
// ember, starburst background.
const starletPosterColorFn = (lpx, lpy, lpz) => {
  const halfX = 0.225, halfY = 0.20;
  if (lpz < 0) return [45, 25, 35];
  if (Math.abs(lpx) > halfX - 0.003 || Math.abs(lpy) > halfY - 0.003) return [45, 25, 35];
  // Wavy tear band — narrowed (was 0.025/0.022) so it doesn't eat into the
  // upper-right corner where the cigarette ember sits.
  const tearX = Math.sin(lpy * 33) * 0.010;
  const tearY = Math.sin(lpx * 28) * 0.010;
  if (Math.abs(lpx) > halfX - 0.013 + tearX) return [28, 16, 22];
  if (Math.abs(lpy) > halfY - 0.013 + tearY) return [28, 16, 22];

  const SIL    = [18, 10, 16];
  const EMBER  = [225, 70, 35];
  const PEARL  = [240, 240, 235];
  const DOT_FG = [225, 195, 215];

  // Hair — flat curl on top of head, slight asymmetry for character
  if ((lpx + 0.005) * (lpx + 0.005) / (0.08 * 0.08) + (lpy - 0.155) * (lpy - 0.155) / (0.04 * 0.04) < 1
      && lpy > 0.135) return SIL;
  // Side hair sweep on the left
  if ((lpx + 0.07) * (lpx + 0.07) + (lpy - 0.13) * (lpy - 0.13) < 0.025 * 0.025) return SIL;
  // Head — circle
  if (lpx * lpx + (lpy - 0.105) * (lpy - 0.105) < 0.045 * 0.045) return SIL;
  // Eye dot — tiny darker SIL accent
  if ((lpx - 0.020) * (lpx - 0.020) + (lpy - 0.115) * (lpy - 0.115) < 0.006 * 0.006) return SIL;
  // Eyelash flick
  if ((lpx - 0.030) * (lpx - 0.030) + (lpy - 0.125) * (lpy - 0.125) < 0.005 * 0.005) return SIL;
  // Ear (right, small bump above hair)
  if ((lpx - 0.04) * (lpx - 0.04) + (lpy - 0.18) * (lpy - 0.18) < 0.015 * 0.015) return SIL;

  // Body curve — one continuous Y-keyed half-width function from neck
  // down to skirt hem. No overlapping ellipses; the halfW(y) function
  // defines the silhouette outline directly.
  const yNeckTop = 0.060, yNeckBot = 0.040;
  const yChest   = -0.005;
  const yWaist   = -0.045;
  const yHip     = -0.090;
  const ySkirt   = -0.180;
  let bodyHalfW = -1;
  if      (lpy <= yNeckTop && lpy >= yNeckBot) bodyHalfW = 0.013;
  else if (lpy <  yNeckBot && lpy >= yChest) {
    const t = (yNeckBot - lpy) / (yNeckBot - yChest);
    bodyHalfW = 0.013 + 0.045 * t;            // collar → chest 0.058
  }
  else if (lpy <  yChest   && lpy >= yWaist) {
    const t = (yChest - lpy) / (yChest - yWaist);
    bodyHalfW = 0.058 - 0.030 * t;            // chest → waist 0.028
  }
  else if (lpy <  yWaist   && lpy >= yHip) {
    const t = (yWaist - lpy) / (yWaist - yHip);
    bodyHalfW = 0.028 + 0.045 * t;            // waist → hip 0.073
  }
  else if (lpy <  yHip     && lpy >= ySkirt) {
    const t = (yHip - lpy) / (yHip - ySkirt);
    bodyHalfW = 0.073 + 0.045 * t;            // hip → skirt hem 0.118
  }
  if (bodyHalfW > 0 && Math.abs(lpx) < bodyHalfW) {
    // Pearl necklace — sit on the upper chest right below the neck
    if (lpy < yNeckBot && lpy > yChest + 0.005) {
      for (let i = -2; i <= 2; i++) {
        const px = i * 0.018;
        const py = yNeckBot - 0.012 - 0.004 * Math.abs(i);
        if ((lpx - px) * (lpx - px) + (lpy - py) * (lpy - py) < 0.007 * 0.007) return PEARL;
      }
    }
    // Polka dots — only on the skirt portion (below hips)
    if (lpy < yHip) {
      const gx = Math.floor((lpx + 0.15) * 12);
      const gy = Math.floor((lpy + 0.25) * 12);
      const dotCx = (gx + 0.5) / 12 - 0.15;
      const dotCy = (gy + 0.5) / 12 - 0.25;
      const dd = (lpx - dotCx) * (lpx - dotCx) + (lpy - dotCy) * (lpy - dotCy);
      if (dd < 0.012 * 0.012) return DOT_FG;
    }
    return SIL;
  }

  // Cigarette holder — thin diagonal from the face up toward upper-right.
  // Pulled in from the corner (was ending at 0.19,0.17) so the ember sits
  // clear of the (now-narrower) tear band, and thinned to half the prior
  // radius so it reads as a holder rather than a pipe.
  {
    const x1 = 0.04, y1 = 0.10, x2 = 0.155, y2 = 0.135;
    const dx = x2 - x1, dy = y2 - y1;
    let t = ((lpx - x1) * dx + (lpy - y1) * dy) / (dx * dx + dy * dy);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = lpx - (x1 + dx * t), cy = lpy - (y1 + dy * t);
    if (cx * cx + cy * cy < 0.005 * 0.005) return SIL;
  }
  // Cigarette ember at the tip — slightly past the holder end, sized up
  // a hair so it pops as the focal accent.
  if ((lpx - 0.170) * (lpx - 0.170) + (lpy - 0.143) * (lpy - 0.143) < 0.014 * 0.014) return EMBER;

  // Background: dusty rose with a faint starburst from upper-left
  const bx = lpx + 0.20, by = lpy - 0.15;
  const ang = Math.atan2(by, bx);
  const ray = Math.cos(ang * 6);
  const dist = Math.sqrt(bx * bx + by * by);
  if (dist < 0.45 && ray > 0.85) return [205, 135, 155];
  return [180, 110, 130];
};


// ──────────────────────────── scene build ────────────────────────────

/**
 * Add the mousehole zone to the scene. Mutates the caller-supplied kitchen
 * `room` handle to carve the entrance tunnel; appends mousehole-region items.
 *
 * @param {import('../../../core/scene.js').Scene} scene
 * @param {{ room: import('../kitchen.js').KitchenHandle }} kitchen
 *        Handles to kitchen surfaces this zone extends.
 */
export const addToScene = (scene, { room: kitchenRoom }) => {
  const add = (item) => registerItem(scene, { ...item, regionKey: REGION_MOUSEHOLE });

  // Carve the entrance tunnel through the kitchen room's wall material,
  // and override its colorFn so the kitchen-side of the tunnel reads as
  // tunnel-brown (matching the mousehole-side) instead of kitchen beige
  // — without the override the player would see beige walls just inside
  // the entrance and brown walls deeper in, discontinuous. Far-from-
  // tunnel steps (the bulk of the kitchen) skip the tunnel eval via the
  // cullable bound under addCut.
  kitchenRoom.addCut(tunnelSdf, TUNNEL_BOUND_CENTER, TUNNEL_BOUND_HALF);
  kitchenRoom.addColorOverride((lpx, lpy, lpz) => {
    if (lpx >= -22 && lpx <= TUNNEL_KITCHEN_END_X && tunnelSdf(lpx, lpy, lpz) < 0.03) {
      if (lpy < INTERIOR_FLOOR_Y + 0.12) return [40, 32, 25];
      return [70, 55, 40];
    }
    return null;
  });

  // The shell of the secret room. No boundingRadius — always considered
  // once we're in the mousehole region.
  add({
    name:     'mousehole-room',
    color:    [60, 50, 40],
    colorFn:  mouseholeRoomColorFn,
    position: [0, 0, 0],
    sdf:      mouseholeRoomSdf,
  });

  // Whole-room glow — a translucent box matching the apartment interior,
  // tinting every ray passing through with a soft blue-cathode wash that
  // pulses in lockstep with the TV. Low opacity so surfaces still read,
  // but enough to feel "TV is on, it's the only light source." Camera
  // inside the box gets the tint applied at step zero. collides:false.
  add({
    name:     'mousehole-roomglow',
    color:    [60, 80, 130],
    colorFn:  roomGlowColorFn,
    position: [INTERIOR_CENTER_X, INTERIOR_CENTER_Y, INTERIOR_CENTER_Z],
    sdf:      boxSDF([INTERIOR_HALF_X, INTERIOR_HALF_Y, INTERIOR_HALF_Z]),
    opacity:  0.20,
    collides: false,
  });

  // Bed — long matchbox-style, tucked along the back wall in the
  // back-left (high-Z) corner. Head against the back wall.
  const BED_HALF = [0.40, 0.075, 0.18];
  const BED_POS  = [
    INTERIOR_BACK_X + BED_HALF[0] + 0.05,
    INTERIOR_FLOOR_Y + BED_HALF[1],
    INTERIOR_CENTER_Z + INTERIOR_HALF_Z - BED_HALF[2] - 0.05,
  ];
  add({
    name:     'mousehole-bed',
    color:    [165, 168, 178],
    colorFn:  bedColorFn,
    position: BED_POS,
    sdf:      boxSDF(BED_HALF),
    boundingBox: BED_HALF,
  });

  // Pillow at the head of the bed — a small box on top of the mattress
  // at the back-wall end. Visual cue that the long flat thing is a bed.
  const PILLOW_HALF = [0.07, 0.025, 0.07];
  add({
    name:     'mousehole-pillow',
    color:    [249, 248, 248],
    position: [BED_POS[0] - BED_HALF[0] + PILLOW_HALF[0] + 0.02, BED_POS[1] + BED_HALF[1] + PILLOW_HALF[1], BED_POS[2]],
    sdf:      boxSDF(PILLOW_HALF),
    boundingBox: PILLOW_HALF,
  });

  // Bench press in the middle of the room — a flat seat on four short
  // legs, two uprights at one end holding a barbell with weight cylinders
  // on each end. Bench long axis along X, with uprights at the +X end so
  // the cheese plate sits at the open -X (foot) end of the seat.
  const BENCH_SEAT_HALF = [0.20, 0.025, 0.10];
  const BENCH_POS = [
    INTERIOR_CENTER_X,
    INTERIOR_FLOOR_Y + 0.10 + BENCH_SEAT_HALF[1],   // legs (0.10 tall) + half seat
    INTERIOR_CENTER_Z,
  ];
  // All sub-shapes are in bench-local coords (origin = seat center).
  const benchLeg = (lx, lz) => translateSDF([lx, -BENCH_SEAT_HALF[1] - 0.05, lz], cylinderSDF(0.05, 0.012));
  const benchUpright = (lz) => translateSDF([+BENCH_SEAT_HALF[0] - 0.02, +BENCH_SEAT_HALF[1] + 0.10, lz], cylinderSDF(0.10, 0.010));
  const BARBELL_Y = +BENCH_SEAT_HALF[1] + 0.205;
  const BARBELL_X = +BENCH_SEAT_HALF[0] - 0.02;
  const BENCH_LEG_OUT = 0.02;
  const benchSdf = unionSDF(
    // Seat
    boxSDF(BENCH_SEAT_HALF),
    // Four legs — slightly inset from each corner of the seat
    benchLeg(+BENCH_SEAT_HALF[0] - BENCH_LEG_OUT, +BENCH_SEAT_HALF[2] - BENCH_LEG_OUT),
    benchLeg(+BENCH_SEAT_HALF[0] - BENCH_LEG_OUT, -BENCH_SEAT_HALF[2] + BENCH_LEG_OUT),
    benchLeg(-BENCH_SEAT_HALF[0] + BENCH_LEG_OUT, +BENCH_SEAT_HALF[2] - BENCH_LEG_OUT),
    benchLeg(-BENCH_SEAT_HALF[0] + BENCH_LEG_OUT, -BENCH_SEAT_HALF[2] + BENCH_LEG_OUT),
    // Two uprights at the +X end of the seat (head end), inside the
    // bench width so the bar is supported across the seat's Z-axis.
    benchUpright(+0.07),
    benchUpright(-0.07),
    // Barbell — capsule along Z spanning past the uprights with weights.
    capsuleBetweenSDF(
      [BARBELL_X, BARBELL_Y, -0.20],
      [BARBELL_X, BARBELL_Y, +0.20],
      0.012,
    ),
    // Weight discs — short fat cylinders along Z at each barbell end
    translateSDF([BARBELL_X, BARBELL_Y, +0.20], rotateXSDF(Math.PI / 2, cylinderSDF(0.018, 0.040))),
    translateSDF([BARBELL_X, BARBELL_Y, -0.20], rotateXSDF(Math.PI / 2, cylinderSDF(0.018, 0.040))),
  );
  add({
    name:     'mousehole-bench',
    color:    [50, 50, 55],
    position: BENCH_POS,
    sdf:      benchSdf,
    // Seat ±[0.20, 0.025, 0.10], legs reach to bench-local Y -0.125,
    // uprights / barbell / weights reach to Y +0.27 and Z ±0.218 at
    // the +X end. Symmetric AABB rounds up the worst-case half on
    // each axis.
    boundingBox: [0.22, 0.27, 0.218],
  });

  // Cheese plate — on the floor in front of the foot of the bed (NOT on
  // the bench; the bench reads better as an empty gym set-piece without
  // food on it). A bit thicker than a paper plate so the cheese tip can
  // rest on its top while the cheese butt sits on the floor (+0.002
  // offset above floor to avoid Z-fight).
  const PLATE_R      = 0.10;
  const PLATE_HALF_Y = 0.012;
  const PLATE_POS = [
    BED_POS[0] + BED_HALF[0] + 0.20,                                   // 0.20 forward of bed foot
    INTERIOR_FLOOR_Y + PLATE_HALF_Y + 0.002,
    BED_POS[2] - 0.10,                                                 // slightly off-center from bed
  ];
  add({
    name:     'mousehole-plate',
    color:    [254, 253, 251],
    position: PLATE_POS,
    sdf:      cylinderSDF(PLATE_HALF_Y, PLATE_R),
    boundingBox: [PLATE_R, PLATE_HALF_Y, PLATE_R],
  });

  // Cheese wedge — shrunk to length 0.20, oriented so the wide butt is
  // on the -Z side of the tip (away from the bed at +Z, pointing toward
  // the bench in the middle of the room). Tilted up around the X axis
  // so the butt rests on the floor and the tip lays on the plate top.
  // Sphere-carved holes for the Swiss-cheese look.
  //
  // Local frame: tip at origin, butt at (0, 0, -0.20), top at y = 0.10.
  const cheeseWedgeSdf = intersectionSDF(
    planeSDF([0,  -1, 0], 0),                       // bottom  (y >= 0)
    planeSDF([0,  +1, 0], 0.10),                    // top     (y <= 0.10)
    planeSDF([+0.894, 0, +0.447], 0),               // right side wall (tip → +X-Z corner)
    planeSDF([-0.894, 0, +0.447], 0),               // left  side wall (tip → -X-Z corner)
    planeSDF([0, 0, -1], 0.20),                     // back wall (z >= -0.20)
  );
  const cheeseHoles = unionSDF(
    translateSDF([+0.02, 0.10, -0.10], sphereSDF(0.022)),
    translateSDF([-0.03, 0.10, -0.14], sphereSDF(0.018)),
    translateSDF([ 0.00, 0.10, -0.06], sphereSDF(0.020)),
    translateSDF([+0.06, 0.05, -0.13], sphereSDF(0.022)),
  );
  // Tilt the wedge around X by ~7.5° so the butt at z=-0.20 drops 0.026
  // in Y. Combined with the cheese item's Y position (just above the
  // plate top), this lands the butt on the floor and rests the tip on
  // the plate.
  const CHEESE_TILT = -Math.PI / 24;                // -7.5°
  const cheeseSdf = rotateXSDF(CHEESE_TILT, cutSDF(cheeseHoles, cheeseWedgeSdf));
  add({
    name:     'mousehole-cheese',
    color:    [240, 210, 90],
    position: [PLATE_POS[0], PLATE_POS[1] + PLATE_HALF_Y + 0.002, PLATE_POS[2]],
    sdf:      cheeseSdf,
    boundingRadius: 0.28,
  });

  // TV remote — strewn on the floor in the back corner under the cowboy
  // poster, opposite the bed. Pulled out from the corner so it feels
  // casually dropped rather than tucked, and rotated diagonally so it
  // doesn't read as wall-aligned-and-sterile.
  const REMOTE_HALF = [0.10, 0.012, 0.025];
  const REMOTE_ROT_THETA = Math.PI / 6;        // 30° CCW from above
  const remoteRotC = Math.cos(REMOTE_ROT_THETA);
  const remoteRotS = Math.sin(REMOTE_ROT_THETA);
  add({
    name:     'mousehole-remote',
    color:    [25, 25, 28],
    colorFn:  (lpx, lpy, lpz) => remoteColorFn(
      lpx * remoteRotC - lpz * remoteRotS,
      lpy,
      lpx * remoteRotS + lpz * remoteRotC,
    ),
    position: [INTERIOR_BACK_X + 0.60, INTERIOR_FLOOR_Y + REMOTE_HALF[1] + 0.002, INTERIOR_CENTER_Z - INTERIOR_HALF_Z + 0.60],
    sdf:      rotateYSDF(REMOTE_ROT_THETA, boxSDF(REMOTE_HALF)),
    // World-AABB of the rotated box: rotation projects the X/Z
    // half-extents onto each world axis as |c|·hx + |s|·hz / |s|·hx + |c|·hz.
    // Y is unchanged. Even after the projection grows X/Z, Y stays
    // at the slab's 0.012 — most of the win.
    boundingBox: [
      remoteRotC * REMOTE_HALF[0] + remoteRotS * REMOTE_HALF[2],
      REMOTE_HALF[1],
      remoteRotS * REMOTE_HALF[0] + remoteRotC * REMOTE_HALF[2],
    ],
  });

  // TV — old-school CRT cabinet sitting on the floor NEAR (but not
  // against) the +X wall, to the left of the door (high-Z side). User has
  // to turn around after entering to see it. Body box + V-shape rabbit-
  // ear antennas on top. Screen face is the -X face.
  const TV_BODY_HALF   = [0.10, 0.10, 0.13];
  const TV_POS         = [INTERIOR_FRONT_X - TV_BODY_HALF[0] - 0.20, INTERIOR_FLOOR_Y + TV_BODY_HALF[1], +21.45];
  const ANTENNA_R      = 0.005;
  const ANTENNA_BASE_Y = TV_BODY_HALF[1];
  const ANTENNA_TIP_Y  = ANTENNA_BASE_Y + 0.22;
  const tvSdf = unionSDF(
    boxSDF(TV_BODY_HALF),
    capsuleBetweenSDF(
      [0,    ANTENNA_BASE_Y, 0],
      [-0.07, ANTENNA_TIP_Y, -0.10],
      ANTENNA_R,
    ),
    capsuleBetweenSDF(
      [0,    ANTENNA_BASE_Y, 0],
      [-0.07, ANTENNA_TIP_Y, +0.10],
      ANTENNA_R,
    ),
  );
  add({
    name:     'mousehole-tv',
    color:    [32, 22, 18],
    colorFn:  tvColorFn,
    position: TV_POS,
    sdf:      tvSdf,
    // Body box ±[0.10, 0.10, 0.13] plus antennas reaching up to item-
    // local Y +0.32 with X reach -0.07 and Z reach ±0.10 (with 0.005
    // capsule radius). Symmetric AABB pads -Y / +X with empty space.
    boundingBox: [0.10, 0.325, 0.13],
  });

  // Focused TV glow — bright haze sphere just in front of the screen.
  // Same pulse function as the room glow above so they pulse in sync.
  add({
    name:     'mousehole-tv-glow',
    color:    [120, 140, 200],
    colorFn:  tvGlowColorFn,
    position: [TV_POS[0] - 0.25, TV_POS[1] + 0.02, TV_POS[2]],
    sdf:      sphereSDF(0.30),
    opacity:  0.10,
    collides: false,
    boundingRadius: 0.32,
  });

  // Movie posters on the -Z wall (the wall opposite the bed). Closer to
  // floor-level so you don't have to swim up to see them.
  const POSTER_HALF = [0.225, 0.20, 0.025];
  const POSTER_Y    = -12.55;
  const POSTER_Z    = INTERIOR_CENTER_Z - INTERIOR_HALF_Z + POSTER_HALF[2];   // pressed against -Z wall
  add({
    name:     'mousehole-poster-cowboy',
    color:    [125, 90, 55],
    colorFn:  withPosterLights(cowboyPosterColorFn),
    position: [-27.0, POSTER_Y, POSTER_Z],
    sdf:      boxSDF(POSTER_HALF),
    boundingBox: POSTER_HALF,
  });
  add({
    name:     'mousehole-poster-starlet',
    color:    [185, 115, 135],
    colorFn:  withPosterLights(starletPosterColorFn),
    position: [-26.0, POSTER_Y, POSTER_Z],
    sdf:      boxSDF(POSTER_HALF),
    boundingBox: POSTER_HALF,
  });

  // Popcorn — main bumpy kernel + scattered crumbs on the floor in front
  // of the posters. Smoothing radius reduced and more spheres added so
  // it reads as a properly irregular popped kernel rather than a sphere.
  const popcornSdf = unionSDF(
    smoothUnionSDF(0.025,
      sphereSDF(0.07),
      translateSDF([+0.06,  0.04,  0.00], sphereSDF(0.05)),
      translateSDF([-0.04,  0.03, +0.04], sphereSDF(0.05)),
      translateSDF([+0.02, -0.05, -0.04], sphereSDF(0.04)),
      translateSDF([-0.05,  0.05, -0.02], sphereSDF(0.04)),
      translateSDF([+0.07, -0.02, +0.06], sphereSDF(0.045)),
      translateSDF([+0.00,  0.07, +0.04], sphereSDF(0.045)),
    ),
    translateSDF([+0.18, -0.05, +0.05], sphereSDF(0.018)),
    translateSDF([-0.15, -0.05, -0.06], sphereSDF(0.014)),
    translateSDF([+0.22, -0.05, -0.10], sphereSDF(0.020)),
    translateSDF([-0.20, -0.05, +0.08], sphereSDF(0.016)),
    translateSDF([+0.05, -0.05, +0.18], sphereSDF(0.022)),
    translateSDF([-0.08, -0.05, -0.16], sphereSDF(0.012)),
  );
  add({
    name:     'mousehole-popcorn',
    color:    [240, 220, 130],
    position: [-26.5, INTERIOR_FLOOR_Y + 0.07, POSTER_Z + 0.5],
    sdf:      popcornSdf,
    boundingRadius: 0.30,
  });

  // Second popcorn cluster — at the corner of the poster wall opposite
  // the head of the bed (i.e., the front-right corner from world POV,
  // where the entrance wall meets the poster wall).
  const popcornCornerSdf = unionSDF(
    smoothUnionSDF(0.022,
      sphereSDF(0.05),
      translateSDF([+0.04,  0.03, +0.01], sphereSDF(0.04)),
      translateSDF([-0.03,  0.02, +0.03], sphereSDF(0.035)),
      translateSDF([+0.02, -0.03, -0.03], sphereSDF(0.035)),
    ),
    translateSDF([+0.10, -0.03, +0.04], sphereSDF(0.013)),
    translateSDF([-0.09, -0.03, -0.05], sphereSDF(0.011)),
    translateSDF([+0.13, -0.03, -0.07], sphereSDF(0.014)),
  );
  add({
    name:     'mousehole-popcorn-corner',
    color:    [240, 220, 130],
    position: [INTERIOR_FRONT_X - 0.20, INTERIOR_FLOOR_Y + 0.05, INTERIOR_CENTER_Z - INTERIOR_HALF_Z + 0.20],
    sdf:      popcornCornerSdf,
    boundingRadius: 0.20,
  });

  // Spider webs — two corner cobwebs in the YZ plane, both anchored on
  // the +Z (left) side of the room since that's where the user's eye
  // tracks. Each clips partially into adjacent walls — the visible part
  // reads as a corner web. Built with `buildWebSdf` for variation.
  const buildWebSdf = ({ radius, stroke, spokes, rings, angleOffset = 0 }) => {
    const angles = [];
    for (let i = 0; i < spokes; i++) angles.push(angleOffset + (2 * Math.PI * i) / spokes);
    const elems = [];
    for (const a of angles) {
      elems.push(capsuleBetweenSDF(
        [0, 0, 0],
        [0, Math.cos(a) * radius, Math.sin(a) * radius],
        stroke,
      ));
    }
    for (const r of rings) {
      for (let i = 0; i < spokes; i++) {
        const a = angles[i];
        const b = angles[(i + 1) % spokes];
        elems.push(capsuleBetweenSDF(
          [0, Math.cos(a) * r, Math.sin(a) * r],
          [0, Math.cos(b) * r, Math.sin(b) * r],
          stroke,
        ));
      }
    }
    return unionSDF(...elems);
  };

  // Web 1: back-left upper corner (above the bed area). Six-spoke,
  // two-ring, slightly bigger. Web is a flat fan in the YZ plane;
  // X half is just the capsule stroke radius.
  add({
    name:     'mousehole-web-back',
    color:    [225, 225, 225],
    position: [INTERIOR_BACK_X + 0.06, INTERIOR_CEILING_Y - 0.10, +21.7],
    sdf:      buildWebSdf({ radius: 0.22, stroke: 0.012, spokes: 6, rings: [0.10, 0.18] }),
    boundingBox: [0.012, 0.22, 0.22],
  });

  // Web 2: front-left upper corner (above the TV). Five-spoke, single-
  // ring, slightly smaller, rotated half a wedge for visual contrast.
  add({
    name:     'mousehole-web-tv',
    color:    [225, 225, 225],
    position: [INTERIOR_FRONT_X - 0.06, INTERIOR_CEILING_Y - 0.10, +21.7],
    sdf:      buildWebSdf({ radius: 0.18, stroke: 0.010, spokes: 5, rings: [0.11], angleOffset: Math.PI / 5 }),
    boundingBox: [0.010, 0.18, 0.18],
  });

  // Red carpet — hallway runner along the tunnel floor only. Retracted
  // from both ends so it doesn't poke into the kitchen or the apartment;
  // a small 0.1-unit gap at each end where the carpet's hem ends and the
  // bare floor begins.
  //
  // Carpet sits entirely inside the mousehole region per isInMousehole
  // (its +X end at -22.1 is just past the kitchen-box wall at x=-22, so
  // every point on the carpet is mousehole). collides:false so the fish
  // doesn't bump a 1cm-thick lip.
  const CARPET_X_START = INTERIOR_FRONT_X + 0.1;     // = -25.1, just inside tunnel from apartment side
  const CARPET_X_END   = -22.1;                      // 0.1 inside tunnel from kitchen side
  const CARPET_HALF_X  = (CARPET_X_END - CARPET_X_START) / 2;
  const CARPET_HALF_Z  = 0.30;                       // narrower than tunnel (0.40)
  registerItem(scene, {
    name:     'tunnel-carpet',
    color:    [180, 30, 30],
    colorFn:  carpetColorFn,
    position: [(CARPET_X_START + CARPET_X_END) / 2, -12.98, +20.9],
    sdf:      boxSDF([CARPET_HALF_X, 0.005, CARPET_HALF_Z]),
    collides: false,
    boundingBox: [CARPET_HALF_X, 0.005, CARPET_HALF_Z],
    regionKey: REGION_MOUSEHOLE,
  });
};
