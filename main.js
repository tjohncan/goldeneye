import { Camera, disk } from './core/camera.js';
import { Painter }      from './core/painter.js';
import { trace }        from './core/tracer.js';

import { createWorld, LIGHTING, WATER_SURFACE_Y } from './aquarium/world.js';
import { bindControls }     from './aquarium/controls.js';
import { bindPhysics }      from './aquarium/physics.js';
import { createBubblePump } from './aquarium/bubblePump.js';
import { throttle }         from './aquarium/fpsThrottle.js';

const SCREEN_W    = 64;
const SCREEN_H    = 64;
const LENS_POINTS = 6400;
const MAX_FPS     = 13;

const lens = disk({ points: LENS_POINTS });
const camera = new Camera({ lens, screenW: SCREEN_W, screenH: SCREEN_H });
const painter = new Painter({
  host: document.getElementById('screen'),
  screenW: SCREEN_W,
  screenH: SCREEN_H,
  shimmer: 0.04,
});
const scene = createWorld();

camera.position = [-4, 0, 4];

const controls = bindControls({
  host: document.getElementById('screen-wrap'),
  camera,
  speed:    1.44,
  yawRate:  1.44,
  speedMul: scene.speedMul,
});
const physics = bindPhysics({ camera, scene });
const bubblePump = createBubblePump({
  scene,
  position:    [1, -1.4, -2.5],
  surfaceY:    WATER_SURFACE_Y,
  spawnPerSec: 1.5,
});

const tick = throttle(MAX_FPS, (timeMs) => {
  controls.update(timeMs);
  physics.update();
  bubblePump.update(timeMs);

  const colors = trace(camera.rays(), scene, LIGHTING);
  painter.paint(camera.blend(colors));
});
requestAnimationFrame(tick);
