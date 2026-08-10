const WHEEL_PIXELS_PER_LINE = 16;
const WHEEL_SESSION_GAP_MS = 160;
const WHEEL_DELTA_PIXEL = 0;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

function normalizeWheelDelta(deltaY, deltaMode, canvasHeight) {
    if (!Number.isFinite(deltaY) || deltaY === 0) {
        return 0;
    }

    const pageSize = Math.max(1, Number.isFinite(canvasHeight) ? canvasHeight : 1);
    let pixelDelta = deltaY;

    if (deltaMode === WHEEL_DELTA_LINE) {
        pixelDelta *= WHEEL_PIXELS_PER_LINE;
    } else if (deltaMode === WHEEL_DELTA_PAGE) {
        pixelDelta *= pageSize;
    }

    return Math.max(-pageSize, Math.min(pageSize, pixelDelta));
}

function computeZoomDelta(delta, distance, proximityThreshold, minimumFactor, crossed = false) {
    if (!Number.isFinite(delta)
        || delta === 0
        || !Number.isFinite(distance)
        || distance < 0
        || (!crossed && distance === 0)) {
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
    const outwardStep = baseStep * 1.25;
    return crossed ? outwardStep : Math.min(outwardStep, distance);
}

const MIN_NORMALIZATION_DENOMINATOR = 1e-9;

export {
    computeZoomDelta,
    normalizeWheelDelta,
    WHEEL_SESSION_GAP_MS
};
