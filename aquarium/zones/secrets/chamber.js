// aquarium/zones/secrets/chamber.js — abstract showcase zone reached by
// swimming INTO the painted sun on the kitchen window. An entry pipe
// is carved through the window at the painted-sun location (a thin
// yellow sun-cover hides the carve from kitchen rays so it still
// reads as a regular painted sun), a torus tunnel wraps behind the
// wall (two paths CW or CCW around the donut, both connecting the
// pipe at the top to the chamber at the bottom), and the chamber
// itself drops realism — gyroid centerpiece + scrolling marquee on
// the back wall. Pipe and tube interiors paint as the surrounding
// wall material on each side of the region boundary (kitchen-beige
// near +Z, chamber-purple past it).
//
// Region wiring: items registered here carry `regionKey: 'chamber'`.
// `isInChamber(p)` is exported for world.js's regionFn.
//
// Geometry overlap discipline:
//   - Entry pipe extends 0.4 into the kitchen (cutSDF rule for kitchen-
//     room and kitchen-window) and 0.4 past the torus's +Z tube extent
//     (unionSDF seam rule).
//   - Torus connects to the chamber +Z face with the same 0.4 minimum.

import {
  registerItem,
  sphereSDF, boxSDF, cylinderSDF,
  unionSDF, intersectionSDF, cutSDF, invertSDF,
  translateSDF, rotateXSDF,
} from '../../../core/scene.js';
import { frameTime } from '../../../core/tracer.js';
import { REGION_KITCHEN } from '../kitchen.js';

export const REGION_CHAMBER = 'chamber';

// Region predicate. Bounded tightly to a box around the actual chamber
// geometry (entry pipe + torus + chamber interior) so the chamber-room
// item — whose invertSDF-of-air-volumes is "material everywhere except
// the air shape, extending to infinity" — only gets considered for
// points genuinely in the chamber zone. Without these bounds, a fast
// fish drifting to e.g. (5, +14, -25) would be tagged chamber and
// physics would shove it into the actual interior. Bounds chosen to
// cover:
//   - pipe          x ∈ [10.05, 10.95], y ∈ [3.75, 4.65], z ∈ [-22.6, -21.5]
//   - torus         x ∈ [9.05, 11.95],  y ∈ [3.75, 4.65], z ∈ [-23.95, -23.05]
//   - chamber box   x ∈ [9.3, 11.7],    y ∈ [3.5, 4.9],   z ∈ [-26.5, -23.5]
// plus a small margin in each direction.
export const isInChamber = (px, py, pz) =>
  px >= +8.5 && px <= +12.5 &&
  py >= +3 && py <= +5.5 &&
  pz >= -27 && pz <= -22;


// ─────────────────────────── geometry ───────────────────────────

// Sun position on the back wall — must match the painted sun in
// zones/kitchen.js: windowColorFn (lpx=2.5, lpy=2.2 in window-local;
// window position [+8, +2, -21.95]).
const SUN_X = 10.5;
const SUN_Y = 4.2;

const KITCHEN_BACK_WALL_Z = -22.0;

// Entry pipe geometry. Outer + inner radius give a thin shell with
// generous interior clearance for the fish (inner radius - fishRadius
// = 0.42 - 0.20 = 0.22). The pipe itself isn't a separate item — it's
// an air-volume cut from the kitchen-room and chamber-room shells, so
// its visible color comes from whichever shell's wall the ray hits.
const PIPE_R_OUTER       = 0.45;
const PIPE_R_INNER       = 0.42;
const PIPE_Z_KITCHEN_END = -21.5;            // 0.5 inside the kitchen
const PIPE_Z_TORUS_END   = -22.6;            // 0.5 past the torus +Z extent at θ=π/2
const PIPE_HALF_LEN      = (PIPE_Z_KITCHEN_END - PIPE_Z_TORUS_END) / 2;
const PIPE_CENTER_Z      = (PIPE_Z_KITCHEN_END + PIPE_Z_TORUS_END) / 2;

// Torus — full donut behind the wall, axis along Y, centered on the sun.
// Minor radii match the entry pipe so the seam at θ=π/2 is flush.
const TORUS_R          = 1.0;                 // major radius
const TORUS_r_OUTER    = 0.45;                // minor radius (outer)
const TORUS_r_INNER    = 0.42;                // minor radius (inner)
const TORUS_CENTER_Z   = -23.5;               // tube CENTER at θ=π/2 sits at z=-22.5; +Z extent at -22.05
//                                            // tube CENTER at θ=-π/2 sits at z=-24.5; +Z extent at -24.05, -Z at -24.95

