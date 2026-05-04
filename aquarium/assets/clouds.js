// aquarium/assets/clouds.js — drifting cloud "anchors" painted onto the sky
// firmament of the outside zone. Sampled per pixel by firmamentColorFn;
// otherwise invisible to the rest of the engine.
//
// Stateless across frames except for a small per-frame cache. Each cloud
// slot's parameters are pure functions of (slot index, frameTime), so
// every cloud drifts within a CYCLE_LENGTH-second birth → drift → death
// cycle, then re-randomizes its position + silhouette + tint at each
// epoch boundary via stable hashing of (slot, epoch). Visually that
// reads as "an old cloud faded out, a new one was born somewhere
// fresh" without any persistent state to manage.
//
// Each cloud is a two-tier cluster of NUM_LOBES tangent-plane sub-
// spheres at the cloud's center direction on the firmament. Per pixel:
// a dot-product reject knocks out far-away clouds first, then per-lobe
// distance checks build the cloud's silhouette. Per-frame state
// (center vector, tangent basis, sub-lobe layout) is cached once per
// frame in _cachedStates so the per-pixel hot path stays trig-free.

import { frameTime } from '../../core/tracer.js';

// Total cloud slots across both layers (white upper + grey lower).
// Each layer reads 7 slots; with slot-key differentiation the two
// layers get fully independent cloud parameters (different sub-lobe
// layouts, sizes, drifts, tints) — no shape duplicates across layers.
const NUM_CLOUDS_PER_LAYER = 7;
const NUM_CLOUDS = NUM_CLOUDS_PER_LAYER * 2;

// One cloud's full birth → drift → death cycle in seconds. Tuned so a
// minute of staring shows clear composition turnover (a cloud or two
// dies + is reborn somewhere fresh).
const CYCLE_LENGTH = 110;

// Fade-in / fade-out duration in seconds. Cloud opacity ramps linearly
// 0 → 1 over the first FADE_DURATION_S of each cycle, holds at 1 for
// the middle, then ramps 1 → 0 over the final FADE_DURATION_S.
// Visible turnover stays slow (clouds appear and disappear gradually).
const FADE_DURATION_S = 15;
const FADE_FRACTION   = FADE_DURATION_S / CYCLE_LENGTH;

// Cloud silhouette is a two-tier cluster: NUM_PRIMARY large "primary"
// puffs around the cloud center, each with NUM_SATELLITE smaller
// "satellite" puffs budding from its outer edge — i.e. each satellite
// is attached at a sensible point on its parent's silhouette so the
// whole cluster reads as a single complex cumulus rather than scattered
// blobs. Total lobes = NUM_PRIMARY × (1 + NUM_SATELLITE).
const NUM_PRIMARY   = 3;
const NUM_SATELLITE = 3;
const NUM_LOBES     = NUM_PRIMARY * (1 + NUM_SATELLITE);

// Edge softness (in tangent-plane units ≈ radians) over which a lobe's
// silhouette opacity ramps from 1 → 0. Small = crisper edges; bigger
// would blur the puffs together.
const EDGE_WIDTH = 0.015;

// Per-slot phase offsets — one slot's birth time relative to the others.
// Even spread across the cycle so deaths/births are spread evenly in
// time and the sky always has clouds in various life stages.
const PHASE_OFFSETS = [];
for (let i = 0; i < NUM_CLOUDS; i++) PHASE_OFFSETS.push((i / NUM_CLOUDS) * CYCLE_LENGTH);

// Deterministic [0, 1) hash. Each (slot, epoch, channel) triple maps to
// a stable random-looking value — different channels give independent
// "rolls" for the cloud's various parameters at that epoch. Same trick
// as the classic GLSL `fract(sin(dot(...)) * big)` hash.
const hash01 = (a, b, c) => {
  const x = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return x - Math.floor(x);
};

