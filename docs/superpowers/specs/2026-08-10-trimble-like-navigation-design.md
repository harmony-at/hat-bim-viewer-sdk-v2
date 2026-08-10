# Trimble-Like Zoom, Pan, and Hit-Point Navigation Design

Status: Approved on 2026-08-10

## Goal

Make xeokit's pointer-following camera navigation behave consistently from component-scale details to site-scale BIM scenes. Mouse wheel and trackpad zoom must remain anchored to a stable spatial reference, and mouse pan must preserve a stable world-space scale for the duration of a drag.

The behavior becomes the default when `CameraControl.followPointer` is `true`. The existing behavior remains when `followPointer` is `false`.

## Scope

- Mouse wheel and trackpad zoom in perspective and orthographic projections.
- Mouse-drag pan in perspective and orthographic projections.
- Cursor hits, zoom-session anchors, navigation pivots, pan references, and MISS fallbacks.
- One-model and multi-model scenes using xeokit's existing picking pipeline.
- Regression protection for first-person, plan-view, touch, keyboard, and `constrainVertical` behavior.
- Automated tests, SDK and viewer builds, and a manual navigation benchmark matrix.

## Out of Scope

- Replacing xeokit's picking implementation with a new BVH, GPU depth, or object-ID pipeline.
- Coupling selection state to navigation state.
- Adding public tuning options for session timing, safe distance, or anchor invalidation.
- Redesigning touch or keyboard navigation.
- Adaptive near/far clipping, distant-model clustering, and tracking anchors through live model transforms.

## Domain Language

The canonical terms are defined in [`CONTEXT.md`](../../../CONTEXT.md): Cursor Hit, Zoom Anchor, Navigation Pivot, and Pan Reference. These terms are not interchangeable.

## Current Behavior and Gaps

`MousePanRotateDollyHandler` schedules a surface pick after the pointer moves, normalizes wheel input to its sign, and accumulates a dolly delta. `CameraUpdater` stores one local follow-pointer world position, scales dolly speed by its distance, and delegates cursor-directed movement to `PanController.dollyToCanvasPos`. Perspective pan already scales pixel movement using the picked mouse-down depth; orthographic pan uses `ortho.scale`.

The current implementation has no explicit Zoom Session, no lifecycle shared by Cursor Hit and Navigation Pivot, no ordered MISS fallback beyond eye-to-look distance, and no deterministic automated coverage for the interaction. The staged fallback change in `CameraUpdater.js` and `cameraControl_dollyFallback.html` is part of the implementation baseline. The unstaged debug log is not part of the design and must be removed during implementation.

## Architecture Decision

Add an internal `NavigationContextController` module beside the existing `PickController`, `PivotController`, and `PanController`. It is a deep module: callers use a small interface while it owns Cursor Hit acquisition, Zoom Session state, last-valid state, fallback selection, explicit Navigation Pivot state, and Navigation Pivot synchronization.

Its internal interface is:

- `beginOrContinueZoom(canvasPos, timestamp)` returns the stable Zoom Anchor and its source.
- `resolvePanReference(canvasPos)` returns the point or depth fixed for a pan gesture.
- `establishNavigationPivot(worldPos, reason)` lets orbit and pan adapters establish the controller-owned explicit pivot without duplicating pivot state.
- `translateNavigationPivot(worldDelta)` keeps the pivot aligned with a pan translation.
- `reset(reason)` releases transient navigation state for camera reset, flight, axis-view, disable, or destroy lifecycles.

The interface is private to `CameraControl`. No public `CameraControl` property or configuration is added.

`CameraUpdater` remains responsible for applying accumulated deltas, inertia, projection-specific camera mutations, and cursor feedback. It asks `NavigationContextController` for navigation context instead of owning that context itself. `MousePickHandler` and the existing picking and pivot modules remain adapters to scene observation and orbit state; they establish or reset context through the five-method interface rather than owning duplicate Navigation Pivot state. Scene lifecycle subscriptions remain hidden inside the controller implementation.

## Zoom Data Flow

1. The input handler converts `WheelEvent.deltaY` to pixel-equivalent units: pixels are unchanged, lines are multiplied by 16, and pages are multiplied by the canvas height. The result is clamped to one page in either direction while retaining sub-page magnitude.
2. A gap of at least 160 ms starts a new Zoom Session. Shorter gaps continue the active session.
3. At session start, the controller performs at most one existing xeokit surface pick at the pointer position.
4. A valid Cursor Hit becomes the Zoom Anchor. During the session, pointer movement and newly intersected objects do not replace it.
5. On a session-start MISS, the controller resolves the first valid source in this order: explicit Navigation Pivot, last valid Cursor Hit, valid visible-scene bounds reference, then a camera-forward reference. A visible-bounds center is valid only when it is in front of the camera and projects within a viewport expanded to 1.5 times its width and height. Otherwise, the camera-forward reference uses the best available positive depth from the explicit pivot, last valid hit, or current eye-to-look distance.
6. Each camera tick computes the current eye-to-anchor distance. Dolly magnitude grows monotonically with that distance, retains the existing configured rate and inertia, and is bounded by the normalized gesture magnitude.
7. Perspective zoom moves toward or away from the Zoom Anchor. Zoom-in leaves a safe distance of `max(2 * activeNear, visibleSceneDiagonal * 10^-6)`; one tick may not consume more than 80% of the remaining distance outside that threshold.
8. Orthographic zoom changes `ortho.scale` and compensates camera translation so that the Zoom Anchor remains at the same canvas position.
9. Zoom-out uses the same base curve as zoom-in and may move up to 1.25 times the inward step, capped to the current eye-to-anchor distance per tick.
10. When the session timeout expires, the Zoom Anchor is released. The Navigation Pivot and last valid Cursor Hit remain available for the next MISS fallback.

