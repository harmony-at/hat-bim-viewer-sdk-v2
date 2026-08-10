import {math} from "../../math/math.js";
import {computeZoomDelta, WHEEL_SESSION_GAP_MS} from "./NavigationUtils.js";

const SCALE_DOLLY_EACH_FRAME = 1; // Recalculate dolly speed for eye->target distance on each Nth frame
const EPSILON = 0.001;
const tempVec3 = math.vec3();
const panDelta = math.vec3();
const panEyeBefore = math.vec3();
const panWorldDelta = math.vec3();

function signedAnchorDepth(camera, anchor) {
    if (anchor && anchor.rayDirection) {
        const direction = anchor.rayDirection;
        const signedDepth = (anchor.worldPos[0] - camera.eye[0]) * direction[0]
            + (anchor.worldPos[1] - camera.eye[1]) * direction[1]
            + (anchor.worldPos[2] - camera.eye[2]) * direction[2];
        if (Number.isFinite(signedDepth)) {
            return signedDepth;
        }
    }
    return null;
}

function zoomAnchorDistance(camera, anchor) {
    const signedDepth = signedAnchorDepth(camera, anchor);
    return signedDepth !== null
        ? Math.abs(signedDepth)
        : math.lenVec3(math.subVec3(anchor.worldPos, camera.eye, tempVec3));
}

function crossedZoomAnchor(camera, anchor) {
    const signedDepth = signedAnchorDepth(camera, anchor);
    return signedDepth === null || signedDepth <= EPSILON;
}

/**
 * Handles camera updates on each "tick" that were scheduled by the various controllers.
 *
 * @private
 */
class CameraUpdater {

