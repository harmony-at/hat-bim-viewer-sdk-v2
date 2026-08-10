import {expect, setupPage} from "./lib.js";

const PAGE = "cameraControl_dollyFallback.html";

setupPage("orbit no-hit zoom scales with eye-look distance", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario());
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(1);
    expect(step.zoomCalls[0]).toBeCloseTo(-200, 6);
    expect(step.afterDistance).toBeCloseTo(5800, 6);
    expect(step.panCalls).toHaveLength(0);
});

setupPage("plan-view no-hit zoom uses the same fallback", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({planView: true}));
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(1);
    expect(step.zoomCalls[0]).toBeCloseTo(-200, 6);
    expect(step.afterDistance).toBeCloseTo(5800, 6);
    expect(step.panCalls).toHaveLength(0);
});

setupPage("surface-hit followPointer behavior remains unchanged", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({
        pickedWorldPos: [0, 0, 3000]
    }));
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(0);
    expect(step.panCalls).toHaveLength(1);
    expect(step.panCalls[0].worldPos).toEqual([0, 0, 3000]);
    expect(step.panCalls[0].amount).toBeCloseTo(100, 6);
});

setupPage("legacy traversal refreshes the pointer reference in every dolly mode", PAGE, async (page) => {
    const result = await page.evaluate(() => ({
        orbit: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], dolliedThroughSurface: true}),
        plan: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], planView: true, dolliedThroughSurface: true}),
        firstPerson: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], firstPerson: true, dolliedThroughSurface: true})
    }));

    expect(result.orbit.steps[0].followPointerDirty).toBe(true);
    expect(result.plan.steps[0].followPointerDirty).toBe(true);
    expect(result.firstPerson.steps[0].followPointerDirty).toBe(true);
});

setupPage("active wheel crossing marks the Zoom Anchor in every dolly mode", PAGE, async (page) => {
    const result = await page.evaluate(() => ({
        orbit: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], wheelContext: true, dolliedThroughSurface: true}),
        plan: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], planView: true, wheelContext: true, dolliedThroughSurface: true}),
        firstPerson: window.runDollyScenario({pickedWorldPos: [0, 0, 3000], firstPerson: true, wheelContext: true, dolliedThroughSurface: true})
    }));

    expect(result.orbit.steps[0].zoomAnchorCrossedCount).toBe(1);
    expect(result.plan.steps[0].zoomAnchorCrossedCount).toBe(1);
    expect(result.firstPerson.steps[0].zoomAnchorCrossedCount).toBe(1);
});

setupPage("repeated no-hit zoom slows as the camera approaches the look point", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({steps: 2}));
    const firstDelta = Math.abs(result.steps[0].zoomCalls[0]);
    const secondDelta = Math.abs(result.steps[1].zoomCalls[0]);

    expect(firstDelta).toBeCloseTo(200, 6);
    expect(secondDelta).toBeCloseTo(5800 / 30, 6);
    expect(secondDelta).toBeLessThan(firstDelta);
});

setupPage("first-person no-hit behavior keeps unit-speed pan dolly", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({firstPerson: true}));
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(0);
    expect(step.panCalls).toHaveLength(1);
    expect(step.panCalls[0].worldPos).toBeNull();
    expect(step.panCalls[0].amount).toBeCloseTo(1, 6);
});

setupPage("first-person wheel context uses the stable fallback anchor", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({firstPerson: true, wheelContext: true}));
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(0);
    expect(step.panCalls).toHaveLength(1);
    expect(step.panCalls[0].worldPos).toEqual([0, 0, 0]);
    expect(step.panCalls[0].amount).toBeCloseTo(200, 6);
});

setupPage("plan-view wheel context uses the stable fallback anchor", PAGE, async (page) => {
    const result = await page.evaluate(() => window.runDollyScenario({planView: true, wheelContext: true}));
    const step = result.steps[0];

    expect(step.zoomCalls).toHaveLength(0);
    expect(step.panCalls).toHaveLength(1);
    expect(step.panCalls[0].worldPos).toEqual([0, 0, 0]);
    expect(step.panCalls[0].amount).toBeCloseTo(200, 6);
});
