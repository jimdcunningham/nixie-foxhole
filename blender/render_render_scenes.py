import argparse
import json
import math
import os
import re
import sys
import tempfile

import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

from script_bootstrap import append_script_search_paths


append_script_search_paths(globals().get("__file__"), bpy.data.filepath, os.getcwd())

from import_render_scene import import_render_scene  # noqa: E402
from render_scene_common import (  # noqa: E402
    PIXELS_PER_METER,
    apply_render_mode,
    collection_world_bounds,
    create_bounds_debug_box,
    ensure_directory,
    load_json,
    normalize_search_roots,
    project_world_point_to_render,
    render_output_key,
    resolve_preview_direction,
    resolve_scene_variant_document,
    resolve_scene_variant_id,
    remove_collection,
    remove_collections_with_prefix,
    remove_default_startup_scene_objects,
    scene_variant_ids,
)


TRENCH_READABILITY_STRUCTURE_IDS = {"trencht1", "trencht2", "trencht3"}
TRENCH_READABILITY_PROFILES = {
    "components/floor": {
        "color_scale": (0.93, 0.915, 0.9),
        "shadow_radius": 28.0,
        "shadow_strength": 0.34,
        "shadow_power": 1.15,
        "center_lift": 0.12,
        "center_power": 1.1,
    },
    "mods/stairs": {
        "color_scale": (0.978, 0.968, 0.958),
        "shadow_radius": 16.0,
        "shadow_strength": 0.16,
        "shadow_power": 1.15,
        "center_lift": 0.05,
        "center_power": 1.05,
    },
    "mods/oneway": {
        "color_scale": (0.978, 0.968, 0.958),
        "shadow_radius": 16.0,
        "shadow_strength": 0.16,
        "shadow_power": 1.15,
        "center_lift": 0.05,
        "center_power": 1.05,
    },
}
FLAT_EDGE_ALPHA_THRESHOLD = 0.5
FLAT_REGION_LINE_THICKNESS = 1
FLAT_FINAL_LINE_THICKNESS = 3
FLAT_FILL_SATURATION = 1.34
FLAT_FILL_VIBRANCE = 0.32
FLAT_FILL_CONTRAST = 1.18
FLAT_FILL_GAMMA = 0.90


def collection_root_anchor_point(collection):
    root_objects = [obj for obj in collection.objects if obj.parent is None]
    if not root_objects:
        return Vector((0.0, 0.0, 0.0))

    if len(root_objects) == 1:
        return root_objects[0].matrix_world.translation.copy()

    combined = Vector((0.0, 0.0, 0.0))
    for obj in root_objects:
        combined += obj.matrix_world.translation
    return combined / float(len(root_objects))


