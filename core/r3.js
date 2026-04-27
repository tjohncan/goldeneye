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
