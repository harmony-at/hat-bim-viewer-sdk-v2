# Camera Dolly Fallback for Sparse Models

## Context

`CameraControl` currently scales wheel dolly speed from the distance between the camera and the surface below the pointer. This works when `followPointer` can pick a surface. When no surface is picked, `CameraUpdater` resets `dollyDistFactor` to `1.0` and still calls `PanController.dollyToCanvasPos()` without a World-space target.

That fallback is effectively unusable for sparse models with a large overall extent. In the reproduced model, the scene diagonal is about 6.5 km while the median entity diagonal is about 1.25 m. A wheel event moves the camera only a few metres until a surface can be picked. Combining the model with long, continuous pipe geometry masks the issue because the pointer can pick that geometry and activate distance-scaled dolly.

## Goals

- Keep wheel zoom responsive when `followPointer` is enabled but no surface is picked.
- Preserve the existing zoom-to-pointer behaviour when a surface is picked.
- Make fallback speed proportional to the current camera scale so it naturally slows as the camera approaches its look point.
- Limit the change to camera dolly behaviour; do not alter model loading, manifests, camera fitting, or application configuration.

## Non-goals

- Changing first-person navigation behaviour.
- Adding a new public configuration option.
- Expanding surface picking or snapping to nearby geometry.
- Tuning `mouseWheelDollyRate` for a specific model.

## Design

### Distance factor

When `followPointer` is enabled:

1. If the pointer pick provides a World-space position, retain the existing calculation based on camera-to-surface distance.
2. If the pointer pick does not provide a World-space position and navigation is not first-person, calculate the fallback factor from `camera.eyeLookDist / dollyProximityThreshold`.
3. Continue applying the existing `dollyMinSpeed` lower bound.
4. Keep the current factor of `1.0` in first-person mode so first-person movement is unchanged.

The fallback factor is deliberately not capped. Successful surface picks already produce factors of the same magnitude, and `Camera.zoom()` enforces its existing minimum eye-to-look distance.

### Applying the dolly

For orbit and plan-view navigation:

- When a World-space pointer target exists, continue using `PanController.dollyToCanvasPos()` exactly as today.
- When no pointer target exists, update orthographic scale as currently done for non-follow-pointer navigation and call `Camera.zoom()`.

Using `Camera.zoom()` in the fallback is important: it changes `eyeLookDist`, so the fallback factor decreases on successive zoom-in events and increases on zoom-out events. Calling `dollyToCanvasPos()` without a target would translate both `eye` and `look`, leave `eyeLookDist` unchanged, and therefore keep the fallback speed artificially constant.

First-person navigation retains its current code path.

## Files

- Modify `src/viewer/scene/CameraControl/lib/CameraUpdater.js`.
- Add a Playwright regression scene and focused functional test under `test-scenes/` and `tests/`.
- Rebuild distributable bundles only after source tests pass, following the repository's existing build workflow.

## Verification

The regression test will cover:

1. `followPointer=true`, orbit mode, and no pick below the pointer: one wheel input must change `eyeLookDist` by a distance-scaled amount rather than the raw fixed-rate amount.
2. A successful surface pick: the existing zoom-to-pointer path remains active.
3. Repeated fallback zoom-in events: movement decreases as `eyeLookDist` decreases, preventing a constant high-speed approach.
4. First-person mode: no distance-scaled fallback is introduced.

Manual verification will load the standalone `app/data/test/manifest.json` model in `hat-bim-viewer-v2`, confirm responsive wheel zoom over empty pixels near the sparse model, and confirm that the combined `test + test1` case still behaves normally.

## Risks

- Switching between fallback center zoom and surface-target zoom may be perceptible when a tiny object first becomes pickable. The transition is bounded by the existing proximity calculation and is preferable to the current near-stationary fallback.
- Orthographic navigation must keep `ortho.scale` synchronized with the fallback delta, matching the existing non-follow-pointer branch.
- Generated `dist/` changes must not overwrite unrelated local bundle changes; only build outputs attributable to this source change should be included.
