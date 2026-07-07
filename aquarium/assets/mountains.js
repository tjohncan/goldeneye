// aquarium/assets/mountains.js — discrete mountain items in the cove.
//
// Three mountains, all on the LAND side (-Z hemisphere), all anchored
// on the shack plateau:
//   - foothill mesa at 268° (kitchen-window view direction): a small
//     green flat-topped mesa with conic sloped sides, fully inside the
//     dome and not constrained to its surface. Mirrors the painted
//     hill on the kitchen window so a player looking out the back of
//     the shack sees a real-geometry version of the indoor painting —
//     and its flat top is a landing terrace for the sky-goldfish.
//   - main range at 220° and 307°: snow-capped mountains, peaks
//     extending PAST the dome's inner shell so each silhouette
//     continues through the bowl glass.
//
// Plateau elevation is owned by outside.js (the cove's authority on
// vertical layout) and threaded in via addToScene's options arg —
// keeps a single source of truth for ground Y and avoids reaching
// across modules for a constant.
//
// Each mountain is a CLUSTER of sub-peaks: matterhorn-sharp single
// horns or mont-blanc-style ridges. SDF takes MAX over sub-peak
// heights for the union shape, giving each mountain a distinct
// silhouette.
//
// Performance: position at MID-HEIGHT lets the bounding-box half on Y
// be just peakH/2+1 instead of peakH+1 (which a base-anchored bound
// would need to enclose the peak). Halves the Y-axis bound size, so
// the per-ray slab cull rejects mountains earlier.

// Peak radius — how far the peak point sits from world origin. Set
// past the dome's outer shell (1030) so mountains extend through the
// bowl. With the dome translucent, the upper portion of each mountain
// reads through the bowl glass with a slight tint — the silhouette
// continues out into and beyond the bowl rather than ending at its
// inner surface.
const PEAK_R = 1100;

// World-Y bands (NOT mountain-local Y, since mountains have varying
// base_y depending on which ground they anchor to). Forest below
// TREE_LINE; rocky between; snow above SNOW_LINE on hasSnow mountains.
// TREE_LINE high enough that the foothill (peak ≈ world Y 67) stays
// all-green.
const TREE_LINE_Y = 100;
const SNOW_LINE_Y = 380;

const peakHeightOnDome = (hd, base_y) => Math.sqrt(PEAK_R * PEAK_R - hd * hd) - base_y;


// ─────────────────────────── shape templates ───────────────────────────
//
// Each mountain's `peaks` array of { ox, oz, h, subR, sharp, flat? }
// in mountain-local XZ. SDF takes MAX over each sub-peak's bell
// contribution. `sharp` exponent kept moderate (1.4–1.9) — keeps the
// SDF gradient at the peak from getting steep enough to cause
// marcher-overshoot artifacts ("neck disappears + dot on top" near
// a sharp summit).
//
// `flat` (0..1, optional, default 0) turns the bell into a mesa: the
// sub-peak holds its full height h out to radius flat×subR, then
// falls off over the remaining (1-flat)×subR with the usual
// (1-t')^sharp profile in the RESCALED radial coordinate. flat=0
// reproduces the original bell exactly. With sharp=1 the sides are
// straight cones — "plateau'd top with conic sloped sides."
//
// Sub-peak counts kept tight (1–3 per mountain) to minimize per-step
// SDF work.

// Matterhorn-style — single sharp horn.
const matterhornPeaks = (h, baseR) => [
  { ox: 0, oz: 0, h: h, subR: baseR * 0.95, sharp: 1.9 },
];

// Mont-Blanc-style — primary peak with one ridge satellite.
const montBlancPeaks = (h, baseR) => [
  { ox: 0,             oz: 0,             h: h,        subR: baseR * 0.65, sharp: 1.7 },   // primary
  { ox:  baseR * 0.50, oz: -baseR * 0.10, h: h * 0.90, subR: baseR * 0.55, sharp: 1.6 },
];


// ─────────────────────────── geometry ───────────────────────────

