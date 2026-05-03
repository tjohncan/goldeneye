import { Camera, disk } from './core/camera.js';
import { Painter }      from './core/painter.js';
import { trace }        from './core/tracer.js';
import { quatLookAt }   from './core/r3.js';

import { createWorld, LIGHTING, WATER_SURFACE_Y, SUN_TRIGGER_Y } from './aquarium/world.js';
import { bindControls }     from './aquarium/controls.js';
import { bindPhysics }      from './aquarium/physics.js';
import { createBubblePump } from './aquarium/bubblePump.js';
import { throttle }         from './aquarium/fpsThrottle.js';

const SCREEN_W    = 64;
const SCREEN_H    = 64;
const LENS_POINTS = 6400;
const MAX_FPS     = 13;

// Spawn pose. Position inside the bowl, off-center; looking at the
// bowl's center origin — picks up sand, plants, the ship, and the
// surrounding kitchen through the translucent bowl glass. SPAWN_UP is
// a hint that pins the camera's roll: world-up here, so the horizon
// reads level. (Camera orientation defaults to identity if a project
// doesn't set one — quatLookAt is opt-in.)
const SPAWN_POSITION = [-4, 0, 4];
const SPAWN_LOOK_AT  = [0, 0, -7];
const SPAWN_UP       = [0, 1, 0];

const TELEPORT_POSITION = [10.5, 4.2, -25.4];
const TELEPORT_LOOK_AT  = [10.5, 4.2, -26.5];
const TELEPORT_UP       = [0, 1, 0];

const lens = disk({ points: LENS_POINTS });
const camera = new Camera({ lens, screenW: SCREEN_W, screenH: SCREEN_H });
const painter = new Painter({
  host: document.getElementById('screen'),
  screenW: SCREEN_W,
  screenH: SCREEN_H,
  shimmer: 0.04,
});
const { scene, speedMul } = createWorld();

camera.position    = SPAWN_POSITION;
camera.orientation = quatLookAt(SPAWN_POSITION, SPAWN_LOOK_AT, SPAWN_UP);

const controls = bindControls({
  host: document.getElementById('screen-wrap'),
  camera,
  speed:    1.44,
  yawRate:  1.44,
  speedMul,
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

  // Sun teleport — flying high enough into the cove sun warps the
  // camera into the chamber (TELEPORT_POSITION). Sits AFTER physics
  // (sees post-collision Y) and BEFORE trace (teleport reflected in
  // this frame's render, no flash of the pre-teleport view). Pure Y
  // check rather than sphere containment: the cove's other regions
  // all live well below this height, so a single threshold can't
  // false-fire from indoors.
  if (camera.position[1] > SUN_TRIGGER_Y) {
    camera.position    = TELEPORT_POSITION;
    camera.orientation = quatLookAt(TELEPORT_POSITION, TELEPORT_LOOK_AT, TELEPORT_UP);
    controls.suspend(500);
  }

  bubblePump.update(timeMs);

  const colors = trace(camera.rays(), scene, LIGHTING);
  painter.paint(camera.blend(colors));
});
requestAnimationFrame(tick);