// Per-frame cache: one state object per cloud slot. Refreshed exactly
// once per frame (gated by _cachedAtTime) so per-pixel sampleClouds()
// just reads precomputed fields — no trig in the hot loop.
const _cachedStates = [];
for (let i = 0; i < NUM_CLOUDS; i++) {
  const lobeOx = [], lobeOy = [], lobeR = [];
  for (let j = 0; j < NUM_LOBES; j++) { lobeOx.push(0); lobeOy.push(0); lobeR.push(0); }
  _cachedStates.push({
    active: false,
    cx: 0, cy: 0, cz: 0,                     // center unit direction on the dome
    rx: 0, ry: 0, rz: 0,                     // tangent-frame "right" axis (u)
    fx: 0, fy: 0, fz: 0,                     // tangent-frame "forward" axis (v)
    cosMaxAng: 0,                            // precomputed reject threshold
    fade: 0,                                 // 0..1 birth/death envelope
    flatness: 1,                             // tangent-Y squash factor
    lobeOx, lobeOy, lobeR,                   // sub-lobe (u, v) centers + radii
    maxLobeR: 0,                             // largest sub-lobe radius (per-cloud depth normalizer)
    tintR: 240, tintG: 240, tintB: 240,
  });
}
let _cachedAtTime = -1;

