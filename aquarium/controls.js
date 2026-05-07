// aquarium/controls.js — pointer-based 3D swim controls with fish-like coast.
//
// Hold the pointer down on the host element to swim. Pointer position
// relative to the host's center steers in local frame:
//   X offset = yaw   (left/right turn)
//   Y offset = pitch (nose up/down)
//
// Reverse: right mouse button on desktop, or 2+ simultaneous pointers on
// mobile/tablet. While multiple pointers are held, steering is the average
// of all pointer positions, each clamped to ±1 of the host's half-extent.
// Pointers outside the host therefore steer at maximum-deflection of the
// nearest disk edge. Release lets the fish coast — translational and
// angular velocity decay exponentially rather than zeroing out.
//
// Optional yawDeadzone / pitchDeadzone — central fraction of the host where
// the input maps to zero, useful when the host spans more than one disk
// (two-eye rig: the bridge between disks is the deadzone, so clicking the
// bridge gives pure forward).
//
// Local-frame application means loop-de-loops work as expected: keep
// pitching up and you'll come over the top, exactly like a real fish.
// Mobile-first; pointer-only locomotion (no keyboard movement).

import * as r3 from '../core/r3.js';

const applyDeadzone = (v, dz) => {
  if (dz <= 0) return v;
  if (Math.abs(v) < dz) return 0;
  return Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
};

/**
 * @param {{
 *   host:           HTMLElement,
 *   camera:         import('../core/camera.js').Camera,
 *   speed?:         number,   // world units/sec at full thrust
 *   yawRate?:       number,   // radians/sec at full deflection
 *   pitchRate?:     number,   // radians/sec at full deflection
 *   accelTau?:      number,   // ramp-up time constant (s)
 *   coastTau?:      number,   // decay time constant after release (s)
 *   yawDeadzone?:   number,   // central fraction of host width with no yaw (0..1)
 *   pitchDeadzone?: number,   // central fraction of host height with no pitch
 *   speedMul?:      (pos: import('../core/r3.js').Vec3) => number,
 *                             // per-frame multiplier on forward speed, keyed off
 *                             // current camera position. Lets callers boost
 *                             // speed in larger regions (e.g. the outside cove)
 *                             // without rewriting locomotion. Default: 1.
 * }} opts
 * @returns {{ update: (timeMs: number) => void, suspend: (durationMs: number) => void, destroy: () => void }}
 */
export const bindControls = ({
  host,
  camera,
  speed         = 1.5,
  yawRate       = 1.5,
  pitchRate     = 1.2,
  accelTau      = 0.15,
  coastTau      = 0.4,
  yawDeadzone   = 0,
  pitchDeadzone = 0,
  speedMul      = () => 1,
}) => {
  /** @type {Map<number, {x: number, y: number, isRight: boolean}>} */
  const pointers = new Map();
  let lastTime = performance.now();

  let velFwd   = 0;
  let velYaw   = 0;
  let velPitch = 0;

  // Timestamp (performance.now() ms) until which input is ignored. Set
  // by suspend() to give a brief lockout window after a caller-driven
  // event (e.g. a teleport) so the user's still-held button doesn't
  // immediately re-launch the camera.
  let suspendedUntil = 0;

  const onDown = (e) => {
    pointers.set(e.pointerId, {
      x:       e.clientX,
      y:       e.clientY,
      isRight: e.button === 2,
    });
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const onUp = (e) => { pointers.delete(e.pointerId); };
  const onContextMenu = (e) => e.preventDefault();

  // Bind to window so the entire page is the touchpad — clicks outside the
  // visible viewing circle still steer; their position is clamped to ±1
  // (extreme edge of the disk) in the update loop. Contextmenu also goes
  // on window: a right-click + drag that releases off the disk would
  // otherwise pop the OS context menu mid-reverse-thrust.
  window.addEventListener('pointerdown',   onDown);
  window.addEventListener('pointermove',   onMove);
  window.addEventListener('pointerup',     onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('contextmenu',   onContextMenu);

  return {
    update(timeMs) {
      // Clamp dt: when a tab is backgrounded then refocused, rAF resumes
      // with a multi-second gap and an unclamped step would snap velocity
      // and orientation through a giant arc in a single frame.
      const dt = Math.min((timeMs - lastTime) / 1000, 0.1);
      lastTime = timeMs;
      if (dt <= 0) return;

      if (timeMs < suspendedUntil) {
        // Suspended — zero velocities so the camera is moved only by
        // physics during the lockout. Pointer events keep being
        // tracked, so once the window expires the user's current
        // input applies immediately on the next tick.
        velFwd = velYaw = velPitch = 0;
      } else if (pointers.size > 0) {
        const rect = host.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const halfW = rect.width  / 2;
        const halfH = rect.height / 2;

        // Average steering across all active pointers. Each pointer's
        // position is normalized to ±1 against the host rect and clamped at
        // the edges, so clicks outside the visible viewing circle still
        // steer at the maximum-deflection value of the nearest disk edge.
        // Reverse if 2+ pointers are held, or any pointer was right-button.
        let sumDx = 0, sumDy = 0;
        let anyRight = false;
        for (const p of pointers.values()) {
          if (p.isRight) anyRight = true;
          let pdx = (p.x - cx) / halfW;
          let pdy = (p.y - cy) / halfH;
          if (pdx >  1) pdx =  1; else if (pdx < -1) pdx = -1;
          if (pdy >  1) pdy =  1; else if (pdy < -1) pdy = -1;
          sumDx += pdx;
          sumDy += pdy;
        }
        const dx = sumDx / pointers.size;
        const dy = sumDy / pointers.size;

        const direction = (pointers.size >= 2 || anyRight) ? -1 : 1;

        const yawInput   = applyDeadzone(dx, yawDeadzone);
        const pitchInput = applyDeadzone(dy, pitchDeadzone);

        const targetVelFwd   =  direction * speed * speedMul(camera.position);
        const targetVelYaw   = -yawInput   * yawRate;
        const targetVelPitch = -pitchInput * pitchRate;

        const ramp = 1 - Math.exp(-dt / accelTau);
        velFwd   += (targetVelFwd   - velFwd)   * ramp;
        velYaw   += (targetVelYaw   - velYaw)   * ramp;
        velPitch += (targetVelPitch - velPitch) * ramp;
      } else {
        const decay = Math.exp(-dt / coastTau);
        velFwd   *= decay;
        velYaw   *= decay;
        velPitch *= decay;
      }

      if (Math.abs(velYaw) > 1e-6) {
        camera.rotateLocal(r3.quatAxisAngle([0, 1, 0], velYaw * dt));
      }
      if (Math.abs(velPitch) > 1e-6) {
        camera.rotateLocal(r3.quatAxisAngle([1, 0, 0], velPitch * dt));
      }
      if (Math.abs(velFwd) > 1e-6) {
        const forward = r3.quatRotate(camera.orientation, [0, 0, -1]);
        camera.position = r3.add(camera.position, r3.scale(forward, velFwd * dt));
      }
    },
    suspend(durationMs) {
      suspendedUntil = performance.now() + durationMs;
    },
    destroy() {
      window.removeEventListener('pointerdown',   onDown);
      window.removeEventListener('pointermove',   onMove);
      window.removeEventListener('pointerup',     onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('contextmenu',   onContextMenu);
    },
  };
};