// Multi-peak heightfield SDF. Mountain volume = union of sub-peak
// volumes, capped above the plateau. This factory creates a closure
// that operates in BASE-relative local Y (lpyBase = 0 at base center,
// + peakH at peak), even though the item itself is positioned at
// MID-HEIGHT for bounding-sphere purposes — the closure shifts the
// incoming midpoint-relative lpy to base-relative before applying the
// shape logic.
//
// SDF scale defaults to 0.30 — heightfield gradient up to ~peakH/baseR
// (~3 for big mountains) plus low-frequency noise (~0.3). Conservative
// enough to keep the marcher from overshooting at sharp peaks. Gentler
// mountains may pass `sdfScale` to march faster: the mesa's conic
// sides peak at slope ~1.5 (noise included), Lipschitz-safe up to
// ~0.55 — creeping at 0.30 made rays grazing its flanks exhaust the
// step budget and halo the silhouette.
const makeMountainSdf = ({ peaks, noiseSeed, peakH, sdfScale, tunnels }) => {
  const yOff  = peakH / 2;
  const scale = sdfScale ?? 0.30;
  // Tunnel-mouth (x, z) centers in mountain-local coords — the surface
  // noise is faded to zero within NOISE_CLEAR of each so the painted
  // arch lands on smooth ground. A mouth on the inner (sub-subR) flank
  // sits where the shallow bell (~5 tall) is dwarfed by the ±5.6 noise,
  // so the raw surface writhes and shreds the arch edge; flattening it
  // there also gentles the gradient (marcher-safe by construction).
  const mouths = tunnels || null;
  const NOISE_CLEAR = 42;
  return (lpx, lpy, lpz) => {
    const lpyBase = lpy + yOff;
    let surfaceMax = 0;
    let hadAny = false;
    let minRimDist = Infinity;

    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      const dx = lpx - p.ox;
      const dz = lpz - p.oz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r <= p.subR) {
        const t = r / p.subR;
        const flat = p.flat || 0;
        const h = t <= flat
          ? p.h
          : p.h * Math.pow((1 - t) / (1 - flat), p.sharp);
        if (h > surfaceMax) surfaceMax = h;
        hadAny = true;
      } else {
        const rimD = r - p.subR;
        if (rimD < minRimDist) minRimDist = rimD;
      }
    }

    if (hadAny) {
      let noise = (
        Math.sin(lpx * 0.030 + noiseSeed) * Math.cos(lpz * 0.030 + noiseSeed * 1.7) +
        Math.sin(lpx * 0.080 + noiseSeed * 1.3) * Math.cos(lpz * 0.075 + noiseSeed * 0.8) * 0.4
      ) * 4;
      if (mouths !== null) {
        for (let i = 0; i < mouths.length; i++) {
          const mx = lpx - mouths[i][0], mz = lpz - mouths[i][2];
          const md = Math.sqrt(mx * mx + mz * mz);
          if (md < NOISE_CLEAR) { noise *= md / NOISE_CLEAR; break; }
        }
      }
      const surfaceH = surfaceMax + noise;
      // Interior distance measures to the SLOPE overhead, not the base
      // plane: the base term used to win anywhere below mid-height, so
      // a collider that punched through a thin skirt got a DOWNWARD
      // gradient, was shoved onto the base, and wedged between the
      // mountain pushing down and the ground pushing up — an
      // inescapable trap. The -200 offset keeps the base term only for
      // absurd depths (sign sanity far underground, unreachable by
      // anything that moves); everywhere reachable, the gradient
      // ejects up-and-out onto the hillside.
      return Math.max(lpyBase - surfaceH, -lpyBase - 200) * scale;
    }
    return Math.sqrt(minRimDist * minRimDist + lpyBase * lpyBase) * scale;
  };
};


// ─────────────────────────── colorFns ───────────────────────────

