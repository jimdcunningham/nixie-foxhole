"""Run with Blender --background --python-exit-code 1 --python this-file."""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector
import render_scene_common as common

document = {
    "structure": {"id": "camera-regression"},
    "render": {"outputKey": "camera-regression", "previewDirection": "sw"},
}
bounds = (Vector((-2, -1, 0)), Vector((4, 2, 3)))

def framing(mode, previous_position, previous_target):
    name = common.PREVIEW_CAMERA_NAME if mode == "preview" else common.TOPDOWN_CAMERA_NAME
    camera = common.configure_camera_object(name, Vector(previous_position), Vector(previous_target))
    bpy.context.view_layer.update()
    state = common.apply_render_mode(document, None, mode, bounds=bounds)
    result = (camera.data.ortho_scale, tuple(tuple(row) for row in camera.matrix_world))
    width, height = state["resolution"]
    center = state["boundsCenterProjection"]
    assert abs(center["pixelX"] - width / 2) < 0.001, (mode, center)
    assert abs(center["pixelY"] - height / 2) < 0.001, (mode, center)
    return result, state["anchor"]

for mode in ("preview", "topdown"):
    first = framing(mode, (12, 12, 12), (0, 0, 2))
    second = framing(mode, (200, -300, 50), (200, -300, 0))
    assert first == second, (mode, first, second)

print("Camera framing is independent of the preceding camera pose")