// Chamber — box behind the torus. Sized to clear the torus (R=1.0,
// r=0.45 → torus reaches X ±1.45 from center) with breathing room, and
// deep enough in -Z that the gyroid centerpiece sits past the tube
// exit without intersecting it.
const CHAMBER_HALF_X   = 1.2;
const CHAMBER_HALF_Y   = 0.7;
const CHAMBER_HALF_Z   = 1.5;
const CHAMBER_FRONT_Z  = -23.5;               // chamber +Z face, 0.55 past tube +Z extent at θ=-π/2
const CHAMBER_CENTER_Z = CHAMBER_FRONT_Z - CHAMBER_HALF_Z;        // -25.0
const CHAMBER_BACK_Z   = CHAMBER_CENTER_Z - CHAMBER_HALF_Z;       // -26.5
const CHAMBER_FLOOR_Y  = SUN_Y - CHAMBER_HALF_Y;                   // 3.5
const CHAMBER_CEIL_Y   = SUN_Y + CHAMBER_HALF_Y;                   // 4.9


// ───────────────────────── SDF primitives ─────────────────────────

// Torus-volume SDF (axis along Y, centered at origin in local frame).
//   ringD = perpendicular distance to the central ring of the donut
//   tubeD = distance from the ring's tube → SDF zero at tube radius r
const torusVolumeSdf = (R, r) => (px, py, pz) => {
  const ringD = Math.sqrt(px * px + pz * pz) - R;
  return Math.sqrt(ringD * ringD + py * py) - r;
};

// Pipe and torus VOLUMES (full solid SDFs) — used by the chamber-room
// air-region union AND by the kitchen-room/window cuts. There are no
// separate pipe-shell or torus-shell items: the chamber-room and
// kitchen-room SDFs render the tube walls in their respective region's
// wall palette (purple in chamber, beige/kitchen elsewhere) as a
// natural consequence of the air-region union, with the region
// boundary at z=-22 acting as a clean color transition mid-tube.
const pipeVolumeWorldSdf = translateSDF(
  [SUN_X, SUN_Y, PIPE_CENTER_Z],
  rotateXSDF(Math.PI / 2, cylinderSDF(PIPE_HALF_LEN, PIPE_R_OUTER)),
);
const torusOuterWorldSdf = translateSDF(
  [SUN_X, SUN_Y, TORUS_CENTER_Z],
  torusVolumeSdf(TORUS_R, TORUS_r_OUTER),
);

const chamberBoxSdf = translateSDF(
  [SUN_X, SUN_Y, CHAMBER_CENTER_Z],
  boxSDF([CHAMBER_HALF_X, CHAMBER_HALF_Y, CHAMBER_HALF_Z]),
);
// Combined air-volume SDF (chamber box ∪ torus tube ∪ entry pipe).
// Exported so the outside zone's house-exterior shell can cut this
// volume out of its wall material; without that cut, the wall
// geometrically overlaps the secret zone and physics probes near the
// air-pocket boundary would let the wall's gradient shove the fish
// out onto the cove ground.
export const chamberAirSdf = unionSDF(
  chamberBoxSdf,
  torusOuterWorldSdf,
  pipeVolumeWorldSdf,
);
const chamberRoomSdf = invertSDF(chamberAirSdf);

