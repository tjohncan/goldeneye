// core/scene.js — Scene + Item primitives, SDF combinators, and transforms.
//
// A Scene is a flat array of Items. Each Item has a color, a world-space
// position, and an SDF (signed distance function) that takes a LOCAL-space
// point (already translated by the tracer) and returns the signed distance to
// the item's surface.
//
// SDFs take three raw numbers rather than a Vec3 to avoid per-call allocation
// in the tracer's hot loop. Compose primitives with combinators
// (union/subtract/smoothUnionSDF/invert) and transforms (translate/rotateY) to
// build arbitrary shapes; the result is just another SDF.

/** @typedef {import('./r3.js').Vec3} Vec3 */
/** @typedef {(px: number, py: number, pz: number) => number} SDF */

/**
 * @typedef {string | number} RegionKey
 */

/**
 * @typedef {{
 *   name?: string,
 *   color: Vec3,            // [r, g, b] in 0-255 — fallback / used when colorFn absent
 *   colorFn?: (lpx: number, lpy: number, lpz: number) => Vec3,
 *                           // optional spatial color in local space; called at hit
 *                           // (not per-step), so cost is amortized. Lets one Item
 *                           // carry patterns (planks, chessboard, painted-on details)
 *                           // without inflating scene size.
 *   position: Vec3,         // world-space center of the item's local frame
 *   sdf: SDF,               // signed distance in the item's local frame
 *   invisible?: boolean,    // skip in tracer (still considered by physics)
 *   opacity?: number,       // surface alpha 0..1; default 1 (opaque). Translucent
 *                           // items contribute color and let rays continue past.
 *   collides?: boolean,     // whether physics treats as solid (default true).
 *                           // Set false for items the camera should pass through.
 *   boundingRadius?: number, // if set, the tracer's per-ray bounding-sphere
 *                           // filter drops the item from a ray's candidate
 *                           // list when the ray's bounding sphere doesn't
 *                           // intersect this radius around `position`. Items
 *                           // WITHOUT this field (or boundingBox) are never
 *                           // filtered — for items whose extent isn't
 *                           // usefully bounded (enclosing shells, ground
 *                           // planes, sky shells).
 *   boundingBox?: Vec3,     // alternative to boundingRadius — world-axis-
 *                           // aligned half-extents [hx, hy, hz] of a box
 *                           // around `position`. Tighter than a sphere for
 *                           // flat or elongated items, where the sphere
 *                           // has to enclose the diagonal and burns volume
 *                           // on the empty axes. Tracer prefers boundingBox
 *                           // when both are set.
 *   regionKey?: RegionKey | RegionKey[],
 *                           // if set together with `Scene.regionFn`, the
 *                           // tracer's per-step region filter only considers
 *                           // this item when the current ray-step point's
 *                           // region matches. A single key restricts the
 *                           // item to one region; an array registers it to
 *                           // multiple (useful for items that legitimately
 *                           // straddle a region boundary — e.g., a thin
 *                           // disk parked at the seam between two zones —
 *                           // so sphere-trace doesn't overstep them during
 *                           // the wrong region's marching). Items WITHOUT
 *                           // a regionKey are always considered — for
 *                           // truly scene-spanning surfaces (enclosing
 *                           // shells, ground planes, sky shells).
 *   _regionKeySet?: Set<RegionKey>,
 *                           // internal: populated by registerItem when
 *                           // regionKey is an array, so per-step / per-
 *                           // iteration region filters can use Set.has()
 *                           // instead of dispatching on Array.isArray +
 *                           // indexOf. Don't set manually — registerItem
 *                           // owns this field.
 * }} Item
 */

