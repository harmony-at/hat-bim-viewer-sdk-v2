import { math } from "../../../math/math.js";
import { PhongMaterial } from "../../../materials/PhongMaterial.js";
import { Mesh } from "../../../mesh/Mesh.js";
import { VBOGeometry } from "../../../geometry/VBOGeometry.js";
import { buildSphereGeometry } from "../../../geometry/builders/buildSphereGeometry.js";
import { worldToRTCPos } from "../../../math/rtcCoords.js";

const tempVec3a = math.vec3();
const tempVec3b = math.vec3();
const tempVec3c = math.vec3();

const tempVec4a = math.vec4();
const tempVec4b = math.vec4();
const tempVec4c = math.vec4();

const TOP_LIMIT = 0.001;
const BOTTOM_LIMIT = Math.PI - 0.001;


/** @private */
class PivotController {

    /**
     * @private
     */
    constructor(scene, configs) {

        // Pivot math by: http://www.derschmale.com/

        this._scene = scene;
        this._configs = configs;
        this._pivotWorldPos = math.vec3();
        this._cameraOffset = math.vec3();
        this._azimuth = 0;
        this._polar = 0;
        this._radius = 0;
        this._pivotPosSet = false; // Initially false, true as soon as _pivotWorldPos has been set to some value
        this._pivoting = false; // True while pivoting
        this._shown = false;

        this._pivotSphereEnabled = false;
        this._pivotSphere = null;
        this._pivotSphereSize = 1;
        this._pivotSphereGeometry = null;
        this._pivotSphereMaterial = null;
        this._rtcCenter = math.vec3();
        this._rtcPos = math.vec3();

        this._pivotViewPos = math.vec4();
        this._pivotProjPos = math.vec4();
        this._pivotCanvasPos = math.vec2();
        this._cameraDirty = true;

        this._onViewMatrix = this._scene.camera.on("viewMatrix", () => {
            this._cameraDirty = true;
        });

        this._onProjMatrix = this._scene.camera.on("projMatrix", () => {
            this._cameraDirty = true;
        });

        this._onTick = this._scene.on("tick", () => {
            this.updatePivotElement();
            this.updatePivotSphere();
        });
    }

    createPivotSphere() {
        const currentPos = this.getPivotPos();
        const cameraPos = math.vec3();
        math.decomposeMat4(math.inverseMat4(this._scene.viewer.camera.viewMatrix, math.mat4()), cameraPos, math.vec4(), math.vec3());
        const length = math.distVec3(cameraPos, currentPos);
        let radius = (Math.tan(Math.PI / 500) * length) * this._pivotSphereSize;

        if (this._scene.camera.projection == "ortho") {
            radius /= (this._scene.camera.ortho.scale / 2);
        }

        worldToRTCPos(currentPos, this._rtcCenter, this._rtcPos);
        this._pivotSphereGeometry = new VBOGeometry(
            this._scene,
            buildSphereGeometry({ radius })
        );
        this._pivotSphere = new Mesh(this._scene, {
            geometry: this._pivotSphereGeometry,
            material: this._pivotSphereMaterial,
            pickable: false,
            collidable: false,
            position: this._rtcPos,
            rtcCenter: this._rtcCenter
        });
    };

    destroyPivotSphere() {
        if (this._pivotSphere) {
            this._pivotSphere.destroy();
            this._pivotSphere = null;
        }
        if (this._pivotSphereGeometry) {
            this._pivotSphereGeometry.destroy();
            this._pivotSphereGeometry = null;
        }
    }

