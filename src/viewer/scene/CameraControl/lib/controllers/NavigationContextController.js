import {WHEEL_SESSION_GAP_MS} from "../NavigationUtils.js";
import {math} from "../../../math/math.js";

const EXPANDED_VIEWPORT_FACTOR = 1.5;
const MIN_DISTANCE = 1e-9;
const rayOrigin = math.vec3();
const rayDirection = math.vec3();

function copyVec2(value) {
    return value ? [value[0], value[1]] : null;
}

function copyVec3(value) {
    return value ? [value[0], value[1], value[2]] : null;
}

function isFiniteVec3(value) {
    return value && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}

function distance(a, b) {
    const x = a[0] - b[0];
    const y = a[1] - b[1];
    const z = a[2] - b[2];
    return Math.sqrt(x * x + y * y + z * z);
}

function dotFromEye(camera, worldPos) {
    const viewX = camera.look[0] - camera.eye[0];
    const viewY = camera.look[1] - camera.eye[1];
    const viewZ = camera.look[2] - camera.eye[2];
    const viewLength = Math.sqrt(viewX * viewX + viewY * viewY + viewZ * viewZ);
    if (viewLength <= MIN_DISTANCE) {
        return -1;
    }
    return ((worldPos[0] - camera.eye[0]) * viewX
        + (worldPos[1] - camera.eye[1]) * viewY
        + (worldPos[2] - camera.eye[2]) * viewZ) / viewLength;
}

function dotFromOrigin(origin, worldPos, direction) {
    return (worldPos[0] - origin[0]) * direction[0]
        + (worldPos[1] - origin[1]) * direction[1]
        + (worldPos[2] - origin[2]) * direction[2];
}

/**
 * Owns private mouse-navigation context for CameraControl.
 *
 * @private
 */
class NavigationContextController {

    constructor(scene, pickController, pivotController) {
        this._scene = scene;
        this._pickController = pickController;
        this._pivotController = pivotController;
        this._zoomAnchor = null;
        this._zoomAnchorResolved = false;
        this._lastValidHit = null;
        this._navigationPivot = null;
        this._lastZoomTimestamp = null;
        this._zoomSessionCanvasPos = null;
        this._eventHandles = [
            scene.on("objectVisibility", (entity) => this._onObjectVisibility(entity)),
            scene.on("modelLoaded", () => this._invalidateResolvedNoAnchor()),
            scene.on("modelUnloaded", (modelId) => this._onModelUnloaded(modelId)),
            scene.on("sectionPlaneCreated", () => this._onSectionPlanesChanged()),
            scene.on("sectionPlaneUpdated", () => this._onSectionPlanesChanged()),
            scene.on("sectionPlaneDestroyed", () => this._onSectionPlanesChanged())
        ];
    }

    beginOrContinueZoom(canvasPos, timestamp) {
        const newSession = this._lastZoomTimestamp === null
            || !Number.isFinite(timestamp)
            || timestamp < this._lastZoomTimestamp
            || timestamp - this._lastZoomTimestamp >= WHEEL_SESSION_GAP_MS;

        this._lastZoomTimestamp = timestamp;

        if (newSession) {
            this._zoomSessionCanvasPos = copyVec2(canvasPos);
        }

        if (!newSession && this._zoomAnchorResolved) {
            if (this._zoomAnchor === null || this._isRecordValid(this._zoomAnchor, this._zoomAnchor.crossed)) {
                return this._zoomAnchor;
            }
        }

        if (newSession) {
            const pickResult = this._pickController.pickSurface(canvasPos);
            const hit = this._copyHit(pickResult, canvasPos);
            if (this._isRecordValid(hit)) {
                this._lastValidHit = hit;
                this._zoomAnchor = hit;
                this._zoomAnchorResolved = true;
                return this._zoomAnchor;
            }
        }

        this._zoomAnchor = this._resolveFallback(this._zoomSessionCanvasPos || canvasPos);
        this._zoomAnchorResolved = true;
        return this._zoomAnchor;
    }

