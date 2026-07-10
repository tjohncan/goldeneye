import { Camera, disk } from './core/camera.js';
import { Painter }      from './core/painter.js';
import { trace }        from './core/tracer.js';
import { quatLookAt }   from './core/r3.js';

import { createWorld, LIGHTING } from './aquarium/world.js';
import { bindControls }          from './aquarium/controls.js';
import { bindPhysics }           from './aquarium/physics.js';
import { throttle }              from './aquarium/fpsThrottle.js';

// Quality levers via query string, defaults matching the classic look:
//   ?res=96   — render-grid resolution (32..128, default 64). Cost
//               scales ~res² twice over: rays traced AND DOM cells
//               painted. 96 is a comfortable step up on a mid machine;
//               128 is for beefy ones.
//   ?fps=20   — frame cap (4..24, default 13).
// Lens point count scales with the grid so sampling density per cell
// (and therefore the fisheye character) is identical at every res.
//
// The two levers are also budget-guarded TOGETHER: rays/second is
// capped at 25600·16 (a 128-grid at 16 fps, ~5× the default load), so
// maxing one lever automatically reins in the other — curiosity about
// big numbers shouldn't cook anyone's laptop.
const params      = new URLSearchParams(location.search);
// Default grid is device-aware: 88 where the pointer is fine (a
// desktop absorbs the ~1.9× cost of the richer grid without breaking
// the 13 fps budget), 64 where it's coarse — average mobile pays the
// res² twice (rays AND painted cells) and stays honest at the classic
// grid. An explicit ?res= always wins.
const FINE_POINTER = typeof matchMedia === 'function'
  && matchMedia('(pointer: fine)').matches;
const RES         = Math.min(128, Math.max(32,
  Number(params.get('res')) || (FINE_POINTER ? 88 : 64)));
const SCREEN_W    = RES;
const SCREEN_H    = RES;
const LENS_POINTS = Math.round(6400 * (RES / 64) * (RES / 64));
const FPS_BUDGET  = Math.floor(25600 * 16 / LENS_POINTS);
const MAX_FPS     = Math.min(24, FPS_BUDGET, Math.max(4, Number(params.get('fps')) || 11));

const lens = disk({ points: LENS_POINTS });
const camera = new Camera({ lens, screenW: SCREEN_W, screenH: SCREEN_H });
const painter = new Painter({
  host:    document.getElementById('screen'),
  screenW: SCREEN_W,
  screenH: SCREEN_H,
  cells:   camera.screen.activeCells,
  shimmer: 0.04,
});
const { scene, speedMul, spawn, teleport, perFrameUpdates } = createWorld();

camera.position    = spawn.position;
camera.orientation = quatLookAt(spawn.position, spawn.lookAt, spawn.up);

const controls = bindControls({
  host: document.getElementById('screen-wrap'),
  camera,
  speed:    1.44,
  yawRate:  1.44,
  speedMul,
});
const physics = bindPhysics({ camera, scene });

const tick = throttle(MAX_FPS, (timeMs) => {
  controls.update(timeMs);
  physics.update();

  // Sun teleport — flying into the cove sun warps the camera to
  // teleport.position. Sits AFTER physics (sees post-collision pose)
  // and BEFORE trace (teleport reflected in this frame's render, no
  // flash of the pre-teleport view). teleport.shouldTrigger combines
  // a height short-circuit with a sphere check, so off-axis flight
  // past the height threshold doesn't false-fire — the camera has to
  // actually enter the sun's volume.
  if (teleport.shouldTrigger(camera.position)) {
    camera.position    = teleport.position;
    camera.orientation = quatLookAt(teleport.position, teleport.lookAt, teleport.up);
    controls.suspend(500);
  }

  for (let i = 0; i < perFrameUpdates.length; i++) perFrameUpdates[i](timeMs);

  const colors = trace(camera.rays(), scene, LIGHTING);
  painter.paint(camera.blend(colors));
});
requestAnimationFrame(tick);