If an anchor contains non-finite coordinates, lies behind the camera for an inward dolly, has no positive usable distance, belongs to a hidden or unloaded source, or is cut away by an active section plane, it is invalid. Pointer movement and a zoom-direction reversal do not invalidate it. Invalidation does not trigger a new pick during the gesture: the controller immediately resolves the next fallback source and keeps that replacement Zoom Anchor stable until the session ends. A replacement anchor is never promoted to Navigation Pivot implicitly.

Live model or object transforms do not add a new invalidation event or transform-revision dependency in this destination. A Zoom Anchor is a copied World-space point and remains fixed for the current Zoom Session when its source transforms; the next session performs the normal session-start pick. Existing hidden, unloaded, and section-plane invalidation remains in force.

## Pan Data Flow

1. Mouse-down resolves the Pan Reference from the Cursor Hit. On MISS, it uses Navigation Pivot depth, then current eye-to-look depth.
2. The Pan Reference remains fixed until mouse-up, regardless of geometry subsequently crossed by the pointer.
3. Perspective converts pixel delta to world delta using the camera field of view, canvas height, and reference depth. Orthographic uses `ortho.scale` and canvas height.
4. The same world delta translates `camera.eye`, `camera.look`, and Navigation Pivot. This preserves both view direction and future zoom context.
5. Existing pan inertia and vertical constraints remain in `CameraUpdater` and apply after conversion.

## Navigation Pivot Lifecycle

- A successful orbit pick establishes a new explicit Navigation Pivot.
- A pan beginning on a Cursor Hit establishes the pivot at the Pan Reference, then translates it with the camera.
- A pan beginning on a MISS translates an existing explicit pivot, but does not invent one from `camera.look`.
- A zoom Cursor Hit updates the Zoom Anchor and last valid Cursor Hit only; it does not replace the Navigation Pivot.
- Camera reset, camera flight, and axis-view transitions clear the explicit pivot so stale context cannot leak into the next gesture.
- `camera.look` remains a camera property and a final depth input; by itself it is not a Navigation Pivot.

## Projection and Navigation Modes

- Orbit perspective uses cursor-directed dolly and the shared Navigation Pivot.
- Orthographic changes scale and applies cursor-lock compensation.
- Plan view uses the same orthographic anchor policy without enabling rotation.
- First-person retains its current vertical constraint and forward-motion semantics; the new context controls speed and safe-distance behavior only where the current `followPointer` path already applies.
- Touch and keyboard handlers retain their current behavior. Shared controller construction and teardown must not alter their inputs.

## Performance Contract

- No new brute-force geometry traversal.
- At most one surface pick at Zoom Session start unless the anchor is explicitly invalidated.
- No pick on every render tick.
- Reuse math buffers in tick and pointer-move paths; do not introduce recurring per-frame allocations.
- Multi-model cost continues to be governed by `Scene.pick`, not by iteration over all models or objects in camera-control code.

## Verification Contract

Implement the navigation contract as one deterministic HTML scene under `test-scenes` with a fake clock, scripted pick and scene adapters, and numeric camera state. A thin Playwright spec calls named scenario functions through `page.evaluate` and asserts their returned observations. These tests do not load a real model, depend on WebGL rendering or Percy snapshots, or use wall-clock waits; integration and manual checks cover the rendered viewer separately.

Deterministic automated coverage must prove:

- One pick per Zoom Session and anchor stability within the session.
- Anchor replacement between sessions.
- The complete MISS fallback order.
- Monotonic distance scaling and inward/outward clamps.
- Perspective anchor direction and safe-distance behavior.
- Orthographic canvas-position preservation.
- Fixed pan depth and common camera/pivot translation.
- No regression when `followPointer` is false or in first-person, plan-view, and vertically constrained paths.

Integration verification must build the SDK, run its available test suite, build `hat-bim-viewer-v2` against the local SDK, and preserve unrelated user changes.

Manual verification covers perspective and orthographic modes; hit-near, hit-far, and MISS positions; one and multiple models; wheel and long trackpad gestures; pan from geometry and background; and transitions between objects in different models. The benchmark records camera travel for comparable gestures at approximately 1 m, 10 m, 100 m, and 1000 m.

## Rollout

The implementation replaces the current `followPointer=true` behavior without a feature flag. Generated SDK and viewer distributions may be rebuilt only as required by the repositories' existing workflow. No unrelated source, documentation, or generated-file cleanup is part of this effort.
