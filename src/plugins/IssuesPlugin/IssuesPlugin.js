import { Plugin } from "../../viewer/Plugin.js";
import { Issues } from "./Issues.js";
import { IssuesControl } from "./IssuesControl.js";
import { Marker } from "../../viewer/index.js";
import { math } from "../../viewer/index.js";

class IssuesPlugin extends Plugin {
  constructor(viewer, cfg = {}) {
    super('Issues', viewer);

    this._pointerLens = cfg.pointerLens;

    this._container = cfg.container || document.body;

    this._defaultControl = null;

    this._issues = {};

    this.labelMinAxisLength = cfg.labelMinAxisLength;
    this.defaultVisible = cfg.defaultVisible !== false;
    this.defaultOriginVisible = cfg.defaultOriginVisible !== false;
    this.defaultTargetVisible = cfg.defaultTargetVisible !== false;
    this.defaultWireVisible = cfg.defaultWireVisible !== false;
    this.defaultXLabelEnabled = cfg.defaultXLabelEnabled !== false;
    this.defaultYLabelEnabled = cfg.defaultYLabelEnabled !== false;
    this.defaultZLabelEnabled = cfg.defaultZLabelEnabled !== false;
    this.defaultLengthLabelEnabled = cfg.defaultLengthLabelEnabled !== false;
    this.defaultLabelsVisible = cfg.defaultLabelsVisible !== false;
    this.defaultAxisVisible = cfg.defaultAxisVisible !== false;
    this.defaultXAxisVisible = cfg.defaultXAxisVisible !== false;
    this.defaultYAxisVisible = cfg.defaultYAxisVisible !== false;
    this.defaultZAxisVisible = cfg.defaultZAxisVisible !== false;
    this.defaultColor = cfg.defaultColor !== undefined ? cfg.defaultColor : '#00BBFF';
    this.zIndex = cfg.zIndex || 10000;
    this.defaultLabelsOnWires = cfg.defaultLabelsOnWires !== false;
    this._triggerIssueState = cfg.bimview.triggerIssueState.bind(cfg.bimview);

    this._onMouseOver = (event, issue) => {
      this.fire('mouseOver', {
        plugin: this,
        issues: issue,
        issue,
        event,
      });
    };

    this._onMouseLeave = (event, issue) => {
      this.fire('mouseLeave', {
        plugin: this,
        issues: issue,
        issue,
        event,
      });
    };

    this._onContextMenu = (event, issue) => {
      this.fire('contextMenu', {
        plugin: this,
        issues: issue,
        issue,
        event,
      });
    };
  }

  /**
   * Gets the plugin's HTML container element, if any.
   * @returns {*|HTMLElement|HTMLElement}
   */
  getContainerElement() {
    return this._container;
  }

  /**
   * @private
   */
  send(name, value) { }

  /**
   * Gets the PointerLens attached to this IssuesPlugin.
   * @returns {PointerCircle}
   */
  get pointerLens() {
    return this._pointerLens;
  }

  /**
   * Gets the default {@link IssuesControl}.
   *
   * @type {IssuesControl}
   * @deprecated
   */
  get control() {
    if (!this._defaultControl) {
      this._defaultControl = new IssuesControl(this, {});
    }
    return this._defaultControl;
  }

  /**
   * Gets the existing {@link Issues}s, each mapped to its {@link Issues#id}.
   *
   * @type {{String:Issues}}
   */
  get issues() {
    return this._issues;
  }

  /**
   * Sets the minimum length, in pixels, of an axis wire beyond which its label is shown.
   *
   * The axis wire's label is not shown when its length is less than this value.
   *
   * This is ````25```` pixels by default.
   *
   * Must not be less than ````1````.
   *
   * @type {number}
   */
  set labelMinAxisLength(labelMinAxisLength) {
    if (labelMinAxisLength < 1) {
      this.error('labelMinAxisLength must be >= 1; defaulting to 25');
      labelMinAxisLength = 25;
    }
    this._labelMinAxisLength = labelMinAxisLength || 25;
  }

  /**
   * Gets the minimum length, in pixels, of an axis wire beyond which its label is shown.
   * @returns {number}
   */
  get labelMinAxisLength() {
    return this._labelMinAxisLength;
  }

