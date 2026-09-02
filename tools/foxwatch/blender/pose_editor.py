import argparse
import json
import os
import shutil
import sys
from datetime import datetime

import bpy
from bpy.props import StringProperty
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from script_bootstrap import append_script_search_paths


append_script_search_paths(globals().get("__file__"), bpy.data.filepath, os.getcwd())

from render_scene_common import (  # noqa: E402
    apply_collection_clip_bounds,
    apply_pose_to_imported_objects,
    collection_world_bounds,
    find_clip_bounds_object,
    load_json,
    normalize_search_roots,
    remove_collections_with_prefix,
    remove_default_startup_scene_objects,
    resolve_scene_variant_id,
)
from render_scene_graph import import_render_scene  # noqa: E402


STATE = {
    "scene_document": None,
    "scene_path": None,
    "structure_id": None,
    "override_path": None,
    "manifest_override_path": None,
    "collection_name": None,
    "armature_name": None,
    "pose_sources_by_id": {},
    "pose_source_ids": [],
}

CLASSES = []


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", help="Absolute path to a single render bundle scene manifest")
    parser.add_argument("--index", help="Absolute path to render bundle index manifest")
    parser.add_argument("--structure-id", help="Structure id to resolve from the index manifest")
    parser.add_argument("--override-path", required=True, help="Absolute path to the exported pose override file")
    parser.add_argument("--public-root", default=None)
    parser.add_argument("--foxwatch-output-root", default=None)
    parser.add_argument("--replace-existing", action="store_true")
    parser.add_argument("--scene-variant", default=None)
    parser.add_argument("--purge-existing", action="store_true")
    return parser.parse_args(raw_args)


def resolve_scene_path(args):
    if args.scene:
        return args.scene

    if not args.index or not args.structure_id:
        raise ValueError("Provide --scene or both --index and --structure-id")

    index_document = load_json(args.index)
    for scene_entry in index_document.get("scenes", []):
        if scene_entry.get("structureId") == args.structure_id:
            return os.path.join(os.path.dirname(args.index), scene_entry["outputPath"])

    raise ValueError(f"Could not find structure '{args.structure_id}' in render bundle index")


def walk_nodes(nodes):
    for node in nodes or []:
        yield node
        yield from walk_nodes(node.get("children", []))


def find_pose_node(scene_document):
    for node in walk_nodes(scene_document.get("scene", {}).get("roots", [])):
        if node.get("pose") or node.get("poseVariants"):
            return node
    return None


def build_pose_sources(scene_document):
    pose_node = find_pose_node(scene_document)
    if pose_node is None:
        return {}, []

    pose_sources_by_id = {}
    pose_source_ids = []

    default_pose = pose_node.get("pose")
    if default_pose:
        pose_sources_by_id["default-pose"] = {
            "label": "Load Generated Default",
            "pose": default_pose,
        }
        pose_source_ids.append("default-pose")

    pose_variants = pose_node.get("poseVariants") or {}
    variant_names_by_id = {
        variant.get("id"): variant.get("name") or variant.get("id")
        for variant in scene_document.get("variants", [])
        if variant.get("id")
    }

    for variant_id in variant_names_by_id:
        pose_document = pose_variants.get(variant_id)
        if not pose_document:
            continue
        pose_sources_by_id[variant_id] = {
            "label": f"Load {variant_names_by_id[variant_id]}",
            "pose": pose_document,
        }
        pose_source_ids.append(variant_id)

    for variant_id, pose_document in pose_variants.items():
        if variant_id in pose_sources_by_id or not pose_document:
            continue
        pose_sources_by_id[variant_id] = {
            "label": f"Load {variant_id}",
            "pose": pose_document,
        }
        pose_source_ids.append(variant_id)

    return pose_sources_by_id, pose_source_ids


def get_editor_collection():
    collection_name = STATE.get("collection_name")
    if not collection_name:
        return None
    return bpy.data.collections.get(collection_name)