    constructor(scene, controllers, configs, states, updates) {

        this._scene = scene;
        const camera = scene.camera;
        const pickController = controllers.pickController;
        const pivotController = controllers.pivotController;
        const panController = controllers.panController;
        const navigationContextController = controllers.navigationContextController;
        const cameraControl = controllers.cameraControl;

        let countDown = SCALE_DOLLY_EACH_FRAME; // Decrements on each tick
        let dollyDistFactor = 1.0; // Calculated when countDown is zero
        let followPointerWorldPos = null; // Holds the pointer's World position when configs.followPointer is true
        
        this._onTick = scene.on("tick", () => {

            if (!(configs.active && configs.pointerEnabled)) {
                return;
            }

            let cursorType = "default";

            //----------------------------------------------------------------------------------------------------------
            // Dolly decay
            //------------------------------------------------------------------------------------  ----------------------

            if (Math.abs(updates.dollyDelta) < EPSILON) {
                updates.dollyDelta = 0;
            }

            //----------------------------------------------------------------------------------------------------------
            // Rotation decay
            //----------------------------------------------------------------------------------------------------------

            if (Math.abs(updates.rotateDeltaX) < EPSILON) {
                updates.rotateDeltaX = 0;
            }

            if (Math.abs(updates.rotateDeltaY) < EPSILON) {
                updates.rotateDeltaY = 0;
            }

            if (updates.rotateDeltaX !== 0 || updates.rotateDeltaY !== 0) {
                updates.dollyDelta = 0;
            }

            //----------------------------------------------------------------------------------------------------------
            // Dolly speed eye->look scaling
            //
            // If the pointer has a surface target, then dolly speed is proportional to the distance to that target.
            //
            // If there is no surface target, then dolly speed is proportional to the current eye->look distance.
            // This keeps no-hit dollying proportional while the pointer is over background gaps in a structure.
            //----------------------------------------------------------------------------------------------------------

            let activeZoomAnchor = null;
            let dollyDeltaForDist;
            const hasWheelInput = configs.followPointer
                && navigationContextController
                && updates.dollyInputSource === "wheel"
                && updates.dollyCanvasPos
                && updates.dollyTimestamp !== null
                && updates.dollyTimestamp !== undefined;
            const lastWheelEventTime = Number.isFinite(updates.dollyLastEventTime)
                ? updates.dollyLastEventTime
                : performance.now();
            const usesWheelContext = hasWheelInput
                && performance.now() - lastWheelEventTime < WHEEL_SESSION_GAP_MS;
            const expiredWheelContext = hasWheelInput && !usesWheelContext;

            if (usesWheelContext && updates.dollyDelta !== 0) {
                activeZoomAnchor = navigationContextController.beginOrContinueZoom(
                    updates.dollyCanvasPos,
                    updates.dollyTimestamp
                );
                if (activeZoomAnchor) {
                    const distance = zoomAnchorDistance(camera, activeZoomAnchor);
                    dollyDeltaForDist = computeZoomDelta(
                        updates.dollyDelta,
                        distance,
                        configs.dollyProximityThreshold,
                        configs.dollyMinSpeed,
                        activeZoomAnchor.crossed === true
                    );
                } else {
                    updates.dollyDelta *= configs.dollyInertia;
                    dollyDeltaForDist = 0;
                }

            } else if (expiredWheelContext) {
                dollyDistFactor = configs.firstPerson
                    ? 1.0
                    : Math.max(configs.dollyMinSpeed, camera.eyeLookDist / configs.dollyProximityThreshold);
                dollyDeltaForDist = updates.dollyDelta * dollyDistFactor;

            } else if (configs.followPointer) {

                if (--countDown <= 0) {

                    countDown = SCALE_DOLLY_EACH_FRAME;

                    if (updates.dollyDelta !== 0) {
                        if (updates.rotateDeltaY === 0 && updates.rotateDeltaX === 0) {

                            if (configs.followPointer && states.followPointerDirty) {

                                pickController.pickCursorPos = states.pointerCanvasPos;
                                pickController.schedulePickSurface = true;
                                pickController.update();

                                if (pickController.pickResult && pickController.pickResult.worldPos) {
                                    followPointerWorldPos = pickController.pickResult.worldPos;
                                    
                                } else {
                                    dollyDistFactor = configs.firstPerson
                                        ? 1.0
                                        : camera.eyeLookDist / configs.dollyProximityThreshold;
                                    followPointerWorldPos = null;
                                }

                                states.followPointerDirty = false;
                            }
                        }

                        if (followPointerWorldPos) {
                            const dist = Math.abs(math.lenVec3(math.subVec3(followPointerWorldPos, scene.camera.eye, tempVec3)));
                            dollyDistFactor = dist / configs.dollyProximityThreshold;
                        } else {
                            dollyDistFactor = configs.firstPerson
                                ? 1.0
                                : camera.eyeLookDist / configs.dollyProximityThreshold;
                        }

                        if (dollyDistFactor < configs.dollyMinSpeed) {
                            dollyDistFactor = configs.dollyMinSpeed;
                        }
                    }
                }
            } else {
              dollyDistFactor = 1;
              followPointerWorldPos = null;
            }

            if (dollyDeltaForDist === undefined) {
                dollyDeltaForDist = updates.dollyDelta * dollyDistFactor;
            }

            //----------------------------------------------------------------------------------------------------------
            // Rotation
            //----------------------------------------------------------------------------------------------------------

            if (updates.rotateDeltaY !== 0 || updates.rotateDeltaX !== 0) {

                if (configs.firstPerson) {
                    if (updates.rotateDeltaX !== 0) {
                        camera.pitch(-updates.rotateDeltaX);
                    }
                    if (updates.rotateDeltaY !== 0) {
                        camera.yaw(updates.rotateDeltaY);
                    }
                }
                else {
                    if (configs.followPointer && pivotController.getPivoting()){
                        pivotController.continuePivot(updates.rotateDeltaY, updates.rotateDeltaX);
                        pivotController.showPivot();
                    }
                }

                updates.rotateDeltaX *= configs.rotationInertia;
                updates.rotateDeltaY *= configs.rotationInertia;

                cursorType = cameraControl._cursors.rotate;
            }

            //----------------------------------------------------------------------------------------------------------
            // Panning
            //----------------------------------------------------------------------------------------------------------

            if (Math.abs(updates.panDeltaX) < EPSILON) {
                updates.panDeltaX = 0;
            }

            if (Math.abs(updates.panDeltaY) < EPSILON) {
                updates.panDeltaY = 0;
            }

            if (Math.abs(updates.panDeltaZ) < EPSILON) {
                updates.panDeltaZ = 0;
            }

            if (updates.panDeltaX !== 0 || updates.panDeltaY !== 0 || updates.panDeltaZ !== 0) {

                panEyeBefore.set(camera.eye);

                panDelta[0] = updates.panDeltaX;
                panDelta[1] = updates.panDeltaY;
                panDelta[2] = updates.panDeltaZ;

                let verticalEye;
                let verticalLook;

                if (configs.constrainVertical) {

                    if (camera.xUp) {
                        verticalEye = camera.eye[0];
                        verticalLook = camera.look[0];
                    } else if (camera.yUp) {
                        verticalEye = camera.eye[1];
                        verticalLook = camera.look[1];
                    } else if (camera.zUp) {
                        verticalEye = camera.eye[2];
                        verticalLook = camera.look[2];
                    }

                    camera.pan(panDelta);

                    const eye = camera.eye;
                    const look = camera.look;

                    if (camera.xUp) {
                        eye[0] = verticalEye;
                        look[0] = verticalLook;
                    } else if (camera.yUp) {
                        eye[1] = verticalEye;
                        look[1] = verticalLook;
                    } else if (camera.zUp) {
                        eye[2] = verticalEye;
                        look[2] = verticalLook;
                    }

                    camera.eye = eye;
                    camera.look = look;

                } else {
                    camera.pan(panDelta);
                }

                if (navigationContextController) {
                    const eye = camera.eye;
                    panWorldDelta[0] = eye[0] - panEyeBefore[0];
                    panWorldDelta[1] = eye[1] - panEyeBefore[1];
                    panWorldDelta[2] = eye[2] - panEyeBefore[2];
                    navigationContextController.translateNavigationPivot(panWorldDelta);
                }

                cursorType = cameraControl._cursors.pan;
            }

            updates.panDeltaX *= configs.panInertia;
            updates.panDeltaY *= configs.panInertia;
            updates.panDeltaZ *= configs.panInertia;

            //----------------------------------------------------------------------------------------------------------
            // Dollying
            //----------------------------------------------------------------------------------------------------------

            if (dollyDeltaForDist !== 0) {

                let crossedActiveZoomAnchor = null;

                if (dollyDeltaForDist < 0) {
                    cursorType = cameraControl._cursors.dollyForward;
                } else {
                    cursorType = cameraControl._cursors.dollyBackward;
                }

                if (configs.firstPerson) {

                    let verticalEye;
                    let verticalLook;

                    if (configs.constrainVertical) {
                        if (camera.xUp) {
                            verticalEye = camera.eye[0];
                            verticalLook = camera.look[0];
                        } else if (camera.yUp) {
                            verticalEye = camera.eye[1];
                            verticalLook = camera.look[1];
                        } else if (camera.zUp) {
                            verticalEye = camera.eye[2];
                            verticalLook = camera.look[2];
                        }
                    }

                    if (configs.followPointer && !expiredWheelContext) {
                        const targetWorldPos = activeZoomAnchor ? activeZoomAnchor.worldPos : followPointerWorldPos;
                        const targetCanvasPos = activeZoomAnchor ? activeZoomAnchor.canvasPos : states.pointerCanvasPos;
                        const dolliedThroughSurface = panController.dollyToCanvasPos(targetWorldPos, targetCanvasPos, -dollyDeltaForDist);
                        if (dolliedThroughSurface) {
                            if (activeZoomAnchor) {
                                crossedActiveZoomAnchor = activeZoomAnchor;
                            } else {
                                states.followPointerDirty = true;
                            }
                        }
                    } else {
                        camera.pan([0, 0, dollyDeltaForDist]);
                        camera.ortho.scale = camera.ortho.scale - dollyDeltaForDist;
                    }

                    if (configs.constrainVertical) {
                        const eye = camera.eye;
                        const look = camera.look;
                        if (camera.xUp) {
                            eye[0] = verticalEye;
                            look[0] = verticalLook;
                        } else if (camera.yUp) {
                            eye[1] = verticalEye;
                            look[1] = verticalLook;
                        } else if (camera.zUp) {
                            eye[2] = verticalEye;
                            look[2] = verticalLook;
                        }
                        camera.eye = eye;
                        camera.look = look;
                    }

                } else if (configs.planView) {

                    const targetWorldPos = expiredWheelContext
                        ? null
                        : (activeZoomAnchor ? activeZoomAnchor.worldPos : followPointerWorldPos);
                    const targetCanvasPos = activeZoomAnchor ? activeZoomAnchor.canvasPos : states.pointerCanvasPos;
                    if (configs.followPointer && targetWorldPos) {
                        const dolliedThroughSurface = panController.dollyToCanvasPos(targetWorldPos, targetCanvasPos, -dollyDeltaForDist);
                        if (dolliedThroughSurface) {
                            if (activeZoomAnchor) {
                                crossedActiveZoomAnchor = activeZoomAnchor;
                            } else {
                                states.followPointerDirty = true;
                            }
                        }
                    } else {
                        camera.ortho.scale = camera.ortho.scale + dollyDeltaForDist;
                        camera.zoom(dollyDeltaForDist);
                    }

                } else { // Orbiting

                    const targetWorldPos = expiredWheelContext
                        ? null
                        : (activeZoomAnchor ? activeZoomAnchor.worldPos : followPointerWorldPos);
                    const targetCanvasPos = activeZoomAnchor ? activeZoomAnchor.canvasPos : states.pointerCanvasPos;
                    if (configs.followPointer && targetWorldPos) {
                        const dolliedThroughSurface = panController.dollyToCanvasPos(targetWorldPos, targetCanvasPos, -dollyDeltaForDist);
                        if (dolliedThroughSurface) {
                            if (activeZoomAnchor) {
                                crossedActiveZoomAnchor = activeZoomAnchor;
                            } else {
                                states.followPointerDirty = true;
                            }
                        }
                    } else {
                        camera.ortho.scale = camera.ortho.scale + dollyDeltaForDist;
                        camera.zoom(dollyDeltaForDist);
                    }
                }

                if (crossedActiveZoomAnchor && crossedZoomAnchor(camera, crossedActiveZoomAnchor)) {
                    navigationContextController.markZoomAnchorCrossed();
                }

                updates.dollyDelta *= configs.dollyInertia;
            }

            pickController.fireEvents();

            document.body.style.cursor = cursorType;
        });
    }


    destroy() {
        this._scene.off(this._onTick);
    }
}

export {CameraUpdater};