// Gyroid — a triply-periodic minimal surface. The unscaled function
// returns a value that's not a true SDF (not Lipschitz-1), but
// multiplying by a small factor makes it conservative enough for the
// marcher. Bounded inside a sphere so it forms a finite blob rather
// than tiling the chamber to infinity.
const GYROID_K = 7.0;                          // frequency — higher = more lattice cells
const GYROID_R = 0.77;                         // bounding sphere radius
// Rotation rates around each axis. Coprime-ish irrationals so the three
// rotations don't sync up — the gyroid tumbles in a way that never
// repeats cleanly. Periods ≈ 20 / 15 / 11 seconds.
const GYROID_RATE_X = 0.31;
const GYROID_RATE_Y = 0.43;
const GYROID_RATE_Z = 0.57;
// Per-frame trig cache for the gyroid's rotation matrices. The marcher
// can hit the gyroid's bounding sphere up to MAX_STEPS=44 times per
// ray, and each step recomputes 6 cos/sin of the same per-frame angles
// otherwise — wasted work since frameTime is constant within a trace.
// Keyed off frameTime so the cache invalidates exactly once per frame.
let _gyroidCachedTime = -1;
let _gxC = 0, _gxS = 0, _gyC = 0, _gyS = 0, _gzC = 0, _gzS = 0;
const gyroidSdf = intersectionSDF(
  (px, py, pz) => {
    if (frameTime !== _gyroidCachedTime) {
      const t = frameTime / 1000;
      _gxC = Math.cos(t * GYROID_RATE_X); _gxS = Math.sin(t * GYROID_RATE_X);
      _gyC = Math.cos(t * GYROID_RATE_Y); _gyS = Math.sin(t * GYROID_RATE_Y);
      _gzC = Math.cos(t * GYROID_RATE_Z); _gzS = Math.sin(t * GYROID_RATE_Z);
      _gyroidCachedTime = frameTime;
    }

    // Apply Rx, then Ry, then Rz to (px, py, pz).
    const y1 = py * _gxC - pz * _gxS;
    const z1 = py * _gxS + pz * _gxC;
    const x2 = px * _gyC + z1 * _gyS;
    const z2 = -px * _gyS + z1 * _gyC;
    const x3 = x2 * _gzC - y1 * _gzS;
    const y3 = x2 * _gzS + y1 * _gzC;

    const tx = x3 * GYROID_K, ty = y3 * GYROID_K, tz = z2 * GYROID_K;
    return (Math.sin(tx) * Math.cos(ty)
          + Math.sin(ty) * Math.cos(tz)
          + Math.sin(tz) * Math.cos(tx)) * 0.20;
  },
  sphereSDF(GYROID_R),
);


// ───────────────────────────── glyphs ─────────────────────────────
//
// Minimal stroke font for the marquee. Each glyph is a list of
// straight-line stroke segments [[x1, y1, x2, y2], ...] in unit space:
// (0,0) is the bottom-left of the glyph cell, (1,1) is top-right.
// Strokes are stored as arrays; the marquee colorFn computes the
// minimum 2D distance from the query point to any stroke and fills
// pixels within `STROKE_HALF_W` of any segment.
//
// Coverage: just the letters in the marquee text below.

const GLYPHS = {
  ' ': [],
  '!': [[0.5, 0.45, 0.5, 1], [0.4, 0.1, 0.6, 0.1]],
  '.': [[0.4, 0.05, 0.6, 0.05], [0.4, 0, 0.6, 0]],
  ':': [[0.4, 0.3, 0.6, 0.3], [0.4, 0.7, 0.6, 0.7]],
  'A': [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.2, 0.4, 0.8, 0.4]],
  'C': [[1.0, 0.85, 0.85, 1.0], [0.85, 1.0, 0.15, 1.0], [0.15, 1.0, 0, 0.85], [0, 0.85, 0, 0.15], [0, 0.15, 0.15, 0], [0.15, 0, 0.85, 0], [0.85, 0, 1.0, 0.15]],
  'D': [[0, 0, 0, 1], [0, 1, 0.6, 1], [0.6, 1, 0.95, 0.7], [0.95, 0.7, 0.95, 0.3], [0.95, 0.3, 0.6, 0], [0.6, 0, 0, 0]],
  'E': [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.7, 0.5], [0, 0, 1, 0]],
  'F': [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.7, 0.5]],
  'G': [[1, 0.85, 0.85, 1], [0.85, 1, 0.15, 1], [0.15, 1, 0, 0.85], [0, 0.85, 0, 0.15], [0, 0.15, 0.15, 0], [0.15, 0, 0.85, 0], [0.85, 0, 1, 0.15], [1, 0.15, 1, 0.45], [1, 0.45, 0.55, 0.45]],
  'H': [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]],
  'I': [[0.2, 0, 0.8, 0], [0.5, 0, 0.5, 1], [0.2, 1, 0.8, 1]],
  'K': [[0, 0, 0, 1], [0, 0.5, 1, 1], [0, 0.5, 1, 0]],
  'L': [[0, 0, 0, 1], [0, 0, 1, 0]],
  'M': [[0, 0, 0, 1], [0, 1, 0.5, 0.4], [0.5, 0.4, 1, 1], [1, 1, 1, 0]],
  'N': [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1]],
  'O': [[0.15, 0, 0.85, 0], [0.85, 0, 1, 0.2], [1, 0.2, 1, 0.8], [1, 0.8, 0.85, 1], [0.85, 1, 0.15, 1], [0.15, 1, 0, 0.8], [0, 0.8, 0, 0.2], [0, 0.2, 0.15, 0]],
  'R': [[0, 0, 0, 1], [0, 1, 0.7, 1], [0.7, 1, 0.95, 0.85], [0.95, 0.85, 0.7, 0.5], [0.7, 0.5, 0, 0.5], [0.4, 0.5, 1, 0]],
  'S': [[1, 0.85, 0.85, 1], [0.85, 1, 0.15, 1], [0.15, 1, 0, 0.85], [0, 0.85, 0, 0.55], [0, 0.55, 0.15, 0.5], [0.15, 0.5, 0.85, 0.5], [0.85, 0.5, 1, 0.45], [1, 0.45, 1, 0.15], [1, 0.15, 0.85, 0], [0.85, 0, 0.15, 0], [0.15, 0, 0, 0.15]],
  // T's top stroke extends past the glyph's [0..1] bounds into the cell
  // margins on both sides, giving it a longer cap than its body width.
  // The marqueeColorFn allows X to range outside [0..1] for this reason
  // (other letters' strokes are confined to [0..1] anyway).
  'T': [[-0.20, 1, 1.20, 1], [0.5, 0, 0.5, 1]],
  'U': [[0, 0.2, 0, 1], [1, 0.2, 1, 1], [0, 0.2, 0.15, 0], [0.15, 0, 0.85, 0], [0.85, 0, 1, 0.2]],
  'V': [[0, 1, 0.5, 0], [0.5, 0, 1, 1]],
  'Y': [[0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]],
};

