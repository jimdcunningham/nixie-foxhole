import argparse
import os
import sys

import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from script_bootstrap import append_script_search_paths


append_script_search_paths(globals().get("__file__"), bpy.data.filepath, os.getcwd())

from render_scene_common import (  # noqa: E402
    ICON_CAMERA_NAME,
    PREVIEW_CAMERA_NAME,
    SUN_NAME,
    TOPDOWN_CAMERA_NAME,
    configure_scene_render,
    ensure_camera_object,
    ensure_sun_object,
    set_object_look_at,
)


RIG_OBJECT_NAMES = {
    TOPDOWN_CAMERA_NAME,
    PREVIEW_CAMERA_NAME,
    ICON_CAMERA_NAME,
    SUN_NAME,
}


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true", help="Save the current blend file after configuring the template")
    parser.add_argument("--preview-size", type=int, default=512)
    parser.add_argument("--icon-size", type=int, default=256)
    return parser.parse_args(raw_args)


def configure_camera(name: str, location: Vector, target: Vector) -> None:
    camera_object = ensure_camera_object(name)
    camera_object.location = location
    set_object_look_at(camera_object, target)
    camera_object.data.type = "ORTHO"
    camera_object.data.ortho_scale = 8.0
    camera_object.data.clip_start = 0.01
    camera_object.data.clip_end = 1000.0


def purge_template_scene() -> None:
    scene_collection = bpy.context.scene.collection

    for obj in list(bpy.data.objects):
        if obj.name in RIG_OBJECT_NAMES:
            continue
        bpy.data.objects.remove(obj, do_unlink=True)

    for collection in list(bpy.data.collections):
        if collection == scene_collection:
            continue
        if collection.name.startswith("FoxWatch:"):
            bpy.data.collections.remove(collection)
            continue
        if not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)


def main():
    args = parse_args()
    scene = bpy.context.scene
    purge_template_scene()
    scene.render.filepath = "//renders/"
    configure_scene_render(args.preview_size, args.preview_size, True)

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = False
    world.color = (0.98, 0.98, 1.0)

    configure_camera(TOPDOWN_CAMERA_NAME, Vector((0.0, 0.0, 20.0)), Vector((0.0, 0.0, 0.0)))
    configure_camera(PREVIEW_CAMERA_NAME, Vector((12.0, 12.0, 12.0)), Vector((0.0, 0.0, 2.0)))
    configure_camera(ICON_CAMERA_NAME, Vector((14.0, 14.0, 14.0)), Vector((0.0, 0.0, 2.5)))

    sun_object = ensure_sun_object(SUN_NAME)
    sun_object.location = (0.0, 0.0, 20.0)
    sun_object.rotation_mode = "XYZ"
    sun_object.rotation_euler = (0.78539816339, 0.0, 0.52359877559)
    sun_object.data.energy = 3.0
    sun_object.data.angle = 0.17453292519

    scene.camera = bpy.data.objects[PREVIEW_CAMERA_NAME]

    if args.save:
        bpy.ops.wm.save_mainfile()

    print(
        f"Configured render template with cameras {TOPDOWN_CAMERA_NAME}, {PREVIEW_CAMERA_NAME}, {ICON_CAMERA_NAME} and sun {SUN_NAME}"
    )


if __name__ == "__main__":
    main()
