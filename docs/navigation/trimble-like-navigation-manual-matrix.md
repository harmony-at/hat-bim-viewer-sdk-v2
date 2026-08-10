# Trimble-Like Navigation Verification Matrix

Date: 2026-08-10

## Automated contract

The deterministic Playwright harness uses a fake clock, scripted pick results, fake scene lifecycle events, and numeric camera state. It does not load a model or require WebGL.

| Area | Covered behavior | Result |
| --- | --- | --- |
| Wheel units | Pixel, line, page, fractional magnitude, one-page clamp, zero event | Pass |
| Zoom Session | One pick per session, 159 ms continuation, 160 ms boundary, stable copied anchor | Pass |
| MISS fallback | Explicit pivot, last valid hit, guarded visible AABB, camera-forward reference | Pass |
| Invalidation | Object hide, model unload, section-plane clipping, no mid-session repick | Pass |
| Adaptive zoom | Monotonic 1/10/100/1000 m scaling, near/scene safe distance, 80% inward clamp, 1.25x outward step, outward cap | Pass |
| Projection | Perspective anchor movement and orthographic cursor-lock compensation | Pass |
| Pan | Fixed drag depth, common camera/pivot translation, constrained vertical translation | Pass |
| Lifecycle | Orbit establishes pivot; controller teardown avoids recursion and releases context | Pass |
| Compatibility | Existing orbit, plan-view, first-person, surface-hit, repeated MISS fallback tests | Pass |

Command:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js tests/camera-control-dolly-fallback.spec.js --project=chromium
```

## Integration contract

| Check | Result |
| --- | --- |
| SDK Rollup development and minified bundles | Pass |
| `hat-bim-viewer-v2` production and development bundles against the feature worktree SDK | Pass |
| New public CameraControl option | None |
| New geometry traversal or picking pipeline | None |

## Physical-device acceptance matrix

Status: **release verification pending**. These rows require real mouse/trackpad hardware and representative 1/10/100/1000 m BIM models; no synthetic result is recorded as a physical-device measurement.

Use this matrix for release smoke testing with a real BIM model and native mouse/trackpad hardware. Numeric scale rows correspond to comparable gestures with the cursor kept at the same semantic target.

| Projection | Scene | Cursor / gesture | Expected observation |
| --- | --- | --- | --- |
| Perspective | One model | Wheel at near surface, about 1 m | Moves toward cursor without crossing the surface; step is smallest scale row |
| Perspective | One model | Wheel at 10 m, 100 m, 1000 m | Travel grows monotonically with anchor distance |
| Perspective | One model | Long trackpad gesture crossing objects | Anchor does not jump inside the gesture |
| Perspective | One model | Wheel over background | Uses pivot/last hit/bounds/forward fallback without stalling |
| Perspective | Any | Wheel over off-center background | Zoom follows the exact pointer ray; fallback source supplies depth only |
| Perspective | Any | Fast inward wheel crosses a surface | Crossing overshoot is small, same-session speed resets, and the camera remains controllable |
| Perspective | Multiple depth layers | Pause after crossing, then wheel again | The next session picks the newly exposed surface and restores distance-scaled speed |
| Orthographic | One model | Wheel over an off-center object | Object remains under the cursor while scale changes |
| Plan view | One model | Wheel and background MISS | Same orthographic anchor policy; rotation remains disabled |
| Perspective | Multiple models | Cursor moves from Model A to Model B during one gesture | Anchor remains on the session-start source; next gesture may select Model B |
| Any | Multiple models | MISS between separated models | Does not choose an arbitrary first model or jump to a remote bounds center |
| Perspective | Any | Pan begins on geometry | Drag scale stays fixed to mouse-down depth; subsequent zoom uses translated pivot |
| Perspective | Any | Pan begins on background | Existing pivot depth is used; no pivot is invented from `camera.look` |
| Orbit/Pan | Any | Drag begins over background | Orbit pivot and pan scale use the same pointer-ray fallback depth |
| Any | Any | Hide or unload anchor source during gesture | Falls back smoothly without a new pick |
| Any | Any | Section plane cuts through anchor during gesture | Falls back smoothly to visible context |
| First person | Any | Wheel with vertical constraint | Existing forward/vertical behavior remains intact |
| Any | Any | Reset, fly-to, axis view, or pointer disable | Previous explicit pivot does not leak into the next gesture |

Live source transforms intentionally keep the copied world-space Zoom Anchor fixed until the active session ends, as specified in the approved design.