const MARQUEE_TEXT     = ":: THANK YOU FOR VISITING ! ::  TIG.SYSTEMS  :: HAVE A NICE DAY ! ::  ";
const MARQUEE_GLYPH_W  = 0.18;                 // per-glyph width on the marquee strip
const MARQUEE_GLYPH_H  = 0.30;                 // per-glyph height (matches the strip's vertical span)
const MARQUEE_TOTAL_W  = MARQUEE_TEXT.length * MARQUEE_GLYPH_W;
// Margins inside each glyph cell — keeps letters from running into each
// other and from kissing the top/bottom edges of the strip.
const GLYPH_MARGIN_X   = 0.18;
const GLYPH_MARGIN_Y   = 0.12;
const STROKE_HALF_W    = 0.085;                // half-width of a stroke in (margin-adjusted) glyph-unit space
const SCROLL_SPEED     = 0.77;                 // world units / sec

// Helper: 2D point-to-segment squared distance.
const segDist2 = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 1e-9 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = px - (x1 + dx * t), cy = py - (y1 + dy * t);
  return cx * cx + cy * cy;
};

const marqueeColorFn = (lpx, lpy, lpz) => {
  // Front face is +Z — back/sides paint dark.
  if (lpz < 0) return [12, 8, 18];
  // Outside the strip's vertical span paints dark backing.
  const strip_lpy = lpy + MARQUEE_GLYPH_H / 2;
  if (strip_lpy < 0 || strip_lpy > MARQUEE_GLYPH_H) return [12, 8, 18];

  // Scroll: time-based offset, then wrap into [0, MARQUEE_TOTAL_W).
  const t = frameTime / 1000;
  const offsetX = lpx + t * SCROLL_SPEED;
  const wrappedX = ((offsetX % MARQUEE_TOTAL_W) + MARQUEE_TOTAL_W) % MARQUEE_TOTAL_W;

  const charIndex = Math.floor(wrappedX / MARQUEE_GLYPH_W) % MARQUEE_TEXT.length;
  const letter    = MARQUEE_TEXT[charIndex] || ' ';
  const strokes   = GLYPHS[letter] || GLYPHS[' '];

  // Apply margins — strokes use only the inner (1 - 2·margin) fraction
  // of the cell, leaving outer strips as gap between adjacent letters
  // and a top/bottom margin from the strip's top and bottom.
  const cellX = (wrappedX - charIndex * MARQUEE_GLYPH_W) / MARQUEE_GLYPH_W;
  const cellY = strip_lpy / MARQUEE_GLYPH_H;
  const usableX = 1 - 2 * GLYPH_MARGIN_X;
  const usableY = 1 - 2 * GLYPH_MARGIN_Y;
  const glyphX = (cellX - GLYPH_MARGIN_X) / usableX;
  const glyphY = (cellY - GLYPH_MARGIN_Y) / usableY;
  // Keep the Y discard (strokes shouldn't render in top/bottom margins),
  // but let X extend past [0..1] so T's wider top stroke can render into
  // adjacent margin space. Other letters' strokes are confined to
  // [0..1] in X anyway, so they don't bleed into adjacent cells.
  if (glyphY < 0 || glyphY > 1) return [25, 18, 35];

  let minD2 = Infinity;
  for (const s of strokes) {
    const d2 = segDist2(glyphX, glyphY, s[0], s[1], s[2], s[3]);
    if (d2 < minD2) minD2 = d2;
  }
  if (minD2 < STROKE_HALF_W * STROKE_HALF_W) {
    // Lit pulse — amber bulbs flickering with a slow base sine
    const pulse = 0.65 + 0.35 * Math.sin(t * 4 + lpx * 12);
    return [200 * pulse + 55, 130 * pulse + 25, 30 * pulse];
  }
  // Dark backing between letters
  return [25, 18, 35];
};


