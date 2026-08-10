# Cursor-Ray Navigation Bug-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep empty-space zoom, orbit, and pan aligned with the pointer while allowing bounded surface crossing and resetting same-session zoom speed after the crossing.

**Architecture:** `NavigationContextController` remains the single owner of gesture references and constructs MISS references on the actual pointer ray at fallback depth. `CameraUpdater` uses one numeric zoom helper for the unchanged pre-cross speed curve, bounded crossing overshoot, and post-cross minimum speed, while `MousePickHandler` consumes the same reference for empty-space orbit.

**Tech Stack:** ES modules, xeokit camera/math utilities, deterministic browser harness, Playwright, Rollup.

## Global Constraints

- Apply the behavior only when `CameraControl.followPointer` is `true`; preserve the existing `followPointer=false` path.
- Perform at most one surface pick at Zoom Session start and no pick on render ticks.
- Keep the initial pointer canvas position and ray stable until the 160 ms Zoom Session ends.
- Preserve the existing distance-scaled zoom-speed curve before crossing.
- Bound crossing overshoot to one input-scaled `dollyMinSpeed` continuation step.
- Use the `dollyMinSpeed` distance factor after crossing until the session ends; do not mutate public configuration.
- Preserve lifecycle invalidation for hidden, destroyed, unloaded, and section-clipped sources.
- Add no public option, dependency, geometry traversal, or unrelated refactor.
- Preserve unrelated working-tree and generated-file changes.

## File Structure

- `src/viewer/scene/CameraControl/lib/NavigationUtils.js`: pure wheel normalization and zoom-step arithmetic.
- `src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js`: Zoom Session state, pointer-ray MISS references, fallback source identity, and crossed state.
- `src/viewer/scene/CameraControl/lib/CameraUpdater.js`: applies zoom/pan/rotation deltas and marks a Zoom Session crossed after camera movement.
- `src/viewer/scene/CameraControl/lib/handlers/MousePickHandler.js`: adapts left-button orbit start to the shared MISS reference.
- `test-scenes/cameraControl_navigationContext.html`: deterministic fake-scene scenarios that exercise the real production modules.
- `tests/camera-control-navigation-context.spec.js`: Playwright assertions for each regression scenario.
- `docs/navigation/trimble-like-navigation-manual-matrix.md`: physical-device acceptance rows for pointer-ray MISS and speed reset.

---

### Task 1: Encode bounded-through zoom arithmetic