const refreshCloudCache = () => {
  if (frameTime === _cachedAtTime) return;
  _cachedAtTime = frameTime;
  const t = frameTime / 1000;

  for (let slot = 0; slot < NUM_CLOUDS; slot++) {
    const state = _cachedStates[slot];

    const phased = t + PHASE_OFFSETS[slot];
    const cycleT = (phased / CYCLE_LENGTH) % 1;            // 0..1 within current cycle
    // Linear ramp up over FADE_FRACTION, plateau at 1, linear ramp
    // down over FADE_FRACTION. Gives a long visible plateau with a
    // slow fade in and out at the cycle boundaries.
    const fade = cycleT < FADE_FRACTION
      ? cycleT / FADE_FRACTION
      : cycleT > 1 - FADE_FRACTION
        ? (1 - cycleT) / FADE_FRACTION
        : 1;

    if (fade < 0.01) { state.active = false; continue; }
    state.active = true;
    state.fade = fade;

    // Epoch advances at each cycle boundary; everything below is hashed
    // against (slot, epoch) so every fresh cycle = fresh cloud personality.
    const epoch = Math.floor(phased / CYCLE_LENGTH);

    const baseAzim   = hash01(slot, epoch, 1) * Math.PI * 2;
    const baseElev   = 0.44 + hash01(slot, epoch, 2) * 0.67;   // 0.44..1.11 rad above horizon — above mountain peaks, below the sun
    const size       = 0.09 + hash01(slot, epoch, 3) * 0.18;   // 5°..15° angular radius
    const flatness   = 0.7  + hash01(slot, epoch, 4) * 1.5;    // 0.7..2.2 vertical squash
    const driftAzim  = (hash01(slot, epoch, 5) - 0.5) * 0.18;  // total azim drift across cycle
    const driftElev  = (hash01(slot, epoch, 6) - 0.5) * 0.04;

    // Drift cycleT-linearly across the cycle; cloud center advances
    // smoothly from baseAzim/baseElev to baseAzim+driftAzim / baseElev+driftElev.
    const azim = baseAzim + driftAzim * cycleT;
    const elev = baseElev + driftElev * cycleT;
    const cosE = Math.cos(elev);
    state.cx = cosE * Math.sin(azim);
    state.cy = Math.sin(elev);
    state.cz = cosE * Math.cos(azim);
    state.flatness  = flatness;
    // Reject cone covers cloud center + farthest possible satellite:
    // primary at up to 0.4×size out, with a satellite attached at the
    // primary's edge (up to 0.8×size further) and own radius up to
    // 0.55×size. Worst-case extent ≈ 1.75×size; cone of 2×size is safe.
    state.cosMaxAng = Math.cos(size * 2.0);

    // Tangent basis at the cloud center. World up is (0, 1, 0); for a
    // near-zenith cloud (cy ~ 1) world up is parallel to center, giving
    // a degenerate cross — fall back to +X. Cove clouds spawn at
    // elev ≤ 1.11 rad (cy ≤ 0.90) so this fallback shouldn't trigger,
    // but kept for safety.
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(state.cy) > 0.95) { upX = 1; upY = 0; upZ = 0; }
    let rxRaw = upY * state.cz - upZ * state.cy;
    let ryRaw = upZ * state.cx - upX * state.cz;
    let rzRaw = upX * state.cy - upY * state.cx;
    const rLen = Math.sqrt(rxRaw * rxRaw + ryRaw * ryRaw + rzRaw * rzRaw);
    state.rx = rxRaw / rLen;
    state.ry = ryRaw / rLen;
    state.rz = rzRaw / rLen;
    state.fx = state.cy * state.rz - state.cz * state.ry;
    state.fy = state.cz * state.rx - state.cx * state.rz;
    state.fz = state.cx * state.ry - state.cy * state.rx;

    // Two-tier sub-lobe layout: primary puffs around the cloud center,
    // each with satellite puffs attached at its outer edge so the whole
    // silhouette reads as one organically-grown cumulus cluster.
    const lobeSeed = epoch * 100 + slot;
    let lobeIdx = 0;
    let maxLobeR = 0;
    for (let p = 0; p < NUM_PRIMARY; p++) {
      // Primary puff — modest distance from cloud center, chunky size.
      const pAng = hash01(lobeSeed, p, 11) * Math.PI * 2;
      const pRad = hash01(lobeSeed, p, 12) * 0.4 * size;       // 0..0.4 × size from cloud center
      const pR   = (0.50 + hash01(lobeSeed, p, 13) * 0.30) * size;  // primary radius 0.5..0.8 × size
      const pOx  = Math.cos(pAng) * pRad;
      const pOy  = Math.sin(pAng) * pRad;
      state.lobeOx[lobeIdx] = pOx;
      state.lobeOy[lobeIdx] = pOy;
      state.lobeR[lobeIdx]  = pR;
      if (pR > maxLobeR) maxLobeR = pR;
      lobeIdx++;

      // Satellites attached to this primary's edge — angle around the
      // primary, attachment radius = (0.7..1.0) × primary radius (so the
      // satellite center sits at the primary's silhouette boundary,
      // visibly poking out rather than nested inside).
      for (let s = 0; s < NUM_SATELLITE; s++) {
        const sChan    = p * 10 + s;
        const sAng     = hash01(lobeSeed, sChan, 14) * Math.PI * 2;
        const sAttach  = pR * (0.7 + hash01(lobeSeed, sChan, 15) * 0.3);
        const sR       = (0.25 + hash01(lobeSeed, sChan, 16) * 0.30) * size;
        state.lobeOx[lobeIdx] = pOx + Math.cos(sAng) * sAttach;
        state.lobeOy[lobeIdx] = pOy + Math.sin(sAng) * sAttach;
        state.lobeR[lobeIdx]  = sR;
        if (sR > maxLobeR) maxLobeR = sR;
        lobeIdx++;
      }
    }
    state.maxLobeR = maxLobeR;

    // Tint — bright white-cream with subtle per-cloud variation.
    state.tintR = 235 + hash01(slot, epoch, 7) * 20;
    state.tintG = 235 + hash01(slot, epoch, 8) * 18;
    state.tintB = 230 + hash01(slot, epoch, 9) * 22;
  }
};

// Module-level scratch buffer:
//   [0] totalOp           — alpha-composited cloud opacity at this direction
//   [1..3] premultR/G/B   — alpha-premultiplied cloud color
//   [4] maxLobeOp         — un-faded peak lobe contribution (clamped 0..1),
//                           used by the cloud overlay caller to derive
//                           effective fade via cloudOp / maxLobeOp
//   [5] maxNormalizedDepth — depth into the deepest contributing lobe,
//                            normalized by THAT cloud's max lobe radius
//                            (range 0 at edge → 1 at deepest core); used
//                            for pure-radial materialization order so the
//                            cloud's silhouette grows from center outward
//                            during fade-in, shrinks the same on fade-out.
const _cloudOut = [0, 0, 0, 0, 0, 0];

