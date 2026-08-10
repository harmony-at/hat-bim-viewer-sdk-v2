# Trimble-Like Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Implement the approved Trimble-like wheel zoom, stable hit-point anchor, MISS fallback, pan reference, and pivot lifecycle in xeokit while preserving legacy behavior when `followPointer` is false.

**Architecture:** Add one private `NavigationContextController` beside xeokit's existing camera controllers. The mouse handler normalizes wheel input and resolves one pan reference per drag, the controller owns sticky navigation context, and `CameraUpdater` applies bounded projection-specific camera motion. Existing scene picking, pivot rendering, camera math, and inertia remain adapters and consumers.

**Tech Stack:** ES modules, xeokit math/camera APIs, Playwright browser tests, Rollup SDK build, npm viewer build.

## Global Constraints

- Keep the controller interface to the five approved methods: `beginOrContinueZoom`, `resolvePanReference`, `establishNavigationPivot`, `translateNavigationPivot`, and `reset`.
- Do not add public `CameraControl` configuration or alter scene-level `mousewheel` event semantics.
- Perform no more than one surface pick at the beginning of a zoom session and no per-tick pick.
- Preserve current touch and keyboard input behavior.
- Preserve existing unrelated staged, unstaged, generated, and untracked files.
- Use a deterministic HTML harness; do not depend on a real model, WebGL rendering, wall-clock waits, or snapshots for the navigation contract.

---

## Task 1: Establish deterministic RED coverage for input normalization

**Files:**

- Create: `src/viewer/scene/CameraControl/lib/NavigationUtils.js`
- Create: `test-scenes/cameraControl_navigationContext.html`
- Create: `tests/camera-control-navigation-context.spec.js`

- [ ] Add harness scenarios that import the production utility module and return normalized values for pixel, line, and page wheel input.
- [ ] Assert `7.5px -> 7.5`, `3 lines -> 48`, `0.5 page at 800px -> 400`, and `2 pages -> 800`.
- [ ] Assert zero delta is ignored and that equal deltas remain equal regardless of event spacing.
- [ ] Run `npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium` and verify RED because `NavigationUtils.js` does not exist.
- [ ] Implement private constants for 16 px/line, one-page clamp, 160 ms session gap, and a pure `normalizeWheelDelta(deltaY, deltaMode, canvasHeight)`.
- [ ] Re-run the focused Playwright test and verify GREEN.
- [ ] Commit: `test: specify navigation wheel normalization`.

## Task 2: Implement sticky zoom sessions and ordered fallback

**Files:**

- Create: `src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js`
- Modify: `src/viewer/scene/CameraControl/lib/controllers/PickController.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add fake scene, camera, canvas, pick, pivot, bounds, and event adapters to the deterministic harness.
- [ ] Add RED scenarios for one pick per session, anchor stability for gaps below 160 ms, and anchor replacement at a 160 ms gap.
- [ ] Add RED scenarios for fallback order: explicit pivot, last valid cursor hit, guarded visible AABB center, camera-forward point.
- [ ] Add RED cases rejecting non-finite, behind-camera, empty-bounds, and off-expanded-viewport candidates.
- [ ] Add an internal immediate surface-pick method to `PickController` so new sessions at the same canvas coordinate are not served stale cached hover results.
- [ ] Implement `NavigationContextController.beginOrContinueZoom` with copied world coordinates and source identity.
- [ ] Implement `establishNavigationPivot`, `translateNavigationPivot`, and `reset` without exposing public state.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit: `feat: add sticky navigation context`.

## Task 3: Invalidate stored anchors from scene lifecycle

**Files:**

- Modify: `src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add RED scenarios for source object hide, model unload, and active section plane clipping during a session.
- [ ] Subscribe once to `objectVisibility`, `modelUnloaded`, `sectionPlaneCreated`, `sectionPlaneUpdated`, and `sectionPlaneDestroyed`.
- [ ] Invalidate affected hit records without picking; resolve and stick the next fallback until the session ends.
- [ ] Copy all hit arrays and scalar identities; do not retain xeokit's reusable `PickResult` buffers.
- [ ] Unsubscribe every scene handle in `destroy`.
- [ ] Re-run focused tests and verify GREEN with no additional pick after invalidation.
- [ ] Commit: `feat: invalidate navigation anchors with scene state`.

## Task 4: Normalize real wheel input and feed session metadata

**Files:**