/**
 * Scenes are arrays of Items. They may optionally carry two region
 * helpers, both consulted by the tracer when present:
 *
 *   - `regionFn`: maps a world-space point to a region key. Used by the
 *     tracer's per-step cull: items whose regionKey doesn't match the
 *     current ray-step point's region are skipped during marching.
 *
 *   - `visibleRegions`: declares which regions a ray ORIGINATING in a
 *     given region can possibly reach. The tracer uses it to pre-cull
 *     items whose region is unreachable from the camera, before the
 *     per-ray bounding-sphere filter — saves iterations in scenes with
 *     isolated zones (e.g., a fully sealed outdoor area). Items with an
 *     array regionKey pass if ANY key is in the camera region's
 *     visible set. Items without a regionKey always pass. The camera's
 *     own region must be listed explicitly in its entry's array.
 *
 * If `regionFn` is absent, both `regionKey` and `visibleRegions` are
 * ignored (full scene considered for every ray). If `visibleRegions` is
 * absent but `regionFn` is present, only the per-step cull runs.
 *
 * @typedef {Item[] & {
 *   regionFn?:       (px: number, py: number, pz: number) => (RegionKey | null),
 *   visibleRegions?: Record<string, RegionKey[]>,
 * }} Scene
 */

/** @returns {Scene} */
export const createScene = () => [];

/**
 * @param {Scene} scene
 * @param {Item} item
 * @returns {Item} the item just registered (same reference passed in)
 */
export const registerItem = (scene, item) => {
  // Pre-classify the regionKey shape so the per-step region filter in
  // the marcher can avoid Array.isArray on every per-item check. Items
  // with array regionKey get a Set sibling for fast has() lookup;
  // single-key and no-key items skip the field entirely (the hot path
  // distinguishes via `_regionKeySet === undefined`).
  if (Array.isArray(item.regionKey)) {
    item._regionKeySet = new Set(item.regionKey);
  }
  scene.push(item);
  return item;
};



// ────────────────────────────── primitives ──────────────────────────────

/** Sphere of given radius, centered at the local origin. */
/** @type {(radius: number) => SDF} */
export const sphereSDF = (radius) => (px, py, pz) =>
  Math.sqrt(px * px + py * py + pz * pz) - radius;

