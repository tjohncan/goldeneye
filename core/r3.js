// core/r3.js — pure 3D vector math (R³) plus quaternion ops for rotation.
// Vectors are plain [x, y, z] arrays; quaternions are [w, x, y, z]. All
// operations are functional and return new arrays.

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[number, number, number, number]} Quat */

/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const add = ([ax, ay, az], [bx, by, bz]) => [ax + bx, ay + by, az + bz];

/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const sub = ([ax, ay, az], [bx, by, bz]) => [ax - bx, ay - by, az - bz];

/** @type {(a: Vec3, s: number) => Vec3} */
export const scale = ([x, y, z], s) => [x * s, y * s, z * s];

/** @type {(a: Vec3) => Vec3} */
export const neg = ([x, y, z]) => [-x, -y, -z];

/** @type {(a: Vec3, b: Vec3) => number} */
export const dot = ([ax, ay, az], [bx, by, bz]) => ax * bx + ay * by + az * bz;

/** @type {(a: Vec3, b: Vec3) => Vec3} */
export const cross = ([ax, ay, az], [bx, by, bz]) => [
  ay * bz - az * by,
  az * bx - ax * bz,
  ax * by - ay * bx,
];

/** @type {(a: Vec3) => number} */
export const len = ([x, y, z]) => Math.sqrt(x * x + y * y + z * z);

/** Squared length — use when only relative comparison matters (skips the sqrt). */
/** @type {(a: Vec3) => number} */
export const len2 = ([x, y, z]) => x * x + y * y + z * z;

/** @type {(a: Vec3, b: Vec3) => number} */
export const dist = (a, b) => len(sub(a, b));

/** @type {(a: Vec3, b: Vec3) => number} */
export const dist2 = (a, b) => len2(sub(a, b));

/** Returns origin for zero input rather than NaN. */
/** @type {(a: Vec3) => Vec3} */
export const normalize = (a) => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

/** @type {(a: Vec3, b: Vec3, t: number) => Vec3} */
export const lerp = ([ax, ay, az], [bx, by, bz], t) => [
  ax + (bx - ax) * t,
  ay + (by - ay) * t,
  az + (bz - az) * t,
];

// Rotations around principal axes, right-handed: positive theta is
// counterclockwise when viewed from the positive axis toward the origin.
// Naming is by axis of rotation (rotX rotates around X), not by plane.

/** @type {(a: Vec3, theta: number) => Vec3} */
export const rotX = ([x, y, z], theta) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x, y * c - z * s, y * s + z * c];
};

/** @type {(a: Vec3, theta: number) => Vec3} */
export const rotY = ([x, y, z], theta) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x * c + z * s, y, -x * s + z * c];
};

/** @type {(a: Vec3, theta: number) => Vec3} */
export const rotZ = ([x, y, z], theta) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [x * c - y * s, x * s + y * c, z];
};


// ─────────────────────────────── quaternions ─────────────────────────────
//
// Quaternions encode 3D orientation without the gimbal-lock failure mode of
// Euler angles — composing rotations across any orientation (loop-de-loops
// included) just works. Format: [w, x, y, z] where (x, y, z) is the vector
// part and w is the scalar part. Identity (no rotation) is [1, 0, 0, 0].
// Same +CCW-from-axis convention as rotX/Y/Z above.

/** @type {() => Quat} */
export const quatId = () => [1, 0, 0, 0];

/** Construct a quaternion from a unit axis and an angle in radians. */
/** @type {(axis: Vec3, angle: number) => Quat} */
export const quatAxisAngle = ([ax, ay, az], angle) => {
  const half = angle / 2;
  const s = Math.sin(half);
  return [Math.cos(half), ax * s, ay * s, az * s];
};

/**
 * Hamilton product. quatMul(a, b) means "apply b first, then a." For
 * local-frame composition (apply delta in the current frame), use
 * quatMul(orientation, delta).
 */
/** @type {(a: Quat, b: Quat) => Quat} */
export const quatMul = ([aw, ax, ay, az], [bw, bx, by, bz]) => [
  aw * bw - ax * bx - ay * by - az * bz,
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
];

/**
 * Renormalize to unit length. Composition can drift over many frames;
 * normalize after each composed update to prevent cumulative scale changes.
 */
/** @type {(q: Quat) => Quat} */
export const quatNormalize = ([w, x, y, z]) => {
  const l = Math.sqrt(w * w + x * x + y * y + z * z);
  return l > 0 ? [w / l, x / l, y / l, z / l] : [1, 0, 0, 0];
};

/** Apply a quaternion rotation to a Vec3. Optimized form of q * v * q^-1. */
/** @type {(q: Quat, v: Vec3) => Vec3} */
export const quatRotate = ([qw, qx, qy, qz], [vx, vy, vz]) => {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
};

/**
 * Quaternion that orients the camera-local frame (forward = -Z, up = +Y,
 * right = +X) so that camera-forward points from `eye` toward `target`,
 * with camera-up landing as close to the supplied `up` reference as
 * possible while staying perpendicular to forward.
 *
 * `up` is a HINT, not a constraint — camera-up has to be perpendicular
 * to forward, so the actual camera-up ends up being the projection of
 * `up` onto the plane perpendicular to forward (i.e., world-up with the
 * forward-aligned component removed). Defaults to [0, 1, 0] (Y-up,
 * matching the engine convention); pass a different vector to roll the
 * spawn pose around the forward axis.
 *
 * Edge cases:
 *   - target = eye returns identity (no direction to look).
 *   - forward parallel to `up` (looking straight up/down with default
 *     world-up): cross is degenerate, so we fall back to a perpendicular
 *     world axis as the up reference. The camera's roll is implementation-
 *     defined in this case — pass an explicit `up` to pin it.
 *
 * @param {Vec3} eye
 * @param {Vec3} target
 * @param {Vec3} [up=[0, 1, 0]]
 * @returns {Quat}
 */
export const quatLookAt = (eye, target, up = [0, 1, 0]) => {
  const fwd = normalize(sub(target, eye));
  if (fwd[0] === 0 && fwd[1] === 0 && fwd[2] === 0) return quatId();
  // right = forward × up. Degenerate when forward is parallel to up; pick
  // a perpendicular world axis as a fallback up reference.
  let right = cross(fwd, up);
  if (len2(right) < 1e-9) {
    const fallback = Math.abs(fwd[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    right = cross(fwd, fallback);
  }
  right = normalize(right);
  const camUp = cross(right, fwd);   // already unit-length: right ⊥ fwd, both unit
  // Build quat from the orthonormal basis. Rotation matrix columns are the
  // world-space directions of camera-local axes (right=+X, up=+Y, fwd=-Z).
  const m00 = right[0], m01 = camUp[0], m02 = -fwd[0];
  const m10 = right[1], m11 = camUp[1], m12 = -fwd[1];
  const m20 = right[2], m21 = camUp[2], m22 = -fwd[2];
  // Standard rotation-matrix-to-quaternion conversion (Shepperd's method),
  // branching on which diagonal element is largest to avoid sqrt of a
  // tiny number.
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
};