    resolvePanReference(canvasPos) {
        const pickResult = this._pickController.pickSurface(canvasPos);
        const hit = this._copyHit(pickResult, canvasPos);
        if (this._isRecordValid(hit)) {
            this._lastValidHit = hit;
            this.establishNavigationPivot(hit.worldPos, "pan", hit);
            return {
                worldPos: copyVec3(hit.worldPos),
                depth: hit.depth,
                source: "cursor-hit"
            };
        }

        const fallback = this._resolveFallback(canvasPos);
        if (fallback) {
            return {
                worldPos: copyVec3(fallback.worldPos),
                depth: fallback.depth,
                source: fallback.source
            };
        }

        return {
            worldPos: null,
            depth: this._eyeLookDistance(),
            source: "camera-look-depth"
        };
    }

    resolveOrbitReference(canvasPos) {
        return this._resolveFallback(canvasPos);
    }

    markZoomAnchorCrossed() {
        if (this._zoomAnchor) {
            this._zoomAnchor.crossed = true;
        }
    }

    establishNavigationPivot(worldPos, reason, sourceRecord) {
        if (!isFiniteVec3(worldPos)) {
            return null;
        }
        const entity = sourceRecord && sourceRecord.entity ? sourceRecord.entity : null;
        this._navigationPivot = {
            worldPos: copyVec3(worldPos),
            canvasPos: null,
            depth: sourceRecord && Number.isFinite(sourceRecord.depth) ? sourceRecord.depth : null,
            rayDirection: sourceRecord && isFiniteVec3(sourceRecord.rayDirection) ? copyVec3(sourceRecord.rayDirection) : null,
            source: "navigation-pivot",
            reason,
            entityId: entity ? entity.id : null,
            modelId: entity && entity.isSceneModelEntity && entity.model ? entity.model.id : null,
            entity
        };
        this._pivotController.setPivotPos(this._navigationPivot.worldPos);
        return this._navigationPivot;
    }

    translateNavigationPivot(worldDelta) {
        if (!this._navigationPivot || !isFiniteVec3(worldDelta)) {
            return;
        }
        const worldPos = this._navigationPivot.worldPos;
        worldPos[0] += worldDelta[0];
        worldPos[1] += worldDelta[1];
        worldPos[2] += worldDelta[2];
        this._pivotController.setPivotPos(worldPos);
    }

    reset(reason) {
        this._zoomAnchor = null;
        this._zoomAnchorResolved = false;
        this._lastValidHit = null;
        this._navigationPivot = null;
        this._lastZoomTimestamp = null;
        this._zoomSessionCanvasPos = null;
        if (reason === "destroy") {
            for (let i = 0, len = this._eventHandles.length; i < len; i++) {
                this._scene.off(this._eventHandles[i]);
            }
            this._eventHandles.length = 0;
            this._scene = null;
            this._pickController = null;
            this._pivotController = null;
        }
    }

    _copyHit(pickResult, canvasPos) {
        if (!pickResult || !isFiniteVec3(pickResult.worldPos)) {
            return null;
        }
        const entity = pickResult.entity || null;
        const hasRay = this._worldRay(canvasPos);
        const signedDepth = hasRay ? dotFromOrigin(this._scene.camera.eye, pickResult.worldPos, rayDirection) : null;
        const depth = Number.isFinite(signedDepth)
            ? signedDepth
            : distance(this._scene.camera.eye, pickResult.worldPos);
        return {
            worldPos: copyVec3(pickResult.worldPos),
            canvasPos: copyVec2(canvasPos),
            depth,
            rayDirection: hasRay ? copyVec3(rayDirection) : null,
            source: "cursor-hit",
            entityId: entity ? entity.id : null,
            modelId: entity && entity.isSceneModelEntity && entity.model ? entity.model.id : null,
            entity,
            crossed: false
        };
    }

    _isRecordValid(record, allowBehind = false) {
        if (!record || !isFiniteVec3(record.worldPos)) {
            return false;
        }
        if (record.entity && record.entity.visible === false) {
            return false;
        }
        if (record.entity && record.entity.destroyed) {
            return false;
        }
        if (record.entityId && record.entity.isObject && this._scene.objects && this._scene.objects[record.entityId] !== record.entity) {
            return false;
        }
        if (record.invalidated || this._isClipped(record)) {
            return false;
        }
        if (allowBehind && record.crossed && distance(this._scene.camera.eye, record.worldPos) <= MIN_DISTANCE) {
            return true;
        }
        return distance(this._scene.camera.eye, record.worldPos) > MIN_DISTANCE
            && (allowBehind || dotFromEye(this._scene.camera, record.worldPos) > MIN_DISTANCE);
    }