/**
 * Sample the cloud field at a unit dome direction for a given layer
 * (0 = upper white, 1 = lower grey). Each layer reads a disjoint
 * range of cloud slots (0..6 vs 7..13) so the two layers render fully
 * independent cloud silhouettes — no shape duplicates. Returns a
 * shared scratch buffer [opacity, r, g, b, maxLobeOp, maxNormalizedDepth].
 *
 * @param {number} nx @param {number} ny @param {number} nz  unit direction
 * @param {number} [layerIdx=0]                              which layer's slot range to read
 * @returns {number[]}                                       scratch buffer — consume immediately
 */
export const sampleClouds = (nx, ny, nz, layerIdx = 0) => {
  refreshCloudCache();

  let totalOp = 0;
  let totalR = 0, totalG = 0, totalB = 0;
  let maxLobeOp = 0;
  let maxNormalizedDepth = 0;

  const slotStart = layerIdx * NUM_CLOUDS_PER_LAYER;
  const slotEnd   = slotStart + NUM_CLOUDS_PER_LAYER;
  for (let slot = slotStart; slot < slotEnd; slot++) {
    const c = _cachedStates[slot];
    if (!c.active) continue;

    // Fast reject: if the pixel direction is outside the cloud's
    // generous reject cone, skip the per-lobe work entirely.
    const dot = nx * c.cx + ny * c.cy + nz * c.cz;
    if (dot < c.cosMaxAng) continue;

    // Project the pixel direction onto the cloud's tangent (u, v) plane.
    // For small angular offsets these (u, v) values are approximately
    // angular distance components — accurate enough for cloud-shape
    // purposes within our max angular size (~12°).
    const u = nx * c.rx + ny * c.ry + nz * c.rz;
    const v = (nx * c.fx + ny * c.fy + nz * c.fz) * c.flatness;

    // Min-distance over the sub-lobes = sharp union of lobes' silhouettes.
    // Min keeps inter-lobe creases visible so the cloud reads as a
    // cluster of puffs, not a single blob.
    let minDist = Infinity;
    for (let i = 0; i < NUM_LOBES; i++) {
      const du = u - c.lobeOx[i];
      const dv = v - c.lobeOy[i];
      const d = Math.sqrt(du * du + dv * dv) - c.lobeR[i];
      if (d < minDist) minDist = d;
    }
    if (minDist >= 0) continue;                                // outside all lobes

    const depth = -minDist;                                    // distance into cloud, positive
    let op = depth / EDGE_WIDTH;
    if (op > 1) op = 1;
    if (op > maxLobeOp) maxLobeOp = op;

    // Per-cloud-normalized depth: 1 at deepest possible point in this
    // cloud (lobe centers of the biggest sub-lobe), 0 at any lobe's
    // boundary. Used by cloud shell for radial materialization order.
    const normalizedDepth = depth / c.maxLobeR;
    if (normalizedDepth > maxNormalizedDepth) maxNormalizedDepth = normalizedDepth;

    const cloudOp = op * c.fade;
    const w = cloudOp * (1 - totalOp);                         // remaining alpha after over-blending
    totalR += c.tintR * w;
    totalG += c.tintG * w;
    totalB += c.tintB * w;
    totalOp += w;
    if (totalOp > 0.99) break;                                 // saturated; further clouds invisible
  }

  _cloudOut[0] = totalOp;
  _cloudOut[1] = totalR;
  _cloudOut[2] = totalG;
  _cloudOut[3] = totalB;
  _cloudOut[4] = maxLobeOp;
  _cloudOut[5] = maxNormalizedDepth;
  return _cloudOut;
};
