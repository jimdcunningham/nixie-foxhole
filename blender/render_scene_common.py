import json
import hashlib
import math
import os
import re
from typing import Iterable, Optional

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Quaternion, Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FOXWATCH_ROOT = os.path.dirname(SCRIPT_DIR)
REPOSITORY_ROOT = os.path.dirname(FOXWATCH_ROOT)
DEFAULT_PUBLIC_ROOT = os.path.normpath(os.path.join(REPOSITORY_ROOT, "packages", "extensions", "foxhole", "public"))
DEFAULT_FOXWATCH_OUTPUT_ROOT = os.path.normpath(os.path.join(FOXWATCH_ROOT, "tmp", "assets"))
PIXELS_PER_METER = 64.0
TOPDOWN_CAMERA_NAME = "FoxWatchTopdownCamera"
PREVIEW_CAMERA_NAME = "FoxWatchPreviewCamera"
ICON_CAMERA_NAME = "FoxWatchIconCamera"
CLIP_BOUNDS_OBJECT_NAME = "FoxWatchClipBounds"
CLIP_BOUNDS_MODIFIER_NAME = "FoxWatchClipBounds"
CLIP_BOUNDS_BOUNDS_MODIFIER_NAME = "FoxWatchClipBoundsBounds"
SUN_NAME = "FoxWatchSun"
DEFAULT_WORLD_COLOR = (0.90, 0.92, 0.96, 1.0)
DEFAULT_WORLD_STRENGTH = 0.60
DEFAULT_SUN_ENERGY = 3.4
DEFAULT_SUN_ROTATION_DEGREES = (50.0, 0.0, 26.0)
DEFAULT_SUN_COLOR = (1.0, 0.99, 0.97)
TOPDOWN_SUN_ROTATION_DEGREES = (0.0, 0.0, 0.0)
DEFAULT_PREVIEW_DIRECTION = "se"
DEFAULT_EXPOSURE = 0.30
DEFAULT_GAMMA = 0.97
_ASSET_PATH_CACHE: dict[tuple[str, str], Optional[str]] = {}
_MATERIAL_SIDECAR_CACHE: dict[tuple[str, str], Optional[str]] = {}
_IMPORTED_MESH_OBJECT_CACHE: dict[tuple[str, Optional[str], Optional[tuple[float, ...]], Optional[str], bool, float], list[object]] = {}
_ROOT_FILE_NAME_INDEX: dict[str, dict[str, list[str]]] = {}
_LAST_RENDER_CONFIGURATION: Optional[tuple[int, int, bool]] = None
PREVIEW_ANGLE_DIRECTIONS: dict[str, tuple[float, float, float]] = {
    "ne": (-1.0, -1.0, 0.72),
    "nw": (-1.0, 1.0, 0.72),
    "sw": (1.0, 1.0, 0.72),
    "se": (1.0, -1.0, 0.72),
}


def preview_direction_planar_yaw_degrees(preview_direction: Optional[str]) -> float:
    resolved_preview_direction = str(preview_direction or DEFAULT_PREVIEW_DIRECTION).strip().lower()
    direction_values = PREVIEW_ANGLE_DIRECTIONS.get(resolved_preview_direction)
    if direction_values is None:
        raise ValueError(f"Unsupported preview variant '{preview_direction}'")

    return math.degrees(math.atan2(direction_values[1], direction_values[0]))


def preview_sun_rotation_degrees(preview_direction: Optional[str]) -> tuple[float, float, float]:
    yaw_offset_degrees = (
        preview_direction_planar_yaw_degrees(preview_direction)
        - preview_direction_planar_yaw_degrees(DEFAULT_PREVIEW_DIRECTION)
    )
    return (
        DEFAULT_SUN_ROTATION_DEGREES[0],
        DEFAULT_SUN_ROTATION_DEGREES[1],
        DEFAULT_SUN_ROTATION_DEGREES[2] + yaw_offset_degrees,
    )


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def normalize_color_channel(value, fallback: float = 0.0) -> float:
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        numeric_value = float(fallback)

    if numeric_value <= 1.0:
        return clamp(numeric_value, 0.0, 1.0)

    return clamp(numeric_value / 255.0, 0.0, 1.0)


def normalize_color_hex(value: Optional[str]) -> Optional[str]:
    normalized = "".join(character for character in str(value or "").strip() if character in "0123456789abcdefABCDEF").lower()
    if len(normalized) in {6, 8}:
        return normalized
    return None


def rgba_from_hex(value: Optional[str], fallback_alpha: float = 1.0) -> Optional[tuple[float, float, float, float]]:
    normalized = normalize_color_hex(value)
    if not normalized:
        return None

    if len(normalized) == 8:
        normalized = normalized[:6]

    return (
        int(normalized[0:2], 16) / 255.0,
        int(normalized[2:4], 16) / 255.0,
        int(normalized[4:6], 16) / 255.0,
        clamp(float(fallback_alpha), 0.0, 1.0),
    )


def rgba_from_color_document(color_document, fallback_alpha: float = 1.0) -> Optional[tuple[float, float, float, float]]:
    if isinstance(color_document, dict):
        explicit_hex = rgba_from_hex(color_document.get("Hex"), color_document.get("A", fallback_alpha))
        if explicit_hex is not None:
            return explicit_hex

        return (
            normalize_color_channel(color_document.get("R", 0.0)),
            normalize_color_channel(color_document.get("G", 0.0)),
            normalize_color_channel(color_document.get("B", 0.0)),
            normalize_color_channel(color_document.get("A", fallback_alpha), fallback_alpha),
        )

    return rgba_from_hex(str(color_document or ""), fallback_alpha)


def resolve_color_shift_rgba(parameters: dict, color_hex: Optional[str]) -> Optional[tuple[float, float, float, float]]:
    explicit_color = rgba_from_hex(color_hex)
    if explicit_color is not None:
        return explicit_color

    colors = parameters.get("Colors", {}) if isinstance(parameters, dict) else {}
    color_shift = colors.get("ColorShift") if isinstance(colors, dict) else None
    return rgba_from_color_document(color_shift)


def pose_parameter(pose_document: Optional[dict], key: str, fallback: float) -> float:
    parameters = (pose_document or {}).get("parameters") or {}
    try:
        return float(parameters.get(key, fallback))
    except (TypeError, ValueError):
        return float(fallback)


def apply_pose_to_imported_objects(imported_objects, pose_document: Optional[dict]) -> None:
    if not imported_objects or not pose_document:
        return

    pose_type = (pose_document.get("type") or "").lower()
    if pose_type == "foxhole-bone-pose":
        for armature_object in [obj for obj in imported_objects if obj.type == "ARMATURE"]:
            apply_sampled_bone_pose(armature_object, pose_document)
        return

    if pose_type != "foxhole-crane-idle":
        return

    profile = (pose_document.get("profile") or "").lower()
    for armature_object in [obj for obj in imported_objects if obj.type == "ARMATURE"]:
        apply_crane_idle_pose(armature_object, profile, pose_document)


def apply_sampled_bone_pose(armature_object, pose_document: dict) -> None:
    bones = pose_document.get("bones") or []
    if not bones:
        return

    armature_object.data.pose_position = "POSE"

    for bone_document in bones:
        bone_name = bone_document.get("name")
        if not bone_name:
            continue
        pose_bone = armature_object.pose.bones.get(bone_name)
        data_bone = armature_object.data.bones.get(bone_name)
        if pose_bone is None or data_bone is None:
            continue

        location = Vector(bone_document.get("location") or [0.0, 0.0, 0.0])
        rotation_values = bone_document.get("rotationQuaternion") or [0.0, 0.0, 0.0, 1.0]
        rotation = Quaternion((float(rotation_values[3]), float(rotation_values[0]), float(rotation_values[1]), float(rotation_values[2])))
        scale = Vector(bone_document.get("scale") or [1.0, 1.0, 1.0])
        if max(abs(scale.x), abs(scale.y), abs(scale.z)) <= 1.0e-6:
            scale = Vector((1.0, 1.0, 1.0))
        pose_bone.matrix_basis = Matrix.LocRotScale(location, rotation, scale)

    bpy.context.view_layer.update()


def apply_crane_idle_pose(armature_object, profile: str, pose_document: dict) -> None:
    if profile == "static-crane":
        apply_telescoping_arm_pose(
            armature_object,
            ["arm_Pivot", "arm_partA", "arm_partB", "arm_partC", "arm_partD"],
            "horizontalRotation",
            "hook",
            pose_document,
            minimum_extension_ratio=0.22,
        )
        return

    if profile == "large-crane":
        apply_telescoping_arm_pose(
            armature_object,
            ["Arm_Pivot", "Arm_Part1", "Arm_Part2", "Arm_Part3", "Arm_Part4", "Arm_Part5"],
            "HorizontalRotation",
            "Hook",
            pose_document,
            minimum_extension_ratio=0.35,
        )


