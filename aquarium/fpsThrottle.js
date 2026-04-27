// aquarium/fpsThrottle.js — cap a render loop at a target frames-per-second.
//
// Wraps a `tick(timeMs)` function so it only invokes the underlying tick at
// most `targetFps` times per second. The rAF loop still runs every browser
// frame (cheap), but the inner work only fires when enough time has passed.
// Useful for letting the user dial down render rate to reduce CPU load — the
// visual still looks OK at low fps for a slow scene, and the fan stays quiet.
//
// Usage:
//   const tick = throttle(13, (timeMs) => { ...render... });
//   requestAnimationFrame(tick);

/**
 * @param {number} targetFps  — set 0 or >=240 for uncapped (every rAF)
 * @param {(timeMs: number) => void} innerTick
 * @returns {(timeMs: number) => void}
 */
export const throttle = (targetFps, innerTick) => {
  const uncapped = !targetFps || targetFps >= 240;
  const minInterval = uncapped ? 0 : 1000 / targetFps;
  let lastTickMs = -Infinity;

  /** @param {number} timeMs */
  const wrapped = (timeMs) => {
    if (uncapped || timeMs - lastTickMs >= minInterval) {
      lastTickMs = timeMs;
      innerTick(timeMs);
    }
    requestAnimationFrame(wrapped);
  };

  return wrapped;
};
