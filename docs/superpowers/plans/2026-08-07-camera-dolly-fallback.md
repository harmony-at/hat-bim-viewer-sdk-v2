# Sparse Model Dolly Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mouse-wheel zoom remain useful when `followPointer` cannot pick a surface, so the sparse `test` model can zoom in and out when loaded alone without changing successful pointer-follow zoom or first-person behavior.

**Architecture:** Keep the existing pointer-hit dolly calculation unchanged. When orbit or plan-view navigation has no picked world position, derive the fallback multiplier from `camera.eyeLookDist / dollyProximityThreshold`, clamp it with the existing minimum speed, and apply the movement through `camera.zoom()` so the eye-to-look distance shrinks or grows and subsequent wheel steps naturally decelerate. Cover the private updater directly with a deterministic browser harness, then verify the real XKT model from an isolated worktree build.

**Tech Stack:** JavaScript ES modules, xeokit `CameraUpdater`, Playwright Chromium, Rollup, static HTTP server.

## Global Constraints

- Execute this plan in an isolated SDK worktree created with `superpowers:using-git-worktrees` at `.worktrees/camera-dolly-fallback`.
- Preserve the user's existing modifications to `dist/xeokit-sdk.*` and the untracked `yarn.lock` in the main SDK checkout. Never stage, overwrite, reset, or clean those files.
- Do not add a public configuration option or a model-specific wheel-rate override.
- Keep the successful `followPointer` surface-hit path byte-for-byte equivalent in behavior.
- Keep first-person no-hit behavior at multiplier `1.0` and on its existing pan-controller path.
- Generated `dist/` changes are build artifacts for verification only and must not be committed.
- Stage files by explicit path. Do not use `git add .` or `git add -A`.

---

## Task 1: Add a deterministic browser regression harness

**Files:**

- Create: `test-scenes/cameraControl_dollyFallback.html`
- Create: `tests/camera-control-dolly-fallback.spec.js`
- Reference: `test-scenes/lib/utils.js`
- Reference: `tests/lib.js`

- [ ] **Step 1: Create the browser test scene**

Create `test-scenes/cameraControl_dollyFallback.html` with the following complete harness. It imports `CameraUpdater` from source, supplies only the camera/control contracts used by the updater, and exposes repeatable scenarios to Playwright:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>CameraControl dolly fallback</title>
</head>
<body>
<script type="module">
import {CameraUpdater} from "../src/viewer/scene/CameraControl/lib/CameraUpdater.js";
import {signalTestComplete} from "./lib/utils.js";