  createIssue(params = {}) {
    if (this._issues[params.id]) {
      const IssueMarker = new Marker(this.viewer.scene, params.origin);
      const IssueWorld = math.vec3();
      IssueMarker.on('worldPos', (value) => {
        IssueWorld.set(value || [0, 0, 0]);
      });
      const offset = [10, 10, 10];
      const eyePos = [
        IssueWorld[0] + offset[0],
        IssueWorld[1] + offset[1],
        IssueWorld[2] + offset[2],
      ];
      this.viewer.camera.look = IssueWorld;
      this.viewer.camera.eye = eyePos;
      return;
    }

    const origin = params.origin;
    const target = params.target;
    const issue = new Issues(this, {
      id: params.id,
      container: this._container, // Chứa canvas hoặc container chứa
      color: params.color || '#FF0000', // màu mặc định nếu không có
      onMouseOver: params.onMouseOver,
      onMouseLeave: params.onMouseLeave,
      onContextMenu: params.onContextMenu,
      visible: params.visible,
      issueVisible: params.issueVisible,
      origin: {
        entity: origin.entity,
        worldPos: origin.worldPos,
      },
      target: {
        entity: target.entity,
        worldPos: target.worldPos,
      },
      triggerIssueState: this._triggerIssueState,
      //themmoi2612
      isPoint: params.isPoint,
    });

    if (params.isZoom) {
      const offset = [10, 10, 10];
      const eyePos = [
        issue._issueWorld[0] + offset[0],
        issue._issueWorld[1] + offset[1],
        issue._issueWorld[2] + offset[2],
      ];
      this.viewer.camera.look = issue._issueWorld;
      this.viewer.camera.eye = eyePos;
    }

    this._issues[params.id] = issue;

    this.fire('issueCreated', issue);

    return issue;
  }

  loadIssue(value) {
    // const origin = value.data;
    // const target = value.data;
    const origin = {
      worldPos: value.data.data,
      entity: value.entity,
    };
    const target = {
      worldPos: value.data.data,
      entity: value.entity,
    };
    this.createIssue({
      origin: origin,
      target: target,
      id: value.id,
      color: value.color,
      isZoom: value.isZoom,
      //themmoi2612
      isPoint: value.isPoint,
    });
  }

  deleteIssue(id) {
    const issue = this._issues[id];
    if (!issue) {
      this.log('Issue not found: ' + id);
      return;
    }
    issue.destroy();
    delete this._issues[id];
    this.fire('issueDestroyed', issue);
  }

  /**
   * Destroys a {@link Issues}.
   *
   * @param {String} id ID of Issues to destroy.
   */
  destroyIssue(id) {
    const issue = this._issues[id];
    if (!issue) {
      this.log('Issues not found: ' + id);
      return;
    }
    issue.destroy();
    this.fire('issueDestroyed', issue);
  }

  /**
   * Shows all or hides the distance label of each {@link Issues}.
   *
   * @param {Boolean} labelsShown Whether or not to show the labels.
   */
  setLabelsShown(labelsShown) {
    for (const [key, issue] of Object.entries(this.measurements)) {
      issue.labelShown = labelsShown;
    }
  }

  /**
   * Shows all or hides the axis wires of each {@link Issues}.
   *
   * @param {Boolean} labelsShown Whether or not to show the axis wires.
   */
  setAxisVisible(axisVisible) {
    for (const [key, issue] of Object.entries(this.measurements)) {
      issue.axisVisible = axisVisible;
    }
    this.defaultAxisVisible = axisVisible;
  }

  /**
   * Gets if the axis wires of each {@link Issues} are visible.
   *
   * @returns {Boolean} Whether or not the axis wires are visible.
   */
  getAxisVisible() {
    return this.defaultAxisVisible;
  }

  /**
   * Destroys all {@link Issues}s.
   */
  clear() {
    const ids = Object.keys(this._issues);
    for (var i = 0, len = ids.length; i < len; i++) {
      this.deleteIssue(ids[i]);
    }
  }

  /**
   * Destroys this IssuesPlugin.
   *
   * Destroys all {@link Issues}s first.
   */
  destroy() {
    this.clear();
    super.destroy();
  }
}

export { IssuesPlugin }