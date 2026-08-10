# Cursor-Ray Navigation Bug-Fix Design

Status: Approved on 2026-08-10

## Goal

Fix pointer-following navigation so wheel zoom, left-button orbit, and middle-button pan remain spatially aligned with the pointer when no model surface is picked. Allow an inward wheel gesture to move the camera through its initial surface anchor without changing direction or picking a new anchor before that wheel session ends. Preserve the current zoom-speed curve before crossing, then reset to the configured minimum speed so a fast gesture cannot carry the camera far past the object the user was approaching.

The behavior remains internal to `CameraControl` and applies when `followPointer` is `true`. Existing behavior when `followPointer` is `false` remains unchanged.

## Root Causes

`NavigationContextController` currently resolves a MISS to an existing Navigation Pivot, the last valid Cursor Hit, the visible-scene bounds center, or a camera-forward point. It then projects that fallback point and supplies the projected position to `PanController.dollyToCanvasPos`. An off-center pointer therefore moves toward the fallback point's canvas position instead of the pointer position.

Left-button orbit has a separate MISS path. `MousePickHandler` delegates to `PivotController.setCanvasPivotPos`, which chooses a sphere radius from the scene center instead of using the same navigation depth policy as zoom and pan. This makes empty-space orbit inconsistent with the other pointer gestures.

Finally, `computeBoundedZoomDelta` leaves a safe distance from a surface and consumes at most 80 percent of the remaining distance on each inward tick. The camera approaches the Cursor Hit asymptotically and cannot pass through it. The active Zoom Anchor is also considered invalid once it lies behind the camera, which would replace the anchor and redirect an in-progress gesture after crossing.

## Architecture Decision

Keep `NavigationContextController` as the owner of navigation context, but make it resolve a unified pointer reference. A pointer reference has:

- A stable `canvasPos`, copied from the pointer position at gesture start.
- A `worldPos` on the ray through that exact canvas position.
- A positive reference depth used for zoom-speed and pan-scale calculations.
- A source identity used for lifecycle invalidation and diagnostics.

A real Cursor Hit already lies on the pointer ray and remains the preferred reference. On a MISS, existing fallback candidates provide depth and source identity only. The controller constructs a virtual World-space point on the pointer ray at that depth instead of navigating toward the candidate's own projected position.

No public API, configuration flag, picking pipeline, or geometry traversal is added.

## Pointer-Ray Fallback

At the beginning of a gesture, the controller resolves fallback depth in this order:

1. Explicit Navigation Pivot.
2. Last valid Cursor Hit.
3. Valid visible-scene bounds center.
4. Current camera eye-to-look distance.

For perspective projection, the controller obtains the World-space ray for the gesture's canvas position and places the virtual reference along that ray at the selected positive distance from the camera eye. For orthographic projection, it uses the same canvas ray and reference depth while leaving the existing `PanController` scale compensation responsible for cursor lock.

The fallback record retains the source label and source entity/model identity where applicable, but its `canvasPos` is always the gesture's original pointer position. Non-finite rays, non-positive depths, clipped candidates, hidden entities, destroyed entities, and unloaded models remain invalid. If no finite pointer reference can be constructed, the caller uses its existing non-follow-pointer camera fallback and must not write non-finite camera state.

## Wheel Zoom Data Flow

1. A wheel event starts or continues the existing 160 ms Zoom Session.
2. At session start, the controller performs at most one surface pick at the pointer.
3. A hit creates a real pointer reference. A MISS creates a virtual pointer reference using the fallback-depth order above.
4. The session copies and retains its initial `canvasPos`; later pointer movement does not redirect it.
5. Before crossing, inward and outward zoom retain the current distance-scaled speed curve, normalized wheel magnitude, configured rates, inertia, and `dollyMinSpeed`. Only the terminal safety behavior changes.
6. If an inward tick would stop before the reference, it applies the same step as today. If it would reach or pass the reference, the applied step is capped to the remaining eye-to-reference distance plus one continuation step calculated with `dollyMinSpeed`. This permits crossing while bounding the first-tick overshoot.
7. After that tick, the session enters a crossed state. Subsequent zoom-in and zoom-out ticks in the same session use `dollyMinSpeed` instead of scaling speed from the increasing distance to the now-behind reference. Input magnitude, sign, rate, and configured inertia still apply; only the distance factor is reset.
8. The controller continues returning the same reference and canvas ray for the rest of the session even though the reference is behind the camera. A crossed reference is not repicked or replaced merely because it is behind the camera. Object hide, destroy, model unload, and section-plane invalidation still replace an invalid source according to the existing lifecycle rules.
9. The next Zoom Session clears crossed state, restores normal distance-scaled speed, and performs the normal session-start pick, allowing a newly visible surface behind the old one to become the next anchor.

