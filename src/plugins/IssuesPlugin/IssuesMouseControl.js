import { math } from "../../viewer/scene/math/math.js";
import { IssuesControl } from "./IssuesControl.js";

const MOUSE_FIRST_CLICK_EXPECTED = 0;

export class IssuesMouseControl extends IssuesControl {
  /**
   * Creates a IssuesMouseControl bound to the given IssuesPlugin.
   *
   * @param {IssuesPlugin} IssuesPlugin The AngleMeasurementsPlugin to control.
   * @param [cfg] Configuration
   * @param {function} [cfg.canvasToPagePos] Optional function to map canvas-space coordinates to page coordinates.
   * @param {PointerLens} [cfg.pointerLens] A PointerLens to use to provide a magnified view of the cursor when snapping is enabled.
   * @param {boolean} [cfg.snapping=true] Whether to initially enable snap-to-vertex and snap-to-edge for this IssuesMouseControl.
   */
  constructor(IssuesPlugin, cfg = {}) {
    super(IssuesPlugin.viewer.scene);

    this._canvasToPagePos = cfg.canvasToPagePos;

    this.pointerLens = cfg.pointerLens;

    this._active = false;

    this._currentDistanceMeasurement = null;

    this._currentDistanceMeasurementInitState = {
      wireVisible: null,
      axisVisible: null,
      xAxisVisible: null,
      yaxisVisible: null,
      zAxisVisible: null,
      targetVisible: null,
    };

    this._initMarkerDiv();

    this._onCameraControlHoverSnapOrSurface = null;
    this._onCameraControlHoverSnapOrSurfaceOff = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onCanvasTouchStart = null;
    this._onCanvasTouchEnd = null;
    this._snapping = cfg.snapping !== false;
    this._mouseState = MOUSE_FIRST_CLICK_EXPECTED;

    this._attachPlugin(IssuesPlugin, cfg);
  }

  _initMarkerDiv() {
    const markerDiv = document.createElement('div');
    markerDiv.setAttribute('id', 'myMarkerDiv');
    const canvas = this.scene.canvas.canvas;
    canvas.parentNode.insertBefore(markerDiv, canvas);
    markerDiv.style.background = 'black';
    markerDiv.style.border = '2px solid blue';
    markerDiv.style.borderRadius = '10px';
    markerDiv.style.width = '5px';
    markerDiv.style.height = '5px';
    markerDiv.style.top = '-200px';
    markerDiv.style.left = '-200px';
    markerDiv.style.margin = '0 0';
    markerDiv.style.zIndex = '100';
    markerDiv.style.position = 'absolute';
    markerDiv.style.pointerEvents = 'none';

    this._markerDiv = markerDiv;
  }

  _destroyMarkerDiv() {
    try {
      if (this._markerDiv) {
        const element = document.getElementById('myMarkerDiv');
        element.parentNode.removeChild(element);
        this._markerDiv = null;
      }
    } catch {
      return;
    }
  }

  _attachPlugin(IssuesPlugin, cfg = {}) {
    /**
     * The {@link IssuesPlugin} that owns this IssuesMouseControl.
     * @type {IssuesPlugin}
     */
    this.IssuesPlugin = IssuesPlugin;

    /**
     * The {@link IssuesPlugin} that owns this IssuesMouseControl.
     * @type {IssuesPlugin}
     */
    this.plugin = IssuesPlugin;
  }

  /**
   * Gets if this IssuesMouseControl is currently active, where it is responding to input.
   *
   * @returns {boolean} True if this IssuesMouseControl is active.
   */
  get active() {
    return this._active;
  }

  /**
   * Sets whether snap-to-vertex and snap-to-edge are enabled for this IssuesMouseControl.
   *
   * This is `true` by default.
   *
   * Internally, this deactivates then activates the IssuesMouseControl when changed, which means that
   * it will destroy any Issues currently under construction, and incurs some overhead, since it unbinds
   * and rebinds various input handlers.
   *
   * @param snapping
   */
  set snapping(snapping) {
    if (snapping !== this._snapping) {
      this._snapping = snapping;
      this.deactivate();
      this.activate();
    } else {
      this._snapping = snapping;
    }
  }