- Modify: `src/viewer/scene/CameraControl/lib/handlers/MousePanRotateDollyHandler.js`
- Modify: `src/viewer/scene/CameraControl/CameraControl.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add RED DOM-wheel scenarios proving magnitude is preserved, `deltaMode` is honored, pointer movement does not restart a session, and a direction reversal remains in the same session.
- [ ] Replace sign-only and elapsed-time magnitude scaling with `normalizeWheelDelta`.
- [ ] Scale pixel-equivalent input against a 100-pixel reference so a conventional 100-pixel event retains the previous 60 Hz base step: `pixelDelta * mouseWheelDollyRate / 6000`.
- [ ] Store the latest accepted wheel timestamp and copied canvas position in `_updates`; zero events neither add magnitude nor extend the session.
- [ ] Leave `followPointer=false` on the legacy distance-independent update path.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit: `feat: preserve wheel and trackpad magnitude`.

## Task 5: Apply bounded perspective and orthographic zoom

**Files:**

- Modify: `src/viewer/scene/CameraControl/lib/CameraUpdater.js`
- Modify: `src/viewer/scene/CameraControl/lib/controllers/PanController.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add RED numeric-camera scenarios for monotonic distance scaling at 1 m, 10 m, 100 m, and 1000 m.
- [ ] Add RED cases for safe distance `max(2 * near, visibleDiagonal * 1e-6)`, 80% inward clamp, 1.25x outward multiplier, and outward current-distance cap.
- [ ] Add RED perspective assertions that eye and look move toward the stable anchor direction.
- [ ] Add RED orthographic assertions that scale changes while the anchor's canvas position remains stable.
- [ ] Refactor `CameraUpdater` to obtain the stable anchor from `NavigationContextController` and remove local `followPointerWorldPos`, `followPointerDirty` picking, and the debug log.
- [ ] Keep inertia, cursor feedback, first-person vertical constraints, plan-view behavior, and `followPointer=false` behavior intact.
- [ ] Reuse module-level math buffers in the tick path.
- [ ] Re-run focused tests and the existing dolly fallback spec; verify GREEN.
- [ ] Commit: `feat: bound adaptive zoom around stable anchors`.

## Task 6: Use a fixed Pan Reference and translate the Navigation Pivot

**Files:**

- Modify: `src/viewer/scene/CameraControl/lib/handlers/MousePanRotateDollyHandler.js`
- Modify: `src/viewer/scene/CameraControl/lib/CameraUpdater.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add RED scenarios proving Pan Reference depth is fixed from mouse-down through mouse-up.
- [ ] Add RED scenarios proving a hit pan establishes a pivot, a MISS pan translates an existing pivot, and a MISS pan does not invent a pivot from `camera.look`.
- [ ] Resolve the reference once in `setMousedownPick`, then convert perspective/orthographic pixel deltas at that fixed depth.
- [ ] Accumulate the same effective constrained world translation for camera and pivot.
- [ ] Ensure pan inertia continues translating the pivot by the actual camera translation on each tick.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit: `feat: preserve pan navigation context`.

## Task 7: Wire orbit, reset, flight, axis-view, and teardown lifecycle

**Files:**

- Modify: `src/viewer/scene/CameraControl/CameraControl.js`
- Modify: `src/viewer/scene/CameraControl/lib/handlers/MousePickHandler.js`
- Modify: `src/viewer/scene/CameraControl/lib/handlers/KeyboardAxisViewHandler.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

- [ ] Add RED lifecycle scenarios for orbit establishing a pivot and reset/flight/axis-view/disable clearing it.
- [ ] Construct `NavigationContextController` after pick and pivot controllers and before handlers.
- [ ] Route successful mouse orbit picks through `establishNavigationPivot`.
- [ ] Reset navigation context before camera flight and axis-view transitions.
- [ ] Fix `_reset` to clear `dollyDelta` and navigation context.
- [ ] Destroy object-valued controllers using `Object.values` so scene subscriptions are released.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit: `feat: wire navigation context lifecycle`.

## Task 8: Complete regression and integration verification

**Files:**

- Modify only if required: `test-scenes/cameraControl_dollyFallback.html`
- Modify only if repository workflow requires: generated SDK `dist/*`
- Modify only if required for local SDK consumption: `../hat-bim-viewer-v2/package.json` or viewer lockfile
- Create: `docs/navigation/trimble-like-navigation-manual-matrix.md`

- [ ] Run `npx playwright test tests/camera-control-navigation-context.spec.js tests/camera-control-dolly-fallback.spec.js --project=chromium` and verify all deterministic/regression tests pass.
- [ ] Run `npm run build` in the SDK and verify Rollup completes.
- [ ] Inspect generated changes and retain only repository-required build outputs without overwriting unrelated user edits.
- [ ] Determine the viewer's local SDK consumption path, build `hat-bim-viewer-v2` against the implementation, and verify its existing build command succeeds.
- [ ] Record the manual benchmark matrix for projection, hit-near/far/MISS, single/multi-model, wheel/trackpad, pan geometry/background, cross-model transition, hide/unload/clipping, and distances 1/10/100/1000 m.
- [ ] Run `git diff --check`, inspect the final source diff, and confirm no unrelated files were changed.
- [ ] Commit: `test: complete navigation verification harness`.

## Final Verification

- [ ] Run the complete focused Playwright command again from a clean feature worktree.
- [ ] Run SDK and viewer builds again and capture exit status.
- [ ] Verify all five controller methods are present and no new public CameraControl API exists.
- [ ] Verify session-start picking count, fallback order, invalidation behavior, and safe-distance constants against the approved design spec.
- [ ] Review every changed line for direct traceability to this feature.
