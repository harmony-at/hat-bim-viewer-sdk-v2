# Viewer Navigation

The shared language for camera navigation behavior in the xeokit viewer SDK.

## Language

**Cursor Hit**:
The visible surface point observed beneath the pointer at a particular instant.
_Avoid_: Hit point, pointer target

**Zoom Anchor**:
The stable spatial reference retained for the duration of one zoom gesture.
_Avoid_: Cursor hit, follow-pointer position

**Navigation Pivot**:
The persistent spatial reference established by a navigation action to preserve context across gestures. A camera look point alone is not a Navigation Pivot.
_Avoid_: Zoom anchor, camera look point

**Pan Reference**:
The spatial point or depth fixed when a pan gesture begins.
_Avoid_: Navigation pivot, pan target