def get_active_armature():
    armature_name = STATE.get("armature_name")
    if armature_name:
        armature_object = bpy.data.objects.get(armature_name)
        if armature_object is not None:
            return armature_object

    collection = get_editor_collection()
    if collection is None:
        return None

    for obj in collection.all_objects:
        if obj.type == "ARMATURE":
            STATE["armature_name"] = obj.name
            return obj

    return None


def focus_armature(armature_object):
    if armature_object is None:
        return

    armature_object.show_in_front = True

    try:
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass

    for obj in bpy.context.selected_objects:
        obj.select_set(False)

    armature_object.select_set(True)
    bpy.context.view_layer.objects.active = armature_object
    try:
        bpy.ops.object.mode_set(mode="POSE")
    except Exception:
        pass

    try:
        bpy.ops.pose.select_all(action="DESELECT")
    except Exception:
        pass

    active_bone = None
    for pose_bone in armature_object.pose.bones:
        if pose_bone.bone.hide:
            continue
        active_bone = pose_bone
        break

    if active_bone is not None:
        if hasattr(active_bone.bone, "select"):
            active_bone.bone.select = True
        if hasattr(active_bone.bone, "select_head"):
            active_bone.bone.select_head = True
        if hasattr(active_bone.bone, "select_tail"):
            active_bone.bone.select_tail = True
        armature_object.data.bones.active = active_bone.bone


def ensure_view3d_sidebar_visible():
    windows = getattr(bpy.context.window_manager, "windows", [])
    for window in windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue

        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue

            for space in area.spaces:
                if space.type != "VIEW_3D":
                    continue
                space.show_region_ui = True
                space.show_gizmo = True
                break


def ensure_view3d_material_preview():
    windows = getattr(bpy.context.window_manager, "windows", [])
    for window in windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue

        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue

            for space in area.spaces:
                if space.type != "VIEW_3D":
                    continue
                shading = getattr(space, "shading", None)
                if shading is None:
                    continue
                shading.type = "MATERIAL"
                if hasattr(shading, "use_scene_lights"):
                    shading.use_scene_lights = True
                if hasattr(shading, "use_scene_world"):
                    shading.use_scene_world = True
                break


def get_manifest_override_path():
    manifest_override_path = STATE.get("manifest_override_path")
    if manifest_override_path:
        return manifest_override_path

    override_path = STATE.get("override_path")
    if not override_path:
        raise ValueError("No FoxWatch override path is configured")

    manifest_override_path = os.path.join(os.path.dirname(os.path.abspath(override_path)), "manifest.json")
    STATE["manifest_override_path"] = manifest_override_path
    return manifest_override_path


def build_manifest_override_scaffold():
    scene_document = STATE.get("scene_document") or {}
    structure = scene_document.get("structure") or {}
    render_settings = scene_document.get("render") or {}
    scaffold = {}

    category_id = structure.get("categoryId")
    if category_id:
        scaffold["categoryId"] = category_id

    preview_direction = render_settings.get("previewDirection")
    if preview_direction:
        scaffold["previewDirection"] = preview_direction

    if render_settings.get("clipFloor") is True:
        scaffold["clipFloor"] = True

    return scaffold


def read_manifest_override_document():
    manifest_override_path = get_manifest_override_path()
    if not os.path.exists(manifest_override_path):
        return build_manifest_override_scaffold()

    document = load_json(manifest_override_path)
    if not isinstance(document, dict):
        raise ValueError(f"Manifest override root must be an object: {manifest_override_path}")

    return document


def backup_file(file_path: str):
    if not os.path.exists(file_path):
        return

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{file_path}.{timestamp}.bak"
    shutil.copyfile(file_path, backup_path)


