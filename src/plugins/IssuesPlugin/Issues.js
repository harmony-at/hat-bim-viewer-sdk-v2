import {Marker} from "../../viewer/scene/marker/Marker.js";
import {Dot} from "../lib/html/Dot.js";
import {math} from "../../viewer/scene/math/math.js";
import {Component} from "../../viewer/scene/Component.js";

class Issues extends Component {
    constructor(plugin, cfg = {}) {
      super(plugin.viewer.scene, cfg);
  
      this.plugin = plugin;
  
      this._container = cfg.container;
      if (!this._container) {
        throw 'config missing: container';
      }
  
      this._eventSubs = {};
  
      const scene = this.plugin.viewer.scene;
      this._issueMarker = new Marker(scene, cfg.origin);
  
      this._issueWorld = math.vec3();
  
      this._isDragging = false;
      this._dragOffset = { x: 0, y: 0 };
  
      this._wp = new Float64Array(12);
      this._vp = new Float64Array(12);
      this._pp = new Float64Array(12);
      this._cp = new Float64Array(4);
  
      this._color = cfg.color || this.plugin.defaultColor;
      this._triggerIssueState = cfg.triggerIssueState;
  
      const onMouseOver = cfg.onMouseOver
        ? (event) => {
            cfg.onMouseOver(event, this);
            this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
              new MouseEvent('mouseover', event)
            );
          }
        : null;
  