Zoom-out retains its existing rate curve. Wheel input normalization, session timing, and the `followPointer=false` path are unchanged.

## Orbit and Pan Data Flow

On left-button orbit start, a Cursor Hit remains the pivot. On MISS, `MousePickHandler` asks `NavigationContextController` for a virtual pointer reference and supplies its `worldPos` directly to `PivotController`. This replaces the scene-center smart-pivot sphere for this path, so rotation begins around a point on the pointer ray at navigation-context depth. A virtual orbit reference is temporary and is not promoted to a persistent Navigation Pivot.

On middle-button pan start, the controller continues fixing one Pan Reference for the entire drag. A hit uses hit depth. A MISS uses the same fallback-depth policy as zoom and orbit. Perspective pixel-to-world conversion and orthographic scale conversion remain in `MousePanRotateDollyHandler`; camera eye, look, and an existing Navigation Pivot continue to receive the same effective translation.

No repick occurs during an orbit or pan drag. Mouse-up ends the fixed reference lifecycle.

## Compatibility and Performance

- `followPointer=false`, keyboard navigation, touch gestures, first-person mode, plan view, vertical constraints, camera flights, resets, and axis views retain their existing contracts.
- Before crossing, the current zoom-speed curve and all public speed settings retain their existing meaning. Crossing resets only the active session's distance factor to `dollyMinSpeed`; it does not mutate public configuration.
- The change performs no additional pick during a gesture. Wheel zoom still performs at most one pick per Zoom Session; orbit and pan still perform their gesture-start pick.
- Pointer-ray math reuses existing xeokit camera/math facilities and avoids recurring geometry scans.
- Existing Navigation Pivot translation and lifecycle invalidation remain authoritative.

## Verification Contract

Extend the deterministic Playwright camera-control harness before changing production code. The regression suite must demonstrate failures on the current implementation and then prove:

- An off-center MISS fallback keeps `canvasPos` equal to the original pointer and constructs a finite `worldPos` on that pointer ray for pivot, last-hit, bounds, and eye-look depth sources.
- Left-button orbit on a MISS supplies the unified virtual reference to `PivotController`, rather than the scene-center smart-pivot fallback.
- Middle-button pan resolves its reference once and uses the unified fallback depth for the entire drag.
- A perspective inward wheel gesture can move the camera from in front of the initial anchor to behind it.
- The crossing tick cannot overshoot by more than one input-scaled `dollyMinSpeed` continuation step beyond the anchor.
- Zoom-in and zoom-out after crossing use the minimum distance factor until the Zoom Session ends, preventing acceleration away from a behind-camera anchor.
- Further ticks in the same Zoom Session continue along the original pointer ray, do not repick, and do not replace the anchor because it is behind the camera.
- A wheel event in the next session performs a new pick and may anchor to a newly exposed surface.
- The next session restores the existing distance-scaled speed curve for its new anchor.
- Orthographic zoom remains locked to the original pointer canvas position.
- Hidden, destroyed, unloaded, or section-clipped sources still invalidate safely.
- Existing navigation-context and dolly-fallback tests remain green.

After focused tests pass, build the SDK, build `hat-bim-viewer-v2` against the local SDK, and run the relevant existing test suite. Generated bundles are updated only through the repositories' existing build commands, and unrelated user changes are preserved.

## Acceptance Criteria

- Zoom, orbit, and pan started over empty space no longer redirect toward a projected scene center, old pivot position, or camera centerline.
- Perspective wheel zoom can cross a picked surface and continues on the same pointer ray at reset minimum speed until the session ends.
- The crossing tick has bounded overshoot, and subsequent same-session input cannot accelerate merely because the old anchor is behind the camera.
- The first wheel event after the session gap may choose a new anchor and restores normal distance-scaled speed.
- No extra per-tick pick or public configuration is introduced.
- Automated regression tests and both project builds pass without overwriting unrelated working-tree changes.
