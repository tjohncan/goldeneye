// aquarium/clouds.js — drifting cloud "anchors" painted onto the sky dome
// of the outside zone. Sampled per dome-pixel by domeColorFn; otherwise
// invisible to the rest of the engine.
//
// Stateless across frames except for a small per-frame cache. Each cloud
// slot's parameters are pure functions of (slot index, frameTime), so
// every cloud drifts within a CYCLE_LENGTH-second birth → drift → death
// cycle, then re-randomizes its position + silhouette + tint at each
// epoch boundary via stable hashing of (slot, epoch). Visually that
// reads as "an old cloud faded out, a new one was born somewhere
// fresh" without any persistent state to manage.
//
// Each cloud is a smooth-cluster of NUM_LOBES tangent-plane sub-spheres
// at the cloud's center direction on the dome. Per pixel: a dot-product
// reject knocks out far-away clouds first, then 4 sub-lobe distance
// checks build the cloud's silhouette. Per-frame state (center vector,
// tangent basis, sub-lobe layout) is cached once per frame in
// _cachedStates so the per-pixel hot path stays trig-free.

import { frameTime } from '../core/tracer.js';

// Number of concurrent cloud slots in the sky. Phase-staggered so they
// don't all fade at the same time.
const NUM_CLOUDS = 7;

// One cloud's full birth → drift → death cycle in seconds. Tuned so a
// minute of staring shows clear composition turnover (a cloud or two
// dies + is reborn somewhere fresh).
const CYCLE_LENGTH = 110;

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
    const fade = Math.sin(Math.PI * cycleT);               // smooth birth → peak → death

    if (fade < 0.01) { state.active = false; continue; }
    state.active = true;
    state.fade = fade;

    // Epoch advances at each cycle boundary; everything below is hashed
    // against (slot, epoch) so every fresh cycle = fresh cloud personality.
    const epoch = Math.floor(phased / CYCLE_LENGTH);

    const baseAzim   = hash01(slot, epoch, 1) * Math.PI * 2;
    const baseElev   = 0.20 + hash01(slot, epoch, 2) * 0.70;   // 0.2..0.9 rad above horizon
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
    // elev ≤ 0.9 rad (cy ≤ 0.78) so this fallback shouldn't trigger,
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
        lobeIdx++;
      }
    }

    // Tint — bright white-cream with subtle per-cloud variation.
    state.tintR = 235 + hash01(slot, epoch, 7) * 20;
    state.tintG = 235 + hash01(slot, epoch, 8) * 18;
    state.tintB = 230 + hash01(slot, epoch, 9) * 22;
  }
};

// Module-level scratch buffer: [accumulatedOpacity, premultR, premultG, premultB].
// Values 1..3 are alpha-premultiplied so the dome colorFn can mix as
// `sky * (1 - op) + premult` without re-multiplying.
const _cloudOut = [0, 0, 0, 0];

/**
 * Sample the cloud field at a unit dome direction. Returns a shared
 * scratch buffer [opacity, r, g, b] where r/g/b are alpha-premultiplied.
 * The caller (domeColorFn) mixes as: sky * (1 - opacity) + [r, g, b].
 *
 * @param {number} nx @param {number} ny @param {number} nz  unit direction
 * @returns {number[]}                       [opacity, r, g, b], scratch — consume immediately
 */
export const sampleClouds = (nx, ny, nz) => {
  refreshCloudCache();

  let totalOp = 0;
  let totalR = 0, totalG = 0, totalB = 0;

  for (let slot = 0; slot < NUM_CLOUDS; slot++) {
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

    // Soft edge: opacity ramps from 0 at lobe boundary to 1 over EDGE_WIDTH.
    let op = -minDist / EDGE_WIDTH;
    if (op > 1) op = 1;

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
  return _cloudOut;
};
