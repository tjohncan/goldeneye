// aquarium/assets/mountains.js — discrete mountain items in the cove.
//
// Three mountains, all on the LAND side (-Z hemisphere), all anchored
// on the shack plateau:
//   - foothill at 268° (kitchen-window view direction): a small green
//     hill, fully inside the dome and not constrained to its surface.
//     Mirrors the painted hill on the kitchen window so a player
//     looking out the back of the shack sees a real-geometry version
//     of the indoor painting.
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
// Performance: bounding box anchored at MID-HEIGHT (not base) so
// the world origin sits OUTSIDE each mountain's bound and the
// per-ray cull actually rejects mountains the ray doesn't point at.
// With base anchoring, the bound would cover the world origin and
// every ray would be forced to consider every mountain per-step.

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
// Each mountain's `peaks` array of { ox, oz, h, subR, sharp } in
// mountain-local XZ. SDF takes MAX over each sub-peak's bell
// contribution. `sharp` exponent kept moderate (1.4–1.9) — keeps the
// SDF gradient at the peak from getting steep enough to cause
// marcher-overshoot artifacts ("neck disappears + dot on top" near
// a sharp summit).
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
// SDF scale 0.30 — heightfield gradient up to ~peakH/baseR (~3 for
// big mountains) plus low-frequency noise (~0.3). Conservative
// enough to keep the marcher from overshooting at sharp peaks.
const makeMountainSdf = ({ peaks, noiseSeed, peakH }) => {
  const yOff = peakH / 2;
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
        const h = p.h * Math.pow(1 - t, p.sharp);
        if (h > surfaceMax) surfaceMax = h;
        hadAny = true;
      } else {
        const rimD = r - p.subR;
        if (rimD < minRimDist) minRimDist = rimD;
      }
    }

    if (hadAny) {
      const noise = (
        Math.sin(lpx * 0.030 + noiseSeed) * Math.cos(lpz * 0.030 + noiseSeed * 1.7) +
        Math.sin(lpx * 0.080 + noiseSeed * 1.3) * Math.cos(lpz * 0.075 + noiseSeed * 0.8) * 0.4
      ) * 4;
      const surfaceH = surfaceMax + noise;
      return Math.max(lpyBase - surfaceH, -lpyBase) * 0.30;
    }
    return Math.sqrt(minRimDist * minRimDist + lpyBase * lpyBase) * 0.30;
  };
};


// ─────────────────────────── colorFns ───────────────────────────

const makeMountainColorFn = ({ hasSnow, noiseSeed, base_y, peakH }) => {
  const yOff = peakH / 2;
  return (lpx, lpy, lpz) => {
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

/**
 * Register all mountain items via the caller-supplied `add` helper
 * (typically outside.js's REGION_OUTSIDE-tagged registrar).
 *
 * Item position is at MID-HEIGHT (base_y + peakH/2) so the bounding
 * box centers there, not at the base — keeps the world origin
 * outside each item's bound so the per-ray cull actually rejects
 * mountains a ray doesn't point at.
 *
 * @param {(item: import('../../core/scene.js').Item) => void} add
 * @param {{ plateauY: number }} opts   `plateauY` is the cove's shack-
 *        plateau elevation (owned by outside.js); each mountain's base
 *        anchors here.
 */
export const addToScene = (add, { plateauY }) => {
  // Range mountain — wraps shape + dome height into a layout record.
  const range = (angle, hd, baseR, base_y, hasSnow, seed, shapeFn) => {
    const peakH = peakHeightOnDome(hd, base_y);
    return {
      angle, hd, baseR, base_y, peakH, hasSnow, noiseSeed: seed,
      peaks: shapeFn(peakH, baseR),
    };
  };

  const mountains = [
    // Foothill — kitchen-window view direction (-Z), free-standing
    // inside the dome. World peak Y = 67, all-green.
    {
      angle: 268, hd: 200, baseR: 70, base_y: plateauY, peakH: 80,
      hasSnow: false, noiseSeed: 9.1,
      peaks: [
        { ox: 0, oz: 0, h: 80, subR: 70, sharp: 1.5 },
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
};