def write_render_sidecar(output_path: str, structure_id: str, output_key: str, render_state: dict, pixels_per_meter: float, anchor: dict):
    resolution_x, resolution_y = render_state["resolution"]
    anchor_pixel_x = float(anchor.get("pixelX", float(resolution_x) * 0.5))
    anchor_pixel_y = float(anchor.get("pixelY", float(resolution_y) * 0.5))
    geometry_center = render_state.get("boundsCenterProjection") or {}
    geometry_center_x = float(geometry_center.get("pixelX", float(resolution_x) * 0.5))
    geometry_center_y = float(geometry_center.get("pixelY", float(resolution_y) * 0.5))
    image_center_x = float(resolution_x) * 0.5
    image_center_y = float(resolution_y) * 0.5
    # Board-placement offsets describe how far the fitted render center must
    # move to land the authored anchor on the board origin, in board pixels.
    offset_x_pixels = image_center_x - anchor_pixel_x
    offset_y_pixels = image_center_y - anchor_pixel_y
    sidecar_document = {
        "schemaVersion": "1.0.0",
        "structureId": structure_id,
        "outputKey": output_key,
        "mode": render_state["mode"],
        "sceneVariant": render_state.get("sceneVariant"),
        "previewVariant": render_state.get("previewVariant"),
        "width": float(resolution_x),
        "height": float(resolution_y),
        "pixelsPerMeter": float(pixels_per_meter),
        "anchorPixelX": anchor_pixel_x,
        "anchorPixelY": anchor_pixel_y,
        "imageCenterPixelX": image_center_x,
        "imageCenterPixelY": image_center_y,
        "geometryCenterPixelX": geometry_center_x,
        "geometryCenterPixelY": geometry_center_y,
        "offsetXPixels": offset_x_pixels,
        "offsetYPixels": offset_y_pixels,
        "offsetX": offset_x_pixels,
        "offsetY": offset_y_pixels,
    }
    sidecar_paths = []
    render_data_root = render_state.get("renderDataRoot")
    if render_data_root:
        normalized_output_key = output_key.replace("/", os.sep).replace("\\", os.sep)
        sidecar_paths.append(os.path.join(render_data_root, structure_id, f"{normalized_output_key}.render.json"))
    else:
        sidecar_paths.append(f"{output_path}.render.json")

    if re.search(r"\.texture(?:\.[0-9a-f]{6})?\.webp$", output_path.lower()):
        sidecar_paths.append(f"{output_path[:-len('.webp')]}.json")
    elif re.search(r"\.texture\.flat(?:\.[0-9a-f]{6})?\.webp$", output_path.lower()):
        sidecar_paths.append(f"{output_path[:-len('.webp')]}.json")

    for sidecar_path in sidecar_paths:
        ensure_directory(os.path.dirname(sidecar_path))
        with open(sidecar_path, "w", encoding="utf-8") as handle:
            json.dump(sidecar_document, handle, indent=2)
            handle.write("\n")


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", required=True, help="Absolute path to render bundle index manifest")
    parser.add_argument("--output-dir", required=True, help="Absolute output directory for rendered WebP files")
    parser.add_argument("--public-root", default=None)
    parser.add_argument("--foxwatch-output-root", default=None)
    parser.add_argument("--render-data-root", default=None)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--scene-variant", action="append", default=[])
    parser.add_argument("--mode", action="append", choices=["topdown", "preview", "icon", "flat"], default=[])
    parser.add_argument("--pixels-per-meter", type=float, default=PIXELS_PER_METER)
    parser.add_argument("--preview-size", type=int, default=512)
    parser.add_argument("--icon-size", type=int, default=256)
    parser.add_argument("--debug-bounds", action="store_true")
    parser.add_argument("--purge-existing", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(raw_args)


def alpha_margins_from_image_path(image_path: str, alpha_threshold: float = 0.04):
    if not os.path.exists(image_path):
        return None

    image = bpy.data.images.load(image_path, check_existing=False)
    try:
        width, height = image.size
        if width <= 0 or height <= 0:
            return None

        pixels = list(image.pixels)
        min_x = width
        min_y = height
        max_x = -1
        max_y = -1

        for y in range(height):
            row_offset = y * width * 4
            for x in range(width):
                alpha = pixels[row_offset + (x * 4) + 3]
                if alpha <= alpha_threshold:
                    continue
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y

        if max_x < min_x or max_y < min_y:
            return None

        return {
            "left": float(min_x),
            "right": float(width - 1 - max_x),
            "top": float(min_y),
            "bottom": float(height - 1 - max_y),
        }
    finally:
        bpy.data.images.remove(image)


def trench_readability_profile(structure_id: str, output_key: str, mode: str):
    if mode != "topdown":
        return None

    if str(structure_id or "").strip().lower() not in TRENCH_READABILITY_STRUCTURE_IDS:
        return None

    return TRENCH_READABILITY_PROFILES.get(str(output_key or "").replace("\\", "/").strip().lower())


def alpha_edge_distances(width: int, height: int, pixels: list[float], alpha_threshold: float = 0.01):
    distances = [float("inf")] * (width * height)

    for y in range(height):
        for x in range(width):
            pixel_index = ((y * width) + x) * 4
            if pixels[pixel_index + 3] <= alpha_threshold:
                distances[(y * width) + x] = 0.0

    neighbor_offsets = [
        (-1, 0, 1.0),
        (0, -1, 1.0),
        (-1, -1, 1.41421356237),
        (1, -1, 1.41421356237),
    ]
    for y in range(height):
        for x in range(width):
            index = (y * width) + x
            best = distances[index]
            for offset_x, offset_y, step_cost in neighbor_offsets:
                sample_x = x + offset_x
                sample_y = y + offset_y
                if sample_x < 0 or sample_x >= width or sample_y < 0 or sample_y >= height:
                    continue
                best = min(best, distances[(sample_y * width) + sample_x] + step_cost)
            distances[index] = best

    neighbor_offsets = [
        (1, 0, 1.0),
        (0, 1, 1.0),
        (1, 1, 1.41421356237),
        (-1, 1, 1.41421356237),
    ]
    for y in range(height - 1, -1, -1):
        for x in range(width - 1, -1, -1):
            index = (y * width) + x
            best = distances[index]
            for offset_x, offset_y, step_cost in neighbor_offsets:
                sample_x = x + offset_x
                sample_y = y + offset_y
                if sample_x < 0 or sample_x >= width or sample_y < 0 or sample_y >= height:
                    continue
                best = min(best, distances[(sample_y * width) + sample_x] + step_cost)
            distances[index] = best

    return distances


def apply_readability_grade(output_path: str, profile):
    if profile is None or not os.path.exists(output_path):
        return

    image = bpy.data.images.load(output_path, check_existing=False)
    try:
        width, height = image.size
        if width <= 0 or height <= 0:
            return

        pixels = list(image.pixels)
        red_scale, green_scale, blue_scale = profile["color_scale"]
        shadow_radius = max(float(profile.get("shadow_radius", 0.0)), 0.0)
        shadow_strength = max(float(profile.get("shadow_strength", 0.0)), 0.0)
        shadow_power = max(float(profile.get("shadow_power", 1.0)), 0.01)
        center_lift = max(float(profile.get("center_lift", 0.0)), 0.0)
        center_power = max(float(profile.get("center_power", 1.0)), 0.01)
        distances = alpha_edge_distances(width, height, pixels)
        max_distance = max((distance for index, distance in enumerate(distances) if pixels[(index * 4) + 3] > 0.0), default=0.0)
        for index in range(0, len(pixels), 4):
            alpha = pixels[index + 3]
            if alpha <= 0.0:
                continue

            edge_distance = distances[index // 4]
            shadow_factor = 1.0
            if shadow_radius > 0.0 and edge_distance < shadow_radius:
                proximity = 1.0 - max(0.0, min(1.0, edge_distance / shadow_radius))
                shadow_factor = 1.0 - (shadow_strength * (proximity ** shadow_power))

            center_factor = 1.0
            if center_lift > 0.0 and max_distance > 0.0:
                center_proximity = max(0.0, min(1.0, edge_distance / max_distance))
                center_factor = 1.0 + (center_lift * (center_proximity ** center_power))

            pixels[index] = max(0.0, min(1.0, pixels[index] * red_scale * shadow_factor * center_factor))
            pixels[index + 1] = max(0.0, min(1.0, pixels[index + 1] * green_scale * shadow_factor * center_factor))
            pixels[index + 2] = max(0.0, min(1.0, pixels[index + 2] * blue_scale * shadow_factor * center_factor))

        image.pixels.foreach_set(pixels)
        image.filepath_raw = output_path
        image.file_format = "WEBP"
        image.save()
    finally:
        bpy.data.images.remove(image)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def ensure_fallback_source_material():
    material_name = "FoxWatchFallbackSourceMaterial"
    existing_material = bpy.data.materials.get(material_name)
    if existing_material is not None:
        return existing_material

    material = bpy.data.materials.new(name=material_name)
    material.use_nodes = True
    node_tree = material.node_tree
    node_tree.nodes.clear()

    output_node = node_tree.nodes.new(type="ShaderNodeOutputMaterial")
    output_node.location = (240, 0)
    diffuse_node = node_tree.nodes.new(type="ShaderNodeBsdfDiffuse")
    diffuse_node.location = (0, 0)
    diffuse_node.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    diffuse_node.inputs[1].default_value = 1.0
    node_tree.links.new(diffuse_node.outputs[0], output_node.inputs[0])
    return material


def ensure_flat_lineart_material():
    material_name = "FoxWatchFlatLineartMaterial"
    existing_material = bpy.data.materials.get(material_name)
    if existing_material is not None:
        return existing_material

    material = bpy.data.materials.new(name=material_name)
    material.use_nodes = True
    node_tree = material.node_tree
    node_tree.nodes.clear()

    output_node = node_tree.nodes.new(type="ShaderNodeOutputMaterial")
    output_node.location = (240, 0)
    transparent_node = node_tree.nodes.new(type="ShaderNodeBsdfTransparent")
    transparent_node.location = (0, 0)
    node_tree.links.new(transparent_node.outputs[0], output_node.inputs[0])
    material.blend_method = "BLEND"
    if hasattr(material, "shadow_method"):
        material.shadow_method = "NONE"
    return material


def set_webp_lossless(image_settings):
    image_settings.file_format = "WEBP"
    if hasattr(image_settings, "color_mode"):
        image_settings.color_mode = "RGBA"
    if hasattr(image_settings, "quality"):
        image_settings.quality = 100
    if hasattr(image_settings, "webp_lossless"):
        image_settings.webp_lossless = True


def set_image_output_format(image_settings, output_path: str):
    extension = os.path.splitext(str(output_path or ""))[1].lower()
    if extension == ".png":
        image_settings.file_format = "PNG"
        if hasattr(image_settings, "color_mode"):
            image_settings.color_mode = "RGBA"
        if hasattr(image_settings, "quality"):
            image_settings.quality = 100
        if hasattr(image_settings, "compression"):
            image_settings.compression = 15
        return

    set_webp_lossless(image_settings)


def set_neutral_view_transform(scene):
    view_settings = scene.view_settings
    display_settings = scene.display_settings
    previous_view_transform = getattr(view_settings, "view_transform", None)
    previous_look = getattr(view_settings, "look", None)
    previous_exposure = getattr(view_settings, "exposure", None)
    previous_gamma = getattr(view_settings, "gamma", None)
    previous_display_device = getattr(display_settings, "display_device", None)

    if hasattr(display_settings, "display_device"):
        display_settings.display_device = "sRGB"
    if hasattr(view_settings, "view_transform"):
        available_names = set()
        if hasattr(bpy, "app") and hasattr(bpy.app, "ocio") and hasattr(bpy.app.ocio, "getCurrentConfig"):
            try:
                config = bpy.app.ocio.getCurrentConfig()
                if hasattr(config, "getViews"):
                    available_names = {str(name) for name in config.getViews()}
            except Exception:
                available_names = set()
        if "Standard" in available_names or not available_names:
            view_settings.view_transform = "Standard"
        elif "Raw" in available_names:
            view_settings.view_transform = "Raw"
    if hasattr(view_settings, "look"):
        view_settings.look = "None"
    if hasattr(view_settings, "exposure"):
        view_settings.exposure = 0.0
    if hasattr(view_settings, "gamma"):
        view_settings.gamma = 1.0

    return {
        "view_transform": previous_view_transform,
        "look": previous_look,
        "exposure": previous_exposure,
        "gamma": previous_gamma,
        "display_device": previous_display_device,
    }


def restore_view_transform(scene, previous_state):
    view_settings = scene.view_settings
    display_settings = scene.display_settings
    if previous_state.get("display_device") is not None and hasattr(display_settings, "display_device"):
        display_settings.display_device = previous_state["display_device"]
    if previous_state.get("view_transform") is not None and hasattr(view_settings, "view_transform"):
        view_settings.view_transform = previous_state["view_transform"]
    if previous_state.get("look") is not None and hasattr(view_settings, "look"):
        view_settings.look = previous_state["look"]
    if previous_state.get("exposure") is not None and hasattr(view_settings, "exposure"):
        view_settings.exposure = previous_state["exposure"]
    if previous_state.get("gamma") is not None and hasattr(view_settings, "gamma"):
        view_settings.gamma = previous_state["gamma"]


def render_fallback_source(output_path: str):
    view_layer = bpy.context.view_layer
    image_settings = bpy.context.scene.render.image_settings
    previous_override = view_layer.material_override
    previous_use_freestyle = bpy.context.scene.render.use_freestyle
    previous_file_format = getattr(image_settings, "file_format", None)
    previous_color_mode = getattr(image_settings, "color_mode", None)
    previous_quality = getattr(image_settings, "quality", None)
    previous_webp_lossless = getattr(image_settings, "webp_lossless", None)
    bpy.context.scene.render.filepath = output_path
    view_layer.material_override = ensure_fallback_source_material()
    bpy.context.scene.render.use_freestyle = True
    set_image_output_format(image_settings, output_path)

    freestyle_settings = view_layer.freestyle_settings
    while len(freestyle_settings.linesets) > 1:
        freestyle_settings.linesets.remove(freestyle_settings.linesets[-1])
    if len(freestyle_settings.linesets) == 0:
        line_set = freestyle_settings.linesets.new("FoxWatchFallback")
    else:
        line_set = freestyle_settings.linesets[0]

    line_style = line_set.linestyle
    if hasattr(line_style, "thickness"):
        line_style.thickness = 1.5
    if hasattr(line_style, "thickness_position"):
        line_style.thickness_position = "CENTER"
    if hasattr(line_style, "color"):
        line_style.color = (0.0, 0.0, 0.0)
    if hasattr(line_style, "alpha"):
        line_style.alpha = 1.0

    line_set.select_by_visibility = True
    line_set.visibility = "VISIBLE"
    line_set.select_contour = False
    line_set.select_external_contour = False
    line_set.select_silhouette = False
    line_set.select_border = False
    line_set.select_crease = True
    line_set.select_ridge_valley = False
    line_set.select_material_boundary = False
    line_set.select_edge_mark = False
    line_set.select_suggestive_contour = False
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.context.scene.render.use_freestyle = previous_use_freestyle
        view_layer.material_override = previous_override
        if previous_file_format is not None:
            image_settings.file_format = previous_file_format
        if previous_color_mode is not None:
            image_settings.color_mode = previous_color_mode
        if previous_quality is not None:
            image_settings.quality = previous_quality
        if previous_webp_lossless is not None and hasattr(image_settings, "webp_lossless"):
            image_settings.webp_lossless = previous_webp_lossless


def render_flat_lineart_source(output_path: str, thickness: int):
    view_layer = bpy.context.view_layer
    image_settings = bpy.context.scene.render.image_settings
    previous_override = view_layer.material_override
    previous_use_freestyle = bpy.context.scene.render.use_freestyle
    previous_file_format = getattr(image_settings, "file_format", None)
    previous_color_mode = getattr(image_settings, "color_mode", None)
    previous_quality = getattr(image_settings, "quality", None)
    previous_webp_lossless = getattr(image_settings, "webp_lossless", None)
    bpy.context.scene.render.filepath = output_path
    view_layer.material_override = ensure_flat_lineart_material()
    bpy.context.scene.render.use_freestyle = True
    set_image_output_format(image_settings, output_path)

    freestyle_settings = view_layer.freestyle_settings
    while len(freestyle_settings.linesets) > 1:
        freestyle_settings.linesets.remove(freestyle_settings.linesets[-1])
    if len(freestyle_settings.linesets) == 0:
        line_set = freestyle_settings.linesets.new("FoxWatchFlat")
    else:
        line_set = freestyle_settings.linesets[0]

    line_style = line_set.linestyle
    if hasattr(line_style, "thickness"):
        line_style.thickness = thickness
    if hasattr(line_style, "thickness_position"):
        line_style.thickness_position = "CENTER"
    if hasattr(line_style, "color"):
        line_style.color = (0.0, 0.0, 0.0)
    if hasattr(line_style, "alpha"):
        line_style.alpha = 1.0

    line_set.select_by_visibility = True
    line_set.visibility = "VISIBLE"
    line_set.select_contour = False
    line_set.select_external_contour = True
    line_set.select_silhouette = True
    line_set.select_border = False
    line_set.select_crease = True
    line_set.select_ridge_valley = False
    line_set.select_material_boundary = False
    line_set.select_edge_mark = False
    line_set.select_suggestive_contour = False
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.context.scene.render.use_freestyle = previous_use_freestyle
        view_layer.material_override = previous_override
        if previous_file_format is not None:
            image_settings.file_format = previous_file_format
        if previous_color_mode is not None:
            image_settings.color_mode = previous_color_mode
        if previous_quality is not None:
            image_settings.quality = previous_quality
        if previous_webp_lossless is not None and hasattr(image_settings, "webp_lossless"):
            image_settings.webp_lossless = previous_webp_lossless


def clamp01_channel(value: float) -> float:
    return max(0.0, min(1.0, value))


def stylize_flat_fill_color(red: float, green: float, blue: float) -> tuple[float, float, float]:
    luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722)
    chroma = max(red, green, blue) - min(red, green, blue)
    saturation_scale = FLAT_FILL_SATURATION + ((1.0 - chroma) * FLAT_FILL_VIBRANCE)

    red = luminance + ((red - luminance) * saturation_scale)
    green = luminance + ((green - luminance) * saturation_scale)
    blue = luminance + ((blue - luminance) * saturation_scale)

    target_luminance = 0.5 + ((luminance - 0.5) * FLAT_FILL_CONTRAST)
    target_luminance = pow(clamp01_channel(target_luminance), FLAT_FILL_GAMMA)
    luminance_scale = target_luminance / max(0.001, luminance)

    red *= luminance_scale
    green *= luminance_scale
    blue *= luminance_scale

    return (
        clamp01_channel(red),
        clamp01_channel(green),
        clamp01_channel(blue),
    )


def build_flat_region_fill_colors(
    width: int,
    height: int,
    source_pixels: list[float],
    lineart_pixels: list[float] | None,
) -> list[float]:
    pixel_count = width * height
    output_pixels = [0.0] * (pixel_count * 4)
    visited = [False] * pixel_count
    solid_threshold = 0.001

    barrier_mask = [False] * pixel_count
    if lineart_pixels is not None:
        for pixel_index in range(pixel_count):
            if lineart_pixels[(pixel_index * 4) + 3] > FLAT_EDGE_ALPHA_THRESHOLD:
                barrier_mask[pixel_index] = True

    for pixel_index in range(pixel_count):
        source_offset = pixel_index * 4
        alpha = source_pixels[source_offset + 3]
        if alpha <= solid_threshold:
            visited[pixel_index] = True
            continue
        if barrier_mask[pixel_index] or visited[pixel_index]:
            continue

        region_pixels: list[int] = []
        stack = [pixel_index]
        visited[pixel_index] = True
        red_total = 0.0
        green_total = 0.0
        blue_total = 0.0
        alpha_total = 0.0

        while stack:
            current_index = stack.pop()
            region_pixels.append(current_index)
            current_offset = current_index * 4
            current_alpha = source_pixels[current_offset + 3]
            if current_alpha > solid_threshold:
                red_total += source_pixels[current_offset] * current_alpha
                green_total += source_pixels[current_offset + 1] * current_alpha
                blue_total += source_pixels[current_offset + 2] * current_alpha
                alpha_total += current_alpha

            x = current_index % width
            y = current_index // width
            if x > 0:
                neighbor_index = current_index - 1
                neighbor_offset = neighbor_index * 4
                if not visited[neighbor_index] and not barrier_mask[neighbor_index] and source_pixels[neighbor_offset + 3] > solid_threshold:
                    visited[neighbor_index] = True
                    stack.append(neighbor_index)
            if x + 1 < width:
                neighbor_index = current_index + 1
                neighbor_offset = neighbor_index * 4
                if not visited[neighbor_index] and not barrier_mask[neighbor_index] and source_pixels[neighbor_offset + 3] > solid_threshold:
                    visited[neighbor_index] = True
                    stack.append(neighbor_index)
            if y > 0:
                neighbor_index = current_index - width
                neighbor_offset = neighbor_index * 4
                if not visited[neighbor_index] and not barrier_mask[neighbor_index] and source_pixels[neighbor_offset + 3] > solid_threshold:
                    visited[neighbor_index] = True
                    stack.append(neighbor_index)
            if y + 1 < height:
                neighbor_index = current_index + width
                neighbor_offset = neighbor_index * 4
                if not visited[neighbor_index] and not barrier_mask[neighbor_index] and source_pixels[neighbor_offset + 3] > solid_threshold:
                    visited[neighbor_index] = True
                    stack.append(neighbor_index)

        if alpha_total <= 0.0:
            continue

        fill_red = red_total / alpha_total
        fill_green = green_total / alpha_total
        fill_blue = blue_total / alpha_total
        fill_red, fill_green, fill_blue = stylize_flat_fill_color(fill_red, fill_green, fill_blue)
        for region_index in region_pixels:
            region_offset = region_index * 4
            output_pixels[region_offset] = fill_red
            output_pixels[region_offset + 1] = fill_green
            output_pixels[region_offset + 2] = fill_blue
            output_pixels[region_offset + 3] = source_pixels[region_offset + 3]

    return output_pixels


def generate_flat_topdown_from_source(
    source_path: str,
    fill_lineart_path: str,
    outline_lineart_path: str,
    output_path: str,
):
    if not os.path.exists(source_path):
        return

    source_image = bpy.data.images.load(source_path, check_existing=False)
    fill_lineart_image = bpy.data.images.load(fill_lineart_path, check_existing=False) if os.path.exists(fill_lineart_path) else None
    outline_lineart_image = bpy.data.images.load(outline_lineart_path, check_existing=False) if os.path.exists(outline_lineart_path) else None
    try:
        width, height = source_image.size
        if width <= 0 or height <= 0:
            return

        source_pixels = list(source_image.pixels)
        fill_lineart_pixels = list(fill_lineart_image.pixels) if fill_lineart_image is not None else None
        outline_lineart_pixels = list(outline_lineart_image.pixels) if outline_lineart_image is not None else None
        output_pixels = build_flat_region_fill_colors(width, height, source_pixels, fill_lineart_pixels)

        if outline_lineart_pixels is not None:
            for pixel_index in range(0, len(source_pixels), 4):
                line_alpha = outline_lineart_pixels[pixel_index + 3]
                if line_alpha <= FLAT_EDGE_ALPHA_THRESHOLD:
                    continue

                line_strength = clamp01_channel((line_alpha - FLAT_EDGE_ALPHA_THRESHOLD) / (1.0 - FLAT_EDGE_ALPHA_THRESHOLD))
                output_pixels[pixel_index] *= (1.0 - line_strength)
                output_pixels[pixel_index + 1] *= (1.0 - line_strength)
                output_pixels[pixel_index + 2] *= (1.0 - line_strength)
                output_pixels[pixel_index + 3] = max(output_pixels[pixel_index + 3], line_alpha)

        flat_image = bpy.data.images.new(
            name=f"FoxWatchFlat:{os.path.basename(output_path)}",
            width=width,
            height=height,
            alpha=True,
        )
        try:
            flat_image.pixels.foreach_set(output_pixels)
            previous_view_state = set_neutral_view_transform(bpy.context.scene)
            image_settings = bpy.context.scene.render.image_settings
            previous_file_format = getattr(image_settings, "file_format", None)
            previous_color_mode = getattr(image_settings, "color_mode", None)
            previous_quality = getattr(image_settings, "quality", None)
            previous_webp_lossless = getattr(image_settings, "webp_lossless", None)
            set_image_output_format(image_settings, output_path)
            try:
                flat_image.save_render(output_path, scene=bpy.context.scene)
            finally:
                restore_view_transform(bpy.context.scene, previous_view_state)
                if previous_file_format is not None:
                    image_settings.file_format = previous_file_format
                if previous_color_mode is not None:
                    image_settings.color_mode = previous_color_mode
                if previous_quality is not None:
                    image_settings.quality = previous_quality
                if previous_webp_lossless is not None and hasattr(image_settings, "webp_lossless"):
                    image_settings.webp_lossless = previous_webp_lossless
        finally:
            bpy.data.images.remove(flat_image)
    finally:
        bpy.data.images.remove(source_image)
        if fill_lineart_image is not None:
            bpy.data.images.remove(fill_lineart_image)
        if outline_lineart_image is not None:
            bpy.data.images.remove(outline_lineart_image)


def generate_pencil_fallback_from_icon(icon_path: str, fallback_path: str):
    if not os.path.exists(icon_path):
        return

    if os.path.exists(fallback_path):
        os.remove(fallback_path)

    image = bpy.data.images.load(icon_path, check_existing=False)
    try:
        width, height = image.size
        if width <= 0 or height <= 0:
            return

        pixels = list(image.pixels)
        output_pixels = [0.0] * len(pixels)
        for index in range(width * height):
            pixel_index = index * 4
            red = pixels[pixel_index]
            green = pixels[pixel_index + 1]
            blue = pixels[pixel_index + 2]
            alpha = pixels[pixel_index + 3]
            if alpha <= 0.001:
                continue

            luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
            line_cut = clamp01((0.82 - luminance) / 0.6)
            output_alpha = clamp01(alpha * (1.0 - line_cut))
            if output_alpha <= 0.01:
                continue

            output_pixels[pixel_index] = 1.0
            output_pixels[pixel_index + 1] = 1.0
            output_pixels[pixel_index + 2] = 1.0
            output_pixels[pixel_index + 3] = output_alpha

        fallback_image = bpy.data.images.new(
            name=f"FoxWatchPencilFallback:{os.path.basename(fallback_path)}",
            width=width,
            height=height,
            alpha=True,
        )
        try:
            fallback_image.pixels.foreach_set(output_pixels)
            previous_view_state = set_neutral_view_transform(bpy.context.scene)
            image_settings = bpy.context.scene.render.image_settings
            previous_file_format = getattr(image_settings, "file_format", None)
            previous_color_mode = getattr(image_settings, "color_mode", None)
            previous_quality = getattr(image_settings, "quality", None)
            previous_webp_lossless = getattr(image_settings, "webp_lossless", None)
            set_image_output_format(image_settings, fallback_path)
            try:
                fallback_image.save_render(fallback_path, scene=bpy.context.scene)
            finally:
                restore_view_transform(bpy.context.scene, previous_view_state)
                if previous_file_format is not None:
                    image_settings.file_format = previous_file_format
                if previous_color_mode is not None:
                    image_settings.color_mode = previous_color_mode
                if previous_quality is not None:
                    image_settings.quality = previous_quality
                if previous_webp_lossless is not None and hasattr(image_settings, "webp_lossless"):
                    image_settings.webp_lossless = previous_webp_lossless
        finally:
            bpy.data.images.remove(fallback_image)
    finally:
        bpy.data.images.remove(image)


def autocenter_ortho_camera_from_render(camera_object, output_path: str, resolution_x: int, resolution_y: int, tolerance_px: float = 1.5, max_iterations: int = 3):
    last_margins = None

    for _ in range(max_iterations):
        bpy.ops.render.render(write_still=True)
        margins = alpha_margins_from_image_path(output_path)
        last_margins = margins
        if margins is None:
            break

        delta_x = margins["left"] - margins["right"]
        delta_y = margins["top"] - margins["bottom"]
        if abs(delta_x) <= tolerance_px and abs(delta_y) <= tolerance_px:
            break

        aspect_ratio = max(float(resolution_x) / max(float(resolution_y), 1.0), 0.01)
        view_height = float(camera_object.data.ortho_scale)
        view_width = view_height * aspect_ratio
        shift_local_x = (delta_x * 0.5) * (view_width / float(resolution_x))
        shift_local_y = (delta_y * 0.5) * (view_height / float(resolution_y))
        world_offset = camera_object.matrix_world.to_quaternion() @ Vector((shift_local_x, shift_local_y, 0.0))
        camera_object.location += world_offset

    return last_margins


def normalize_allowed_id(value):
    return str(value or "").strip().lower()


def should_render(entry, allowed_ids):
    if not allowed_ids:
        return True

    entry_ids = [entry.get("structureId"), *(entry.get("allowedStructureIds") or [])]
    return any(normalize_allowed_id(value) in allowed_ids for value in entry_ids)


def normalize_asset_type_name(raw_asset_type: str | None) -> str:
    normalized_asset_type = str(raw_asset_type or "").strip().lower()
    if normalized_asset_type in {"item", "items"}:
        return "items"
    if normalized_asset_type in {"vehicle", "vehicles"}:
        return "vehicles"
    return "structures"


def structure_output_directory(base_output_dir: str, asset_type: str, structure_id: str) -> str:
    return os.path.join(base_output_dir, normalize_asset_type_name(asset_type), structure_id)


def ensure_structure_output_directory(base_output_dir: str, asset_type: str, structure_id: str) -> str:
    output_directory = structure_output_directory(base_output_dir, asset_type, structure_id)
    ensure_directory(output_directory)
    return output_directory


def render_file_stem_name(base_name: str, mode: str, scene_variant: str | None, scene_variant_document: dict | None = None) -> str:
    place_variant_after_mode = bool((scene_variant_document or {}).get("placeVariantAfterMode"))
    if not place_variant_after_mode:
        stem_name = base_name if not scene_variant else f"{base_name}.{scene_variant}"
        if mode == "topdown":
            return f"{stem_name}.texture"
        if mode == "flat":
            return f"{stem_name}.texture.flat"
        if mode == "preview":
            return f"{stem_name}.preview"
        if mode == "icon":
            return f"{stem_name}.icon.default"
        raise ValueError(f"Unsupported render mode '{mode}'")

    if mode == "topdown":
        stem_name = f"{base_name}.texture"
    elif mode == "flat":
        stem_name = f"{base_name}.texture.flat"
    elif mode == "preview":
        stem_name = f"{base_name}.preview"
    elif mode == "icon":
        stem_name = f"{base_name}.icon.default"
    else:
        raise ValueError(f"Unsupported render mode '{mode}'")

    if scene_variant:
        return f"{stem_name}.{scene_variant}"

    return stem_name


def render_file_extension(mode: str) -> str:
    if mode in {"preview", "icon"}:
        return ".png"
    return ".webp"


def resolve_render_output_path(base_output_dir: str, asset_type: str, structure_id: str, raw_output_key: str, scene_document: dict, mode: str, scene_variant: str | None) -> str:
    scene_variant_document = resolve_scene_variant_document(scene_document, scene_variant)
    normalized_output_key = str(raw_output_key or "").replace("\\", "/").strip("/")
    typed_output_directory = os.path.join(base_output_dir, normalize_asset_type_name(asset_type))
    asset_root_directory = os.path.normpath(os.path.join(base_output_dir, os.pardir))
    extension = render_file_extension(mode)
    stem = lambda base_name: f"{render_file_stem_name(base_name, mode, scene_variant, scene_variant_document)}{extension}"

    if structure_id == "mods":
        base_name = os.path.basename(normalized_output_key)
        output_directory = os.path.join(asset_root_directory, "shared", "modifications", base_name)
        return os.path.join(output_directory, stem(base_name))

    if structure_id == "packaged-pallets":
        base_name = os.path.basename(normalized_output_key)
        output_directory = os.path.join(asset_root_directory, "shared", "packaging", base_name)
        return os.path.join(output_directory, stem(base_name))

    if normalized_output_key.startswith("components/"):
        base_name = os.path.basename(normalized_output_key)
        output_directory = os.path.join(typed_output_directory, structure_id, "components", base_name)
        return os.path.join(output_directory, stem(base_name))

    if normalized_output_key.startswith("modifications/"):
        base_name = os.path.basename(normalized_output_key)
        output_directory = os.path.join(typed_output_directory, structure_id, "modifications", base_name)
        return os.path.join(output_directory, stem(base_name))

    base_name = os.path.basename(normalized_output_key) or structure_id
    output_directory = os.path.join(typed_output_directory, structure_id)
    return os.path.join(output_directory, stem(base_name))


def preview_variants_for_mode(scene_document, mode):
    if mode != "preview":
        return [None]

    return [resolve_preview_direction(scene_document)]


def render_file_output_key(scene_document: dict, mode: str, preview_variant: str | None, scene_variant: str | None) -> str:
    if mode == "preview":
        return render_output_key(scene_document['render']['outputKey'], mode, None, scene_variant)

    return render_output_key(scene_document['render']['outputKey'], mode, preview_variant, scene_variant)


def should_generate_default_icon(scene_document: dict) -> bool:
    return bool((scene_document.get("render") or {}).get("generateDefaultIcon"))


def resolve_default_icon_output_path(preview_output_path: str) -> str:
    if preview_output_path.lower().endswith(".preview.png"):
        return preview_output_path[:-len(".preview.png")] + ".icon.default.png"

    return preview_output_path.replace(".preview", ".icon.default")


def allowed_modes_for_scene(scene_document: dict, requested_modes: list[str]) -> list[str]:
    configured_modes = scene_document.get("render", {}).get("modes") or []
    if not configured_modes:
        return requested_modes

    configured_mode_set = {str(mode).strip().lower() for mode in configured_modes if str(mode).strip()}
    return [mode for mode in requested_modes if mode in configured_mode_set]


def main():
    args = parse_args()
    args.index = os.path.abspath(args.index)
    args.output_dir = os.path.abspath(args.output_dir)
    if args.public_root:
        args.public_root = os.path.abspath(args.public_root)
    if args.foxwatch_output_root:
        args.foxwatch_output_root = os.path.abspath(args.foxwatch_output_root)
    if args.render_data_root:
        args.render_data_root = os.path.abspath(args.render_data_root)
    remove_default_startup_scene_objects()
    index_document = load_json(args.index)
    index_directory = os.path.dirname(args.index)
    search_roots = normalize_search_roots(args.public_root, args.foxwatch_output_root)
    ensure_directory(args.output_dir)
    if args.purge_existing:
        remove_collections_with_prefix("FoxWatch:")

    modes = args.mode or ["topdown", "preview"]
    rendered = 0
    for entry in index_document.get("scenes", []):
        structure_id = entry["structureId"]
        if not should_render(entry, {normalize_allowed_id(value) for value in args.only}):
            continue

        scene_path = os.path.join(index_directory, entry["outputPath"])
        scene_document = load_json(scene_path)
        asset_type = normalize_asset_type_name(scene_document.get("structure", {}).get("assetType"))
        output_directory = ensure_structure_output_directory(args.output_dir, asset_type, structure_id)
        allowed_scene_variants = {variant_id.lower() for variant_id in args.scene_variant}
        rendered_scene_variant = False
        for scene_variant in scene_variant_ids(scene_document, allowed_scene_variants):
            rendered_scene_variant = True
            collection = import_render_scene(
                scene_document,
                search_roots,
                replace_existing=True,
                scene_variant=scene_variant,
                clip_bounds_mode="shader",
            )
            collection_bounds = collection_world_bounds(collection)
            if args.debug_bounds:
                create_bounds_debug_box(collection, collection_bounds[0], collection_bounds[1])

            for mode in allowed_modes_for_scene(scene_document, modes):
                preview_variants = preview_variants_for_mode(scene_document, mode)
                for preview_variant in preview_variants:
                    render_state = apply_render_mode(
                        scene_document,
                        collection,
                        mode,
                        preview_variant=preview_variant,
                        scene_variant=scene_variant,
                        pixels_per_meter=args.pixels_per_meter,
                        preview_size=args.preview_size,
                        icon_size=args.icon_size,
                        bounds=collection_bounds,
                    )
                    render_state["renderDataRoot"] = args.render_data_root
                    output_key = render_file_output_key(scene_document, mode, preview_variant, scene_variant)
                    output_path = resolve_render_output_path(
                        args.output_dir,
                        asset_type,
                        structure_id,
                        scene_document['render']['outputKey'],
                        scene_document,
                        mode,
                        scene_variant,
                    )
                    ensure_directory(os.path.dirname(output_path))
                    bpy.context.scene.render.filepath = output_path
                    render_margins = None
                    if mode == "flat":
                        source_file = tempfile.NamedTemporaryFile(suffix=".flat-source.webp", delete=False)
                        source_path = source_file.name
                        source_file.close()
                        fill_lineart_file = tempfile.NamedTemporaryFile(suffix=".flat-fill-lines.webp", delete=False)
                        fill_lineart_path = fill_lineart_file.name
                        fill_lineart_file.close()
                        outline_lineart_file = tempfile.NamedTemporaryFile(suffix=".flat-outline-lines.webp", delete=False)
                        outline_lineart_path = outline_lineart_file.name
                        outline_lineart_file.close()
                        try:
                            bpy.context.scene.render.filepath = source_path
                            bpy.ops.render.render(write_still=True)
                            render_flat_lineart_source(fill_lineart_path, FLAT_REGION_LINE_THICKNESS)
                            render_flat_lineart_source(outline_lineart_path, FLAT_FINAL_LINE_THICKNESS)
                            generate_flat_topdown_from_source(source_path, fill_lineart_path, outline_lineart_path, output_path)
                        finally:
                            if os.path.exists(source_path):
                                os.remove(source_path)
                            if os.path.exists(fill_lineart_path):
                                os.remove(fill_lineart_path)
                            if os.path.exists(outline_lineart_path):
                                os.remove(outline_lineart_path)
                    elif mode == "preview" and bpy.context.scene.camera is not None:
                        render_margins = autocenter_ortho_camera_from_render(
                            bpy.context.scene.camera,
                            output_path,
                            render_state["resolution"][0],
                            render_state["resolution"][1],
                        )
                    else:
                        bpy.ops.render.render(write_still=True)
                    apply_readability_grade(
                        output_path,
                        trench_readability_profile(structure_id, output_key, render_state["mode"]),
                    )
                    if mode == "preview" and scene_variant is None and should_generate_default_icon(scene_document):
                        lineart_source_file = tempfile.NamedTemporaryFile(suffix=".icon.default.source.png", delete=False)
                        lineart_source_path = lineart_source_file.name
                        lineart_source_file.close()
                        try:
                            render_fallback_source(lineart_source_path)
                            generate_pencil_fallback_from_icon(
                                lineart_source_path,
                                resolve_default_icon_output_path(output_path),
                            )
                        finally:
                            if os.path.exists(lineart_source_path):
                                os.remove(lineart_source_path)
                    if mode in {"topdown", "flat"}:
                        anchor_projection = (
                            project_world_point_to_render(
                                bpy.context.scene.camera,
                                collection_root_anchor_point(collection),
                                render_state["resolution"][0],
                                render_state["resolution"][1],
                            )
                            if bpy.context.scene.camera is not None
                            else (render_state.get("anchor") or {})
                        )
                        write_render_sidecar(
                            output_path,
                            structure_id,
                            output_key,
                            render_state,
                            args.pixels_per_meter,
                            anchor_projection,
                        )
                    if args.verbose:
                        print(
                            f"Rendered {structure_id}"
                            f"{f' [{scene_variant}]' if scene_variant else ''}"
                            f" ({render_state['mode']}{f':{preview_variant}' if preview_variant else ''}, {render_state['resolution'][0]}x{render_state['resolution'][1]}, {render_state['camera']}, "
                            f"center=({render_state['boundsCenterProjection']['pixelX']:.2f},{render_state['boundsCenterProjection']['pixelY']:.2f}), "
                            f"bounds L={render_state['boundsMargins']['left']:.2f} R={render_state['boundsMargins']['right']:.2f} "
                            f"T={render_state['boundsMargins']['top']:.2f} B={render_state['boundsMargins']['bottom']:.2f}"
                            + (
                                f", alpha L={render_margins['left']:.2f} R={render_margins['right']:.2f} "
                                f"T={render_margins['top']:.2f} B={render_margins['bottom']:.2f}"
                                if render_margins else ''
                            )
                            + ")"
                        )

            remove_collection(collection.name)

        if not rendered_scene_variant:
            continue

        rendered += 1
        if args.limit > 0 and rendered >= args.limit:
            break

    print(f"render_render_scenes: rendered {rendered} structure(s) to {args.output_dir}")


if __name__ == "__main__":
    main()