// ────────────────────────── colorFns ──────────────────────────

const chamberRoomColorFn = (lpx, lpy, lpz) => {
  // Floor band — deep purple-dark
  if (lpy < CHAMBER_FLOOR_Y + 0.10) return [22, 14, 30];
  // Ceiling band — even darker, voidy
  if (lpy > CHAMBER_CEIL_Y - 0.10) return [10, 8, 18];
  // Walls — abstract dark plum with a faint diagonal lattice
  const lattice = Math.sin((lpx + lpz) * 14) * Math.sin((lpx - lpz) * 14);
  if (lattice > 0.85) return [70, 45, 110];                            // lit lattice node
  if (lattice > 0.65) return [50, 30, 80];
  return [38, 24, 60];
};

// Whole-chamber psychedelic wash — a translucent box filling the
// chamber air with a slowly hue-cycling color. Three independent
// frequencies on R/G/B with phase offsets, so the wash never settles
// on a static color. Pulses through the entire chamber atmosphere
// like the gyroid is leaking light into the room.
const chamberGlowColorFn = (lpx, lpy, lpz) => {
  const t = frameTime / 1000;
  const r = 70 + 90 * Math.sin(t * 0.6);
  const g = 70 + 90 * Math.sin(t * 0.85 + 2.1);
  const b = 90 + 90 * Math.sin(t * 1.05 + 4.3);
  return [r, g, b];
};

const gyroidColorFn = (lpx, lpy, lpz) => {
  // Iridescent palette keyed off local position — different per ridge,
  // mutating fast enough for the gyroid to feel actively alive.
  const t = frameTime / 500;
  const r = 100 + 100 * Math.sin(lpx * 8 + t);
  const g = 100 + 100 * Math.sin(lpy * 8 + t * 1.3);
  const b = 150 + 100 * Math.sin(lpz * 8 + t * 0.7);
  return [r, g, b];
};


// ─────────────────────────── scene build ───────────────────────────

/**
 * Add the chamber zone to the scene. Mutates the caller-supplied kitchen
 * `room` AND `window` items in place to carve the entry pipe through the
 * back wall and through the painted-sun area of the window.
 *
 * @param {import('../../../core/scene.js').Scene} scene
 * @param {{
 *   room:   import('../../../core/scene.js').Item,
 *   window: import('../../../core/scene.js').Item,
 * }} kitchen   Handles to kitchen items this zone needs to mutate.
 */