def write_manifest_override_document(document):
    manifest_override_path = get_manifest_override_path()
    os.makedirs(os.path.dirname(manifest_override_path), exist_ok=True)
    backup_file(manifest_override_path)
    with open(manifest_override_path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")

    return manifest_override_path


def prune_empty_manifest_override_file():
    manifest_override_path = get_manifest_override_path()
    if not os.path.exists(manifest_override_path):
        return

    os.remove(manifest_override_path)
    override_directory = os.path.dirname(manifest_override_path)
    if os.path.isdir(override_directory) and len(os.listdir(override_directory)) == 0:
        os.rmdir(override_directory)


def round_export_number(value: float) -> float:
    rounded = round(float(value), 4)
    return 0.0 if abs(rounded) < 0.0001 else rounded


def clip_bounds_world_bounds(clip_object):
    corners = [clip_object.matrix_world @ Vector(corner) for corner in clip_object.bound_box]
    min_corner = Vector((
        min(corner.x for corner in corners),
        min(corner.y for corner in corners),
        min(corner.z for corner in corners),
    ))
    max_corner = Vector((
        max(corner.x for corner in corners),
        max(corner.y for corner in corners),
        max(corner.z for corner in corners),
    ))
    return min_corner, max_corner


def serialize_clip_bounds_object(clip_object):
    local_corners = [Vector(corner) for corner in clip_object.bound_box]
    min_corner = Vector((
        min(corner.x for corner in local_corners),
        min(corner.y for corner in local_corners),
        min(corner.z for corner in local_corners),
    ))
    max_corner = Vector((
        max(corner.x for corner in local_corners),
        max(corner.y for corner in local_corners),
        max(corner.z for corner in local_corners),
    ))
    matrix_world = clip_object.matrix_world
    return {
        "min": [round_export_number(min_corner.x), round_export_number(min_corner.y), round_export_number(min_corner.z)],
        "max": [round_export_number(max_corner.x), round_export_number(max_corner.y), round_export_number(max_corner.z)],
        "transformMatrix": [
            round_export_number(matrix_world[row][column])
            for row in range(4)
            for column in range(4)
        ],
    }


def format_bounds_vector(values):
    return ", ".join(f"{float(value):.2f}" for value in values)


def reveal_clip_bounds_object(clip_object):
    if clip_object is None:
        return None

    clip_object.hide_viewport = False
    clip_object.hide_select = False
    clip_object.hide_render = True
    clip_object.show_in_front = True
    clip_object.display_type = "WIRE"
    return clip_object


def get_editor_clip_bounds_object():
    return find_clip_bounds_object(get_editor_collection())


def focus_object(object_handle):
    if object_handle is None:
        return

    try:
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass

    for obj in bpy.context.selected_objects:
        obj.select_set(False)

    object_handle.hide_viewport = False
    object_handle.hide_select = False
    object_handle.select_set(True)
    bpy.context.view_layer.objects.active = object_handle


def fit_clip_bounds_to_collection(collection):
    if collection is None:
        return None

    min_corner, max_corner = collection_world_bounds(collection)
    clip_object = apply_collection_clip_bounds(
        collection,
        {
            "min": [min_corner.x, min_corner.y, min_corner.z],
            "max": [max_corner.x, max_corner.y, max_corner.z],
        },
        visible_bounds_object=True,
    )
    return reveal_clip_bounds_object(clip_object)


def serialize_current_pose(armature_object):
    if armature_object is None or armature_object.type != "ARMATURE":
        raise ValueError("No active FoxWatch armature is available")

    bones = []
    data_bones = list(armature_object.data.bones)
    bone_indices_by_name = {bone.name: index for index, bone in enumerate(data_bones)}
    for bone in data_bones:
        pose_bone = armature_object.pose.bones.get(bone.name)
        if pose_bone is None:
            continue

        location, rotation, scale = pose_bone.matrix_basis.decompose()
        parent_index = bone_indices_by_name.get(bone.parent.name, -1) if bone.parent is not None else -1
        bones.append(
            {
                "name": bone.name,
                "parentIndex": parent_index,
                "location": [float(location.x), float(location.y), float(location.z)],
                "rotationQuaternion": [float(rotation.x), float(rotation.y), float(rotation.z), float(rotation.w)],
                "scale": [float(scale.x), float(scale.y), float(scale.z)],
            }
        )

    return {
        "type": "foxhole-bone-pose",
        "bones": bones,
    }


def apply_pose_document(pose_document):
    armature_object = get_active_armature()
    if armature_object is None:
        raise ValueError("No active FoxWatch armature is available")
    apply_pose_to_imported_objects([armature_object], pose_document)
    focus_armature(armature_object)


class FOXWATCH_OT_load_pose(bpy.types.Operator):
    bl_idname = "foxwatch.load_pose"
    bl_label = "Load FoxWatch Pose"

    pose_id: StringProperty()

    def execute(self, context):
        pose_entry = STATE["pose_sources_by_id"].get(self.pose_id)
        if pose_entry is None:
            self.report({"ERROR"}, f"Unknown pose id: {self.pose_id}")
            return {"CANCELLED"}

        try:
            apply_pose_document(pose_entry["pose"])
        except ValueError as exception:
            self.report({"ERROR"}, str(exception))
            return {"CANCELLED"}

        self.report({"INFO"}, f"Applied {pose_entry['label']}")
        return {"FINISHED"}


class FOXWATCH_OT_copy_pose(bpy.types.Operator):
    bl_idname = "foxwatch.copy_pose"
    bl_label = "Copy Current Pose"

    def execute(self, context):
        try:
            armature_object = get_active_armature()
            pose_document = serialize_current_pose(armature_object)
        except ValueError as exception:
            self.report({"ERROR"}, str(exception))
            return {"CANCELLED"}

        context.window_manager.foxwatch_pose_clipboard = json.dumps(pose_document)
        self.report({"INFO"}, f"Copied pose from {armature_object.name}")
        return {"FINISHED"}


class FOXWATCH_OT_paste_pose(bpy.types.Operator):
    bl_idname = "foxwatch.paste_pose"
    bl_label = "Paste Pose"

    def execute(self, context):
        raw_pose = context.window_manager.foxwatch_pose_clipboard
        if not raw_pose:
            self.report({"ERROR"}, "FoxWatch pose clipboard is empty")
            return {"CANCELLED"}

        pose_document = json.loads(raw_pose)
        try:
            apply_pose_document(pose_document)
        except ValueError as exception:
            self.report({"ERROR"}, str(exception))
            return {"CANCELLED"}

        self.report({"INFO"}, "Pasted FoxWatch pose")
        return {"FINISHED"}


class FOXWATCH_OT_export_default_pose(bpy.types.Operator):
    bl_idname = "foxwatch.export_default_pose"
    bl_label = "Export Default Pose"

    def execute(self, context):
        try:
            armature_object = get_active_armature()
            pose_document = serialize_current_pose(armature_object)
        except ValueError as exception:
            self.report({"ERROR"}, str(exception))
            return {"CANCELLED"}

        override_path = STATE["override_path"]
        os.makedirs(os.path.dirname(override_path), exist_ok=True)

        backup_file(override_path)

        with open(override_path, "w", encoding="utf-8") as handle:
            json.dump(pose_document, handle, indent=2)
            handle.write("\n")

        self.report({"INFO"}, f"Exported default pose to {override_path}")
        return {"FINISHED"}


class FOXWATCH_OT_clear_default_pose_override(bpy.types.Operator):
    bl_idname = "foxwatch.clear_default_pose_override"
    bl_label = "Clear Default Pose Override"

    def execute(self, context):
        override_path = STATE["override_path"]
        if not os.path.exists(override_path):
            self.report({"INFO"}, "No default pose override file exists")
            return {"FINISHED"}

        os.remove(override_path)
        self.report({"INFO"}, f"Deleted {override_path}")
        return {"FINISHED"}


class FOXWATCH_OT_focus_clip_bounds(bpy.types.Operator):
    bl_idname = "foxwatch.focus_clip_bounds"
    bl_label = "Select Clip Box"

    def execute(self, context):
        clip_object = reveal_clip_bounds_object(get_editor_clip_bounds_object())
        if clip_object is None:
            self.report({"ERROR"}, "No clip box is available")
            return {"CANCELLED"}

        focus_object(clip_object)
        self.report({"INFO"}, f"Selected {clip_object.name}")
        return {"FINISHED"}


class FOXWATCH_OT_fit_clip_bounds_to_mesh(bpy.types.Operator):
    bl_idname = "foxwatch.fit_clip_bounds_to_mesh"
    bl_label = "Fit Clip Box To Mesh Bounds"

    def execute(self, context):
        collection = get_editor_collection()
        if collection is None:
            self.report({"ERROR"}, "No FoxWatch collection is loaded")
            return {"CANCELLED"}

        clip_object = fit_clip_bounds_to_collection(collection)
        if clip_object is None:
            self.report({"ERROR"}, "Unable to create a clip box for this scene")
            return {"CANCELLED"}

        focus_object(clip_object)
        self.report({"INFO"}, "Updated clip box from rendered mesh bounds")
        return {"FINISHED"}


class FOXWATCH_OT_export_clip_bounds(bpy.types.Operator):
    bl_idname = "foxwatch.export_clip_bounds"
    bl_label = "Export Clip Box"

    def execute(self, context):
        clip_object = reveal_clip_bounds_object(get_editor_clip_bounds_object())
        if clip_object is None:
            self.report({"ERROR"}, "No clip box is available")
            return {"CANCELLED"}

        try:
            manifest_document = read_manifest_override_document()
        except ValueError as exception:
            self.report({"ERROR"}, str(exception))
            return {"CANCELLED"}

        manifest_document["clipBounds"] = serialize_clip_bounds_object(clip_object)
        manifest_override_path = write_manifest_override_document(manifest_document)
        self.report({"INFO"}, f"Exported clip bounds to {manifest_override_path}")
        return {"FINISHED"}


class FOXWATCH_OT_clear_clip_bounds_override(bpy.types.Operator):
    bl_idname = "foxwatch.clear_clip_bounds_override"
    bl_label = "Clear Clip Box Override"

    def execute(self, context):
        manifest_override_path = get_manifest_override_path()
        removed_manifest_override = False

        if os.path.exists(manifest_override_path):
            try:
                manifest_document = read_manifest_override_document()
            except ValueError as exception:
                self.report({"ERROR"}, str(exception))
                return {"CANCELLED"}

            removed_manifest_override = manifest_document.pop("clipBounds", None) is not None
            if manifest_document:
                write_manifest_override_document(manifest_document)
            else:
                prune_empty_manifest_override_file()

        apply_collection_clip_bounds(get_editor_collection(), None)
        if removed_manifest_override:
            self.report({"INFO"}, "Cleared exported clip bounds")
        else:
            self.report({"INFO"}, "Cleared the scene clip box")
        return {"FINISHED"}


class FOXWATCH_PT_pose_editor(bpy.types.Panel):
    bl_label = "FoxWatch Pose Editor"
    bl_idname = "FOXWATCH_PT_pose_editor"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "FoxWatch"

    def draw(self, context):
        layout = self.layout
        structure_id = STATE.get("structure_id") or "<unknown>"
        armature_object = get_active_armature()
        clip_object = get_editor_clip_bounds_object()

        layout.label(text=f"Structure: {structure_id}")
        layout.label(text=f"Armature: {armature_object.name if armature_object else '<none>'}")
        layout.label(text=f"Override: {os.path.basename(STATE.get('override_path') or '')}")

        pose_box = layout.box()
        pose_box.label(text="Load Poses")
        if not STATE["pose_source_ids"]:
            pose_box.label(text="No generated poses found")
        else:
            for pose_id in STATE["pose_source_ids"]:
                pose_entry = STATE["pose_sources_by_id"].get(pose_id)
                if pose_entry is None:
                    continue
                operator = pose_box.operator("foxwatch.load_pose", text=pose_entry["label"])
                operator.pose_id = pose_id

        clipboard_box = layout.box()
        clipboard_box.label(text="Session Pose")
        clipboard_box.operator("foxwatch.copy_pose")
        clipboard_box.operator("foxwatch.paste_pose")

        export_box = layout.box()
        export_box.label(text="Override")
        export_box.operator("foxwatch.export_default_pose")
        export_box.operator("foxwatch.clear_default_pose_override")

        clip_box = layout.box()
        clip_box.label(text="Clip Bounds")
        if clip_object is None:
            clip_box.label(text="No clip box in scene")
            clip_box.operator("foxwatch.fit_clip_bounds_to_mesh", text="Create From Mesh Bounds")
        else:
            world_min_corner, world_max_corner = clip_bounds_world_bounds(clip_object)
            clip_box.label(text=f"Min: {format_bounds_vector([world_min_corner.x, world_min_corner.y, world_min_corner.z])}")
            clip_box.label(text=f"Max: {format_bounds_vector([world_max_corner.x, world_max_corner.y, world_max_corner.z])}")
            row = clip_box.row(align=True)
            row.operator("foxwatch.focus_clip_bounds")
            row.operator("foxwatch.fit_clip_bounds_to_mesh", text="Refit To Mesh")
            clip_box.operator("foxwatch.export_clip_bounds")
        clip_box.operator("foxwatch.clear_clip_bounds_override")


def unregister_classes():
    for cls in reversed(CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass

    if hasattr(bpy.types.WindowManager, "foxwatch_pose_clipboard"):
        del bpy.types.WindowManager.foxwatch_pose_clipboard


def register_classes():
    bpy.types.WindowManager.foxwatch_pose_clipboard = StringProperty(default="")

    for cls in CLASSES:
        bpy.utils.register_class(cls)


def main():
    args = parse_args()
    remove_default_startup_scene_objects()
    if args.purge_existing:
        remove_collections_with_prefix("FoxWatch:")

    scene_path = resolve_scene_path(args)
    scene_document = load_json(scene_path)
    scene_document.setdefault("render", {}).setdefault("materialMode", "sidecar")
    resolved_scene_variant = resolve_scene_variant_id(scene_document, args.scene_variant)
    search_roots = normalize_search_roots(args.public_root, args.foxwatch_output_root)
    collection = import_render_scene(
        scene_document,
        search_roots,
        replace_existing=args.replace_existing,
        scene_variant=resolved_scene_variant,
    )

    pose_sources_by_id, pose_source_ids = build_pose_sources(scene_document)
    structure_id = scene_document.get("structure", {}).get("id") or args.structure_id

    STATE.update(
        {
            "scene_document": scene_document,
            "scene_path": scene_path,
            "structure_id": structure_id,
            "override_path": os.path.abspath(args.override_path),
            "manifest_override_path": os.path.join(os.path.dirname(os.path.abspath(args.override_path)), "manifest.json"),
            "collection_name": collection.name,
            "armature_name": None,
            "pose_sources_by_id": pose_sources_by_id,
            "pose_source_ids": pose_source_ids,
        }
    )

    armature_object = get_active_armature()
    focus_armature(armature_object)
    reveal_clip_bounds_object(get_editor_clip_bounds_object())
    ensure_view3d_sidebar_visible()
    ensure_view3d_material_preview()

    unregister_classes()
    register_classes()
    print(f"FoxWatch pose editor ready for {structure_id} from {scene_path}")


CLASSES.extend(
    [
        FOXWATCH_OT_load_pose,
        FOXWATCH_OT_copy_pose,
        FOXWATCH_OT_paste_pose,
        FOXWATCH_OT_export_default_pose,
        FOXWATCH_OT_clear_default_pose_override,
        FOXWATCH_OT_focus_clip_bounds,
        FOXWATCH_OT_fit_clip_bounds_to_mesh,
        FOXWATCH_OT_export_clip_bounds,
        FOXWATCH_OT_clear_clip_bounds_override,
        FOXWATCH_PT_pose_editor,
    ]
)


if __name__ == "__main__":
    main()