    _resolveFallback(canvasPos) {
        if (this._isRecordValid(this._navigationPivot)) {
            const pivot = this._pointerRayRecord(canvasPos, this._navigationPivot, "navigation-pivot");
            if (pivot) {
                return pivot;
            }
        }
        if (this._isRecordValid(this._lastValidHit)) {
            const lastHit = this._pointerRayRecord(canvasPos, this._lastValidHit, "last-valid-hit");
            if (lastHit) {
                return lastHit;
            }
        }

        const boundsDepthRecord = this._visibleBoundsDepthRecord();
        const boundsRecord = boundsDepthRecord
            ? this._pointerRayRecord(canvasPos, boundsDepthRecord, "visible-bounds")
            : null;
        if (boundsRecord) {
            return boundsRecord;
        }
        const cameraDepthRecord = this._cameraLookDepthRecord();
        return cameraDepthRecord
            ? this._pointerRayRecord(canvasPos, cameraDepthRecord, "camera-look-depth")
            : null;
    }

    _pointerRayRecord(canvasPos, depthRecord, source) {
        const depth = this._longitudinalDepth(depthRecord);
        if (!Number.isFinite(depth) || depth <= MIN_DISTANCE) {
            return null;
        }
        if (!this._worldRay(canvasPos)) {
            return null;
        }
        const originDepth = dotFromOrigin(this._scene.camera.eye, rayOrigin, rayDirection);
        const rayDepth = depth - originDepth;
        const worldPos = [
            rayOrigin[0] + rayDirection[0] * rayDepth,
            rayOrigin[1] + rayDirection[1] * rayDepth,
            rayOrigin[2] + rayDirection[2] * rayDepth
        ];
        const record = {
            worldPos,
            canvasPos: copyVec2(canvasPos),
            depth,
            rayDirection: copyVec3(rayDirection),
            source,
            entityId: depthRecord.entityId || null,
            modelId: depthRecord.modelId || null,
            entity: depthRecord.entity || null,
            crossed: false
        };
        return this._isClipped(record) ? null : record;
    }

    _worldRay(canvasPos) {
        math.canvasPosToWorldRay(
            this._scene.canvas.canvas,
            this._scene.camera.viewMatrix,
            this._scene.camera.projMatrix,
            this._scene.camera.projection,
            canvasPos,
            rayOrigin,
            rayDirection
        );
        return isFiniteVec3(rayOrigin) && isFiniteVec3(rayDirection);
    }

    _longitudinalDepth(record) {
        if (Number.isFinite(record.depth) && record.depth > MIN_DISTANCE) {
            return record.depth;
        }
        const depth = dotFromEye(this._scene.camera, record.worldPos);
        return Number.isFinite(depth) && depth > MIN_DISTANCE
            ? depth
            : distance(this._scene.camera.eye, record.worldPos);
    }

    _visibleBoundsDepthRecord() {
        if (this._scene.numVisibleObjects <= 0) {
            return null;
        }
        const aabb = this._scene.getAABB(this._scene.visibleObjectIds);
        if (!aabb || aabb.length < 6) {
            return null;
        }
        const worldPos = [
            (aabb[0] + aabb[3]) * 0.5,
            (aabb[1] + aabb[4]) * 0.5,
            (aabb[2] + aabb[5]) * 0.5
        ];
        if (!this._isRecordValid({worldPos})) {
            return null;
        }

        const projected = this._scene.camera.projectWorldPos(worldPos);
        const canvas = this._scene.canvas.canvas;
        const xMargin = canvas.clientWidth * (EXPANDED_VIEWPORT_FACTOR - 1) * 0.5;
        const yMargin = canvas.clientHeight * (EXPANDED_VIEWPORT_FACTOR - 1) * 0.5;
        if (!projected
            || !Number.isFinite(projected[0])
            || !Number.isFinite(projected[1])
            || projected[0] < -xMargin
            || projected[0] > canvas.clientWidth + xMargin
            || projected[1] < -yMargin
            || projected[1] > canvas.clientHeight + yMargin) {
            return null;
        }
        return {worldPos};
    }

