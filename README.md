# goldeneye

***First-person-shoot for the stars!*** 

... in this aquarium-themed HTML demonstration of a JavaScript 3D graphics engine:
SDFs are sphere-traced under lambertian shading,
painted onto a CSS grid of round `<div>` cells.
Strictly DOM — no canvas; no WebGL.

[tjohncan.github.io/goldeneye/](https://tjohncan.github.io/goldeneye/)

![demo](motion.gif)

## Controls

- **Click and hold** to swim. Pointer position steers.
- **Right-click** (or two-finger touch on a touchscreen) to reverse.

## Run locally

```sh
node serve.js
# ( note: any other static file server works too;
# ... it's just a single-page HTML doc linking JS )
# then: open http://localhost:8080/ in your favorite browser.
```

## Layout

`core/` is a reusable engine;
`aquarium/` is one scene built on it.

- `core/` — generic, scene-agnostic toolkit
  - `r3.js` — vector & quaternion math
  - `scene.js` — `Item` type + SDF primitives, combinators, transforms
  - `camera.js` — `Camera` class + lens-shape factories
  - `tracer.js` — sphere-trace a ray batch through a scene
  - `painter.js` — paint a per-cell color signal onto a CSS grid host
- `aquarium/` — the kitchen fish-bowl scene
  - `world.js` — scene composition (tank decor, furnishings)
  - `controls.js` — pointer-based 3D swimming
  - `physics.js` — SDF-gradient collision sliding
  - `bubblePump.js` — pool of rising bubble Items
  - `fpsThrottle.js` — render-loop FPS cap
- `index.html` — markup, meta, asset & module wiring
- `main.js` — entry point; constructs the camera, scene, and render loop
- `styles.css` — page chrome (the rendered scene styles itself)
- `serve.js` — simple node server relevant only for local dev trials

## Toolkit notes

Items are plain objects with `position`, `sdf`, and `color`. A handful of
optional fields layer on top:

- `colorFn(lpx, lpy, lpz)` — procedural surface color in local space,
  called at hits. Lets a single Item carry patterns
  (ex: planks, chessboards, painted-on details) without inflating scene size.
- `opacity` — front-to-back translucent compositing
  (rays continue through transparent items).
- `collides` — physics participation (default true).
- `boundingRadius` — opt-in per-ray culling.
  The tracer drops items whose bounding sphere doesn't intersect each ray's path.
- `regionKey` — opt-in per-step culling. With `Scene.regionFn(p)` mapping
  world points to region keys, the tracer skips items whose `regionKey`
  doesn't match the current ray-step point's region.

Hot loops (tracer, blend, paint) reuse module-level Float32Arrays and
pooled scratch buffers. The per-frame render path allocates only the
unavoidable DOM-paint strings.
