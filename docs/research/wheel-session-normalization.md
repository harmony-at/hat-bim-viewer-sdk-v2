# Wheel and Trackpad Session Normalization

Research date: 2026-08-10
xeokit baseline: `6f7c3f47f7846f8a1cdef4522400fdec48f67f11`

## Decision

Retain the four proposed baselines, with their role made explicit:

| Policy | Recommendation | Basis |
| --- | --- | --- |
| Line conversion | **16 pixels per line** | Retain as a named xeokit convention. The standard defines line units but deliberately provides no line-to-pixel ratio. |
| Page conversion | **Current canvas client height per page** | Retain. A page is defined as a screen or demarcated page; for an embedded viewer, its visible canvas is the relevant screen. |
| Safety clamp | **Clamp each converted event to one canvas page, preserving its sign and all sub-page magnitude** | Retain as an outlier guard after unit conversion. It is an application policy, not a standard requirement. |
| Session boundary | **Start a new session when the gap from the preceding accepted vertical wheel event is at least 160 ms** | Retain as an internal heuristic. UI Events requires wheel transactions but intentionally leaves the time interval implementation-specific. |

Normalize `deltaY` to signed pixel-equivalent distance first:

```text
pixelDelta = deltaY                                      when deltaMode = PIXEL
pixelDelta = deltaY * 16                                 when deltaMode = LINE
pixelDelta = deltaY * canvas.clientHeight                when deltaMode = PAGE
normalizedDelta = clamp(pixelDelta, -canvas.clientHeight, canvas.clientHeight)
```

Pass `normalizedDelta` onward without reducing it to its sign and without multiplying it by the inter-event time. Use time only to decide whether the sticky zoom-anchor session continues. A direction reversal inside the gap remains in the same session; pointer movement also does not end it. Zero-`deltaY` events do not contribute zoom magnitude or extend the vertical zoom session.

The exact constants are xeokit product choices, not portable facts about hardware. Keep them private and named, as approved, and make the normalizer a pure internal function so its unit conversions and boundary cases can be tested independently.

## Evidence

### What the standards establish

- `WheelEvent.deltaX`, `deltaY`, and `deltaZ` are measurements in pixels, lines, or pages after an environment-specific translation of physical input. Device settings may add acceleration or produce sub-pixel measurements, so authors cannot assume identical physical motion produces identical numeric deltas across environments. This means the numeric magnitude contains user-agent/device intent and should not be collapsed to ±1. [W3C UI Events: Wheel Events](https://w3c.github.io/uievents/split/wheel-events.html#events-wheelevents)
- `DOM_DELTA_PIXEL`, `DOM_DELTA_LINE`, and `DOM_DELTA_PAGE` identify pixel, text-line, and page units. A page may be a single screen or a demarcated page; no normative conversion ratio from lines or pages to pixels is supplied. [W3C UI Events: `WheelEvent`](https://w3c.github.io/uievents/split/wheel-events.html#interface-wheelevent)
- A user agent groups events from one gesture into a wheel event transaction, but the grouping interval is explicitly implementation-specific. Consequently, 160 ms cannot be validated as a web-standard value; it is a reasonable xeokit session policy that must be covered by behavioral tests. [W3C UI Events: wheel event transaction](https://w3c.github.io/uievents/split/wheel-events.html#wheel-event-transaction)
- `Event.timeStamp` is a `DOMHighResTimeStamp` exposed on every event and represents the event timestamp in milliseconds. Use successive wheel-event timestamps for the gap calculation, rather than folding handler arrival timing into zoom magnitude. [WHATWG DOM: `Event.timeStamp`](https://dom.spec.whatwg.org/#dom-event-timestamp)

### What current xeokit does

- The camera wheel handler clamps `-deltaY * 40` to `[-1, 1]`, divides by its absolute value, and therefore retains only direction. It then scales that sign by an elapsed time forced into the range 1/60–1/20 second. It does not inspect `deltaMode`. [MousePanRotateDollyHandler.js](../../src/viewer/scene/CameraControl/lib/handlers/MousePanRotateDollyHandler.js#L313-L347)
- The scene-level `mousewheel` input event independently applies the same `[-1, 1]` clamp and also ignores `deltaMode`. It is not the input consumed by the camera handler above, so changing its public event semantics is not required for this navigation change. [Input.js](../../src/viewer/scene/input/Input.js#L1225-L1235)
- `CameraUpdater` subsequently applies distance-based scaling and inertia to the accumulated `dollyDelta`; it does not recover the magnitude already discarded by the wheel handler. [CameraUpdater.js](../../src/viewer/scene/CameraControl/lib/CameraUpdater.js#L59-L114)

## Inferences and trade-offs

The following are engineering inferences, not requirements stated by W3C or WHATWG:

1. **16 pixels per line is acceptable but not uniquely correct.** A 3D canvas has no meaningful text line height. A fixed private constant gives deterministic behavior across scenes and is preferable here to coupling navigation to unrelated CSS typography.
2. **Canvas height is the best local definition of a page.** It matches the portion of the 3D application visible to the user and updates naturally when the viewer is resized.
3. **The one-page clamp is deliberately lossy only for extreme single events.** Below the clamp it preserves device acceleration and fractional trackpad deltas; above it, safety against a camera jump wins over literal magnitude.
4. **160 ms is a starting value, not a spec-derived truth.** Acceptance tests should assert only the chosen boundary semantics (`gap < 160 ms` continues; `gap >= 160 ms` starts a new session), while manual mouse/trackpad testing decides whether the constant needs future adjustment.

## Implementation-facing acceptance cases

For a canvas height of 800 pixels:

- pixel delta `7.5` → `7.5`
- line delta `3` → `48`
- page delta `0.5` → `400`
- page delta `2` → `800` after clamping
- equal signed deltas arriving at different sub-160-ms intervals contribute equal zoom magnitude
- an event at 159 ms after the previous accepted event continues the session; an event at 160 ms starts a new one

The normalization belongs in the camera-control wheel path. Leave the independent scene `mousewheel` event unchanged unless a separate compatibility decision explicitly changes that public event.
