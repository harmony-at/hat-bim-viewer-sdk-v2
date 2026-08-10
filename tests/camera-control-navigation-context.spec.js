import {expect, test} from "@playwright/test";

const navigationContextBaseURL = process.env.NAVIGATION_CONTEXT_BASE_URL || "http://localhost:8080";

test.beforeEach(async ({page}) => {
    await page.goto(`${navigationContextBaseURL}/test-scenes/cameraControl_navigationContext.html`);
    await expect(page.locator("#percyLoaded")).toBeAttached();
});

test("normalizes wheel units without discarding magnitude", async ({page}) => {
    const result = await page.evaluate(() => window.runWheelNormalizationScenario());

    expect(result).toEqual({
        pixel: 7.5,
        line: 48,
        halfPage: 400,
        clampedPage: 800,
        negativeLine: -32,
        zero: 0,
        sessionGap: 160
    });
});

test("keeps one copied anchor per 160 ms zoom session", async ({page}) => {
    const result = await page.evaluate(() => window.runZoomSessionScenario());

    expect(result).toEqual({
        first: [0, 0, -10],
        same: [0, 0, -10],
        next: [4, 0, -20],
        firstSource: "cursor-hit",
        nextSource: "cursor-hit",
        pickCount: 2
    });
});

test("constructs every off-center MISS fallback on the pointer ray", async ({page}) => {
    const result = await page.evaluate(() => window.runPointerRayFallbackScenario());

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
    expect(result.pickCounts).toEqual([0, 1, 0, 0]);
});

test("measures MISS fallback depth along the pointer ray", async ({page}) => {
    const result = await page.evaluate(() => window.runPointerRayDepthScenario());

    expect(result.perspective.lookSignedDepth).toBeCloseTo(10, 8);
    expect(result.perspective.lookDepth).toBeCloseTo(10, 8);
    expect(result.ortho.lookSignedDepth).toBeCloseTo(10, 8);
    expect(result.ortho.lookDepth).toBeCloseTo(10, 8);
    expect(result.ortho.lookWorldZ).toBeCloseTo(0, 8);
    expect(result.ortho.dollyStep).toBeCloseTo(10 / 30, 8);
});

test("keeps a crossed anchor for its session and clears crossed state in the next session", async ({page}) => {
    const result = await page.evaluate(() => window.runCrossedAnchorLifetimeScenario());

    expect(result).toEqual({
        sameCrossed: true,
        sameRecord: true,
        sameSessionPickCount: 1,
        nextCrossed: false,
        nextRecord: false,
        nextSessionPickCount: 2
    });
});

test("keeps the original zoom-session ray after same-session invalidation", async ({page}) => {
    const result = await page.evaluate(() => window.runInvalidatedSessionRayScenario());

    expect(result.sameSessionCanvasPos).toEqual([500, 400]);
    expect(result.sameSessionDirection).toEqual([0, 0, -1]);
    expect(result.nextSessionCanvasPos).toEqual([750, 250]);
    expect(result.nextSessionDirection).not.toEqual(result.sameSessionDirection);
});

test("resolves MISS using pivot, last hit, bounds, then camera look depth", async ({page}) => {
    const result = await page.evaluate(() => window.runFallbackOrderScenario());

    expect(result.pivot.source).toBe("navigation-pivot");
    expect(result.pivot.canvasPos).toEqual([100, 100]);
    expect(result.pivot.worldPos).not.toEqual([2, 0, -8]);
    expect(result.last.source).toBe("last-valid-hit");
    expect(result.last.worldPos[2]).toBeCloseTo(-12, 8);
    expect(result.bounds.source).toBe("visible-bounds");
    expect(result.bounds.worldPos[2]).toBeCloseTo(-10, 8);
    expect(result.forward.source).toBe("camera-look-depth");
    expect(result.forward.worldPos[2]).toBeCloseTo(-10, 8);
});