/** Axis-aligned box centered at the local origin; takes half-extents. */
/** @type {(halfExtents: Vec3) => SDF} */
export const boxSDF = ([hx, hy, hz]) => (px, py, pz) => {
  const dx = Math.abs(px) - hx;
  const dy = Math.abs(py) - hy;
  const dz = Math.abs(pz) - hz;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const oz = Math.max(dz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside  = Math.min(Math.max(dx, Math.max(dy, dz)), 0);
  return outside + inside;
};

/**
 * Infinite plane through the local origin with the given (assumed unit)
 * normal. `offset` shifts the plane along the normal by that distance.
 * Positive SDF on the side the normal points toward.
 */
/** @type {(normal: Vec3, offset?: number) => SDF} */
export const planeSDF = ([nx, ny, nz], offset = 0) => (px, py, pz) =>
  px * nx + py * ny + pz * nz - offset;

/**
 * Capsule of given radius along a line segment centered at the local origin
 * along the Y axis, extending from -halfHeight to +halfHeight.
 */
/** @type {(halfHeight: number, radius: number) => SDF} */
export const capsuleSDF = (halfHeight, radius) => (px, py, pz) => {
  const cy = Math.max(-halfHeight, Math.min(halfHeight, py));
  const dy = py - cy;
  return Math.sqrt(px * px + dy * dy + pz * pz) - radius;
};

/**
 * Capsule between two arbitrary 3D points with the given radius — a smooth
 * tube with hemispherical caps. Cleaner than chains of sphere SDFs for limbs
 * and connectors; no bulging at segment-center points.
 */
/** @type {(a: Vec3, b: Vec3, radius: number) => SDF} */
export const capsuleBetweenSDF = ([ax, ay, az], [bx, by, bz], radius) => {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  return (px, py, pz) => {
    const lpx = px - ax, lpy = py - ay, lpz = pz - az;
    let t = (lpx * dx + lpy * dy + lpz * dz) / lenSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cpx = lpx - dx * t, cpy = lpy - dy * t, cpz = lpz - dz * t;
    return Math.sqrt(cpx * cpx + cpy * cpy + cpz * cpz) - radius;
  };
};

/**
 * Cylinder centered at the local origin along the Y axis, total height
 * 2*halfHeight, with the given radius.
 *
 * Cheap form: outside-distance is exact (Euclidean to the nearest face,
 * accounting for the rounded edge where side meets cap). Inside-distance
 * is `min(max(dr, dy), 0)` — accurate near a single bounding face but
 * understated near the inside corner where side and cap meet, where the
 * true nearest-surface distance is the diagonal to that corner. The
 * marcher and physics consume only the sign and the outside step
 * distance, so neither cares; a precise inside-overlap measurement
 * (e.g., a deep penetration test) would need the corrected form.
 */
/** @type {(halfHeight: number, radius: number) => SDF} */
export const cylinderSDF = (halfHeight, radius) => (px, py, pz) => {
  const dr = Math.sqrt(px * px + pz * pz) - radius;
  const dy = Math.abs(py) - halfHeight;
  const ox = Math.max(dr, 0);
  const oy = Math.max(dy, 0);
  return Math.min(Math.max(dr, dy), 0) + Math.sqrt(ox * ox + oy * oy);
};

/**
 * Open-top bowl: a thin spherical shell (between innerR and outerR) that
 * exists only below Y = rimY. Above the rim there is no wall — air
 * continues upward, so a viewer inside the bowl can look up through the
 * open top into whatever else is in the scene above.
 *
 * Returns a regular SDF (negative inside the wall material, positive in
 * air). Marching outward from the interior: the SDF approaches zero at
 * the inner wall (r = innerR), goes negative inside the shell, and
 * returns to positive outside (r > outerR). Above the rim, the
 * (py - rimY) term keeps the SDF positive everywhere — the open top
 * never reads as a hit.
 */
/** @type {(opts: { outerR: number, innerR: number, rimY: number }) => SDF} */
export const openTopBowlSDF = ({ outerR, innerR, rimY }) => (px, py, pz) => {
  const r = Math.sqrt(px * px + py * py + pz * pz);
  return Math.max(innerR - r, r - outerR, py - rimY);
};


// ───────────────────────── boolean combinators ──────────────────────────

/** Sharp union (visual: A ∪ B). */
/** @type {(...sdfs: SDF[]) => SDF} */
export const unionSDF = (...sdfs) => (px, py, pz) => {
  let d = Infinity;
  for (let i = 0; i < sdfs.length; i++) {
    const di = sdfs[i](px, py, pz);
    if (di < d) d = di;
  }
  return d;
};

/** Intersection (visual: A ∩ B). */
/** @type {(...sdfs: SDF[]) => SDF} */
export const intersectionSDF = (...sdfs) => (px, py, pz) => {
  let d = -Infinity;
  for (let i = 0; i < sdfs.length; i++) {
    const di = sdfs[i](px, py, pz);
    if (di > d) d = di;
  }
  return d;
};

/**
 * Cut `remove` out of `from`. Result = from \ remove.
 *
 * Pitfall: when the carve is supposed to open onto a face of `from` (e.g.,
 * a slot punched through the front of a box), make `remove` extend past
 * `from` in those dimensions. Two failure modes if you don't:
 *
 *   1. RENDERING: with no overlap (boundaries exactly coincident), both
 *      `from` and `remove` report SDF = 0 along the shared face, cutSDF
 *      returns 0, and the marcher reads it as a hit — the hole's edge
 *      renders as a thin solid skin instead of an open opening.
 *
 *   2. COLLISION: with a small overlap, the SDF dips in the overlap region
 *      just outside `from`'s face (min depth ≈ overlap / 2). If a
 *      collision-radius-`r` mover tries to traverse the opening, it'll be
 *      pushed back when the dip falls below `r`. Use overlap > 2r.
 *
 * Rendering-only carves (no traversal) can use as little as 0.1.
 */
/** @type {(remove: SDF, from: SDF) => SDF} */
export const cutSDF = (remove, from) => (px, py, pz) =>
  Math.max(-remove(px, py, pz), from(px, py, pz));

/**
 * Like cutSDF but cheap when the query point is far from the cut tool. The
 * tool is assumed fully contained in sphere(removeCenter, removeBoundR);
 * outside that sphere, tool(p) > 0 (no carved material), so cutSDF
 * collapses to base(p) and we skip the tool eval entirely. Inside the
 * sphere, identical to cutSDF.
 *
 * Useful when a small cut tool localizes within a much larger always-
 * considered base (e.g., a shaped hole punched through an enclosing
 * shell): the base's SDF gets queried every step it stays in scope,
 * but the tool exists in just one neighborhood — shortcut bails out
 * of the tool eval for the steps that are far from the tool.
 *
 * Bound MUST fully enclose the tool's MATERIAL (where tool ≤ 0).
 * Margin past the worst-case tool-surface distance depends on the
 * consumer:
 *   - Rendering only: margin > HIT_EPSILON (~0.001) avoids ghost-pixel
 *     artifacts at the tool surface.
 *   - Physics-traversed (a mover-radius collider must be able to swim
 *     through the carved volume): margin ≥ MOVER_RADIUS. Otherwise
 *     when the mover's center crosses the bound boundary while still
 *     inside the carved tool's neighborhood, the shortcut returns the
 *     base SDF (much more negative than reality), and the collider's
 *     overlap-resolver pushes along the BASE gradient — which is
 *     usually wrong direction for the carved volume, slingshotting
 *     the mover out of the tunnel. Use the larger margin if either
 *     applies; both apply for any cut a collider traverses.
 *
 * The same enclosure rule is load-bearing for any consumer that reads
 * the SDF MAGNITUDE outside the bound: real cut(p) is max(-tool, base),
 * but the shortcut returns base(p) — a value MORE NEGATIVE than reality
 * when the point is inside `from` material near the tool (the shortcut
 * reads as if the point is deeper inside the carved item than it
 * actually is). Sign always agrees, so the marcher (which only
 * consumes sign + outside-step distance) is unaffected; a numeric-
 * overlap consumer that uses the depth therefore over-estimates
 * penetration by up to tool(p) at the bound surface. In practice the
 * gap is bounded by the margin chosen above.
 *
 * Bound coords match the frame the SDFs are combined in (world if both
 * SDFs are world-frame; item-local if base is in item-local and tool was
 * wrapped to match — translate the bound center the same way).
 */
/** @type {(remove: SDF, from: SDF, removeCenter: Vec3, removeBoundR: number) => SDF} */
export const cutSDFCullable = (remove, from, [cx, cy, cz], r) => {
  const r2 = r * r;
  return (px, py, pz) => {
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    if (dx * dx + dy * dy + dz * dz > r2) return from(px, py, pz);
    return Math.max(-remove(px, py, pz), from(px, py, pz));
  };
};

/**
 * Like cutSDFCullable but with an axis-aligned box bound instead of a
 * sphere — tighter for elongated or box-shaped tools, where a sphere
 * bound has to enclose the diagonal and burns volume on the empty axes.
 *
 * `removeHalf` is the world-axis-aligned half-extents around `removeCenter`.
 * Same coord-frame rule as the sphere variant.
 */
/** @type {(remove: SDF, from: SDF, removeCenter: Vec3, removeHalf: Vec3) => SDF} */
export const cutSDFCullableBox = (remove, from, [cx, cy, cz], [hx, hy, hz]) =>
  (px, py, pz) => {
    if (Math.abs(px - cx) > hx ||
        Math.abs(py - cy) > hy ||
        Math.abs(pz - cz) > hz) return from(px, py, pz);
    return Math.max(-remove(px, py, pz), from(px, py, pz));
  };

/**
 * Smooth union — like unionSDF but with rounded blending where surfaces meet.
 * `k` is the smoothing radius in world units; small k ≈ sharp, larger k
 * (try 0.1–0.5) gives blob-like rounded transitions. Used for organic shapes
 * — clusters of jittered spheres, soft-bodied joins, branching forms.
 * Don't pass k = 0.
 *
 * Implementation: nested polynomial smooth-min from Inigo Quilez. Faster than
 * the exponential variant — no exp/log in the hot loop.
 */
/** @type {(k: number, ...sdfs: SDF[]) => SDF} */
export const smoothUnionSDF = (k, ...sdfs) => (px, py, pz) => {
  let result = sdfs[0](px, py, pz);
  for (let i = 1; i < sdfs.length; i++) {
    const d = sdfs[i](px, py, pz);
    const h = Math.max(k - Math.abs(d - result), 0) / k;
    result = Math.min(result, d) - h * h * k * 0.25;
  }
  return result;
};

/**
 * Generic SDF inverter — flips inside and outside. Used to make "interior"
 * surfaces of any closed shape (e.g., a room from a box).
 */
/** @type {(sdf: SDF) => SDF} */
export const invertSDF = (sdf) => (px, py, pz) => -sdf(px, py, pz);


// ─────────────────────────────── transforms ──────────────────────────────

/** Translate an SDF by [dx, dy, dz] in its parent frame. */
/** @type {(offset: Vec3, sdf: SDF) => SDF} */
export const translateSDF = ([dx, dy, dz], sdf) => (px, py, pz) =>
  sdf(px - dx, py - dy, pz - dz);

/**
 * Rotate an SDF by `theta` radians around the Y axis. Uses the same
 * +CCW-from-above convention as r3.rotY (so positive theta visually rotates
 * the shape counterclockwise when viewed from above).
 */
/** @type {(theta: number, sdf: SDF) => SDF} */
export const rotateYSDF = (theta, sdf) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return (px, py, pz) => sdf(px * c - pz * s, py, px * s + pz * c);
};