  /**
   * Gets whether snap-to-vertex and snap-to-edge are enabled for this IssuesMouseControl.
   *
   * This is `true` by default.
   * @returns {*}
   */
  get snapping() {
    return this._snapping;
  }

  /**
   * Activates this IssuesMouseControl, ready to respond to input.
   */
  activate(done, isPoint) {
    if (this._active) {
      return;
    }

    if (!this._markerDiv) {
      this._initMarkerDiv();
    }

    this.fire('issueCreated', true);

    const plugin = this.plugin;
    const scene = plugin.viewer.scene;
    const cameraControl = plugin.viewer.cameraControl;
    const canvas = scene.canvas.canvas;
    const input = scene.input;
    let mouseHovering = false;
    const pointerWorldPos = math.vec3();
    const pointerCanvasPos = math.vec2();
    let pointerDownCanvasX;
    let pointerDownCanvasY;
    const clickTolerance = 20;
    let hoveredEntity = null;

    this._mouseState = 'MOUSE_FIRST_CLICK_EXPECTED';

    const getTop = (el) =>
      el.offsetTop +
      (el.offsetParent &&
        el.offsetParent !== canvas.parentNode &&
        getTop(el.offsetParent));
    const getLeft = (el) =>
      el.offsetLeft +
      (el.offsetParent &&
        el.offsetParent !== canvas.parentNode &&
        getLeft(el.offsetParent));

    const pagePos = math.vec2();

    this._onCameraControlHoverSnapOrSurface = cameraControl.on(
      this._snapping ? 'hoverSnapOrSurface' : 'hoverSurface',
      (event) => {
        const canvasPos = event.snappedCanvasPos || event.canvasPos;
        mouseHovering = true;
        pointerWorldPos.set(event.worldPos);
        pointerCanvasPos.set(event.canvasPos);
        if (this._mouseState === 'MOUSE_FIRST_CLICK_EXPECTED') {
          if (this._canvasToPagePos) {
            this._canvasToPagePos(canvas, canvasPos, pagePos);
            this._markerDiv.style.left = `${pagePos[0] - 5}px`;
            this._markerDiv.style.top = `${pagePos[1] - 5}px`;
          } else {
            this._markerDiv.style.left = `${getLeft(canvas) + canvasPos[0] - 5}px`;
            this._markerDiv.style.top = `${getTop(canvas) + canvasPos[1] - 5}px`;
          }

          this._markerDiv.style.background = 'pink';
          if (event.snappedToVertex || event.snappedToEdge) {
            if (this.pointerLens) {
              this.pointerLens.visible = true;
              this.pointerLens.canvasPos = event.canvasPos;
              this.pointerLens.snappedCanvasPos =
                event.snappedCanvasPos || event.canvasPos;
              this.pointerLens.snapped = true;
            }
            this._markerDiv.style.background = 'greenyellow';
            this._markerDiv.style.border = '2px solid green';
          } else {
            if (this.pointerLens) {
              this.pointerLens.visible = true;
              this.pointerLens.canvasPos = event.canvasPos;
              this.pointerLens.snappedCanvasPos = event.canvasPos;
              this.pointerLens.snapped = false;
            }
            this._markerDiv.style.background = 'pink';
            this._markerDiv.style.border = '2px solid red';
          }
          hoveredEntity = event.entity;
        } else {
          this._markerDiv.style.left = `-10000px`;
          this._markerDiv.style.top = `-10000px`;
        }
        canvas.style.cursor = 'pointer';
        if (this._currentIssue) {
          this._markerDiv.style.left = `-10000px`;
          this._markerDiv.style.top = `-10000px`;
        }
      }
    );

    canvas.addEventListener(
      'mousedown',
      (this._onMouseDown = (e) => {
        if (e.which !== 1) {
          return;
        }
        pointerDownCanvasX = e.clientX;
        pointerDownCanvasY = e.clientY;
      })
    );

    canvas.addEventListener(
      'mouseup',
      (this._onMouseUp = (e) => {
        if (!hoveredEntity) return;
        if (e.which !== 1) {
          return;
        }
        if (
          e.clientX > pointerDownCanvasX + clickTolerance ||
          e.clientX < pointerDownCanvasX - clickTolerance ||
          e.clientY > pointerDownCanvasY + clickTolerance ||
          e.clientY < pointerDownCanvasY - clickTolerance
        ) {
          return;
        }
        const idIs = math.createUUID();
        this._currentIssue = plugin.createIssue({
          id: idIs,
          origin: {
            worldPos: pointerWorldPos.slice(),
            entity: hoveredEntity,
          },
          target: {
            worldPos: pointerWorldPos.slice(),
            entity: hoveredEntity,
          },
          approximate: true,
          //themmoi2612
          isPoint: isPoint,
        });
        this._currentIssue.clickable = false;
        const id = hoveredEntity?.id;
        const modelId = hoveredEntity?.model?.id;
        hoveredEntity = null;

        return done({
          entityId: id,
          pos: pointerWorldPos.slice(),
          modelId: modelId,
          draftId: idIs,
        });
      })
    );

    this._onCameraControlHoverSnapOrSurfaceOff = cameraControl.on(
      this._snapping ? 'hoverSnapOrSurfaceOff' : 'hoverOff',
      (event) => {
        if (this.pointerLens) {
          this.pointerLens.visible = true;
          this.pointerLens.canvasPos = event.canvasPos;
          this.pointerLens.snappedCanvasPos = event.snappedCanvasPos || event.canvasPos;
        }
        mouseHovering = false;
        this._markerDiv.style.left = `-100px`;
        this._markerDiv.style.top = `-100px`;
        if (this._currentIssue) {
          this._currentIssue.wireVisible = false;
          this._currentIssue.targetVisible = false;
          this._currentIssue.axisVisible = false;
        }
        canvas.style.cursor = 'default';
      }
    );

    this._active = true;
  }