test("rejects invalid hit and visible-bounds candidates", async ({page}) => {
    const result = await page.evaluate(() => window.runInvalidCandidateScenario());

    expect(result).toEqual({
        nonFinite: "camera-look-depth",
        behind: "camera-look-depth",
        offscreen: "camera-look-depth"
    });
});

test("falls back without repicking when an anchor source becomes invalid", async ({page}) => {
    const result = await page.evaluate(() => window.runInvalidationScenario());

    expect(result).toMatchObject({
        hidden: "camera-look-depth",
        unloaded: "camera-look-depth",
        clipped: "camera-look-depth",
        clippedPivot: {source: "camera-look-depth"},
        destroyed: "camera-look-depth",
        nonObject: "cursor-hit",
        pickCounts: [1, 1, 1, 2, 1]
    });
    expect(result.clippedPivot.worldPos[2]).toBeGreaterThan(-5);
    expect(result.clippedPivot.worldPos[2]).toBeLessThan(0);
});

test("preserves legacy sign/time wheel behavior when followPointer is false", async ({page}) => {
    const result = await page.evaluate(() => window.runLegacyWheelHandlerScenario());

    expect(result.small.dollyDelta).toBeCloseTo(100 / 60, 6);
    expect(result.large.dollyDelta).toBeCloseTo(result.small.dollyDelta, 6);
    expect(result.small.inputSource).toBeNull();
    expect(result.large.inputSource).toBeNull();
});

test("feeds pixel-equivalent wheel magnitude and session metadata to CameraUpdater", async ({page}) => {
    const result = await page.evaluate(() => window.runWheelHandlerScenario());

    expect(result.pixel1.dollyDelta).toBeCloseTo(1 / 60, 8);
    expect(result.pixel100.dollyDelta).toBeCloseTo(100 / 60, 8);
    expect(result.lines.dollyDelta).toBeCloseTo(48 / 60, 8);
    expect(result.pages.dollyDelta).toBeCloseTo(800 / 60, 8);
    expect(result.pages.timestamp).toBe(40);
    expect(result.pages.lastEventTime).toBeGreaterThan(0);
    expect(result.pages.canvasPos).toEqual([250, 300]);
    expect(result.zero.dollyDelta).toBe(0);
    expect(result.zero.timestamp).toBe(result.beforeZeroTimestamp);
});

test("returns no anchor when section planes exclude the entire forward ray", async ({page}) => {
    const result = await page.evaluate(() => window.runInvalidSectionFallbackScenario());

    expect(result).toEqual({parallel: null, parallelAgain: null, parallelAABBReads: 1, contradictory: null});
});

test("preserves zoom speed, bounds crossing, and resets the post-cross factor", async ({page}) => {
    const result = await page.evaluate(() => window.runZoomDeltaScenario());

    expect(result.beforeCrossNear).toBeCloseTo(-10 / 30, 8);
    expect(result.beforeCrossFar).toBeCloseTo(-100 / 30, 8);
    expect(result.crossing).toBeCloseTo(-(10 + 100 * 0.04), 8);
    expect(result.afterCrossIn).toBeCloseTo(-100 * 0.04, 8);
    expect(result.afterCrossInAtAnchor).toBeCloseTo(-100 * 0.04, 8);
    expect(result.afterCrossOut).toBeCloseTo(100 * 0.04 * 1.25, 8);
    expect(result.afterCrossOutNear).toBeCloseTo(100 * 0.04 * 1.25, 8);
    expect(result.afterCrossOutAtAnchor).toBeCloseTo(100 * 0.04 * 1.25, 8);
    expect(result.outward).toBeCloseTo(10 / 30 * 1.25, 8);
});