export const addToScene = (scene, { room: kitchenRoom, window: kitchenWindow }) => {
  const add = (item) => registerItem(scene, { ...item, regionKey: REGION_CHAMBER });

  // Carve the entry pipe through the kitchen room (so the kitchen-side
  // half of the pipe reads as air) and through the kitchen window (so
  // the pipe punches a clean circular hole through the glass at the
  // sun's painted location).
  //
  // Item SDFs are queried in item-LOCAL coords (world - item.position),
  // so a tool SDF built in world coords (like our pipeVolumeSdf) has to
  // be wrapped into each target's local frame before cutting. The
  // kitchen-room is at (0,0,0) so local = world and the wrap is a
  // no-op, but the window sits at (+8, +2, -21.95) and needs the offset.
  const cutItemWith = (item, worldToolSdf) => {
    const [px, py, pz] = item.position;
    const localTool = (lx, ly, lz) => worldToolSdf(lx + px, ly + py, lz + pz);
    const oldSdf = item.sdf;
    item.sdf = cutSDF(localTool, oldSdf);
  };
  cutItemWith(kitchenRoom,   pipeVolumeWorldSdf);
  cutItemWith(kitchenWindow, pipeVolumeWorldSdf);

  // Chamber-room shell — material everywhere except in the chamber
  // box, the torus tube, and the entry pipe. Paints chamber walls.
  add({
    name:     'chamber-room',
    color:    [40, 25, 65],
    colorFn:  chamberRoomColorFn,
    position: [0, 0, 0],
    sdf:      chamberRoomSdf,
  });

  // Whole-chamber glow — translucent box filling the chamber air with
  // a slow psychedelic wash. Camera inside the chamber picks up the
  // tint at step zero (since chamber-glow's box SDF is negative inside).
  // collides:false. Confined to the chamber box (not the torus / pipe
  // interior), so the wash is contained to "the trippy room" and the
  // tube stays its dim plum.
  add({
    name:     'chamber-glow',
    color:    [110, 110, 140],
    colorFn:  chamberGlowColorFn,
    position: [SUN_X, SUN_Y, CHAMBER_CENTER_Z],
    sdf:      boxSDF([CHAMBER_HALF_X, CHAMBER_HALF_Y, CHAMBER_HALF_Z]),
    opacity:  0.20,
    collides: false,
  });

  // Marquee — a thin lit strip running wall-to-wall along the back of
  // the chamber, scrolling text via the glyph table above. Front face
  // (+Z) is the visible side; back/sides paint dark.
  const MARQUEE_HALF = [CHAMBER_HALF_X, MARQUEE_GLYPH_H / 2, 0.025];
  add({
    name:     'chamber-marquee',
    color:    [25, 18, 35],
    colorFn:  marqueeColorFn,
    position: [SUN_X, SUN_Y - 0.05, CHAMBER_BACK_Z + MARQUEE_HALF[2] + 0.02],
    sdf:      boxSDF(MARQUEE_HALF),
    boundingRadius: Math.hypot(MARQUEE_HALF[0], MARQUEE_HALF[1], MARQUEE_HALF[2]) + 0.02,
  });

  // Gyroid centerpiece — abstract sculptural blob hovering just behind
  // the chamber center. The 0.4-unit -Z offset places the gyroid +Z
  // extent at the tube -Z extent at θ=-π/2 with no overlap. Iridescent
  // time-varying colorFn keyed off local position.
  add({
    name:     'chamber-gyroid',
    color:    [180, 130, 200],
    colorFn:  gyroidColorFn,
    position: [SUN_X, SUN_Y, CHAMBER_CENTER_Z - 0.4],
    sdf:      gyroidSdf,
    boundingRadius: GYROID_R + 0.05,
  });

  // Sun cover — a thin opaque disk parked just in front of the carved
  // window at the painted-sun location. Hides the tube interior from
  // kitchen rays so the secret reads as a regular painted sun. Fish
  // swims through (collides:false). Registered to BOTH the chamber and
  // kitchen regions: the disk geometrically sits inside the kitchen box,
  // but chamber rays approaching it via the entry pipe must consider it
  // too — otherwise the per-step cull drops it during chamber-region
  // steps and the marcher's nearestD ignores it, letting a single step
  // leap past the 0.01-thick disk and the ray sees through to kitchen
  // items behind it instead of terminating on the cover.
  registerItem(scene, {
    name:     'chamber-sun-cover',
    color:    [255, 235, 120],                // matches windowColorFn's painted sun core
    position: [SUN_X, SUN_Y, KITCHEN_BACK_WALL_Z + 0.15],   // 0.05 in front of the window's kitchen-facing face
    sdf:      rotateXSDF(Math.PI / 2, cylinderSDF(0.005, 0.55)),
    collides: false,
    boundingRadius: 0.56,
    regionKey: [REGION_CHAMBER, REGION_KITCHEN],
  });
};