      const onMouseLeave = cfg.onMouseLeave
        ? (event) => {
            cfg.onMouseLeave(event, this);
            this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
              new MouseEvent('mouseleave', event)
            );
          }
        : null;
  
      const onMouseDown = (event) => {
        //   event.preventDefault();
        console.log('event nenenenen');
        this._isDragging = true;
        this._dragOffset.x = event.clientX - this._issueDot._x;
        this._dragOffset.y = event.clientY - this._issueDot._y;
        this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
          new MouseEvent('mousedown', event)
        );
      };
  
      const onMouseMove = (event) => {
        if (this._isDragging) {
          const x = event.clientX - this._dragOffset.x;
          const y = event.clientY - this._dragOffset.y;
          this._updateIssuePosition(x, y);
        }
        this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
          new MouseEvent('mousemove', event)
        );
      };
  
      const onMouseUp = (event) => {
        this._isDragging = false;
        this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
          new MouseEvent('mouseup', event)
        );
      };
  
      const onContextMenu = cfg.onContextMenu
        ? (event) => {
            cfg.onContextMenu(event, this);
          }
        : null;
  
      const onMouseWheel = (event) => {
        this.plugin.viewer.scene.canvas.canvas.dispatchEvent(
          new WheelEvent('wheel', event)
        );
      };
  
      const getId = () => {
        this._triggerIssueState(cfg.id);
      };
  
      this._issueDot = new Dot(this._container, {
        fillColor: this._color,
        zIndex: plugin.zIndex !== undefined ? plugin.zIndex + 2 : undefined,
        onMouseOver,
        onMouseLeave,
        onMouseWheel,
        onMouseDown,
        onMouseUp,
        onMouseMove,
        onContextMenu,
        getId,
        visible: 'visible',
        width: 18,
        height: 18,
        isIssue: true,
        id: cfg.id,
        //themmoi2012
        origin: cfg?.origin.worldPos,
        //themmoi2612
        isPoint: cfg?.isPoint
      });
  
      this._wpDirty = false;
      this._vpDirty = false;
      this._cpDirty = false;
      this._sectionPlanesDirty = true;
  
      this._visible = false;
      this._issueVisible = false;
      this._clickable = false;
  
      this._issueMarker.on('worldPos', (value) => {
        this._issueWorld.set(value || [0, 0, 0]);
        this._wpDirty = true;
        this._needUpdate(0);
      });
  
      this._onViewMatrix = scene.camera.on('viewMatrix', () => {
        this._vpDirty = true;
        this._needUpdate(0);
      });
  
      this._onProjMatrix = scene.camera.on('projMatrix', () => {
        this._cpDirty = true;
        this._needUpdate();
      });
  
      this._onCanvasBoundary = scene.canvas.on('boundary', () => {
        this._cpDirty = true;
        this._needUpdate(0);
      });
  
      this._onSectionPlaneUpdated = scene.on('sectionPlaneUpdated', () => {
        this._sectionPlanesDirty = true;
        this._needUpdate();
      });
  
      this.visible = cfg.visible;
      this.issueVisible = cfg.issueVisible;
    }
  
    _updateIssuePosition(x, y) {
      const scene = this.plugin.viewer.scene;
      const camera = scene.camera;
  
      // Chuyển đổi từ tọa độ màn hình sang tọa độ chuẩn hóa
      const canvas = scene.canvas.canvas;
      const rect = canvas.getBoundingClientRect();
      const normalizedX = ((x - rect.left) / canvas.clientWidth) * 2 - 1;
      const normalizedY = -((y - rect.top) / canvas.clientHeight) * 2 + 1;
  
      // Tạo ray từ camera qua điểm trên màn hình
      const ray = camera.getWorldRay(normalizedX, normalizedY);
  
      // Tính toán điểm giao của ray với mặt phẳng chứa issue cũ
      const planeNormal = camera.worldForward;
      const planePoint = this._issueWorld;
      const intersection = math.intersectRayPlane(
        ray.origin,
        ray.direction,
        planePoint,
        planeNormal
      );
  
      if (intersection) {
        // Cập nhật vị trí mới cho issue
        this._issueMarker.worldPos = intersection;
        this._wpDirty = true;
        this._needUpdate(0);
      }
    }
  
    _update() {
      if (!this._visible) {
        return;
      }
  
      const scene = this.plugin.viewer.scene;
  
      if (this._wpDirty) {
        this._wp[0] = this._issueWorld[0];
        this._wp[1] = this._issueWorld[1];
        this._wp[2] = this._issueWorld[2];
        this._wp[3] = 1.0;
  
        this._wpDirty = false;
        this._vpDirty = true;
      }
  
      if (this._vpDirty) {
        math.transformPositions4(scene.camera.viewMatrix, this._wp, this._vp);
  
        this._vp[3] = 1.0;
  
        this._vpDirty = false;
        this._cpDirty = true;
      }
  
      if (this._sectionPlanesDirty) {
        if (this._isSliced(this._issueWorld)) {
          this._issueDot.setCulled(true);
          return;
        } else {
          this._issueDot.setCulled(false);
        }
  
        this._sectionPlanesDirty = true;
      }
  
      const near = -0.3;
      const vpz = this._issueMarker.viewPos[2];
  
      if (vpz > near) {
        this._issueDot.setVisible(false);
        return;
      }
  
      if (this._cpDirty) {
        math.transformPositions4(scene.camera.project.matrix, this._vp, this._pp);
  
        const pp = this._pp;
        const cp = this._cp;
  
        const canvas = scene.canvas.canvas;
        const offsets = canvas.getBoundingClientRect();
        const containerOffsets = this._container.getBoundingClientRect();
        const top = offsets.top - containerOffsets.top;
        const left = offsets.left - containerOffsets.left;
        const aabb = scene.canvas.boundary;
        const canvasWidth = aabb[2];
        const canvasHeight = aabb[3];
  
        cp[0] = left + Math.floor(((1 + pp[0] / pp[3]) * canvasWidth) / 2);
        cp[1] = top + Math.floor(((1 - pp[1] / pp[3]) * canvasHeight) / 2);
  
        this._issueDot.setPos(cp[0], cp[1]);
  
        this._issueDot._x = cp[0];
        this._issueDot._y = cp[1];
  
        // this._issueDot.setVisible(this._visible && this._issueVisible);
        this._issueDot.setVisible(true);
        this._cpDirty = false;
      }
    }
  
    _isSliced(positions) {
      const sectionPlanes = this.scene._sectionPlanesState.sectionPlanes;
      for (let i = 0, len = sectionPlanes.length; i < len; i++) {
        const sectionPlane = sectionPlanes[i];
        if (math.planeClipsPositions3(sectionPlane.pos, sectionPlane.dir, positions, 4)) {
          return true;
        }
      }
      return false;
    }
  
    get issueData() {
      return this._issueMarker;
    }
  
    get color() {
      return this._color;
    }
  
    set color(value) {
      this._color = value;
      this._issueDot.setFillColor(value);
    }
  
    set visible(value) {
      value = value !== undefined ? Boolean(value) : this.plugin.defaultVisible;
  
      this._visible = value;
  
      // this._issueDot.setVisible(this._visible && this._issueVisible);
  
      this._cpDirty = true;
  
      this._needUpdate();
    }
  
    get visible() {
      return this._visible;
    }
  
    set issueVisible(value) {
      value = value !== undefined ? Boolean(value) : this.plugin.defaultIssueVisible;
      this._issueVisible = value;
      // this._issueDot.setVisible(this._visible && this._issueVisible);
    }
  
    get issueVisible() {
      return this._issueVisible;
    }
  
    setHighlighted(highlighted) {
      this._issueDot.setHighlighted(highlighted);
    }
  
    set clickable(value) {
      value = !!value;
      this._clickable = value;
      this._issueDot.setClickable(this._clickable);
    }
  
    get clickable() {
      return this._clickable;
    }
  
    destroy() {
      const scene = this.plugin.viewer.scene;
  
      if (this._onViewMatrix) {
        scene.camera.off(this._onViewMatrix);
      }
      if (this._onProjMatrix) {
        scene.camera.off(this._onProjMatrix);
      }
      if (this._onCanvasBoundary) {
        scene.canvas.off(this._onCanvasBoundary);
      }
      if (this._onSectionPlaneUpdated) {
        scene.off(this._onSectionPlaneUpdated);
      }
  
      this._issueDot.destroy();
  
      super.destroy();
    }
  }
  
export {Issues};