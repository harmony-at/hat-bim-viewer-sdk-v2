import {Component} from "../../viewer/scene/Component.js";

/**
 * Creates {@link DistanceMeasurement}s in a {@link DistanceMeasurementsPlugin} from user input.
 *
 * @interface
 * @abstract
 */
export class IssuesControl extends Component {
    /**
     * Gets if this IssuesControl is currently active, where it is responding to input.
     *
     * @returns {boolean} True if this IssuesControl is active.
     * @abstract
     */
    get active() {}
  
    /**
     * Sets whether snap-to-vertex and snap-to-edge are enabled for this IssuesControl.
     *
     * This is `true` by default.
     *
     * Internally, this deactivates then activates the IssuesControl when changed, which means that
     * it will destroy any Issues currently under construction, and incurs some overhead, since it unbinds
     * and rebinds various input handlers.
     *
     * @param {boolean} snapping Whether to enable snap-to-vertex and snap-edge for this IssuesControl.
     */
    set snapping(snapping) {}
  
    /**
     * Gets whether snap-to-vertex and snap-to-edge are enabled for this IssuesControl.
     *
     * This is `true` by default.
     *
     * @returns {boolean} Whether snap-to-vertex and snap-to-edge are enabled for this IssuesControl.
     */
    get snapping() {
      return true;
    }
  
    /**
     * Activates this IssuesControl, ready to respond to input.
     *
     * @abstract
     */
    activate() {}
  
    /**
     * Deactivates this IssuesControl, making it unresponsive to input.
     *
     * Destroys any {@link DistanceMeasurement} under construction by this IssuesControl.
     *
     * @abstract
     */
    deactivate() {}
  
    /**
     * Resets this IssuesControl.
     *
     * Destroys any {@link DistanceMeasurement} under construction by this IssuesControl.
     *
     * Does nothing if the IssuesControl is not active.
     *
     * @abstract
     */
    reset() {}
  
    /**
     * Gets the {@link DistanceMeasurement} under construction by this IssuesControl, if any.
     *
     * @returns {null|DistanceMeasurement}
     *
     * @abstract
     */
    get currentMeasurement() {
      return null;
    }
  
    /**
     * Destroys this IssuesControl.
     *
     * Destroys any {@link DistanceMeasurement} under construction by this IssuesControl.
     *
     * @abstract
     */
    destroy() {}
  }