    _cameraLookDepthRecord() {
        const camera = this._scene.camera;
        const viewX = camera.look[0] - camera.eye[0];
        const viewY = camera.look[1] - camera.eye[1];
        const viewZ = camera.look[2] - camera.eye[2];
        const viewLength = Math.sqrt(viewX * viewX + viewY * viewY + viewZ * viewZ) || 1;
        const dirX = viewX / viewLength;
        const dirY = viewY / viewLength;
        const dirZ = viewZ / viewLength;
        let lowerDepth = MIN_DISTANCE;
        let upperDepth = Number.POSITIVE_INFINITY;
        const sectionPlanes = this._scene.sectionPlanes;
        for (const id in sectionPlanes) {
            if (!Object.prototype.hasOwnProperty.call(sectionPlanes, id) || !sectionPlanes[id].active) {
                continue;
            }
            const plane = sectionPlanes[id];
            const eyeDistance = (camera.eye[0] - plane.pos[0]) * plane.dir[0]
                + (camera.eye[1] - plane.pos[1]) * plane.dir[1]
                + (camera.eye[2] - plane.pos[2]) * plane.dir[2];
            const directionDot = dirX * plane.dir[0] + dirY * plane.dir[1] + dirZ * plane.dir[2];
            if (Math.abs(directionDot) <= MIN_DISTANCE) {
                if (eyeDistance < 0) {
                    return null;
                }
                continue;
            }
            const intersectionDepth = -eyeDistance / directionDot;
            const margin = Math.max(MIN_DISTANCE, Math.abs(intersectionDepth) * 1e-6);
            if (directionDot > 0) {
                lowerDepth = Math.max(lowerDepth, intersectionDepth + margin);
            } else {
                upperDepth = Math.min(upperDepth, intersectionDepth - margin);
            }
        }
        if (lowerDepth > upperDepth) {
            return null;
        }
        let depth = this._eyeLookDistance();
        if (depth < lowerDepth) {
            depth = lowerDepth;
        }
        if (depth > upperDepth) {
            depth = lowerDepth + (upperDepth - lowerDepth) * 0.8;
        }
        const record = {
            worldPos: [
                camera.eye[0] + dirX * depth,
                camera.eye[1] + dirY * depth,
                camera.eye[2] + dirZ * depth
            ],
            depth
        };
        if (this._isClipped(record)) {
            return null;
        }
        return record;
    }

    _eyeLookDistance() {
        const camera = this._scene.camera;
        return Math.max(MIN_DISTANCE, Number.isFinite(camera.eyeLookDist)
            ? camera.eyeLookDist
            : distance(camera.eye, camera.look));
    }

    _onObjectVisibility(entity) {
        this._invalidateResolvedNoAnchor();
        if (!entity || entity.visible !== false) {
            return;
        }
        this._invalidateRecords((record) => record.entityId === entity.id);
    }

    _onModelUnloaded(modelId) {
        this._invalidateResolvedNoAnchor();
        this._invalidateRecords((record) => record.modelId === modelId);
    }

    _onSectionPlanesChanged() {
        this._invalidateResolvedNoAnchor();
        this._invalidateRecords((record) => this._isClipped(record));
    }

    _invalidateResolvedNoAnchor() {
        if (this._zoomAnchor === null) {
            this._zoomAnchorResolved = false;
        }
    }

    _invalidateRecords(predicate) {
        const records = [this._zoomAnchor, this._lastValidHit, this._navigationPivot];
        for (let i = 0, len = records.length; i < len; i++) {
            const record = records[i];
            if (record && predicate(record)) {
                record.invalidated = true;
            }
        }
    }

    _isClipped(record) {
        if (record.entity && record.entity.clippable === false) {
            return false;
        }
        const sectionPlanes = this._scene.sectionPlanes;
        for (const id in sectionPlanes) {
            if (!Object.prototype.hasOwnProperty.call(sectionPlanes, id)) {
                continue;
            }
            const plane = sectionPlanes[id];
            if (!plane.active) {
                continue;
            }
            const dx = record.worldPos[0] - plane.pos[0];
            const dy = record.worldPos[1] - plane.pos[1];
            const dz = record.worldPos[2] - plane.pos[2];
            if (dx * plane.dir[0] + dy * plane.dir[1] + dz * plane.dir[2] < 0) {
                return true;
            }
        }
        return false;
    }
}

export {NavigationContextController};