  /**
   * Deactivates this IssuesMouseControl, making it unresponsive to input.
   *
   * Destroys any {@link DistanceMeasurement} under construction by this IssuesMouseControl.
   */
  deactivate() {
    if (!this._active) {
      return;
    }

    this.fire('activated', false);

    if (this.pointerLens) {
      this.pointerLens.visible = false;
    }
    if (this._markerDiv) {
      this._destroyMarkerDiv();
    }
    this.reset();
    const canvas = this.scene.canvas.canvas;
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    const cameraControl = this.IssuesPlugin.viewer.cameraControl;
    cameraControl.off(this._onCameraControlHoverSnapOrSurface);
    cameraControl.off(this._onCameraControlHoverSnapOrSurfaceOff);
    if (this._currentDistanceMeasurement) {
      this.IssuesPlugin.fire('measurementCancel', this._currentDistanceMeasurement);
      this._currentDistanceMeasurement.destroy();
      this._currentDistanceMeasurement = null;
    }
    this._active = false;
  }

  //themmoi37
  //themmoi2612
  loadIssue(data, isPoint) {
    const entity = this.plugin.viewer.scene.objects[data.entityId];
    this.plugin.loadIssue({
      data: data,
      entity: entity,
      id: data.id,
      color: data.color,
      isZoom: data.isZoom,
      isPoint: isPoint,
    });
  }

  deleteIssue(id) {
    this.plugin.deleteIssue(id);
  }
  clearIssue() {
    this.plugin.destroy();
  }
  //endthemmoi37
  /**
   * Resets this IssuesMouseControl.
   *
   * Destroys any {@link DistanceMeasurement} under construction by this IssuesMouseControl.
   *
   * Does nothing if the IssuesMouseControl is not active.
   */
  reset() {
    if (!this._active) {
      return;
    }

    this._destroyMarkerDiv();
    this._initMarkerDiv();

    if (this._currentDistanceMeasurement) {
      this.IssuesPlugin.fire('measurementCancel', this._currentDistanceMeasurement);
      this._currentDistanceMeasurement.destroy();
      this._currentDistanceMeasurement = null;
    }

    this._mouseState = MOUSE_FIRST_CLICK_EXPECTED;
  }

  /**
   * Gets the {@link DistanceMeasurement} under construction by this IssuesMouseControl, if any.
   *
   * @returns {null|DistanceMeasurement}
   */
  get currentMeasurement() {
    return this._currentDistanceMeasurement;
  }

  /**
   * Destroys this IssuesMouseControl.
   *
   * Destroys any {@link DistanceMeasurement} under construction by this IssuesMouseControl.
   */
  destroy() {
    this.deactivate();
    super.destroy();
  }
}