/**
 * Rotate an SDF by `theta` radians around the X axis. Same +CCW-from-axis
 * convention as r3.rotX (looking from +X toward origin: positive theta takes
 * +Y toward +Z, equivalently +Z toward -Y). For "pitch nose up" of a shape
 * built bow-forward along +Z, pass a negative theta.
 */
/** @type {(theta: number, sdf: SDF) => SDF} */
export const rotateXSDF = (theta, sdf) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return (px, py, pz) => sdf(px, py * c + pz * s, -py * s + pz * c);
};

/**
 * Rotate an SDF by `theta` radians around the Z axis. Same +CCW-from-axis
 * convention as r3.rotZ (looking from +Z toward origin: positive theta takes
 * +X toward +Y).
 */
/** @type {(theta: number, sdf: SDF) => SDF} */
export const rotateZSDF = (theta, sdf) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return (px, py, pz) => sdf(px * c + py * s, -px * s + py * c, pz);
};


// ─────────────────────────── differential ops ───────────────────────────

/** Module-level scratch buffer for sdfGrad's return value — reused across
 *  calls so the hot loop doesn't allocate a fresh [gx, gy, gz] per hit.
 *  Callers must consume (typically destructure) before the next sdfGrad
 *  call. JS is single-threaded and tracer/physics use it synchronously. */
const _gradOut = [0, 0, 0];

/**
 * Forward finite-difference gradient of an SDF at a local-space point. Caller
 * supplies the precomputed center distance so the helper does only 3 SDF
 * evaluations instead of 4. Returns the unnormalized gradient vector — caller
 * normalizes if needed.
 *
 * The returned Vec3 is a shared module-level buffer; consume before the next
 * sdfGrad call.
 *
 * @param {SDF} sdf
 * @param {number} lpx        item-local x
 * @param {number} lpy        item-local y
 * @param {number} lpz        item-local z
 * @param {number} centerD    precomputed sdf(lpx, lpy, lpz)
 * @param {number} eps        finite-difference step size
 * @returns {Vec3}            [gx, gy, gz]
 */
export const sdfGrad = (sdf, lpx, lpy, lpz, centerD, eps) => {
  _gradOut[0] = sdf(lpx + eps, lpy, lpz) - centerD;
  _gradOut[1] = sdf(lpx, lpy + eps, lpz) - centerD;
  _gradOut[2] = sdf(lpx, lpy, lpz + eps) - centerD;
  return _gradOut;
};
