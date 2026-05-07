import { Camera, disk } from './core/camera.js';
import { Painter }      from './core/painter.js';
import { trace }        from './core/tracer.js';
import { quatLookAt }   from './core/r3.js';

import { createWorld, LIGHTING } from './aquarium/world.js';
import { bindControls }          from './aquarium/controls.js';
import { bindPhysics }           from './aquarium/physics.js';
import { throttle }              from './aquarium/fpsThrottle.js';

const SCREEN_W    = 64;
const SCREEN_H    = 64;
const LENS_POINTS = 6400;
const MAX_FPS     = 13;

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

  // Sun teleport — flying high enough into the cove sun warps the
  // camera to teleport.position. Sits AFTER physics (sees post-collision
  // Y) and BEFORE trace (teleport reflected in this frame's render, no
  // flash of the pre-teleport view). A pure Y threshold suffices: the
  // cove's other regions all live well below teleport.triggerY, so the
  // check can't false-fire from indoors.
  if (camera.position[1] > teleport.triggerY) {
    camera.position    = teleport.position;
    camera.orientation = quatLookAt(teleport.position, teleport.lookAt, teleport.up);
    controls.suspend(500);
  }

  for (let i = 0; i < perFrameUpdates.length; i++) perFrameUpdates[i](timeMs);

  const colors = trace(camera.rays(), scene, LIGHTING);
  painter.paint(camera.blend(colors));
});
requestAnimationFrame(tick);