test("CameraUpdater preserves crossing overshoot and resets speed for the crossed session", async ({page}) => {
    const result = await page.evaluate(() => window.runCameraUpdaterCrossingScenario());

    expect(result.preCrossStep).toBeCloseTo(result.currentCurveStep, 8);
    expect(result.crossingOvershoot).toBeGreaterThan(0);
    expect(result.crossingOvershoot).toBeLessThanOrEqual(result.crossingInput * result.minimumFactor + 1e-8);
    expect(result.postCrossInStep).toBeCloseTo(result.postCrossInInput * result.minimumFactor, 8);
    expect(result.postCrossOutStep).toBeCloseTo(result.postCrossOutInput * result.minimumFactor * 1.25, 8);
    expect(result.preCrossDisplacement).toBeCloseTo(result.preCrossStep, 8);
    expect(result.crossingDisplacement).toBeCloseTo(result.crossingStep, 8);
    expect(result.postCrossInDisplacement).toBeCloseTo(result.postCrossInStep, 8);
    expect(result.postCrossOutDisplacement).toBeCloseTo(-result.postCrossOutStep, 8);
    expect(result.nextSessionDisplacement).toBeCloseTo(result.nextSessionStep, 8);
    expect(result.preCrossCrossed).toBe(false);
    expect(result.crossingCrossed).toBe(true);
    expect(result.postCrossInCrossed).toBe(true);
    expect(result.postCrossOutCrossed).toBe(true);
    expect(result.sameSessionAnchorIdentity).toBe(true);
    expect(result.sameSessionPickCount).toBe(1);
    expect(result.sameSessionBeginCount).toBe(4);
    expect(result.sameSessionCanvasPos).toEqual(result.initialCanvasPos);
    expect(result.nextSessionAnchorIdentity).toBe(true);
    expect(result.nextSessionPickCount).toBe(2);
    expect(result.nextSessionBeginCount).toBe(5);
    expect(result.nextSessionCrossed).toBe(false);
    expect(result.nextSessionStep).toBeCloseTo(result.nextSessionCurrentCurveStep, 8);
});

test("first-person vertical constraint only marks crossed after constrained motion crosses the anchor", async ({page}) => {
    const result = await page.evaluate(() => window.runFirstPersonConstrainedCrossingScenario());

    expect(result.eye[1]).toBe(5);
    expect(result.look[1]).toBe(5);
    expect(result.crossed).toBe(false);
});

test("expires wheel anchor after input silence while preserving inertia", async ({page}) => {
    const result = await page.evaluate(() => window.runExpiredInertiaScenario());

    expect(result.beginCount).toBe(0);
    expect(result.warmupPanCount).toBe(1);
    expect(result.panCount).toBe(1);
    expect(result.zoomCalls).toHaveLength(1);
    expect(result.zoomCalls[0]).toBeCloseTo(-1 / 3, 8);
    expect(result.remainingDelta).toBeCloseTo(-0.5, 8);
});

test("keeps one fixed perspective Pan Reference for the drag", async ({page}) => {
    const result = await page.evaluate(() => window.runPanHandlerScenario());

    expect(result.resolveCount).toBe(1);
    expect(result.panDeltaX).toBeCloseTo(1.5 * 40 * 20 * Math.tan(Math.PI / 6) / 800, 8);
});

test("preserves legacy MISS pan depth when followPointer is false", async ({page}) => {
    const result = await page.evaluate(() => window.runFollowPointerDisabledPanScenario());

    expect(result.resolveCount).toBe(0);
    expect(result.panDeltaX).toBeCloseTo(1.5 * 40 * 5 * Math.tan(Math.PI / 6) / 800, 8);
});

test("clears an in-progress pan when CameraControl is disabled", async ({page}) => {
    const result = await page.evaluate(() => window.runPanDisableResetScenario());

    expect(result.beforeDisable).toBeGreaterThan(0);
    expect(result.afterEnable).toBeCloseTo(result.beforeDisable, 8);
});

test("keeps a physically held modifier active across consecutive drags", async ({page}) => {
    const result = await page.evaluate(() => window.runHeldModifierPanScenario());

    expect(result.afterFirstDrag).toBeGreaterThan(0);
    expect(result.afterSecondDrag).toBeGreaterThan(result.afterFirstDrag);
});