def apply_telescoping_arm_pose(
    armature_object,
    arm_bone_names: list[str],
    rotation_bone_name: str,
    hook_bone_name: str,
    pose_document: dict,
    minimum_extension_ratio: float,
) -> None:
    horizontal_distance_cm = pose_parameter(pose_document, "horizontalDistanceCm", 0.0)
    max_horizontal_distance_cm = max(pose_parameter(pose_document, "maxHorizontalDistanceCm", 1.0), 1.0)
    yaw_degrees = pose_parameter(pose_document, "yawDegrees", 0.0)
    hook_depth_cm = pose_parameter(pose_document, "hookDepthCm", 0.0)

    extension_ratio = clamp(horizontal_distance_cm / max_horizontal_distance_cm, minimum_extension_ratio, 1.0)
    armature_object.data.pose_position = "POSE"

    for bone_name in arm_bone_names:
        pose_bone = armature_object.pose.bones.get(bone_name)
        if pose_bone is None:
            continue
        pose_bone.scale = (pose_bone.scale.x, extension_ratio, pose_bone.scale.z)

    rotation_bone = armature_object.pose.bones.get(rotation_bone_name)
    if rotation_bone is not None:
        rotation_bone.rotation_mode = "XYZ"
        rotation_bone.rotation_euler = (0.0, 0.0, math.radians(yaw_degrees))

    if hook_depth_cm > 0.0:
        hook_bone = armature_object.pose.bones.get(hook_bone_name)
        if hook_bone is not None:
            hook_scale = max(hook_depth_cm / 100.0, 1.0)
            hook_bone.scale = (hook_bone.scale.x, hook_scale, hook_bone.scale.z)

    bpy.context.view_layer.update()

def configure_world_lighting() -> None:
    scene = bpy.context.scene
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        scene.world = world

    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links

    background = nodes.get("Background")
    output = nodes.get("World Output")
    if background is None or output is None:
        nodes.clear()
        background = nodes.new(type="ShaderNodeBackground")
        output = nodes.new(type="ShaderNodeOutputWorld")
        background.location = (0, 0)
        output.location = (200, 0)
        links.new(background.outputs["Background"], output.inputs["Surface"])

    background.inputs["Color"].default_value = DEFAULT_WORLD_COLOR
    background.inputs["Strength"].default_value = DEFAULT_WORLD_STRENGTH


def load_json(file_path: str):
    with open(file_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_directory(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def normalize_search_roots(public_root: Optional[str], foxwatch_output_root: Optional[str]) -> list[str]:
    roots = []
    for candidate in [public_root or DEFAULT_PUBLIC_ROOT, foxwatch_output_root or DEFAULT_FOXWATCH_OUTPUT_ROOT]:
        if candidate and candidate not in roots:
            roots.append(candidate)
    return roots


def file_name_index_for_root(root: str) -> dict[str, list[str]]:
    indexed = _ROOT_FILE_NAME_INDEX.get(root)
    if indexed is not None:
        return indexed

    indexed = {}
    for current_root, _, files in os.walk(root):
        for current_file in files:
            file_key = os.path.normcase(current_file)
            indexed.setdefault(file_key, []).append(os.path.join(current_root, current_file))

    _ROOT_FILE_NAME_INDEX[root] = indexed
    return indexed


def resolve_asset_path(source: Optional[str], search_roots: Iterable[str]) -> Optional[str]:
    if not source:
        return None

    normalized = source.replace("/", os.sep).lstrip("/\\")
    candidate_suffixes = [normalized]
    foxhole_prefix = os.path.join("assets", "foxhole")
    if normalized.startswith(foxhole_prefix + os.sep):
        candidate_suffixes.append(normalized[len(foxhole_prefix) + 1:])

    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue

        for suffix in candidate_suffixes:
            candidate = os.path.normpath(os.path.join(root, suffix))
            if os.path.exists(candidate):
                return candidate

            cache_key = (root, suffix)
            if cache_key in _ASSET_PATH_CACHE:
                cached = _ASSET_PATH_CACHE[cache_key]
                if cached is not None:
                    return cached
                continue

            resolved = find_asset_by_suffix(root, suffix)
            _ASSET_PATH_CACHE[cache_key] = resolved
            if resolved is not None:
                return resolved

    return None


def find_asset_by_suffix(root: str, suffix: str) -> Optional[str]:
    normalized_suffix = os.path.normcase(os.path.normpath(suffix))
    file_name = os.path.normcase(os.path.basename(normalized_suffix))

    for candidate in file_name_index_for_root(root).get(file_name, []):
        candidate_suffix = os.path.normcase(os.path.relpath(candidate, root))
        if candidate_suffix.endswith(normalized_suffix):
            return candidate

    return None


def resolve_exported_texture_path(texture_reference: Optional[str], search_roots: Iterable[str]) -> Optional[str]:
    if not texture_reference:
        return None

    package_path = texture_reference.split(".", 1)[0] + ".png"
    return resolve_asset_path(package_path, search_roots)


def normalize_material_name(material_name: str) -> str:
    return re.sub(r"\.\d{3}$", "", material_name)


def is_track_like_material(material_name: str) -> bool:
    normalized = normalize_material_name(material_name).lower()
    return any(token in normalized for token in ("tread", "treads", "track", "tracks", "threads"))


def uses_implicit_packed_opacity(material_name: str, parameters: dict) -> bool:
    switches = parameters.get("Switches", {})
    if switches.get("Blend OverlapOpacity with Opacity Mask", False):
        return True

    normalized = normalize_material_name(material_name).lower()
    return any(token in normalized for token in ("grass", "foliage", "leaf", "leaves", "ivy", "bush", "reed", "plant"))


def uses_color_change_workflow(material_name: str, textures: dict, parameters: dict) -> bool:
    switches = parameters.get("Switches", {})
    if switches.get("UseColorMask?", False):
        return True

    colors = parameters.get("Colors", {})
    if not isinstance(colors, dict) or not isinstance(colors.get("ColorShift"), dict):
        return False

    normalized = normalize_material_name(material_name).lower()
    if any(token in normalized for token in ("colorchange", "colourchange", "color_change", "colour_change")):
        return True

    texture_references = [str(value).lower() for value in textures.values() if isinstance(value, str)]
    return any(any(token in reference for token in ("colorchange", "colourchange", "color_change", "colour_change")) for reference in texture_references)


def find_material_sidecar(material_name: str, search_roots: Iterable[str]) -> Optional[str]:
    target_name = f"{normalize_material_name(material_name)}.json"
    target_key = os.path.normcase(target_name)
    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue
        cache_key = (root, target_name)
        if cache_key in _MATERIAL_SIDECAR_CACHE:
            cached = _MATERIAL_SIDECAR_CACHE[cache_key]
            if cached is not None:
                return cached
            continue
        for candidate in file_name_index_for_root(root).get(target_key, []):
            _MATERIAL_SIDECAR_CACHE[cache_key] = candidate
            return candidate
        _MATERIAL_SIDECAR_CACHE[cache_key] = None
    return None


def first_texture_reference(textures: dict, *keys: str) -> Optional[str]:
    for key in keys:
        value = textures.get(key)
        if value:
            return value
    return None


def collection_by_name(name: str):
    return bpy.data.collections.get(name)


def remove_collection(name: str) -> None:
    collection = collection_by_name(name)
    if collection is None:
        return

    for child in list(collection.children):
        remove_collection(child.name)

    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    bpy.data.collections.remove(collection)


def remove_collections_with_prefix(prefix: str) -> None:
    for collection in list(bpy.data.collections):
        if collection.name.startswith(prefix):
            remove_collection(collection.name)


def remove_default_startup_scene_objects() -> None:
    # Blender's startup file includes a stock Cube/Light/Camera. If we leave them in place,
    # partial FoxWatch scenes can accidentally render the startup cube and make missing-asset
    # debugging look like a real imported mesh.
    for object_name in ("Cube", "Light", "Camera"):
        object_handle = bpy.data.objects.get(object_name)
        if object_handle is None:
            continue

        bpy.data.objects.remove(object_handle, do_unlink=True)


def ensure_collection(name: str, parent_collection=None):
    collection = collection_by_name(name)
    if collection is None:
        collection = bpy.data.collections.new(name)

    parent = parent_collection or bpy.context.scene.collection
    if parent.children.get(collection.name) is None:
        parent.children.link(collection)

    return collection


def ensure_private_collection(name: str):
    collection = collection_by_name(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    collection.hide_render = True
    return collection


def ensure_camera_object(name: str):
    camera_object = bpy.data.objects.get(name)
    if camera_object is None:
        camera_data = bpy.data.cameras.new(name)
        camera_object = bpy.data.objects.new(name, camera_data)
        bpy.context.scene.collection.objects.link(camera_object)
    elif camera_object.type != "CAMERA":
        raise ValueError(f"Object '{name}' exists but is not a camera")

    return camera_object


def ensure_sun_object(name: str):
    sun_object = bpy.data.objects.get(name)
    if sun_object is None:
        sun_data = bpy.data.lights.new(name, type="SUN")
        sun_object = bpy.data.objects.new(name, sun_data)
        bpy.context.scene.collection.objects.link(sun_object)
    elif sun_object.type != "LIGHT":
        raise ValueError(f"Object '{name}' exists but is not a light")
    elif sun_object.data.type != "SUN":
        raise ValueError(f"Object '{name}' exists but is not a sun light")

    return sun_object


def matrix_from_manifest(values: list[float]) -> Matrix:
    if len(values) != 16:
        return Matrix.Identity(4)

    return Matrix((
        values[0:4],
        values[4:8],
        values[8:12],
        values[12:16],
    ))


def set_object_look_at(object_handle, target: Vector) -> None:
    direction = target - object_handle.location
    if direction.length <= 1e-6:
        return

    object_handle.rotation_mode = "QUATERNION"
    object_handle.rotation_quaternion = direction.to_track_quat("-Z", "Y")


def configure_camera_object(name: str, position: Vector, target: Vector):
    camera_object = ensure_camera_object(name)
    camera = camera_object.data
    camera.type = "ORTHO"
    camera_object.location = position
    set_object_look_at(camera_object, target)
    bpy.context.scene.camera = camera_object
    return camera_object


def configure_topdown_camera_object(name: str, position: Vector):
    camera_object = ensure_camera_object(name)
    camera = camera_object.data
    camera.type = "ORTHO"
    camera_object.location = position
    camera_object.rotation_mode = "XYZ"
    camera_object.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = camera_object
    return camera_object


def configure_sun(mode: Optional[str] = None, preview_direction: Optional[str] = None):
    sun_object = ensure_sun_object(SUN_NAME)
    sun_object.data.energy = DEFAULT_SUN_ENERGY
    sun_object.data.color = DEFAULT_SUN_COLOR
    sun_object.rotation_mode = "XYZ"
    rotation_degrees = (
        TOPDOWN_SUN_ROTATION_DEGREES
        if mode in {"topdown", "flat"}
        else preview_sun_rotation_degrees(preview_direction)
    )
    sun_object.rotation_euler = [math.radians(angle) for angle in rotation_degrees]
    return sun_object


def configure_scene_render(
    resolution_x: int,
    resolution_y: int,
    transparent_background: bool,
    file_format: str = "WEBP",
) -> None:
    global _LAST_RENDER_CONFIGURATION

    scene = bpy.context.scene
    normalized_file_format = str(file_format or "WEBP").strip().upper() or "WEBP"
    configuration = (max(1, int(resolution_x)), max(1, int(resolution_y)), transparent_background, normalized_file_format)
    if _LAST_RENDER_CONFIGURATION == configuration:
        return

    scene.render.resolution_x = configuration[0]
    scene.render.resolution_y = configuration[1]
    scene.render.film_transparent = transparent_background
    scene.render.image_settings.file_format = normalized_file_format
    scene.render.image_settings.color_mode = "RGBA"
    if normalized_file_format == "PNG":
        scene.render.image_settings.quality = 100
        if hasattr(scene.render.image_settings, "compression"):
            scene.render.image_settings.compression = 15
    else:
        scene.render.image_settings.quality = 90
        if hasattr(scene.render.image_settings, "use_webp_lossless"):
            scene.render.image_settings.use_webp_lossless = False
        elif hasattr(scene.render.image_settings, "use_lossless"):
            scene.render.image_settings.use_lossless = False
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    except ValueError:
        scene.render.engine = "BLENDER_EEVEE"

    configure_world_lighting()

    if hasattr(scene, "eevee"):
        if hasattr(scene.eevee, "use_gtao"):
            scene.eevee.use_gtao = True
        if hasattr(scene.eevee, "gtao_factor"):
            scene.eevee.gtao_factor = 1.0
        if hasattr(scene.eevee, "use_bloom"):
            scene.eevee.use_bloom = False
        if hasattr(scene.eevee, "use_raytracing"):
            scene.eevee.use_raytracing = False
        if hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = 16
        if hasattr(scene.eevee, "taa_samples"):
            scene.eevee.taa_samples = 16

    if hasattr(scene, "view_settings") and hasattr(scene.view_settings, "exposure"):
        scene.view_settings.exposure = DEFAULT_EXPOSURE
    if hasattr(scene, "view_settings") and hasattr(scene.view_settings, "gamma"):
        scene.view_settings.gamma = DEFAULT_GAMMA

    _LAST_RENDER_CONFIGURATION = configuration


def pixels_to_meters(value: Optional[float], pixels_per_meter: float = PIXELS_PER_METER) -> float:
    if value is None:
        return 1.0
    return max(float(value) / pixels_per_meter, 0.01)


def make_image_material(name: str, image_path: str):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name=name)

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (300, 0)
    shader = nodes.new(type="ShaderNodeBsdfPrincipled")
    shader.location = (0, 0)
    texture = nodes.new(type="ShaderNodeTexImage")
    texture.location = (-300, 0)
    texture.image = bpy.data.images.load(image_path, check_existing=True)

    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    if "Alpha" in texture.outputs and "Alpha" in shader.inputs:
        links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
        material.blend_method = "BLEND"

    return material


def ensure_clay_material(name: str = "FoxWatchClay"):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name=name)

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (300, 0)
    shader = nodes.new(type="ShaderNodeBsdfPrincipled")
    shader.location = (0, 0)
    shader.inputs["Base Color"].default_value = (0.72, 0.74, 0.78, 1.0)
    shader.inputs["Roughness"].default_value = 0.6
    shader.inputs["Specular IOR Level"].default_value = 0.35

    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def ensure_solid_color_material(name: str, color: list[float]):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name=name)

    rgba = list(color[:4])
    while len(rgba) < 4:
        rgba.append(1.0)

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (300, 0)
    shader = nodes.new(type="ShaderNodeBsdfPrincipled")
    shader.location = (0, 0)
    shader.inputs["Base Color"].default_value = tuple(rgba)
    shader.inputs["Roughness"].default_value = 0.45
    shader.inputs["Specular IOR Level"].default_value = 0.3
    if rgba[3] < 0.999:
        material.blend_method = "BLEND"
        if hasattr(material, "shadow_method"):
            material.shadow_method = "NONE"
    else:
        material.blend_method = "OPAQUE"

    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def ensure_emissive_color_material(name: str, color: list[float], strength: float = 8.0):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name=name)

    rgba = list(color[:4])
    while len(rgba) < 4:
        rgba.append(1.0)

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (300, 0)
    emission = nodes.new(type="ShaderNodeEmission")
    emission.location = (0, 0)
    emission.inputs["Color"].default_value = tuple(rgba)
    emission.inputs["Strength"].default_value = strength

    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    material.blend_method = "OPAQUE"
    if hasattr(material, "shadow_method"):
        material.shadow_method = "NONE"

    return material