    updatePivotElement() {

        const camera = this._scene.camera;
        const canvas = this._scene.canvas;

        if (this._pivoting && this._cameraDirty) {

            math.transformPoint3(camera.viewMatrix, this.getPivotPos(), this._pivotViewPos);
            this._pivotViewPos[3] = 1;
            math.transformPoint4(camera.projMatrix, this._pivotViewPos, this._pivotProjPos);

            const canvasAABB = canvas.boundary;
            const canvasWidth = canvasAABB[2];
            const canvasHeight = canvasAABB[3];

            this._pivotCanvasPos[0] = Math.floor((1 + this._pivotProjPos[0] / this._pivotProjPos[3]) * canvasWidth / 2);
            this._pivotCanvasPos[1] = Math.floor((1 - this._pivotProjPos[1] / this._pivotProjPos[3]) * canvasHeight / 2);

            // data-textures: avoid to do continuous DOM layout calculations            
            let canvasBoundingRect = canvas._lastBoundingClientRect;

            if (!canvasBoundingRect || canvas._canvasSizeChanged) {
                const canvasElem = canvas.canvas;

                canvasBoundingRect = canvas._lastBoundingClientRect = canvasElem.getBoundingClientRect();
            }

            if (this._pivotElement) {
                this._pivotElement.style.left = (Math.floor(canvasBoundingRect.left + this._pivotCanvasPos[0]) - (this._pivotElement.clientWidth / 2) + window.scrollX) + "px";
                this._pivotElement.style.top = (Math.floor(canvasBoundingRect.top + this._pivotCanvasPos[1]) - (this._pivotElement.clientHeight / 2) + window.scrollY) + "px";
            }
            this._cameraDirty = false;
        }
    }

    updatePivotSphere() {
        if (this._pivoting && this._pivotSphere) {
            worldToRTCPos(this.getPivotPos(), this._rtcCenter, this._rtcPos);
            if (!math.compareVec3(this._rtcPos, this._pivotSphere.position)) {
                this.destroyPivotSphere();
                this.createPivotSphere();
            }
        }
    }
    /**
     * Sets the HTML DOM element that will represent the pivot position.
     *
     * @param pivotElement
     */
    setPivotElement(pivotElement) {
        this._pivotElement = pivotElement;
    }

    /**
     * Sets a sphere as the representation of the pivot position.
     *
     * @param {Object} [cfg] Sphere configuration.
     * @param {String} [cfg.size=1] Optional size factor of the sphere. Defaults to 1.
     * @param {String} [cfg.color=Array] Optional maretial color. Defaults to a red.
     */
    enablePivotSphere(cfg = {}) {
        this.destroyPivotSphere();
        this._pivotSphereEnabled = true;
        if (cfg.size) {
            this._pivotSphereSize = cfg.size;
        }
        const color = cfg.color || [1, 0, 0];
        this._pivotSphereMaterial = new PhongMaterial(this._scene, {
            emissive: color,
            ambient: color,
            specular: [0, 0, 0],
            diffuse: [0, 0, 0],
        });
    }

    /**
     * Remove the sphere as the representation of the pivot position.
     *
     */
    disablePivotSphere() {
        this.destroyPivotSphere();
        this._pivotSphereEnabled = false;
    }

    /**
     * Begins pivoting.
     */
    startPivot() {

        const camera = this._scene.camera;

        if (!this._pivotPosSet) {
            this.setPivotPos(camera.look);
        }

        let lookat = math.lookAtMat4v(camera.eye, camera.look, camera.up);
        math.transformPoint3(lookat, this.getPivotPos(), this._cameraOffset);

        const pivotPos = this.getPivotPos();
        this._cameraOffset[2] += math.distVec3(camera.eye, pivotPos);

        lookat = math.inverseMat4(lookat);

        const offset = math.transformVec3(lookat, this._cameraOffset);
        const diff = math.vec3();

        math.subVec3(camera.eye, pivotPos, diff);
        math.addVec3(diff, offset);

        if (camera.zUp) {
            const t = diff[1];
            diff[1] = diff[2];
            diff[2] = t;
        }

        this._radius = math.lenVec3(diff);
        this._polar = Math.acos(diff[1] / this._radius);
        this._azimuth = Math.atan2(diff[0], diff[2]);
        this._pivoting = true;
    }

    _cameraLookingDownwards() { // Returns true if angle between camera viewing direction and World-space "up" axis is too small
        const camera = this._scene.camera;
        const forwardAxis = math.normalizeVec3(math.subVec3(camera.look, camera.eye, tempVec3a));
        const rightAxis = math.cross3Vec3(forwardAxis, camera.worldUp, tempVec3b);
        let rightAxisLen = math.sqLenVec3(rightAxis);
        return (rightAxisLen <= 0.0001);
    }

    /**
     * Returns true if we are currently pivoting.
     *
     * @returns {Boolean}
     */
    getPivoting() {
        return this._pivoting;
    }

