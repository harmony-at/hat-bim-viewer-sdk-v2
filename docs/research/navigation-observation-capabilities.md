# xeokit Navigation Observation and Invalidation Capabilities

**Scope.** Audit of `hat-bim-viewer-sdk-v2` at `6f7c3f47f7846f8a1cdef4522400fdec48f67f11`, against the anchor/fallback/invalidation requirements in the supplied Trimble navigation design. This is a source audit, not an implementation proposal.

## Decision

The approved navigation flow does **not** need a new picking pipeline. Existing surface picking can provide a clipping-aware cursor hit, world position, entity identity, and—when the hit is a `SceneModelEntity`—model identity. Existing scene events are sufficient to invalidate anchors after explicit object hide, model unload, and section-plane changes. The Navigation Pivot and an aggregate of explicitly visible objects are also already available as fallback inputs.

Two capability gaps remain:

1. There is no general transform-change event for `SceneModel`, `SceneModelTransform`, or ordinary `Mesh` transforms, so a sticky world-space anchor cannot reliably detect or follow a moved source object without a small new internal signal (or polling).
2. There is no native “currently rendered visible bounds” query. `getAABB(scene.visibleObjectIds)` is usable for the approved aggregate-visible fallback, but it means explicitly `visible && collidable`, not frustum-, occlusion-, or section-plane-clipped visibility, and its empty-list behavior must be guarded.

## Capability matrix