def create_bounds_debug_box(collection, min_corner: Vector, max_corner: Vector, color: Optional[list[float]] = None):
    object_name = "FoxWatchBoundsDebug"
    existing_object = collection.objects.get(object_name)
    if existing_object is not None:
        bpy.data.objects.remove(existing_object, do_unlink=True)

    mesh = bpy.data.meshes.new(f"{object_name}Mesh")
    debug_object = bpy.data.objects.new(object_name, mesh)
    vertices = [
        (min_corner.x, min_corner.y, min_corner.z),
        (max_corner.x, min_corner.y, min_corner.z),
        (max_corner.x, max_corner.y, min_corner.z),
        (min_corner.x, max_corner.y, min_corner.z),
        (min_corner.x, min_corner.y, max_corner.z),
        (max_corner.x, min_corner.y, max_corner.z),
        (max_corner.x, max_corner.y, max_corner.z),
        (min_corner.x, max_corner.y, max_corner.z),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    debug_material = ensure_emissive_color_material(
        "FoxWatchBoundsDebugMaterial",
        color or [1.0, 0.12, 0.12, 1.0],
        strength=6.0,
    )
    mesh.materials.append(debug_material)

    wireframe_modifier = debug_object.modifiers.new(name="BoundsWireframe", type="WIREFRAME")
    wireframe_modifier.use_replace = True
    wireframe_modifier.thickness = 0.03

    debug_object.hide_render = False
    debug_object.show_in_front = True
    collection.objects.link(debug_object)
    return debug_object


def normalize_bounds_vector(value) -> Optional[Vector]:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None

    try:
        return Vector((float(value[0]), float(value[1]), float(value[2])))
    except (TypeError, ValueError):
        return None


def normalize_bounds_matrix(value) -> Optional[Matrix]:
    if not isinstance(value, (list, tuple)) or len(value) < 16:
        return None

    try:
        return Matrix((
            (float(value[0]), float(value[1]), float(value[2]), float(value[3])),
            (float(value[4]), float(value[5]), float(value[6]), float(value[7])),
            (float(value[8]), float(value[9]), float(value[10]), float(value[11])),
            (float(value[12]), float(value[13]), float(value[14]), float(value[15])),
        ))
    except (TypeError, ValueError):
        return None


def clip_bounds_world_bounds_from_box(box_document) -> tuple[Vector, Vector]:
    local_min = box_document["local_min"]
    local_max = box_document["local_max"]
    matrix_world = box_document["matrix_world"]
    world_corners = [
        matrix_world @ Vector((x, y, z))
        for x in (local_min.x, local_max.x)
        for y in (local_min.y, local_max.y)
        for z in (local_min.z, local_max.z)
    ]
    world_min = Vector((
        min(corner.x for corner in world_corners),
        min(corner.y for corner in world_corners),
        min(corner.z for corner in world_corners),
    ))
    world_max = Vector((
        max(corner.x for corner in world_corners),
        max(corner.y for corner in world_corners),
        max(corner.z for corner in world_corners),
    ))
    return world_min, world_max


def normalize_clip_bounds_document(clip_bounds_document):
    if not isinstance(clip_bounds_document, dict):
        return None

    min_corner = normalize_bounds_vector(clip_bounds_document.get("min"))
    max_corner = normalize_bounds_vector(clip_bounds_document.get("max"))
    if min_corner is None or max_corner is None:
        return None

    local_min = Vector((
        min(min_corner.x, max_corner.x),
        min(min_corner.y, max_corner.y),
        min(min_corner.z, max_corner.z),
    ))
    local_max = Vector((
        max(min_corner.x, max_corner.x),
        max(min_corner.y, max_corner.y),
        max(min_corner.z, max_corner.z),
    ))
    matrix_world = normalize_bounds_matrix(clip_bounds_document.get("transformMatrix"))
    if matrix_world is None:
        matrix_world = Matrix.Identity(4)

    world_min, world_max = clip_bounds_world_bounds_from_box(
        {
            "local_min": local_min,
            "local_max": local_max,
            "matrix_world": matrix_world,
        }
    )

    return {
        "local_min": local_min,
        "local_max": local_max,
        "matrix_world": matrix_world,
        "world_min": world_min,
        "world_max": world_max,
    }


def constrain_bounds_to_clip_bounds(bounds: tuple[Vector, Vector], clip_bounds_document) -> tuple[Vector, Vector]:
    normalized_box = normalize_clip_bounds_document(clip_bounds_document)
    if normalized_box is None:
        return bounds

    min_corner, max_corner = bounds
    clip_min = normalized_box["world_min"]
    clip_max = normalized_box["world_max"]
    clipped_min = Vector((
        max(min_corner.x, clip_min.x),
        max(min_corner.y, clip_min.y),
        max(min_corner.z, clip_min.z),
    ))
    clipped_max = Vector((
        min(max_corner.x, clip_max.x),
        min(max_corner.y, clip_max.y),
        min(max_corner.z, clip_max.z),
    ))

    if clipped_min.x > clipped_max.x or clipped_min.y > clipped_max.y or clipped_min.z > clipped_max.z:
        return bounds

    return clipped_min, clipped_max


def create_box_mesh(mesh_name: str, min_corner: Vector, max_corner: Vector):
    mesh = bpy.data.meshes.new(mesh_name)
    vertices = [
        (min_corner.x, min_corner.y, min_corner.z),
        (max_corner.x, min_corner.y, min_corner.z),
        (max_corner.x, max_corner.y, min_corner.z),
        (min_corner.x, max_corner.y, min_corner.z),
        (min_corner.x, min_corner.y, max_corner.z),
        (max_corner.x, min_corner.y, max_corner.z),
        (max_corner.x, max_corner.y, max_corner.z),
        (min_corner.x, max_corner.y, max_corner.z),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    return mesh


def assign_box_mesh(object_handle, min_corner: Vector, max_corner: Vector):
    old_mesh = object_handle.data if object_handle.type == "MESH" else None
    object_handle.data = create_box_mesh(f"{object_handle.name}Mesh", min_corner, max_corner)
    if old_mesh is not None and old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)


def configure_clip_bounds_object(clip_object, visible_in_viewport: bool):
    clip_object.display_type = "WIRE"
    clip_object.show_in_front = True
    clip_object.hide_render = True
    clip_object.hide_viewport = not visible_in_viewport
    clip_object.hide_select = not visible_in_viewport


def find_clip_bounds_object(collection):
    if collection is None:
        return None

    return collection.objects.get(CLIP_BOUNDS_OBJECT_NAME)


def ensure_clip_bounds_object(collection, clip_bounds_document, visible_in_viewport: bool = False):
    normalized_box = normalize_clip_bounds_document(clip_bounds_document)
    if normalized_box is None:
        return None

    local_min = normalized_box["local_min"]
    local_max = normalized_box["local_max"]
    matrix_world = normalized_box["matrix_world"]
    existing_object = find_clip_bounds_object(collection)
    if existing_object is None:
        clip_object = bpy.data.objects.new(
            CLIP_BOUNDS_OBJECT_NAME,
            create_box_mesh(f"{CLIP_BOUNDS_OBJECT_NAME}Mesh", local_min, local_max),
        )
        collection.objects.link(clip_object)
    elif existing_object.type == "MESH":
        clip_object = existing_object
        assign_box_mesh(clip_object, local_min, local_max)
    else:
        bpy.data.objects.remove(existing_object, do_unlink=True)
        clip_object = bpy.data.objects.new(
            CLIP_BOUNDS_OBJECT_NAME,
            create_box_mesh(f"{CLIP_BOUNDS_OBJECT_NAME}Mesh", local_min, local_max),
        )
        collection.objects.link(clip_object)

    clip_object.matrix_world = matrix_world.copy()
    configure_clip_bounds_object(clip_object, visible_in_viewport=visible_in_viewport)
    return clip_object


def remove_collection_clip_bounds(collection):
    if collection is None:
        return

    clip_object = find_clip_bounds_object(collection)
    for obj in collection.all_objects:
        if obj.type != "MESH" or obj == clip_object:
            continue

        for modifier_name in (CLIP_BOUNDS_MODIFIER_NAME, CLIP_BOUNDS_BOUNDS_MODIFIER_NAME):
            modifier = obj.modifiers.get(modifier_name)
            if modifier is not None:
                obj.modifiers.remove(modifier)

    if clip_object is not None:
        clip_mesh = clip_object.data if clip_object.type == "MESH" else None
        bpy.data.objects.remove(clip_object, do_unlink=True)
        if clip_mesh is not None and clip_mesh.users == 0:
            bpy.data.meshes.remove(clip_mesh)

    bpy.context.view_layer.update()


def apply_collection_clip_bounds(collection, clip_bounds_document, visible_bounds_object: bool = False):
    if collection is None:
        return None

    normalized_box = normalize_clip_bounds_document(clip_bounds_document)
    if normalized_box is None:
        remove_collection_clip_bounds(collection)
        return None

    clip_object = ensure_clip_bounds_object(collection, clip_bounds_document, visible_in_viewport=visible_bounds_object)
    if clip_object is None:
        remove_collection_clip_bounds(collection)
        return None

    for obj in collection.all_objects:
        if obj.type != "MESH" or obj == clip_object:
            continue

        bounds_only_modifier = obj.modifiers.get(CLIP_BOUNDS_BOUNDS_MODIFIER_NAME)
        if bounds_only_modifier is not None:
            obj.modifiers.remove(bounds_only_modifier)

        modifier = obj.modifiers.get(CLIP_BOUNDS_MODIFIER_NAME)
        if modifier is None:
            modifier = obj.modifiers.new(name=CLIP_BOUNDS_MODIFIER_NAME, type="BOOLEAN")

        modifier.object = clip_object
        modifier.operation = "INTERSECT"
        if hasattr(modifier, "solver"):
            modifier.solver = "EXACT"

    bpy.context.view_layer.update()
    return clip_object


def ensure_parameter_light_material(name: str, primary_color: list[float], secondary_color: Optional[list[float]] = None, opacity: float = 1.0, emissive_strength: float = 4.0):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name=name)

    rgba = list(primary_color[:4])
    while len(rgba) < 4:
        rgba.append(1.0)

    if secondary_color:
        secondary_rgba = list(secondary_color[:4])
        while len(secondary_rgba) < 4:
            secondary_rgba.append(1.0)
        rgba = [
            (rgba[0] + secondary_rgba[0]) * 0.5,
            (rgba[1] + secondary_rgba[1]) * 0.5,
            (rgba[2] + secondary_rgba[2]) * 0.5,
            max(rgba[3], secondary_rgba[3]),
        ]

    rgba[3] = max(0.0, min(1.0, float(opacity) * rgba[3]))

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (700, 0)
    transparent = nodes.new(type="ShaderNodeBsdfTransparent")
    transparent.location = (0, -140)
    emission = nodes.new(type="ShaderNodeEmission")
    emission.location = (0, 80)
    emission.inputs["Color"].default_value = tuple(rgba)
    emission.inputs["Strength"].default_value = emissive_strength
    shader = nodes.new(type="ShaderNodeBsdfPrincipled")
    shader.location = (0, 300)
    shader.inputs["Base Color"].default_value = tuple(rgba)
    shader.inputs["Emission Color"].default_value = tuple(rgba)
    shader.inputs["Emission Strength"].default_value = emissive_strength * 0.35
    shader.inputs["Roughness"].default_value = 0.25
    shader.inputs["Specular IOR Level"].default_value = 0.15
    add_shader = nodes.new(type="ShaderNodeAddShader")
    add_shader.location = (300, 160)
    mix_shader = nodes.new(type="ShaderNodeMixShader")
    mix_shader.location = (520, 20)
    alpha_value = nodes.new(type="ShaderNodeValue")
    alpha_value.location = (300, -120)
    alpha_value.outputs[0].default_value = rgba[3]

    links.new(shader.outputs["BSDF"], add_shader.inputs[0])
    links.new(emission.outputs["Emission"], add_shader.inputs[1])
    links.new(alpha_value.outputs[0], mix_shader.inputs["Fac"])
    links.new(transparent.outputs["BSDF"], mix_shader.inputs[1])
    links.new(add_shader.outputs["Shader"], mix_shader.inputs[2])
    links.new(mix_shader.outputs["Shader"], output.inputs["Surface"])
    material.blend_method = "BLEND"
    if hasattr(material, "shadow_method"):
        material.shadow_method = "NONE"

    return material