    /**
     * Sets a 3D World-space position to pivot about.
     *
     * @param {Number[]} worldPos The new World-space pivot position.
     */
    setPivotPos(worldPos) {
        this._pivotWorldPos.set(worldPos);
        this._pivotPosSet = true;
    }

    /**
     * Sets the pivot position using the Ground Plane Projection Fallback mechanism:
     * 1. Attempts surface raycast to find collision point with model.
     * 2. If no collision, defines the reference ground plane at model's bottom elevation (Z = Zmin or Y = Ymin)
     *    with normal vector n = camera.worldUp.
     * 3. Solves line-plane intersection: P(t) = C + t * d with plane (P - P0) . n = 0,
     *    yielding intersection point P_inter as the new pivot point.
     *
     * @param {Number[]} canvasPos
     */
    setCanvasPivotPos(canvasPos) {
        // Step 1: Raycast to find collision with model
        const pickResult = this._scene.pick({
            canvasPos: canvasPos,
            pickSurface: true
        });

        if (pickResult && pickResult.worldPos) {
            this.setPivotPos(pickResult.worldPos);
            return;
        }

        // Step 2: Ground Plane Projection Fallback
        const camera = this._scene.camera;
        const canvas = this._scene.canvas.canvas;

        // Calculate Raycast origin C and direction d from camera through canvasPos
        const rayOrigin = math.vec3(); // Camera C
        const rayDir = math.vec3();    // Direction d
        math.canvasPosToWorldRay(
            canvas,
            camera.viewMatrix,
            camera.projMatrix,
            camera.projection,
            canvasPos,
            rayOrigin,
            rayDir
        );

        // Define Ground Reference Plane:
        // Normal vector n is aligned with worldUp (e.g. n = (0, 0, 1) for Z-up, (0, 1, 0) for Y-up)
        let upAxis = 1;
        if (camera.worldUp[2] > camera.worldUp[0] && camera.worldUp[2] > camera.worldUp[1]) {
            upAxis = 2; // Z-up: n = (0, 0, 1)
        } else if (camera.worldUp[0] > camera.worldUp[1] && camera.worldUp[0] > camera.worldUp[2]) {
            upAxis = 0; // X-up: n = (1, 0, 0)
        }

        // Ground elevation Zmin from model Bounding Box
        const aabb = this._scene.numVisibleObjects > 0
            ? this._scene.getAABB(this._scene.visibleObjectIds)
            : this._scene.aabb;
        const floorElevation = aabb[upAxis]; // Zmin
        const sceneCenter = this._scene.center;
        const distToCenter = Math.max(1, math.distVec3(sceneCenter, rayOrigin));

        // Step 3: Line-Plane Intersection
        // Plane equation: P . n + D = 0  =>  (C + t * d) . n - floorElevation = 0
        // Solving for t: t = (floorElevation - C . n) / (d . n)
        const dDotN = rayDir[upAxis];
        const cDotN = rayOrigin[upAxis];
        let pivotPos;

        if (Math.abs(dDotN) > 0.0001) {
            const t = (floorElevation - cDotN) / dDotN;
            if (t > 0 && t <= distToCenter * 20) {
                // P_inter = C + t * d
                pivotPos = math.addVec3(rayOrigin, math.mulVec3Scalar(rayDir, t, tempVec3b), tempVec3c);
            }
        }

        // Fallback if ray does not intersect in front (looking parallel or upward):
        // Project ray direction onto the ground reference plane
        if (!pivotPos) {
            const horizontalDir = math.vec3([rayDir[0], rayDir[1], rayDir[2]]);
            horizontalDir[upAxis] = 0;
            if (math.sqLenVec3(horizontalDir) > 0.0001) {
                math.normalizeVec3(horizontalDir);
                pivotPos = math.addVec3(rayOrigin, math.mulVec3Scalar(horizontalDir, distToCenter, tempVec3b), tempVec3c);
            } else {
                pivotPos = math.vec3([sceneCenter[0], sceneCenter[1], sceneCenter[2]]);
            }
        }

        // Guarantee exact ground plane elevation
        pivotPos[upAxis] = floorElevation;
        this.setPivotPos(pivotPos);
    }