**Files:**
- Modify: `src/viewer/scene/CameraControl/lib/NavigationUtils.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

**Interfaces:**
- Produces: `computeZoomDelta(delta, distance, proximityThreshold, minimumFactor, crossed = false): number`.
- Replaces: `computeBoundedZoomDelta(...)` and `getSafeZoomDistance(...)` in the camera updater and deterministic harness.

- [ ] **Step 1: Write the failing arithmetic scenario**

Replace `runBoundedZoomScenario` with a scenario that calls the wished-for interface:

```javascript
window.runZoomDeltaScenario = () => ({
    beforeCrossNear: computeZoomDelta(-1, 10, 30, 0.04, false),
    beforeCrossFar: computeZoomDelta(-1, 100, 30, 0.04, false),
    crossing: computeZoomDelta(-100, 10, 30, 0.04, false),
    afterCrossIn: computeZoomDelta(-100, 20, 30, 0.04, true),
    afterCrossOut: computeZoomDelta(100, 20, 30, 0.04, true),
    outward: computeZoomDelta(1, 10, 30, 0.04, false)
});
```

Assert exact curve and crossing behavior:

```javascript
test("preserves zoom speed, bounds crossing, and resets the post-cross factor", async ({page}) => {
    const result = await page.evaluate(() => window.runZoomDeltaScenario());
    expect(result.beforeCrossNear).toBeCloseTo(-10 / 30, 8);
    expect(result.beforeCrossFar).toBeCloseTo(-100 / 30, 8);
    expect(result.crossing).toBeCloseTo(-(10 + 100 * 0.04), 8);
    expect(result.afterCrossIn).toBeCloseTo(-100 * 0.04, 8);
    expect(result.afterCrossOut).toBeCloseTo(100 * 0.04 * 1.25, 8);
    expect(result.outward).toBeCloseTo(10 / 30 * 1.25, 8);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "preserves zoom speed"
```

Expected: FAIL because `computeZoomDelta` is not exported.

- [ ] **Step 3: Implement the pure zoom-step helper**

Implement the following behavior in `NavigationUtils.js`:

```javascript
function computeZoomDelta(delta, distance, proximityThreshold, minimumFactor, crossed = false) {
    if (!Number.isFinite(delta) || delta === 0 || !Number.isFinite(distance) || distance <= 0) {
        return 0;
    }
    const threshold = Math.max(MIN_NORMALIZATION_DENOMINATOR, proximityThreshold);
    const minFactor = Math.max(0, minimumFactor);
    const factor = crossed ? minFactor : Math.max(minFactor, distance / threshold);
    const baseStep = Math.abs(delta) * factor;

    if (delta < 0) {
        if (!crossed && baseStep >= distance) {
            return -(distance + Math.abs(delta) * minFactor);
        }
        return -baseStep;
    }
    return Math.min(baseStep * 1.25, distance);
}
```

Export `computeZoomDelta`; remove `computeBoundedZoomDelta` and `getSafeZoomDistance` only after all callers are migrated in Task 4.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: PASS with no console errors.

- [ ] **Step 5: Commit the arithmetic slice**

```bash
git add src/viewer/scene/CameraControl/lib/NavigationUtils.js test-scenes/cameraControl_navigationContext.html tests/camera-control-navigation-context.spec.js
git commit -m "fix: define bounded through zoom speed"
```

---

### Task 2: Construct MISS references on the pointer ray

**Files:**
- Modify: `src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

**Interfaces:**
- Produces: `NavigationContextController.resolveOrbitReference(canvasPos): PointerReference|null` without performing a pick.
- Produces: `NavigationContextController.markZoomAnchorCrossed(): void`.
- Produces: `PointerReference = {worldPos: number[3], canvasPos: number[2], depth: number, source: string, entityId, modelId, entity, crossed: boolean}`.
- Preserves: `beginOrContinueZoom`, `resolvePanReference`, `establishNavigationPivot`, `translateNavigationPivot`, and `reset`.

- [ ] **Step 1: Add a deterministic off-center camera ray to `FakeScene`**

Import `math` from `src/viewer/scene/math/math.js`, give the fake camera the same view/projection math as a perspective viewer, and use an actual canvas-like size:

```javascript
const eye = [0, 0, 0];
const look = [0, 0, -10];
this.camera = {
    eye,
    look,
    projection: "perspective",
    viewMatrix: math.lookAtMat4v(eye, look, [0, 1, 0], math.mat4()),
    projMatrix: math.perspectiveMat4(60 * Math.PI / 180, 1000 / 800, 0.1, 1000, math.mat4()),
    projectWorldPos: (worldPos) => [500 + worldPos[0] * 100, 400 - worldPos[1] * 100]
};
```

- [ ] **Step 2: Write RED scenarios for off-center fallback and crossed-state lifetime**

Add `runPointerRayFallbackScenario` that resolves pivot, last-hit, bounds, and eye-look MISS references at `[750, 250]`. Return each record's `canvasPos`, `source`, `depth`, and normalized direction from camera eye to `worldPos`. Assert:

```javascript
expect(result.pivot.canvasPos).toEqual([750, 250]);
expect(result.last.canvasPos).toEqual([750, 250]);
expect(result.bounds.canvasPos).toEqual([750, 250]);
expect(result.look.canvasPos).toEqual([750, 250]);
expect(result.pivot.source).toBe("navigation-pivot");
expect(result.last.source).toBe("last-valid-hit");
expect(result.bounds.source).toBe("visible-bounds");
expect(result.look.source).toBe("camera-look-depth");
for (const reference of [result.pivot, result.last, result.bounds, result.look]) {
    expect(reference.depth).toBeGreaterThan(0);
    expect(reference.direction).toEqual(result.expectedRayDirection);
}
```

Add `runCrossedAnchorLifetimeScenario`: start a hit Zoom Session, call `markZoomAnchorCrossed`, continue at 159 ms, then start a new session at 160 ms. Assert the same-session record has `crossed: true`, stays the same record with one pick, and the next session has `crossed: false` with two picks.

- [ ] **Step 3: Run the new context tests and verify RED**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "pointer ray|crossed anchor"
```

Expected: FAIL because fallbacks currently project their source positions, `resolveOrbitReference`/`markZoomAnchorCrossed` do not exist, and a behind-camera anchor is replaced.

- [ ] **Step 4: Implement pointer-ray construction**

Import `math`, reuse module-level vectors, and add a private helper equivalent to:

```javascript
_pointerRayRecord(canvasPos, depthRecord, source) {
    const depth = distance(this._scene.camera.eye, depthRecord.worldPos);
    if (!Number.isFinite(depth) || depth <= MIN_DISTANCE) {
        return null;
    }
    math.canvasPosToWorldRay(
        this._scene.canvas.canvas,
        this._scene.camera.viewMatrix,
        this._scene.camera.projMatrix,
        this._scene.camera.projection,
        canvasPos,
        rayOrigin,
        rayDirection
    );
    if (!isFiniteVec3(rayOrigin) || !isFiniteVec3(rayDirection)) {
        return null;
    }
    const worldPos = [
        rayOrigin[0] + rayDirection[0] * depth,
        rayOrigin[1] + rayDirection[1] * depth,
        rayOrigin[2] + rayDirection[2] * depth
    ];
    const record = {
        worldPos,
        canvasPos: copyVec2(canvasPos),
        depth,
        source,
        entityId: depthRecord.entityId || null,
        modelId: depthRecord.modelId || null,
        entity: depthRecord.entity || null,
        crossed: false
    };
    return this._isClipped(record) ? null : record;
}
```

Normalize `rayDirection` if `canvasPosToWorldRay` does not guarantee unit length. Change `_resolveFallback` so pivot, last-hit, visible-bounds, and camera-look candidates feed `_pointerRayRecord`; keep source identities and lifecycle metadata. Return `canvasPos` copied from the pointer, never from `_projectCanvasPos`.

- [ ] **Step 5: Add orbit and crossed-state methods without extra picking**

Implement:

```javascript
resolveOrbitReference(canvasPos) {
    return this._resolveFallback(canvasPos);
}

markZoomAnchorCrossed() {
    if (this._zoomAnchor) {
        this._zoomAnchor.crossed = true;
    }
}
```

At a new session, create a fresh record with `crossed: false`. During the same session, allow a crossed record to remain behind the camera while still rejecting invalidated, hidden, destroyed, unloaded, non-finite, or clipped records. Make `resolvePanReference` return the unified fallback's `worldPos`, `depth`, and `source` on MISS without establishing a new Navigation Pivot.

- [ ] **Step 6: Run the new and existing context tests**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "pointer ray|crossed anchor|MISS|invalid"
```

Expected: PASS. Existing fallback-order expectations must be updated only where the World-space point now correctly moves onto the off-center pointer ray or source changes from `camera-forward` to `camera-look-depth`.

- [ ] **Step 7: Commit the context slice**

```bash
git add src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js test-scenes/cameraControl_navigationContext.html tests/camera-control-navigation-context.spec.js
git commit -m "fix: align miss references with pointer ray"
```

---

### Task 3: Route empty-space orbit through the shared reference

**Files:**
- Modify: `src/viewer/scene/CameraControl/lib/handlers/MousePickHandler.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

**Interfaces:**
- Consumes: `resolveOrbitReference(canvasPos): PointerReference|null` from Task 2.
- Preserves: successful Cursor Hit establishment as a persistent Navigation Pivot.

- [ ] **Step 1: Write a failing empty-space orbit adapter scenario**

Add a second orbit scenario whose pick controller returns `null`. Stub `resolveOrbitReference` to return `{worldPos: [3, 2, -9], canvasPos: [700, 300], source: "camera-look-depth"}`. Record `pivotController.setPivotPos` and `setCanvasPivotPos` calls. Assert:

```javascript
expect(result.resolvedCanvasPositions).toEqual([[700, 300]]);
expect(result.worldPivotCalls).toEqual([[3, 2, -9]]);
expect(result.canvasPivotCalls).toEqual([]);
expect(result.navigationPivotCalls).toEqual([]);
```

- [ ] **Step 2: Run the orbit test and verify RED**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "empty-space orbit"
```

Expected: FAIL because `MousePickHandler` still calls `setCanvasPivotPos` or the old look/last-click branch.

- [ ] **Step 3: Implement the minimal MISS adapter**

In the left-button MISS branch:

```javascript
const orbitReference = navigationContextController.resolveOrbitReference(states.pointerCanvasPos);
if (orbitReference) {
    pivotController.setPivotPos(orbitReference.worldPos);
} else if (configs.smartPivot) {
    pivotController.setCanvasPivotPos(states.pointerCanvasPos);
} else if (this._lastClickedWorldPos) {
    pivotController.setPivotPos(this._lastClickedWorldPos);
} else {
    pivotController.setPivotPos(scene.camera.look);
}
pivotController.startPivot();
```

Do not call `establishNavigationPivot` for a virtual reference.

- [ ] **Step 4: Run hit and MISS orbit tests**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "orbit"
```

Expected: PASS for both successful hit routing and empty-space virtual pivot routing.

- [ ] **Step 5: Commit the orbit slice**

```bash
git add src/viewer/scene/CameraControl/lib/handlers/MousePickHandler.js test-scenes/cameraControl_navigationContext.html tests/camera-control-navigation-context.spec.js
git commit -m "fix: anchor empty-space orbit to pointer ray"
```

---

### Task 4: Apply crossing and speed reset in CameraUpdater

**Files:**
- Modify: `src/viewer/scene/CameraControl/lib/CameraUpdater.js`
- Modify: `src/viewer/scene/CameraControl/lib/NavigationUtils.js`
- Modify: `test-scenes/cameraControl_navigationContext.html`
- Modify: `tests/camera-control-navigation-context.spec.js`

**Interfaces:**
- Consumes: `computeZoomDelta(...)`, `PointerReference.crossed`, and `markZoomAnchorCrossed()`.
- Removes: visible-scene diagonal safety-distance caching from `CameraUpdater` and obsolete safe-distance exports after all callers migrate.

- [ ] **Step 1: Write the full CameraUpdater crossing scenario**

Create `runCameraUpdaterCrossingScenario` with a perspective camera at `[0, 0, 0]`, an off-center anchor at `[2, 0, -10]`, a stable anchor canvas position, a `PanController`, and a real `NavigationContextController` or stateful adapter. Drive:

1. A pre-cross tick whose delta is too small to reach the anchor.
2. A crossing tick with a large inward delta.
3. Another inward tick in the same session.
4. An outward tick in the same session.
5. A new-session inward tick with a new anchor.

Return camera positions, applied dolly distances, anchor identity, crossed flags, and pick/begin counts. Assert:

```javascript
expect(result.preCrossStep).toBeCloseTo(result.currentCurveStep, 8);
expect(result.crossingOvershoot).toBeGreaterThan(0);
expect(result.crossingOvershoot).toBeLessThanOrEqual(result.crossingInput * result.minimumFactor + 1e-8);
expect(result.postCrossInStep).toBeCloseTo(result.postCrossInInput * result.minimumFactor, 8);
expect(result.postCrossOutStep).toBeCloseTo(result.postCrossOutInput * result.minimumFactor * 1.25, 8);
expect(result.sameSessionPickCount).toBe(1);
expect(result.sameSessionCanvasPos).toEqual(result.initialCanvasPos);
expect(result.nextSessionPickCount).toBe(2);
expect(result.nextSessionCrossed).toBe(false);
expect(result.nextSessionStep).toBeCloseTo(result.nextSessionCurrentCurveStep, 8);
```

- [ ] **Step 2: Run the crossing scenario and verify RED**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js --project=chromium --grep "crossing overshoot"
```

Expected: FAIL because the current updater asymptotically stops before the anchor and has no crossed-state speed reset.

- [ ] **Step 3: Migrate CameraUpdater to `computeZoomDelta`**

Replace the current safe-distance calculation with:

```javascript
const distance = math.lenVec3(math.subVec3(activeZoomAnchor.worldPos, camera.eye, tempVec3));
dollyDeltaForDist = computeZoomDelta(
    updates.dollyDelta,
    distance,
    configs.dollyProximityThreshold,
    configs.dollyMinSpeed,
    activeZoomAnchor.crossed === true
);
```

Remove `getVisibleSceneDiagonal`, `visibleSceneDiagonal`, its timestamp/cache branch, `getSafeZoomDistance`, and the obsolete safety-distance import. Preserve expired wheel inertia and all non-wheel paths.

- [ ] **Step 4: Mark the session crossed after actual camera movement**

In the first-person, plan-view, and orbiting `dollyToCanvasPos` call sites, replace the old `followPointerDirty` response with:

```javascript
const dolliedThroughSurface = panController.dollyToCanvasPos(
    targetWorldPos,
    targetCanvasPos,
    -dollyDeltaForDist
);
if (dolliedThroughSurface && activeZoomAnchor) {
    navigationContextController.markZoomAnchorCrossed();
}
```

Do not repick, replace the canvas position, or mutate `configs.dollyMinSpeed`.

- [ ] **Step 5: Remove obsolete numeric helpers and update legacy expectations**

After `rg "computeBoundedZoomDelta|getSafeZoomDistance" src test-scenes tests` shows only obsolete definitions/tests, remove those definitions and imports. Delete the old safe-distance assertions; retain normalization, outward multiplier, expired inertia, orthographic lock, plan view, first-person, and vertical-constraint assertions.

- [ ] **Step 6: Run the focused navigation suite**

Run:

```bash
npx playwright test tests/camera-control-navigation-context.spec.js tests/camera-control-dolly-fallback.spec.js --project=chromium
```

Expected: all tests PASS with no browser console errors.

- [ ] **Step 7: Commit the updater slice**

```bash
git add src/viewer/scene/CameraControl/lib/CameraUpdater.js src/viewer/scene/CameraControl/lib/NavigationUtils.js test-scenes/cameraControl_navigationContext.html tests/camera-control-navigation-context.spec.js
git commit -m "fix: reset zoom speed after crossing anchor"
```

---

### Task 5: Verify integration and update the manual matrix

**Files:**
- Modify: `docs/navigation/trimble-like-navigation-manual-matrix.md`
- Generated by existing build: `dist/xeokit-sdk.cjs.js`
- Generated by existing build: `dist/xeokit-sdk.es.js`
- Generated by existing build: `dist/xeokit-sdk.es5.js`
- Generated by existing build: `dist/xeokit-sdk.min.cjs.js`
- Generated by existing build: `dist/xeokit-sdk.min.es.js`
- Generated by existing build: `dist/xeokit-sdk.min.es5.js`
- Generated by existing viewer build: `../hat-bim-viewer-v2/dist/xeokit-bim-viewer.es.js`
- Generated by existing viewer build: `../hat-bim-viewer-v2/dist/xeokit-bim-viewer.min.es.js`

**Interfaces:**
- Verifies the complete internal behavior without adding a public API.

- [ ] **Step 1: Run the complete deterministic navigation suite**

```bash
npx playwright test tests/camera-control-navigation-context.spec.js tests/camera-control-dolly-fallback.spec.js --project=chromium
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run debug-instrumentation and diff hygiene checks**

```bash
rg -n "\[DEBUG-" src test-scenes tests
git diff --check
```

Expected: no debug tags and no whitespace errors.

- [ ] **Step 3: Build the SDK**

```bash
npm run build
```

Expected: both Rollup configurations complete successfully. Keep only generated bundle changes that correspond to the navigation source changes; do not clean or overwrite unrelated files.

- [ ] **Step 4: Build the viewer against the local SDK**

Run from `../hat-bim-viewer-v2`:

```bash
npm run build
```

Expected: production and development viewer bundles complete successfully using the local `@xeokit/xeokit-sdk` dependency.

- [ ] **Step 5: Update physical-device acceptance rows**

Add rows that require:

```markdown
| Perspective | Any | Wheel over off-center background | Zoom follows the exact pointer ray; fallback source supplies depth only |
| Perspective | Any | Fast inward wheel crosses a surface | Crossing overshoot is small, same-session speed resets, and the camera remains controllable |
| Perspective | Multiple depth layers | Pause after crossing, then wheel again | The next session picks the newly exposed surface and restores distance-scaled speed |
| Orbit/Pan | Any | Drag begins over background | Orbit pivot and pan scale use the same pointer-ray fallback depth |
```

Mark physical-device results pending unless they were actually performed with real hardware.

- [ ] **Step 6: Re-run final verification after documentation/build outputs**

```bash
npx playwright test tests/camera-control-navigation-context.spec.js tests/camera-control-dolly-fallback.spec.js --project=chromium
git diff --check
```

Expected: tests PASS and diff check is clean.

- [ ] **Step 7: Commit verified source, tests, docs, and intended generated bundles**

Stage only files attributable to this fix after inspecting `git status --short` and `git diff --stat`:

```bash
git add src/viewer/scene/CameraControl/lib/NavigationUtils.js src/viewer/scene/CameraControl/lib/controllers/NavigationContextController.js src/viewer/scene/CameraControl/lib/CameraUpdater.js src/viewer/scene/CameraControl/lib/handlers/MousePickHandler.js test-scenes/cameraControl_navigationContext.html tests/camera-control-navigation-context.spec.js docs/navigation/trimble-like-navigation-manual-matrix.md
git commit -m "fix: keep pointer navigation stable through surfaces"
```

If generated SDK bundles are already modified by the user, report their verified build state but do not stage or overwrite them without separating ownership. Handle viewer-repository generated bundles in a separate viewer commit only when their diff is attributable to this fix.