// `tunnels` — optional list of mountain-LOCAL [x, y, z] points where a
// railway bores in. Painted as a dark mouth with a stone ring; the
// track's items simply drive into the mountain's material behind it
// (no carve — the surface occludes them), so the mouth is the whole
// illusion.
const makeMountainColorFn = ({ hasSnow, noiseSeed, base_y, peakH, tunnels }) => {
  const yOff = peakH / 2;
  return (lpx, lpy, lpz) => {
    if (tunnels !== undefined) {
      for (let i = 0; i < tunnels.length; i++) {
        const tn = tunnels[i];
        const dx = lpx - tn[0];
        const dz = lpz - tn[2];
        if (dx * dx + dz * dz > 1500) continue;
        // Tunnel-arch profile, anchored at rail level and STRETCHED
        // up-slope along the bore axis (tn[3..4], toward the mountain
        // core): the mouth paints onto a skirt seen nearly edge-on from
        // the track, so a circular patch foreshortens to a dot — the
        // elongated footprint climbs the hillside and reads as a bore
        // driven into it. Size + elongation are per-portal (tn[5..6])
        // so a steeper skirt can carry a bigger, rounder mouth. Base
        // profile: across-track half-width 15, crown ~21 over rails.
        const u = dx * tn[3] + dz * tn[4];     // along the bore axis
        const v = dz * tn[3] - dx * tn[4];     // across it
        const ay = lpy - tn[1] + 8;            // 0 at the rail base
        if (ay > -1.5) {
          const dome = ay > 8 ? (ay - 8) * 1.15 : 0;
          const p2 = v * v + u * u * tn[6] + dome * dome;
          const sm = tn[5] * tn[5];            // linear scale → area threshold
          if (p2 < 225 * sm) return [26, 24, 28];   // the dark bore
          if (p2 < 342 * sm) return [96, 86, 78];   // dressed-stone ring
        }
      }
    }
    const worldY = lpy + base_y + yOff;
    if (hasSnow && worldY > SNOW_LINE_Y) {
      const drift = Math.sin(lpx * 0.40 + noiseSeed) * Math.cos(lpz * 0.50 + noiseSeed * 1.4);
      return [240 + 12 * drift, 245 + 8 * drift, 250 + 4 * drift];
    }
    if (worldY > TREE_LINE_Y) {
      const t = Math.min(1, (worldY - TREE_LINE_Y) / (SNOW_LINE_Y - TREE_LINE_Y));
      const streak = Math.sin(lpx * 0.25 + noiseSeed) * Math.cos(lpz * 0.27 + noiseSeed * 0.8);
      return [
        90  + 60 * t + 18 * streak,
        80  + 60 * t + 14 * streak,
        75  + 65 * t + 12 * streak,
      ];
    }
    const patch  = Math.sin(lpx * 0.40 + noiseSeed) * Math.cos(lpz * 0.50 - noiseSeed * 1.2);
    const detail = Math.sin(lpx * 0.90 + noiseSeed * 0.7) * Math.cos(lpz * 0.85 + noiseSeed * 1.5);
    if (patch >  0.5) return [82 + 20 * detail, 132 + 18 * detail, 60 + 12 * detail];
    if (patch < -0.4) return [55 + 14 * detail, 90  + 18 * detail, 50 + 10 * detail];
    return [70 + 22 * detail, 105 + 22 * detail, 55 + 12 * detail];
  };
};


// ─────────────────────────── scene build ───────────────────────────

// Foothill-mesa shape numbers, hoisted so addToScene can hand exact
// surface info back to the caller (tree + perch placement on the flat
// top). Slope on the conic sides = H / ((1-flat)·subR) ≈ 55/43.5 ≈
// 1.26 — comfortably inside the 0.30 SDF-scale safety rule.
const MESA_ANGLE  = 268;
const MESA_HD     = 200;
const MESA_SUB_R  = 75;
const MESA_H      = 55;
const MESA_FLAT   = 0.42;
const MESA_SEED   = 9.1;

/**
 * Register all mountain items via the caller-supplied `add` helper
 * (typically outside.js's REGION_OUTSIDE-tagged registrar).
 *
 * Item position is at MID-HEIGHT (base_y + peakH/2) so the bounding
 * box centers there, not at the base — keeps the world origin
 * outside each item's bound so the per-ray cull actually rejects
 * mountains a ray doesn't point at.
 *
 * Returns geometry info for the foothill mesa (center, flat-top
 * radius, and an exact surfaceY(px, pz) valid on the flat top —
 * includes the SDF's noise term) so the caller can seat items and
 * sky-goldfish perches directly ON the rendered surface instead of
 * hovering at a guessed elevation.
 *
 * @param {(item: import('../../core/scene.js').Item) => void} add
 * @param {{ plateauY: number, tunnels?: number[][] }} opts
 *        `plateauY` is the cove's shack-plateau elevation (owned by
 *        outside.js); each mountain's base anchors here. `tunnels` are
 *        WORLD points of railway bores — each is painted onto
 *        whichever mountain's footprint contains it.
 * @returns {{ mesa: { x: number, z: number, topR: number,
 *                     surfaceY: (px: number, pz: number) => number } }}
 */