    /**
     * Gets the current position we're pivoting about.
     * @returns {Number[]} The current World-space pivot position.
     */
    getPivotPos() {
        return (this._pivotPosSet) ? this._pivotWorldPos : this._scene.camera.look; // Avoid pivoting about [0,0,0] by default
    }

    /**
     * Continues to pivot.
     *
     * @param {Number} yawInc Yaw rotation increment.
     * @param {Number} pitchInc Pitch rotation increment.
     */
    continuePivot(yawInc, pitchInc) {
        if (!this._pivoting) {
            return;
        }
        if (yawInc === 0 && pitchInc === 0) {
            return;
        }
        const camera = this._scene.camera;
        var dx = -yawInc;
        const dy = -pitchInc;
        if (camera.worldUp[2] === 1) {
            dx = -dx;
        }
        this._azimuth += -dx * .01;

        const isMovingUp = dy < 0;
        const isMovingDown = dy > 0;

        // Track if we're at limits - only check if we're very close to the limit
        const atTopLimit = Math.abs(this._polar - TOP_LIMIT) < 0.005;
        const atBottomLimit = Math.abs(this._polar - BOTTOM_LIMIT) < 0.005;

        let newPolar = this._polar + dy * .01;

        // Case 1: At top limit and trying to go beyond
        if (atTopLimit && isMovingUp) {
            newPolar = TOP_LIMIT;
        }
        // Case 2: At bottom limit and trying to go beyond
        else if (atBottomLimit && isMovingDown) {
            newPolar = BOTTOM_LIMIT;
        }
        // Case 3: Normal rotation or moving away from a limit
        else {
            newPolar = math.clamp(newPolar, TOP_LIMIT, BOTTOM_LIMIT);
        }

        this._polar = newPolar;

        const pos = [
            this._radius * Math.sin(this._polar) * Math.sin(this._azimuth),
            this._radius * Math.cos(this._polar),
            this._radius * Math.sin(this._polar) * Math.cos(this._azimuth)
        ];
        if (camera.worldUp[2] === 1) {
            const t = pos[1];
            pos[1] = pos[2];
            pos[2] = t;
        }
        // Preserve the eye->look distance, since in xeokit "look" is the point-of-interest, not the direction vector.
        const eyeLookLen = math.lenVec3(math.subVec3(camera.look, camera.eye, math.vec3()));
        const pivotPos = this.getPivotPos();
        math.addVec3(pos, pivotPos);
        let lookat = math.lookAtMat4v(pos, pivotPos, camera.worldUp);
        lookat = math.inverseMat4(lookat);
        const offset = math.transformVec3(lookat, this._cameraOffset);
        lookat[12] -= offset[0];
        lookat[13] -= offset[1];
        lookat[14] -= offset[2];
        const zAxis = [lookat[8], lookat[9], lookat[10]];
        camera.eye = [lookat[12], lookat[13], lookat[14]];
        math.subVec3(camera.eye, math.mulVec3Scalar(zAxis, eyeLookLen), camera.look);
        camera.up = [lookat[4], lookat[5], lookat[6]];
        this.showPivot();
    }

    /**
     * Shows the pivot position.
     *
     * Only works if we set an  HTML DOM element to represent the pivot position.
     */
    showPivot() {
        if (this._shown) {
            return;
        }
        if (this._pivotElement) {
            this.updatePivotElement();
            this._pivotElement.style.visibility = "visible";
        }
        if (this._pivotSphereEnabled) {
            this.destroyPivotSphere();
            this.createPivotSphere();
        }
        this._shown = true;
    }

    /**
     * Hides the pivot position.
     *
     * Only works if we set an  HTML DOM element to represent the pivot position.
     */
    hidePivot() {
        if (!this._shown) {
            return;
        }
        if (this._pivotElement) {
            this._pivotElement.style.visibility = "hidden";
        }
        if (this._pivotSphereEnabled) {
            this.destroyPivotSphere();
        }
        this._shown = false;
    }

    /**
     * Finishes pivoting.
     */
    endPivot() {
        this._pivoting = false;
    }

    destroy() {
        this.destroyPivotSphere();
        this._scene.camera.off(this._onViewMatrix);
        this._scene.camera.off(this._onProjMatrix);
        this._scene.off(this._onTick);
    }
}


export { PivotController };