def clip_mesh_object_to_world_floor(object_handle, floor_z: float = 0.0):
    if object_handle.type != "MESH":
        return

    mesh = object_handle.data
    bm = bmesh.new()
    bm.from_mesh(mesh)

    inverse_world = object_handle.matrix_world.inverted()
    plane_co = inverse_world @ Vector((0.0, 0.0, floor_z))
    normal_matrix = inverse_world.transposed().to_3x3()
    plane_no = (normal_matrix @ Vector((0.0, 0.0, 1.0))).normalized()

    geometry = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(
        bm,
        geom=geometry,
        plane_co=plane_co,
        plane_no=plane_no,
        clear_inner=True,
        clear_outer=False,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def clip_mesh_object_to_world_bounds(object_handle, min_corner: Vector, max_corner: Vector):
    if object_handle.type != "MESH":
        return

    mesh = object_handle.data
    bm = bmesh.new()
    bm.from_mesh(mesh)

    inverse_world = object_handle.matrix_world.inverted()
    normal_matrix = inverse_world.transposed().to_3x3()
    plane_definitions = [
        (Vector((min_corner.x, 0.0, 0.0)), Vector((1.0, 0.0, 0.0)), True, False),
        (Vector((max_corner.x, 0.0, 0.0)), Vector((1.0, 0.0, 0.0)), False, True),
        (Vector((0.0, min_corner.y, 0.0)), Vector((0.0, 1.0, 0.0)), True, False),
        (Vector((0.0, max_corner.y, 0.0)), Vector((0.0, 1.0, 0.0)), False, True),
        (Vector((0.0, 0.0, min_corner.z)), Vector((0.0, 0.0, 1.0)), True, False),
        (Vector((0.0, 0.0, max_corner.z)), Vector((0.0, 0.0, 1.0)), False, True),
    ]

    for world_plane_co, world_plane_no, clear_inner, clear_outer in plane_definitions:
        plane_co = inverse_world @ world_plane_co
        plane_no = (normal_matrix @ world_plane_no).normalized()
        geometry = list(bm.verts) + list(bm.edges) + list(bm.faces)
        if not geometry:
            break

        bmesh.ops.bisect_plane(
            bm,
            geom=geometry,
            plane_co=plane_co,
            plane_no=plane_no,
            clear_inner=clear_inner,
            clear_outer=clear_outer,
        )

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def bake_mesh_object_from_evaluated_state(object_handle, depsgraph):
    if object_handle.type != "MESH":
        return

    evaluated_object = object_handle.evaluated_get(depsgraph)
    baked_mesh = bpy.data.meshes.new_from_object(
        evaluated_object,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    if baked_mesh is None:
        return

    old_mesh = object_handle.data
    if old_mesh is not None and len(baked_mesh.materials) == 0:
        for material in old_mesh.materials:
            baked_mesh.materials.append(material)

    object_handle.data = baked_mesh
    for modifier in list(object_handle.modifiers):
        object_handle.modifiers.remove(modifier)

    if old_mesh is not None and old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)


def apply_collection_clip_bounds_baked(collection, clip_bounds_document):
    if collection is None:
        return None

    normalized_box = normalize_clip_bounds_document(clip_bounds_document)
    if normalized_box is None:
        return None

    min_corner = normalized_box["world_min"]
    max_corner = normalized_box["world_max"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue

        bake_mesh_object_from_evaluated_state(obj, depsgraph)
        clip_mesh_object_to_world_bounds(obj, min_corner, max_corner)

    bpy.context.view_layer.update()
    return normalized_bounds


def clip_bounds_material_suffix(min_corner: Vector, max_corner: Vector) -> str:
    encoded_values = ",".join(
        f"{float(value):.5f}"
        for value in (min_corner.x, min_corner.y, min_corner.z, max_corner.x, max_corner.y, max_corner.z)
    )
    return hashlib.sha1(encoded_values.encode("utf-8")).hexdigest()[:12]


def ensure_clip_bounds_material(material, clip_object, min_corner: Vector, max_corner: Vector):
    if material is None:
        return None

    matrix_values = [clip_object.matrix_world[row][column] for row in range(4) for column in range(4)]
    clip_material_payload = ",".join(
        f"{float(value):.5f}"
        for value in (
            min_corner.x,
            min_corner.y,
            min_corner.z,
            max_corner.x,
            max_corner.y,
            max_corner.z,
            *matrix_values,
        )
    )
    clip_material_name = f"{material.name}@clipbounds:{hashlib.sha1(clip_material_payload.encode('utf-8')).hexdigest()[:12]}"
    clip_material = bpy.data.materials.get(clip_material_name)
    if clip_material is None:
        clip_material = material.copy()
        clip_material.name = clip_material_name
        clip_material.use_nodes = True

        node_tree = clip_material.node_tree
        if node_tree is None:
            return clip_material

        nodes = node_tree.nodes
        links = node_tree.links
        output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL" and getattr(node, "is_active_output", False)), None)
        if output is None:
            output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
        if output is None:
            return clip_material

        surface_input = output.inputs.get("Surface")
        if surface_input is None or len(surface_input.links) == 0:
            return clip_material

        source_link = surface_input.links[0]
        source_socket = source_link.from_socket
        links.remove(source_link)

        texture_coordinate = nodes.new(type="ShaderNodeTexCoord")
        texture_coordinate.location = (-950, -360)
        if hasattr(texture_coordinate, "object"):
            texture_coordinate.object = clip_object
        separate = nodes.new(type="ShaderNodeSeparateXYZ")
        separate.location = (-720, -360)

        links.new(texture_coordinate.outputs["Object"], separate.inputs[0])

        def create_compare_node(operation: str, axis_output, threshold: float, x: float, y: float):
            compare = nodes.new(type="ShaderNodeMath")
            compare.operation = operation
            compare.location = (x, y)
            compare.inputs[1].default_value = float(threshold)
            links.new(axis_output, compare.inputs[0])
            return compare

        compares = [
            create_compare_node("GREATER_THAN", separate.outputs["X"], min_corner.x, -260, -120),
            create_compare_node("LESS_THAN", separate.outputs["X"], max_corner.x, -260, -200),
            create_compare_node("GREATER_THAN", separate.outputs["Y"], min_corner.y, -20, -120),
            create_compare_node("LESS_THAN", separate.outputs["Y"], max_corner.y, -20, -200),
            create_compare_node("GREATER_THAN", separate.outputs["Z"], min_corner.z, 220, -120),
            create_compare_node("LESS_THAN", separate.outputs["Z"], max_corner.z, 220, -200),
        ]

        inside_mask = compares[0]
        combine_locations = [(460, -140), (680, -140), (900, -140), (1120, -140), (1340, -140)]
        for compare_node, (location_x, location_y) in zip(compares[1:], combine_locations):
            multiply = nodes.new(type="ShaderNodeMath")
            multiply.operation = "MULTIPLY"
            multiply.location = (location_x, location_y)
            links.new(inside_mask.outputs[0], multiply.inputs[0])
            links.new(compare_node.outputs[0], multiply.inputs[1])
            inside_mask = multiply

        transparent = nodes.new(type="ShaderNodeBsdfTransparent")
        transparent.location = (1560, -260)
        mix_shader = nodes.new(type="ShaderNodeMixShader")
        mix_shader.location = (1760, -80)
        links.new(inside_mask.outputs[0], mix_shader.inputs["Fac"])
        links.new(transparent.outputs["BSDF"], mix_shader.inputs[1])
        links.new(source_socket, mix_shader.inputs[2])
        links.new(mix_shader.outputs["Shader"], surface_input)

        clip_material.blend_method = "CLIP"
        clip_material.alpha_threshold = 0.5
        if hasattr(clip_material, "shadow_method"):
            clip_material.shadow_method = "CLIP"

    return clip_material


def apply_collection_clip_bounds_shader(collection, clip_bounds_document):
    if collection is None:
        return None

    normalized_box = normalize_clip_bounds_document(clip_bounds_document)
    if normalized_box is None:
        return None

    min_corner = normalized_box["local_min"]
    max_corner = normalized_box["local_max"]
    clip_object = ensure_clip_bounds_object(collection, clip_bounds_document, visible_in_viewport=False)
    if clip_object is None:
        return None

    for obj in collection.all_objects:
        if obj.type != "MESH" or obj == clip_object:
            continue

        if getattr(obj, "data", None) is not None and getattr(obj.data, "users", 0) > 1:
            obj.data = obj.data.copy()

        modifier = obj.modifiers.get(CLIP_BOUNDS_MODIFIER_NAME)
        if modifier is not None:
            obj.modifiers.remove(modifier)

        bounds_modifier = obj.modifiers.get(CLIP_BOUNDS_BOUNDS_MODIFIER_NAME)
        if bounds_modifier is None:
            bounds_modifier = obj.modifiers.new(name=CLIP_BOUNDS_BOUNDS_MODIFIER_NAME, type="BOOLEAN")

        bounds_modifier.object = clip_object
        bounds_modifier.operation = "INTERSECT"
        if hasattr(bounds_modifier, "solver"):
            bounds_modifier.solver = "EXACT"
        if hasattr(bounds_modifier, "show_viewport"):
            bounds_modifier.show_viewport = True
        if hasattr(bounds_modifier, "show_render"):
            bounds_modifier.show_render = False

        for slot in obj.material_slots:
            if slot.material is None:
                continue
            slot.material = ensure_clip_bounds_material(slot.material, clip_object, min_corner, max_corner)

    bpy.context.view_layer.update()
    return normalized_box


def prepare_imported_mesh_objects(
    imported_objects,
    search_roots: Iterable[str],
    material_mode: Optional[str] = None,
    debug_color: Optional[list[float]] = None,
    scene_variant_color_hex: Optional[str] = None,
    clip_floor: bool = False,
    floor_z: float = 0.0,
    material_sidecar_name_override: Optional[str] = None,
):
    imported_armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
    clay_material = ensure_clay_material() if material_mode == "clay" else None
    debug_material = ensure_solid_color_material(f"FoxWatchDebug:{debug_color}", debug_color) if debug_color is not None else None
    prepared_objects = []
    for obj in imported_objects:
        if imported_armatures and obj.type == "MESH" and obj.parent is None and obj.name == "Icosphere":
            bpy.data.objects.remove(obj, do_unlink=True)
            continue

        if debug_material is not None and obj.type == "MESH":
            if len(obj.data.materials) == 0:
                obj.data.materials.append(debug_material)
            else:
                for index in range(len(obj.data.materials)):
                    obj.data.materials[index] = debug_material
        elif clay_material is not None and obj.type == "MESH":
            if len(obj.data.materials) == 0:
                obj.data.materials.append(clay_material)
            else:
                for index in range(len(obj.data.materials)):
                    obj.data.materials[index] = clay_material
        elif material_mode == "sidecar" and obj.type == "MESH":
            for index, slot in enumerate(obj.material_slots):
                material_name = slot.material.name if slot.material is not None else None
                if material_sidecar_name_override:
                    material_name = material_sidecar_name_override
                if not material_name:
                    continue
                sidecar_path = find_material_sidecar(material_name, search_roots)
                if not sidecar_path:
                    continue
                obj.material_slots[index].material = ensure_sidecar_material(
                    normalize_material_name(material_name),
                    sidecar_path,
                    search_roots,
                    color_hex=scene_variant_color_hex,
                )

        if clip_floor and obj.type == "MESH":
            clip_mesh_object_to_world_floor(obj, floor_z=floor_z)

        prepared_objects.append(obj)

    return prepared_objects


def link_imported_objects_to_collection(imported_objects, collection):
    for obj in imported_objects:
        for user_collection in list(obj.users_collection):
            user_collection.objects.unlink(obj)
        collection.objects.link(obj)


def attach_root_objects_to_parent(root_objects, parent_object=None):
    if parent_object is None:
        return

    for root_object in root_objects:
        local_matrix = root_object.matrix_world.copy()
        root_object.parent = parent_object
        root_object.matrix_parent_inverse = Matrix.Identity(4)
        root_object.matrix_world = parent_object.matrix_world @ local_matrix


def ensure_sidecar_material(name: str, material_sidecar_path: str, search_roots: Iterable[str], color_hex: Optional[str] = None):
    normalized_color_hex = normalize_color_hex(color_hex)
    material_name = f"{name}@{normalized_color_hex}" if normalized_color_hex else name
    material = bpy.data.materials.get(material_name)
    if material is None:
        material = bpy.data.materials.new(name=material_name)

    material_document = load_json(material_sidecar_path)
    textures = material_document.get("Textures", {})
    parameters = material_document.get("Parameters", {})
    property_overrides = parameters.get("Properties", {}).get("BasePropertyOverrides", {})

    # Some Foxhole sidecars export light cards as parameter-only "null" materials with no texture
    # payload. We synthesize a warm emissive translucent fallback from the authored color params
    # so fixtures like LanternOn-Off stay readable instead of degrading into flat gray geometry.
    if parameters.get("IsNull") and not textures:
        colors = parameters.get("Colors", {})
        scalars = parameters.get("Scalars", {})
        primary = colors.get("Color") or {"R": 1.0, "G": 0.78, "B": 0.32, "A": 1.0}
        secondary = colors.get("Color2")
        return ensure_parameter_light_material(
            f"{name}:parameter-light",
            [primary.get("R", 1.0), primary.get("G", 0.78), primary.get("B", 0.32), primary.get("A", 1.0)],
            [secondary.get("R", 1.0), secondary.get("G", 0.45), secondary.get("B", 0.08), secondary.get("A", 1.0)] if secondary else None,
            opacity=float(scalars.get("Opacity", 1.0)),
            emissive_strength=max(float(scalars.get("Emissive", 1.0)) * 6.0, 4.0),
        )

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (900, 0)
    shader = nodes.new(type="ShaderNodeBsdfPrincipled")
    shader.location = (600, 0)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    albedo_node = None
    base_color_output = None
    albedo_path = resolve_exported_texture_path(
        first_texture_reference(textures, "Albedo", "PM_Diffuse", "A", "A-Base", "A-2", "A-3"),
        search_roots,
    )
    if albedo_path:
        albedo_node = nodes.new(type="ShaderNodeTexImage")
        albedo_node.location = (0, 180)
        albedo_node.image = bpy.data.images.load(albedo_path, check_existing=True)
        base_color_output = albedo_node.outputs["Color"]

    material.blend_method = "OPAQUE"
    if hasattr(material, "shadow_method"):
        material.shadow_method = "OPAQUE"

    roughness_image = None
    roughness_channels = None
    roughness_texture_key = None
    normal_path = resolve_exported_texture_path(
        first_texture_reference(textures, "Normal", "PM_Normals", "N-Base", "N-2", "N-3"),
        search_roots,
    )
    if normal_path:
        normal_image = nodes.new(type="ShaderNodeTexImage")
        normal_image.location = (0, -40)
        normal_image.image = bpy.data.images.load(normal_path, check_existing=True)
        normal_image.image.colorspace_settings.name = "Non-Color"
        normal_map = nodes.new(type="ShaderNodeNormalMap")
        normal_map.location = (300, -40)
        links.new(normal_image.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

    if textures.get("RoughnessUVTexture"):
        roughness_texture_key = "RoughnessUVTexture"
    elif textures.get("Materiality"):
        roughness_texture_key = "Materiality"
    elif textures.get("M-Base"):
        roughness_texture_key = "M-Base"
    elif textures.get("M-2"):
        roughness_texture_key = "M-2"
    elif textures.get("M-3"):
        roughness_texture_key = "M-3"

    roughness_path = resolve_exported_texture_path(
        textures.get(roughness_texture_key) if roughness_texture_key else None,
        search_roots,
    )
    if roughness_path:
        roughness_image = nodes.new(type="ShaderNodeTexImage")
        roughness_image.location = (0, -260)
        roughness_image.image = bpy.data.images.load(roughness_path, check_existing=True)
        roughness_image.image.colorspace_settings.name = "Non-Color"
        roughness_channels = nodes.new(type="ShaderNodeSeparateColor")
        roughness_channels.location = (300, -260)
        links.new(roughness_image.outputs["Color"], roughness_channels.inputs["Color"])
        links.new(roughness_channels.outputs["Green"], shader.inputs["Roughness"])
        if parameters.get("Switches", {}).get("Use Red Channel for Metalness?", False):
            links.new(roughness_channels.outputs["Red"], shader.inputs["Metallic"])

    switches = parameters.get("Switches", {})
    uses_color_mask = uses_color_change_workflow(name, textures, parameters)
    color_shift_rgba = resolve_color_shift_rgba(parameters, normalized_color_hex)
    if base_color_output is not None and uses_color_mask and color_shift_rgba is not None:
        color_shift_node = nodes.new(type="ShaderNodeRGB")
        color_shift_node.location = (0, 360)
        color_shift_node.outputs["Color"].default_value = color_shift_rgba

        multiplied_albedo = nodes.new(type="ShaderNodeMixRGB")
        multiplied_albedo.location = (300, 220)
        multiplied_albedo.blend_type = "MULTIPLY"
        multiplied_albedo.inputs["Fac"].default_value = 1.0
        links.new(base_color_output, multiplied_albedo.inputs["Color1"])
        links.new(color_shift_node.outputs["Color"], multiplied_albedo.inputs["Color2"])

        # Foxhole's color-change materials pack the selective tint mask into the
        # material texture's blue channel. The exported albedo alpha is fully opaque
        # for the container assets, so preferring it colors the entire mesh.
        mask_output = roughness_channels.outputs["Blue"] if roughness_channels is not None else None
        if mask_output is None and albedo_node is not None and "Alpha" in albedo_node.outputs:
            mask_output = albedo_node.outputs["Alpha"]

        if mask_output is not None:
            masked_base_color = nodes.new(type="ShaderNodeMixRGB")
            masked_base_color.location = (450, 120)
            links.new(mask_output, masked_base_color.inputs["Fac"])
            links.new(base_color_output, masked_base_color.inputs["Color1"])
            links.new(multiplied_albedo.outputs["Color"], masked_base_color.inputs["Color2"])
            base_color_output = masked_base_color.outputs["Color"]
        else:
            base_color_output = multiplied_albedo.outputs["Color"]

    if base_color_output is not None:
        links.new(base_color_output, shader.inputs["Base Color"])

    blend_mode = str(property_overrides.get("BlendMode") or parameters.get("BlendMode") or "").strip()
    explicit_opacity_mask_reference = textures.get("OpacityMask") or textures.get("Opacity Mask")
    uses_opacity_mask = (
        blend_mode == "BLEND_Masked"
        and not switches.get("Don't Use Opacity Mask", False)
        and not switches.get("Disable Opacity", False)
    )
    if uses_opacity_mask:
        opacity_mask_output = None
        opacity_mask_path = resolve_exported_texture_path(
            explicit_opacity_mask_reference,
            search_roots,
        )
        if opacity_mask_path:
            opacity_mask_node = nodes.new(type="ShaderNodeTexImage")
            opacity_mask_node.location = (0, -470)
            opacity_mask_node.image = bpy.data.images.load(opacity_mask_path, check_existing=True)
            opacity_mask_node.image.colorspace_settings.name = "Non-Color"
            if "Alpha" in opacity_mask_node.outputs:
                opacity_mask_output = opacity_mask_node.outputs["Alpha"]
        elif explicit_opacity_mask_reference is None and is_track_like_material(name):
            opacity_mask_output = None
        elif (
            explicit_opacity_mask_reference is None
            and roughness_texture_key == "Materiality"
            and roughness_channels is not None
            and uses_implicit_packed_opacity(name, parameters)
        ):
            opacity_mask_output = roughness_channels.outputs["Blue"]
        elif roughness_image is not None:
            if "Alpha" in roughness_image.outputs:
                opacity_mask_output = roughness_image.outputs["Alpha"]
        elif albedo_node is not None:
            if "Alpha" in albedo_node.outputs:
                opacity_mask_output = albedo_node.outputs["Alpha"]

        if opacity_mask_output is not None:
            # Unreal masked materials use a hard opacity cutoff. Linking their
            # sampled mask straight into Principled Alpha makes perforated bunker
            # roofs look like a translucent solid sheet in Blender/Eevee instead.
            opacity_mask_clip = nodes.new(type="ShaderNodeMath")
            opacity_mask_clip.operation = "GREATER_THAN"
            opacity_mask_clip.location = (440, -470)
            opacity_mask_clip.inputs[1].default_value = float(
                property_overrides.get("OpacityMaskClipValue", 0.3333) or 0.3333
            )
            links.new(opacity_mask_output, opacity_mask_clip.inputs[0])
            links.new(opacity_mask_clip.outputs[0], shader.inputs["Alpha"])
            material.blend_method = "CLIP"
            material.alpha_threshold = float(property_overrides.get("OpacityMaskClipValue", 0.3333) or 0.3333)
            if hasattr(material, "shadow_method"):
                material.shadow_method = "CLIP"

    shader.inputs["Specular IOR Level"].default_value = 0.35
    shader.inputs["Roughness"].default_value = 0.65 if roughness_path is None else shader.inputs["Roughness"].default_value
    material.use_backface_culling = not bool(property_overrides.get("TwoSided", False))
    return material


def import_mesh_asset(mesh_path: str, collection, search_roots: Iterable[str], parent_object=None, material_mode: Optional[str] = None, debug_color: Optional[list[float]] = None, scene_variant_color_hex: Optional[str] = None, clip_floor: bool = False, floor_z: float = 0.0, material_sidecar_name_override: Optional[str] = None):
    debug_color_key = tuple(float(component) for component in debug_color) if debug_color is not None else None
    cache_key = (mesh_path, material_mode, debug_color_key, normalize_color_hex(scene_variant_color_hex), bool(clip_floor), float(floor_z), material_sidecar_name_override)
    cached_objects = _IMPORTED_MESH_OBJECT_CACHE.get(cache_key)
    if cached_objects is None:
        template_collection = ensure_private_collection("FoxWatch:AssetTemplates")
        existing_names = {obj.name for obj in bpy.data.objects}
        bpy.ops.import_scene.gltf(filepath=mesh_path)
        imported_objects = [obj for obj in bpy.data.objects if obj.name not in existing_names]
        prepared_objects = prepare_imported_mesh_objects(
            imported_objects,
            search_roots,
            material_mode=material_mode,
            debug_color=debug_color,
            scene_variant_color_hex=scene_variant_color_hex,
            clip_floor=clip_floor,
            floor_z=floor_z,
            material_sidecar_name_override=material_sidecar_name_override,
        )
        for obj in prepared_objects:
            for user_collection in list(obj.users_collection):
                user_collection.objects.unlink(obj)
            template_collection.objects.link(obj)
            obj.hide_render = True
            obj.hide_viewport = True
        cached_objects = prepared_objects
        _IMPORTED_MESH_OBJECT_CACHE[cache_key] = cached_objects

    duplicated_objects = []
    duplicate_map = {}
    for source_object in cached_objects:
        duplicate = source_object.copy()
        if getattr(source_object, "data", None) is not None:
            duplicate.data = source_object.data
        duplicate.animation_data_clear()
        duplicate.hide_render = False
        duplicate.hide_viewport = False
        collection.objects.link(duplicate)
        duplicate_map[source_object] = duplicate
        duplicated_objects.append(duplicate)

    root_duplicates = []
    for source_object, duplicate in duplicate_map.items():
        source_parent = source_object.parent
        if source_parent in duplicate_map:
            duplicate.parent = duplicate_map[source_parent]
            duplicate.matrix_parent_inverse = source_object.matrix_parent_inverse.copy()
            duplicate.matrix_local = source_object.matrix_local.copy()
        else:
            duplicate.parent = None
            duplicate.matrix_world = source_object.matrix_world.copy()
            root_duplicates.append(duplicate)

        if duplicate.type == "MESH":
            for modifier in duplicate.modifiers:
                if modifier.type != "ARMATURE":
                    continue
                if modifier.object in duplicate_map:
                    modifier.object = duplicate_map[modifier.object]

    attach_root_objects_to_parent(root_duplicates, parent_object)

    return duplicated_objects


def set_scene_background_transparency(enabled: bool):
    bpy.context.scene.render.film_transparent = enabled


def evaluated_mesh_world_bounds(evaluated_object):
    mesh = evaluated_object.to_mesh()
    try:
        if mesh is not None and len(mesh.vertices) > 0:
            corners = [evaluated_object.matrix_world @ vertex.co for vertex in mesh.vertices]
        else:
            corners = [evaluated_object.matrix_world @ Vector(corner) for corner in evaluated_object.bound_box]
    finally:
        if mesh is not None:
            evaluated_object.to_mesh_clear()

    if not corners:
        return None

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


def collection_world_bounds(collection):
    corners = []
    depsgraph = bpy.context.evaluated_depsgraph_get()

    for obj in collection.all_objects:
        if obj.hide_render or obj.type != "MESH":
            continue

        evaluated_object = obj.evaluated_get(depsgraph)
        object_bounds = evaluated_mesh_world_bounds(evaluated_object)
        if object_bounds is None:
            continue
        corners.extend(object_bounds)

    if not corners:
        return Vector((-0.5, -0.5, -0.5)), Vector((0.5, 0.5, 0.5))

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


def topdown_resolution_from_bounds(min_corner: Vector, max_corner: Vector, padding: float, pixels_per_meter: float):
    width = max((max_corner.x - min_corner.x) + padding * 2.0, 0.01)
    height = max((max_corner.y - min_corner.y) + padding * 2.0, 0.01)
    return math.ceil(width * pixels_per_meter), math.ceil(height * pixels_per_meter)


def projected_bounds_for_camera(camera_object, min_corner: Vector, max_corner: Vector):
    corners = [
        Vector((x, y, z))
        for x in (min_corner.x, max_corner.x)
        for y in (min_corner.y, max_corner.y)
        for z in (min_corner.z, max_corner.z)
    ]
    view_matrix = camera_object.matrix_world.inverted()
    projected = [view_matrix @ corner for corner in corners]
    min_x = min(point.x for point in projected)
    max_x = max(point.x for point in projected)
    min_y = min(point.y for point in projected)
    max_y = max(point.y for point in projected)
    min_z = min(point.z for point in projected)
    max_z = max(point.z for point in projected)
    return min_x, max_x, min_y, max_y, min_z, max_z


def recenter_ortho_camera_from_projected_bounds(camera_object, min_x: float, max_x: float, min_y: float, max_y: float):
    offset_x = (min_x + max_x) * 0.5
    offset_y = (min_y + max_y) * 0.5
    if abs(offset_x) <= 1e-6 and abs(offset_y) <= 1e-6:
        return

    world_offset = camera_object.matrix_world.to_quaternion() @ Vector((offset_x, offset_y, 0.0))
    camera_object.location -= world_offset


def fit_ortho_camera_to_bounds(camera_object, min_corner: Vector, max_corner: Vector, resolution_x: int, resolution_y: int, padding: float):
    min_x, max_x, min_y, max_y, min_z, max_z = projected_bounds_for_camera(camera_object, min_corner, max_corner)

    span_x = max(max_x - min_x, 0.01)
    span_y = max(max_y - min_y, 0.01)
    depth = max(max_z - min_z, 0.1)

    view_width = span_x + padding * 2.0
    view_height = span_y + padding * 2.0
    aspect_ratio = max(float(resolution_x) / max(float(resolution_y), 1.0), 0.01)

    camera = camera_object.data
    camera.type = "ORTHO"
    camera.ortho_scale = max(view_height, view_width / aspect_ratio)
    camera.clip_start = 0.01
    camera.clip_end = max(depth * 4.0, 100.0)


def fit_topdown_camera_to_bounds(
    camera_object,
    min_corner: Vector,
    max_corner: Vector,
    resolution_x: int,
    resolution_y: int,
    padding: float,
    pixels_per_meter: float,
):
    width = max((max_corner.x - min_corner.x) + padding * 2.0, 0.01)
    height = max((max_corner.y - min_corner.y) + padding * 2.0, 0.01)

    camera_object.location.x = (min_corner.x + max_corner.x) * 0.5
    camera_object.location.y = (min_corner.y + max_corner.y) * 0.5

    # Top-down framing places the camera above the structure using its widest span,
    # so the far clip must account for camera-to-deck distance, not only Z thickness.
    far_distance = max(camera_object.location.z - min_corner.z, 0.1)

    camera = camera_object.data
    camera.type = "ORTHO"
    # The render resolution is rounded to whole pixels, while the source bounds
    # are not. Fitting the camera to the unrounded bounds made every cropped
    # component render at a slightly different pixels-per-meter value. The board
    # consumes each sidecar as a fixed 64 px/m texture, so preserve that scale
    # here and let the ceiling operation become symmetric sub-pixel padding.
    camera.ortho_scale = max(float(resolution_x), float(resolution_y)) / max(float(pixels_per_meter), 0.01)
    camera.clip_start = 0.01
    camera.clip_end = max(far_distance * 1.5, 100.0)


def project_world_point_to_render(camera_object, world_point: Vector, resolution_x: int, resolution_y: int):
    view_point = world_to_camera_view(bpy.context.scene, camera_object, world_point)
    normalized_x = float(view_point.x)
    normalized_y = 1.0 - float(view_point.y)

    pixel_x = normalized_x * float(resolution_x)
    pixel_y = normalized_y * float(resolution_y)
    return {
        "normalizedX": normalized_x,
        "normalizedY": normalized_y,
        "pixelX": pixel_x,
        "pixelY": pixel_y,
        "depth": float(view_point.z),
    }


def projected_bounds_margins(camera_object, min_corner: Vector, max_corner: Vector, resolution_x: int, resolution_y: int):
    corners = [
        Vector((x, y, z))
        for x in (min_corner.x, max_corner.x)
        for y in (min_corner.y, max_corner.y)
        for z in (min_corner.z, max_corner.z)
    ]
    projected = [project_world_point_to_render(camera_object, corner, resolution_x, resolution_y) for corner in corners]

    left = min(point["pixelX"] for point in projected)
    right = float(resolution_x) - max(point["pixelX"] for point in projected)
    top = min(point["pixelY"] for point in projected)
    bottom = float(resolution_y) - max(point["pixelY"] for point in projected)
    return {
        "left": left,
        "right": right,
        "top": top,
        "bottom": bottom,
        "deltaX": left - right,
        "deltaY": top - bottom,
    }


def mode_output_key(output_key: str, mode: str) -> str:
    return output_key if mode == "topdown" else f"{output_key}.{mode}"


def scene_variant_output_key(output_key: str, scene_variant: Optional[str] = None) -> str:
    return output_key if not scene_variant else f"{output_key}.{scene_variant}"


def resolve_scene_variant_id(scene_document: dict, requested_variant: Optional[str] = None) -> Optional[str]:
    scene_variants = scene_document.get("variants") or []
    if not scene_variants:
        return None

    if requested_variant:
        requested_variant = requested_variant.lower()
        for scene_variant in scene_variants:
            variant_id = (scene_variant.get("id") or "").lower()
            if variant_id == requested_variant:
                return scene_variant.get("id")
        raise ValueError(f"Unsupported scene variant '{requested_variant}'")

    for scene_variant in scene_variants:
        if scene_variant.get("isDefault"):
            return scene_variant.get("id")

    return scene_variants[0].get("id")


def resolve_scene_variant_document(scene_document: dict, requested_variant: Optional[str] = None) -> Optional[dict]:
    resolved_variant_id = resolve_scene_variant_id(scene_document, requested_variant)
    if not resolved_variant_id:
        return None

    for scene_variant in scene_document.get("variants") or []:
        if (scene_variant.get("id") or "").lower() == resolved_variant_id.lower():
            return scene_variant

    return None


def scene_variant_ids(scene_document: dict, allowed_ids: Optional[set[str]] = None) -> list[Optional[str]]:
    scene_variants = scene_document.get("variants") or []
    if not scene_variants:
        return [None]

    allowed = {variant_id.lower() for variant_id in (allowed_ids or set())}
    resolved_ids = []
    for scene_variant in scene_variants:
        variant_id = scene_variant.get("id")
        if not variant_id:
            continue
        if allowed and variant_id.lower() not in allowed:
            continue
        resolved_ids.append(variant_id)
    if resolved_ids:
        return resolved_ids
    return [] if allowed else [resolve_scene_variant_id(scene_document)]


def resolve_preview_direction(scene_document: dict, preview_variant: Optional[str] = None) -> str:
    render_settings = scene_document.get("render", {})
    return (preview_variant or render_settings.get("previewDirection") or "se").lower()


def angled_camera_pose(scene_document: dict, mode: str, center: Vector, min_corner: Vector, span: Vector, max_dimension: float, preview_variant: Optional[str] = None):
    resolved_preview_variant = resolve_preview_direction(scene_document, preview_variant)
    direction_values = PREVIEW_ANGLE_DIRECTIONS.get(resolved_preview_variant)
    if direction_values is None:
        raise ValueError(f"Unsupported preview variant '{preview_variant}'")

    direction = Vector(direction_values).normalized()
    camera_position = center + direction * max(max_dimension * 2.5, 8.0)
    target = Vector((center.x, center.y, min_corner.z + span.z * 0.5))
    return camera_position, target


def render_output_key(output_key: str, mode: str, preview_variant: Optional[str] = None, scene_variant: Optional[str] = None) -> str:
    base_key = mode_output_key(scene_variant_output_key(output_key, scene_variant), mode)
    return base_key if not preview_variant else f"{base_key}.{preview_variant}"


def apply_render_mode(
    scene_document: dict,
    collection,
    mode: str,
    preview_variant: Optional[str] = None,
    scene_variant: Optional[str] = None,
    pixels_per_meter: float = PIXELS_PER_METER,
    preview_size: int = 512,
    icon_size: int = 256,
    bounds: Optional[tuple[Vector, Vector]] = None,
):
    min_corner, max_corner = bounds or collection_world_bounds(collection)
    center = (min_corner + max_corner) / 2.0
    span = max_corner - min_corner
    max_dimension = max(span.x, span.y, span.z, 0.5)
    render_settings = scene_document.get("render", {})
    transparent_background = render_settings.get("transparentBackground", True)

    if mode in {"topdown", "flat"}:
        configure_sun(mode)
        # Board-placement renders need an exact footprint. Keep top-down framing tight
        # to the evaluated structure bounds and emit the true origin anchor separately.
        padding = 0.0
        resolution_x, resolution_y = topdown_resolution_from_bounds(min_corner, max_corner, padding, pixels_per_meter)
        configure_scene_render(resolution_x, resolution_y, transparent_background, file_format="WEBP")
        camera_position = Vector((center.x, center.y, max_corner.z + max(max_dimension * 2.0, 8.0)))
        camera_object = configure_topdown_camera_object(TOPDOWN_CAMERA_NAME, camera_position)
        fit_topdown_camera_to_bounds(
            camera_object,
            min_corner,
            max_corner,
            resolution_x,
            resolution_y,
            padding,
            pixels_per_meter,
        )
    elif mode == "preview":
        resolved_preview_variant = resolve_preview_direction(scene_document, preview_variant)
        configure_sun(mode, resolved_preview_variant)
        resolution_x = preview_size
        resolution_y = preview_size
        padding = max(max_dimension * 0.03, 0.12)
        configure_scene_render(resolution_x, resolution_y, transparent_background, file_format="PNG")
        camera_position, target = angled_camera_pose(scene_document, mode, center, min_corner, span, max_dimension, resolved_preview_variant)
        camera_object = configure_camera_object(PREVIEW_CAMERA_NAME, camera_position, target)
        fit_ortho_camera_to_bounds(camera_object, min_corner, max_corner, resolution_x, resolution_y, padding)
    elif mode == "icon":
        resolved_preview_variant = resolve_preview_direction(scene_document, preview_variant)
        configure_sun(mode, resolved_preview_variant)
        resolution_x = icon_size
        resolution_y = icon_size
        padding = max(max_dimension * 0.03, 0.12)
        configure_scene_render(resolution_x, resolution_y, transparent_background, file_format="PNG")
        camera_position, target = angled_camera_pose(scene_document, mode, center, min_corner, span, max_dimension, resolved_preview_variant)
        camera_object = configure_camera_object(ICON_CAMERA_NAME, camera_position, target)
        fit_ortho_camera_to_bounds(camera_object, min_corner, max_corner, resolution_x, resolution_y, padding)
    else:
        raise ValueError(f"Unsupported render mode '{mode}'")

    anchor = project_world_point_to_render(camera_object, Vector((0.0, 0.0, 0.0)), resolution_x, resolution_y)
    boundsCenter = (min_corner + max_corner) * 0.5
    boundsCenterProjection = project_world_point_to_render(camera_object, boundsCenter, resolution_x, resolution_y)
    boundsMargins = projected_bounds_margins(camera_object, min_corner, max_corner, resolution_x, resolution_y)
    return {
        "mode": mode,
        "previewVariant": preview_variant,
        "sceneVariant": scene_variant,
        "outputKey": render_output_key(render_settings.get("outputKey", scene_document["structure"]["id"]), mode, preview_variant, scene_variant),
        "resolution": (bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y),
        "camera": bpy.context.scene.camera.name if bpy.context.scene.camera else None,
        "anchor": anchor,
        "boundsCenterProjection": boundsCenterProjection,
        "boundsMargins": boundsMargins,
    }