export const addToScene = (add, { plateauY, tunnels = [] }) => {
  // Range mountain — wraps shape + dome height into a layout record.
  const range = (angle, hd, baseR, base_y, hasSnow, seed, shapeFn) => {
    const peakH = peakHeightOnDome(hd, base_y);
    return {
      angle, hd, baseR, base_y, peakH, hasSnow, noiseSeed: seed,
      peaks: shapeFn(peakH, baseR),
    };
  };

  const mountains = [
    // Foothill mesa — kitchen-window view direction (-Z), free-standing
    // inside the dome. Flat top (radius ≈ 31) with straight conic sides;
    // world top Y = plateauY + 55 = 42 (±the SDF's gentle noise), well
    // under TREE_LINE_Y so it stays all-green.
    {
      angle: MESA_ANGLE, hd: MESA_HD, baseR: MESA_SUB_R, base_y: plateauY,
      peakH: MESA_H, hasSnow: false, noiseSeed: MESA_SEED, sdfScale: 0.5,
      peaks: [
        { ox: 0, oz: 0, h: MESA_H, subR: MESA_SUB_R, sharp: 1.0, flat: MESA_FLAT },
      ],
    },
    // Main range — 2 mountains on the LAND side of the cove (-Z
    // hemisphere). The painted-silhouette backdrop on the firmament
    // fills out the rest of the horizon, so only a couple of real-
    // geometry items are needed to give the player something to fly
    // up to. 220° sits on the far -X flank as a matterhorn horn;
    // 307° sits back-right (off the mousehole side) as a wider
    // mont-blanc ridge. Asymmetric placement avoids regularity.
    range(220, 900, 400, plateauY, true, 1.7, matterhornPeaks),
    range(307, 850, 440, plateauY, true, 4.5, montBlancPeaks),
  ];

  for (const m of mountains) {
    const angRad = m.angle * Math.PI / 180;
    const cx     = m.hd * Math.cos(angRad);
    const cz     = m.hd * Math.sin(angRad);
    const cy     = m.base_y + m.peakH / 2;
    // Claim any tunnel bore landing inside this mountain's footprint,
    // converted to this item's local frame for the colorFn, plus the
    // unit bore axis (anchor → mountain core) the arch stretches along.
    const myTunnels = [];
    for (const tw of tunnels) {
      const dx = tw[0] - cx, dz = tw[2] - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < m.baseR) {
        // [dx, dy, dz, axisX, axisZ, sizeScale, elongCoeff]
        myTunnels.push([dx, tw[1] - cy, dz, -dx / d, -dz / d, tw[3] ?? 1, tw[4] ?? 0.27]);
      }
    }
    if (myTunnels.length > 0) m.tunnels = myTunnels;
    add({
      name:     `outside-mountain-${m.angle}`,
      color:    [110, 95, 75],
      colorFn:  makeMountainColorFn(m),
      position: [cx, cy, cz],
      sdf:      makeMountainSdf(m),
      // Mountain is a heightfield cone: ±baseR in X/Z at the foot,
      // narrowing to a peak at the top. AABB matches the foot and
      // accepts empty corners high up — tighter than a sphere bound
      // that would need to enclose the base-to-peak diagonal.
      boundingBox: [m.baseR + 1, m.peakH / 2 + 1, m.baseR + 1],
    });
  }

  // Mesa geometry handout. surfaceY mirrors makeMountainSdf's noise
  // term exactly (same frequencies, same seed) so a caller-placed item
  // sits ON the rendered surface. Only valid on the flat top (r ≤
  // topR), where the bell contribution is the constant MESA_H.
  const mesaRad = MESA_ANGLE * Math.PI / 180;
  const mesaX   = MESA_HD * Math.cos(mesaRad);
  const mesaZ   = MESA_HD * Math.sin(mesaRad);
  const mesaSurfaceY = (px, pz) => {
    const lpx = px - mesaX, lpz = pz - mesaZ;
    const noise = (
      Math.sin(lpx * 0.030 + MESA_SEED) * Math.cos(lpz * 0.030 + MESA_SEED * 1.7) +
      Math.sin(lpx * 0.080 + MESA_SEED * 1.3) * Math.cos(lpz * 0.075 + MESA_SEED * 0.8) * 0.4
    ) * 4;
    return plateauY + MESA_H + noise;
  };
  return {
    mesa: { x: mesaX, z: mesaZ, topR: MESA_SUB_R * MESA_FLAT, surfaceY: mesaSurfaceY },
  };
};