function createHarness({pickedWorldPos = null, firstPerson = false, planView = false} = {}) {
    let tick;
    const zoomCalls = [];
    const panCalls = [];

    const camera = {
        eye: [0, 0, 6000],
        look: [0, 0, 0],
        up: [0, 1, 0],
        projection: "perspective",
        ortho: {scale: 1},
        get eyeLookDist() {
            const dx = this.eye[0] - this.look[0];
            const dy = this.eye[1] - this.look[1];
            const dz = this.eye[2] - this.look[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        },
        zoom(delta) {
            zoomCalls.push(delta);
            this.eye[2] += delta;
        },
        pan() {},
        pitch() {},
        yaw() {}
    };

    const scene = {
        camera,
        on(event, callback) {
            if (event === "tick") {
                tick = callback;
            }
            return "tick-subscription";
        },
        off() {}
    };

    const pickController = {
        pickCursorPos: null,
        schedulePickSurface: false,
        pickResult: null,
        update() {
            this.pickResult = pickedWorldPos ? {worldPos: pickedWorldPos} : null;
        },
        fireEvents() {}
    };

    const panController = {
        dollyToCanvasPos(worldPos, canvasPos, amount) {
            panCalls.push({worldPos, canvasPos, amount});
            return false;
        }
    };

    const pivotController = {
        getPivoting() {
            return false;
        },
        continuePivot() {},
        showPivot() {}
    };

    const cameraControl = {
        _cursors: {
            rotate: "grabbing",
            pan: "move",
            dollyForward: "zoom-in",
            dollyBackward: "zoom-out"
        }
    };

    const controllers = {
        pickController,
        panController,
        pivotController,
        cameraControl
    };

    const configs = {
        active: true,
        pointerEnabled: true,
        followPointer: true,
        firstPerson,
        planView,
        constrainVertical: false,
        dollyProximityThreshold: 30,
        dollyMinSpeed: 0.04,
        dollyInertia: 0,
        rotationInertia: 0,
        panInertia: 0
    };

    const states = {
        followPointerDirty: true,
        pointerCanvasPos: [10, 10]
    };

    const updates = {
        rotateDeltaX: 0,
        rotateDeltaY: 0,
        panDeltaX: 0,
        panDeltaY: 0,
        panDeltaZ: 0,
        dollyDelta: 0
    };

    new CameraUpdater(
        scene,
        controllers,
        configs,
        states,
        updates
    );

    function runStep() {
        const beforeDistance = camera.eyeLookDist;
        const zoomStart = zoomCalls.length;
        const panStart = panCalls.length;
        states.followPointerDirty = true;
        updates.dollyDelta = -1;
        tick();
        return {
            beforeDistance,
            afterDistance: camera.eyeLookDist,
            zoomCalls: zoomCalls.slice(zoomStart),
            panCalls: panCalls.slice(panStart)
        };
    }

    return {runStep};
}

window.runDollyScenario = (options = {}) => {
    const harness = createHarness(options);
    const steps = [];
    const stepCount = options.steps || 1;
    for (let i = 0; i < stepCount; i++) {
        steps.push(harness.runStep());
    }
    return {steps};
};

signalTestComplete();
</script>
</body>
</html>
```

- [ ] **Step 2: Create focused Playwright tests**

Create `tests/camera-control-dolly-fallback.spec.js`:

```js
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
```

- [ ] **Step 3: Run the regression test against the current implementation**

Run from the isolated SDK worktree:

```bash
npx playwright test tests/camera-control-dolly-fallback.spec.js --project=chromium
```

Expected result before the fix: the orbit, plan-view, and repeated no-hit tests fail because no `camera.zoom()` call occurs; the surface-hit and first-person tests pass. If the harness itself throws, fix the harness before modifying production code.

- [ ] **Step 4: Check the test-only diff**

```bash
git diff --check -- test-scenes/cameraControl_dollyFallback.html tests/camera-control-dolly-fallback.spec.js
```

Expected result: exit code `0` with no output.

## Task 2: Implement the no-hit dolly fallback

**Files:**

- Modify: `src/viewer/scene/CameraControl/lib/CameraUpdater.js`
- Test: `tests/camera-control-dolly-fallback.spec.js`

- [ ] **Step 1: Scale a failed-pick fallback from camera distance**

In the `configs.followPointer` block that updates `dollyDistFactor`, preserve the successful-pick code and the existing distance calculation below it. Replace only the failed-pick branch with:

```js
} else {
    dollyDistFactor = configs.firstPerson
        ? 1.0
        : camera.eyeLookDist / configs.dollyProximityThreshold;
    followPointerWorldPos = null;
}
```

Leave the later `if (followPointerWorldPos)` distance calculation and the existing `dollyMinSpeed` clamp unchanged.

- [ ] **Step 2: Route only a valid pointer target through pointer dolly**

In both the plan-view and orbit dolly application branches, change the pointer-dolly condition from:

```js
if (configs.followPointer) {
```

to:

```js
if (configs.followPointer && followPointerWorldPos) {
```

The existing `else` branch must continue updating orthographic scale and calling `camera.zoom(dollyDeltaForDist)`. Do not alter the separate first-person branch above it.

- [ ] **Step 3: Run the focused regression suite**

```bash
npx playwright test tests/camera-control-dolly-fallback.spec.js --project=chromium
```

Expected result: all five tests pass. Specifically, a 6000-unit eye-look distance produces a first no-hit zoom delta of `-200` in orbit and plan view, the second orbit delta is approximately `-193.333333`, the picked target still uses `dollyToCanvasPos`, and first-person still uses amount `1`.

- [ ] **Step 4: Inspect the surgical production diff**

```bash
git diff -- src/viewer/scene/CameraControl/lib/CameraUpdater.js
git diff --check -- src/viewer/scene/CameraControl/lib/CameraUpdater.js
```

Expected result: only the failed-pick multiplier and the valid-target condition changed; `git diff --check` exits `0`.

- [ ] **Step 5: Commit source and regression coverage only**

```bash
git add src/viewer/scene/CameraControl/lib/CameraUpdater.js test-scenes/cameraControl_dollyFallback.html tests/camera-control-dolly-fallback.spec.js
git diff --cached --check
git commit -m "fix: scale dolly fallback for sparse models"
```

Expected result: one commit containing exactly the production source file, browser harness, and Playwright spec. No `dist/` file or lockfile is staged.

## Task 3: Build and verify the real sparse model

**Files:**

- Verify: `dist/xeokit-sdk.es.js` in the isolated worktree only
- Verify model: `/Volumes/Datas/www/harmonyAT/xeokit-viewer/hat-bim-viewer-v2/app/data/test/manifest.json`
- Verify combined model: `/Volumes/Datas/www/harmonyAT/xeokit-viewer/hat-bim-viewer-v2/app/data/test1/manifest.json`

- [ ] **Step 1: Build the SDK in the isolated worktree**

```bash
npm run build
```

Expected result: Rollup exits `0` and produces the SDK bundles. These generated changes remain unstaged.

- [ ] **Step 2: Re-run the focused tests after the build**

```bash
npx playwright test tests/camera-control-dolly-fallback.spec.js --project=chromium
```

Expected result: all five tests pass after bundle generation as well.

- [ ] **Step 3: Serve the workspace for real-model verification**

In one terminal, serve `/Volumes/Datas/www/harmonyAT/xeokit-viewer` for the model data:

```bash
npx http-server /Volumes/Datas/www/harmonyAT/xeokit-viewer -a 127.0.0.1 -p 8082 --cors
```

In a second terminal, serve the isolated SDK worktree and its newly built bundle:

```bash
npx http-server /Volumes/Datas/www/harmonyAT/xeokit-viewer/hat-bim-viewer-sdk-v2/.worktrees/camera-dolly-fallback -a 127.0.0.1 -p 8083 --cors
```

Keep both processes running only for the next two browser checks.

- [ ] **Step 4: Verify `test` alone with the worktree bundle**

Open `http://127.0.0.1:8083/test-scenes/cameraControl_dollyFallback.html` in the browser and run this module expression in the page context:

```js
(async () => {
    const sdk = await import("/dist/xeokit-sdk.es.js");
    window.xeokit = sdk;
    document.body.innerHTML = '<canvas id="verifyCanvas" style="width:100vw;height:100vh"></canvas>';
    const viewer = new sdk.Viewer({canvasId: "verifyCanvas", transparent: true});
    viewer.cameraControl.followPointer = true;
    const loader = new sdk.XKTLoaderPlugin(viewer);
    const model = loader.load({
        id: "test",
        manifestSrc: "http://127.0.0.1:8082/hat-bim-viewer-v2/app/data/test/manifest.json",
        excludeUnclassifiedObjects: true
    });
    await new Promise((resolve, reject) => {
        model.on("loaded", resolve);
        model.on("error", reject);
    });
    viewer.cameraFlight.jumpTo({aabb: model.aabb});
    window.sparseModelVerification = {viewer, model};
    return {
        entityCount: model.numEntities,
        eyeLookDist: viewer.camera.eyeLookDist,
        aabb: Array.from(model.aabb)
    };
})()
```

Evaluate `window.sparseModelVerification.viewer.camera.eyeLookDist`, move the pointer over empty canvas near the model, scroll in and out, then evaluate the same expression again after each direction. Expected result: the value changes by a clearly visible amount in both directions, zoom-in steps get smaller as the camera approaches its look point, and orbit/pan remain responsive.

- [ ] **Step 5: Verify successful pointer zoom with `test` and `test1` combined**

In the same page, load the second manifest:

```js
(async () => {
    const {viewer} = window.sparseModelVerification;
    const loader = new window.xeokit.XKTLoaderPlugin(viewer);
    const model = loader.load({
        id: "test1",
        manifestSrc: "http://127.0.0.1:8082/hat-bim-viewer-v2/app/data/test1/manifest.json",
        excludeUnclassifiedObjects: true
    });
    await new Promise((resolve, reject) => {
        model.on("loaded", resolve);
        model.on("error", reject);
    });
    viewer.cameraFlight.jumpTo({aabb: viewer.scene.getAABB()});
    return {entityCount: model.numEntities};
})()
```

Point at visible `test1` pipe geometry and scroll. Expected result: zoom still follows the picked surface with the same target-dependent speed as before the fix.

- [ ] **Step 6: Confirm build artifacts are not part of the commit**

From the isolated SDK worktree:

```bash
git status --short
git show --stat --oneline HEAD
```

Expected result: generated `dist/` files may appear modified in the worktree status, but the commit stat lists only `CameraUpdater.js`, the browser test scene, and the Playwright test. Do not commit the generated files.

- [ ] **Step 7: Stop the temporary server and record verification evidence**

Stop both `http-server` processes with `Ctrl-C`. Record the focused test result, build result, initial and post-wheel `eyeLookDist` values for `test`, and the combined-model pointer-zoom observation in the handoff.

## Task 4: Final integrity checks

**Files:**

- Review: `src/viewer/scene/CameraControl/lib/CameraUpdater.js`
- Review: `test-scenes/cameraControl_dollyFallback.html`
- Review: `tests/camera-control-dolly-fallback.spec.js`

- [ ] **Step 1: Verify the final commit contents**

```bash
git diff HEAD^ --name-only
git diff HEAD^ --check
```

Expected result: exactly three paths are listed and the whitespace check exits `0`.

- [ ] **Step 2: Verify the main checkout was untouched**

From `/Volumes/Datas/www/harmonyAT/xeokit-viewer/hat-bim-viewer-sdk-v2`:

```bash
git status --short
```

Expected result: the pre-existing modified `dist/xeokit-sdk.*` files and untracked `yarn.lock` remain present exactly as they were before implementation; no implementation source or test file is modified in the main checkout until the user chooses an integration method.

- [ ] **Step 3: Prepare the handoff**

Report the implementation commit hash, the five-test Playwright result, the Rollup build result, the real `test` model wheel-distance evidence, the combined-model regression result, and the fact that generated bundles were deliberately left uncommitted.