test("translates camera and Navigation Pivot by the same effective pan", async ({page}) => {
    const result = await page.evaluate(() => window.runPanPivotTranslationScenario());

    expect(result.eye).toEqual([2, -3, 10]);
    expect(result.look).toEqual([2, -3, 0]);
    expect(result.translated).toEqual([[2, -3, 0]]);
});

test("routes a successful mouse orbit pick through the context controller", async ({page}) => {
    const result = await page.evaluate(() => window.runOrbitPivotAdapterScenario());

    expect(result.established).toEqual([{worldPos: [1, 2, 3], reason: "orbit"}]);
});

test("routes empty-space orbit through the resolved pointer reference", async ({page}) => {
    const result = await page.evaluate(() => window.runEmptySpaceOrbitPivotAdapterScenario());

    expect(result.resolvedCanvasPositions).toEqual([[700, 300]]);
    expect(result.worldPivotCalls).toEqual([[3, 2, -9]]);
    expect(result.canvasPivotCalls).toEqual([]);
    expect(result.navigationPivotCalls).toEqual([]);
});

test("tears down child controllers without recursively destroying CameraControl", async ({page}) => {
    const result = await page.evaluate(() => window.runControllerTeardownScenario());

    expect(result).toEqual({
        selfDestroyCount: 0,
        childDestroyCount: 1,
        resetReasons: ["destroy"]
    });
});

test("orthographic zoom preserves the anchor canvas position", async ({page}) => {
    const result = await page.evaluate(() => window.runOrthographicAnchorScenario());

    expect(result.before).toBeCloseTo(660, 8);
    expect(result.after).toBeCloseTo(result.before, 8);
    expect(result.scale).toBeLessThan(10);
});

test("first-person wheel motion remains forward while vertical constraint is active", async ({page}) => {
    const result = await page.evaluate(() => window.runFirstPersonConstrainedWheelScenario());

    expect(result.eye[1]).toBe(5);
    expect(result.look[1]).toBe(5);
    expect(result.eye[2]).toBeLessThan(0);
});

test("CameraControl disable, flight, and axis-view paths reset navigation context", async ({page}) => {
    const result = await page.evaluate(() => window.runLifecycleResetScenario());

    expect(result.handlerResetCalls).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.contextResetCalls).toEqual(["camera-control-reset"]);
    expect(result.axisResetCalls).toEqual(["axis-view"]);
    expect(result.flightResetCalls).toEqual(["camera-flight"]);
});

test("vertical constraints also constrain Navigation Pivot translation", async ({page}) => {
    const result = await page.evaluate(() => window.runConstrainedPanPivotScenario());

    expect(result.eye).toEqual([2, 5, 10]);
    expect(result.look).toEqual([2, 5, 0]);
    expect(result.translated).toEqual([[2, 0, 0]]);
});

test("a MISS pan translates an existing pivot but never invents one from camera.look", async ({page}) => {
    const result = await page.evaluate(() => window.runPanMissPivotScenario());

    expect(result.existingReference.source).toBe("navigation-pivot");
    expect(result.existingReference.depth).toBeCloseTo(8, 8);
    expect(result.translatedFallback.source).toBe("navigation-pivot");
    expect(result.noPivotReference.source).toBe("camera-look-depth");
    expect(result.noPivotReference.depth).toBeCloseTo(10, 8);
    expect(result.noPivotFallback.source).toBe("camera-look-depth");
    expect(result.existingReference.direction).toEqual(result.noPivotReference.direction);
    expect(result.translatedFallback.direction).toEqual(result.noPivotFallback.direction);
});

test("keeps a crossed anchor valid when the camera is exactly on it", async ({page}) => {
    const result = await page.evaluate(() => window.runExactCrossedAnchorScenario());

    expect(result.sameRecord).toBe(true);
    expect(result.sameSource).toBe("cursor-hit");
    expect(result.pickCount).toBe(1);
});