| Need | Existing interface | Decision-relevant behavior | Gap / guard |
|---|---|---|---|
| Cursor Hit world position | `Scene.pick({canvasPos, pickSurface: true})`; already wrapped by `PickController` | `PickController` schedules exactly this surface pick and exposes the resulting `PickResult` ([PickController.js](../../src/viewer/scene/CameraControl/lib/controllers/PickController.js#L119), [PickController.js](../../src/viewer/scene/CameraControl/lib/controllers/PickController.js#L152)). | Copy the coordinates immediately; do not retain the returned typed-array reference. |
| Entity and model identity | `PickResult.entity`; `SceneModelEntity.model` | A result carries the picked entity ([PickResult.js](../../src/viewer/scene/webgl/PickResult.js#L12)); scene-model entities expose `id`, `isSceneModelEntity`, and their owning `model` ([SceneModelEntity.js](../../src/viewer/scene/model/SceneModelEntity.js#L24)). | Model identity is not uniform for every possible `Entity`; use `entity.model.id` only when `entity.isSceneModelEntity`, otherwise retain entity identity and, for `Component` entities, its destroy signal. |
| Nearest rendered surface | Existing GPU pick passes | The pick pass only draws non-culled, visible, pickable drawables and depth-tests them ([Renderer.js](../../src/viewer/scene/webgl/Renderer.js#L1359)). | “Interactive” currently means `pickable`; navigation should preserve that policy unless product requirements say otherwise. |
| Clipping-aware hit | Existing pick shaders and section-plane state | Pick mesh/depth programs are built with the scene section-plane state ([Layer.js](../../src/viewer/scene/model/layer/Layer.js#L141), [Layer.js](../../src/viewer/scene/model/layer/Layer.js#L231)); the shared fragment builder discards clipped fragments ([WebGLRenderer.js](../../src/viewer/scene/webgl/WebGLRenderer.js#L249)). | No new CPU clipping predicate is needed for acquiring a hit. A stored anchor still needs revalidation when section planes change. |
| Navigation Pivot | Internal `PivotController.getPivotPos()` / `setPivotPos()` | The controller owns a stable world position; before any explicit pivot is set, `getPivotPos()` falls back to `camera.look` ([PivotController.js](../../src/viewer/scene/CameraControl/lib/controllers/PivotController.js#L239)). | It exposes neither `hasPivot` nor entity/model provenance nor a pivot-changed event. The anchor resolver must distinguish “explicit pivot” from the `camera.look` fallback if that distinction matters. |
| Aggregate visible bounds | `scene.visibleObjectIds`, `scene.getAABB(ids)` | Visibility changes maintain a visible-object registry ([Scene.js](../../src/viewer/scene/scene/Scene.js#L1093)); `getAABB(ids)` unions collidable object AABBs ([Scene.js](../../src/viewer/scene/scene/Scene.js#L2449)). | Check `scene.numVisibleObjects > 0` first: an empty ID list returns `scene.aabb`, not an empty result ([Scene.js](../../src/viewer/scene/scene/Scene.js#L2472)). The registry does not exclude culled or clipped objects. |
| Hide/show invalidation | Scene `objectVisibility` event | Entity visibility updates refresh the registry and fire `objectVisibility` with the entity ([Scene.js](../../src/viewer/scene/scene/Scene.js#L1093)); `SceneModelEntity.visible` routes through it ([SceneModelEntity.js](../../src/viewer/scene/model/SceneModelEntity.js#L197)). | On model destruction, entity removal does not fire `objectVisibility`; model unload must be observed separately. |
| Model unload invalidation | Scene `modelUnloaded`; model `destroyed` | Deregistration emits `modelUnloaded` with the model ID ([Scene.js](../../src/viewer/scene/scene/Scene.js#L1069)); model destruction deregisters the model and then fires the normal component lifecycle ([SceneModel.js](../../src/viewer/scene/model/SceneModel.js#L3380), [Component.js](../../src/viewer/scene/Component.js#L850)). | `SceneModelEntity` itself is not a `Component` and has no per-entity destroyed event; match the stored `modelId` against `modelUnloaded`. |
| Section-plane invalidation | Scene `sectionPlaneCreated`, `sectionPlaneUpdated`, `sectionPlaneDestroyed` | Creation and destruction are published by `Scene` ([Scene.js](../../src/viewer/scene/scene/Scene.js#L999)); active/position/direction mutations all publish `sectionPlaneUpdated` ([SectionPlane.js](../../src/viewer/scene/sectionPlane/SectionPlane.js#L95)). | Revalidate only anchors whose source entity is clippable. A point-vs-active-plane test is sufficient to reject a now-clipped stored point; a fresh surface pick can be deferred to the next session rather than introduced as a per-tick pipeline. |
| Transform invalidation | Dirty propagation only | `SceneModelTransform` setters dirty matrices/AABBs and redraw, but emit no event ([SceneModelTransform.js](../../src/viewer/scene/model/SceneModelTransform.js#L98), [SceneModelTransform.js](../../src/viewer/scene/model/SceneModelTransform.js#L359)). `SceneModel` transform setters likewise dirty state without firing a transform notification ([SceneModel.js](../../src/viewer/scene/model/SceneModel.js#L1411)). | This is the concrete missing observation capability. Add one internal model/scene transform revision or event if anchors must invalidate during a live object/model transform. |

## Safe implementation boundary

The `NavigationContextController` can implement the approved fallback order with current facilities:

1. **Active Zoom Anchor:** new controller-owned session state; store copied `worldPos`, `entityId`, optional `modelId`, and source flags.
2. **Navigation Pivot:** read the existing `PivotController`; no pick required.
3. **Last valid Cursor Hit:** controller-owned copy of the same hit record.
4. **Visible-scene bounds reference:** if `numVisibleObjects > 0`, compute the center/reference from `getAABB(visibleObjectIds)`; otherwise skip it.
5. **Camera-forward plane:** pure camera math; no scene query or pick pipeline.

For invalidation, subscribe once at controller construction to `objectVisibility`, `modelUnloaded`, and the three section-plane lifecycle events; unsubscribe on destroy. Do not pick on these events or on each render tick. Mark the affected stored source invalid and let the existing fallback order resolve immediately.

Because `Renderer.pick` owns a reusable singleton `PickResult` and resets it on each call ([Renderer.js](../../src/viewer/scene/webgl/Renderer.js#L1256), [Renderer.js](../../src/viewer/scene/webgl/Renderer.js#L1274)), every stored anchor must copy `worldPos` and scalar IDs. Retaining `pickResult.worldPos` directly—as the current updater does ([CameraUpdater.js](../../src/viewer/scene/CameraControl/lib/CameraUpdater.js#L77))—does not provide durable session state.

## Explicitly deferred gaps

- True visible-frustum/nearest-cluster bounds require a new bounds service or renderer query; current scene APIs do not expose them.
- Tracking an anchor through arbitrary entity/model transforms requires source-local coordinates plus reliable source mesh/transform identity, or the narrower transform invalidation signal above. `PickResult.entity` alone does not identify the contributing `SceneModelMesh`.
- Adaptive near/far range is independent of hit observation and is not needed to implement the approved fallback lifecycle.
