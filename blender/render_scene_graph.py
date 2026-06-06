import os

import bpy
from mathutils import Matrix, Vector

from render_scene_common import (
    apply_collection_clip_bounds,
    apply_collection_clip_bounds_baked,
    apply_collection_clip_bounds_shader,
    apply_pose_to_imported_objects,
    collection_by_name,
    ensure_collection,
    ensure_emissive_color_material,
    ensure_parameter_light_material,
    import_mesh_asset,
    remove_collection,
    resolve_scene_variant_document,
    resolve_scene_variant_id,
    resolve_asset_path,
    set_scene_background_transparency,
)
from render_scene_transforms import node_transform, unreal_scene_location_centimeters_to_blender


def compose_attachment_world_matrix(parent_object, parent_bone_name, local_transform):
    pose_bone = parent_object.pose.bones.get(parent_bone_name) if parent_object and parent_object.type == "ARMATURE" else None
    if pose_bone is None:
        return None

    parent_location, parent_rotation, parent_scale = parent_object.matrix_world.decompose()
    local_location, local_rotation, local_scale = local_transform.decompose()
    bone_world_matrix = parent_object.matrix_world @ pose_bone.matrix

    offset = Vector(
        (
            local_location.x * parent_scale.x,
            local_location.y * parent_scale.y,
            local_location.z * parent_scale.z,
        )
    )
    world_location = bone_world_matrix.translation + (parent_rotation.to_matrix() @ offset)
    world_rotation = parent_rotation @ local_rotation
    world_scale = Vector(
        (
            parent_scale.x * local_scale.x,
            parent_scale.y * local_scale.y,
            parent_scale.z * local_scale.z,
        )
    )
    return Matrix.LocRotScale(world_location, world_rotation, world_scale)


def render_settings_from_document(scene_document: dict, scene_variant_document: dict | None = None) -> dict:
    render_settings = scene_document.get("render", {})
    return {
        "clip_floor": render_settings.get("clipFloor", False),
        "floor_z": render_settings.get("floorZ", 0.0),
        "clip_bounds": render_settings.get("clipBounds"),
        "transparent_background": render_settings.get("transparentBackground", True),
        "material_mode": render_settings.get("materialMode"),
        "scene_variant_color_hex": (scene_variant_document or {}).get("colorHex"),
    }


def apply_node_transform(object_handle, node_document, parent_object=None, parent_bone_name=None):
    transform = node_transform(node_document)
    if parent_object is None:
        object_handle.matrix_world = transform
        return

    object_handle.parent = parent_object
    if parent_bone_name:
        attachment_world_matrix = compose_attachment_world_matrix(parent_object, parent_bone_name, transform)
        if attachment_world_matrix is not None:
            object_handle.matrix_parent_inverse = parent_object.matrix_world.inverted()
            object_handle.matrix_world = attachment_world_matrix
            return

    object_handle.matrix_parent_inverse = Matrix.Identity(4)
    object_handle.matrix_local = transform


def create_debug_marker(node_document, collection, parent_object=None):
    marker_size = node_document.get("markerSize")
    if marker_size is None:
        return None

    half = float(marker_size) / 2.0
    mesh = bpy.data.meshes.new(f"{node_document['id']}:marker")
    marker_object = bpy.data.objects.new(f"{node_document['name']}:marker", mesh)
    vertices = [
        (-half, -half, -half),
        (half, -half, -half),
        (half, half, -half),
        (-half, half, -half),
        (-half, -half, half),
        (half, -half, half),
        (half, half, half),
        (-half, half, half),
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

    marker_material = ensure_emissive_color_material(
        f"FoxWatchMarker:{node_document['id']}",
        node_document.get("markerColor") or node_document.get("debugColor") or [1.0, 0.0, 0.0, 1.0],
    )
    mesh.materials.append(marker_material)
    collection.objects.link(marker_object)
    marker_object.hide_render = True
    marker_object.display_type = "WIRE"
    if parent_object is not None:
        marker_object.parent = parent_object
        marker_object.matrix_parent_inverse = Matrix.Identity(4)
        marker_object.matrix_local = Matrix.Identity(4)
    else:
        marker_object.matrix_world = node_transform(node_document)

    print(
        f"Created debug marker for {node_document['id']} size={marker_size} color={node_document.get('markerColor') or node_document.get('debugColor')} location={tuple(marker_object.matrix_world.translation)}"
    )

    return marker_object


def primitive_points_from_document(primitive_document):
    points = []
    points_unit = (primitive_document.get("pointsUnit") or "unreal_centimeters").lower()
    for point in primitive_document.get("points") or []:
        if not point or len(point) < 3:
            continue

        if points_unit == "blender":
            points.append(Vector((float(point[0]), float(point[1]), float(point[2]))))
            continue

        points.append(unreal_scene_location_centimeters_to_blender(point))
    return points


def create_trench_barbed_wire_object(node_document, primitive_document, collection, parent_object):
    points = primitive_points_from_document(primitive_document)
    if len(points) < 2:
        return None

    curve_data = bpy.data.curves.new(f"{node_document['id']}:barbedwire", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = float(primitive_document.get("radius") or 0.015)
    curve_data.bevel_resolution = 3

    for strand_index, z_offset in enumerate((0.0, 0.05)):
        spline = curve_data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point_index, point in enumerate(points):
            wobble = 0.03 if point_index % 2 == strand_index % 2 else -0.03
            spline.points[point_index].co = (
                point.x,
                point.y + wobble,
                point.z + z_offset,
                1.0,
            )

    wire_object = bpy.data.objects.new(f"{node_document['name']}:barbedwire", curve_data)
    curve_data.materials.append(
        ensure_parameter_light_material(
            f"FoxWatchPrimitive:{node_document['id']}:barbedwire",
            primitive_document.get("color") or [0.72, 0.72, 0.72, 1.0],
            opacity=1.0,
            emissive_strength=1.2,
        )
    )
    collection.objects.link(wire_object)
    wire_object.parent = parent_object
    wire_object.matrix_parent_inverse = Matrix.Identity(4)
    wire_object.matrix_local = Matrix.Identity(4)
    return wire_object


def create_trench_berm_object(node_document, primitive_document, collection, parent_object):
    points = primitive_points_from_document(primitive_document)
    if len(points) < 2:
        return None

    berm_width = max(0.12, float(primitive_document.get("width") or 0.36))
    berm_height = max(0.08, float(primitive_document.get("height") or 0.2))
    half_width = berm_width * 0.5

    vertices = []
    faces = []
    for index, point in enumerate(points):
        previous_point = points[index - 1] if index > 0 else points[index]
        next_point = points[index + 1] if index + 1 < len(points) else points[index]
        tangent = next_point - previous_point
        tangent.z = 0.0
        if tangent.length_squared == 0.0:
            tangent = Vector((1.0, 0.0, 0.0))
        tangent.normalize()
        normal = Vector((-tangent.y, tangent.x, 0.0)) * half_width

        vertices.extend(
            [
                (point - normal),
                (point + normal),
                (point + Vector((0.0, 0.0, berm_height))),
            ]
        )

    for index in range(len(points) - 1):
        current = index * 3
        following = (index + 1) * 3
        faces.append((current + 0, following + 0, following + 2, current + 2))
        faces.append((current + 2, following + 2, following + 1, current + 1))
        faces.append((current + 1, following + 1, following + 0, current + 0))

    mesh = bpy.data.meshes.new(f"{node_document['id']}:berm")
    mesh.from_pydata([tuple(vertex) for vertex in vertices], [], faces)
    mesh.update()

    berm_object = bpy.data.objects.new(f"{node_document['name']}:berm", mesh)
    mesh.materials.append(
        ensure_parameter_light_material(
            f"FoxWatchPrimitive:{node_document['id']}:berm",
            primitive_document.get("color") or [0.58, 0.47, 0.31, 1.0],
            opacity=1.0,
            emissive_strength=0.35,
        )
    )
    collection.objects.link(berm_object)
    berm_object.parent = parent_object
    berm_object.matrix_parent_inverse = Matrix.Identity(4)
    berm_object.matrix_local = Matrix.Identity(4)
    return berm_object


def create_primitive_object(node_document, collection, parent_object):
    primitive_document = node_document.get("primitive") or {}
    primitive_type = (primitive_document.get("type") or "").lower()
    if primitive_type == "trench_barbed_wire":
        return create_trench_barbed_wire_object(node_document, primitive_document, collection, parent_object)
    if primitive_type == "trench_berm":
        return create_trench_berm_object(node_document, primitive_document, collection, parent_object)
    return None


def node_matches_scene_variant(node_document, scene_variant):
    variant_ids = node_document.get("variantIds") or []
    if not variant_ids:
        return True
    if not scene_variant:
        return False
    return any((variant_id or "").lower() == scene_variant.lower() for variant_id in variant_ids)


def resolve_node_pose_document(node_document, scene_variant=None):
    pose_variants = node_document.get("poseVariants") or {}
    if scene_variant and pose_variants:
        requested_scene_variant = scene_variant.lower()
        for variant_id, pose_document in pose_variants.items():
            if (variant_id or "").lower() == requested_scene_variant and pose_document:
                return pose_document

    return node_document.get("pose")


def instantiate_node(node_document, collection, mesh_assets_by_id, search_roots, render_settings, scene_variant=None, parent_object=None):
    if not node_matches_scene_variant(node_document, scene_variant):
        return None

    node_object = bpy.data.objects.new(node_document["name"] or node_document["id"], None)
    node_object.empty_display_type = "PLAIN_AXES"
    collection.objects.link(node_object)
    apply_node_transform(node_object, node_document, parent_object, node_document.get("attachBoneName"))
    node_object.hide_render = not node_document.get("visible", True)

    create_debug_marker(node_document, collection, node_object)
    create_primitive_object(node_document, collection, node_object)

    mesh_id = node_document.get("meshId")
    child_parent_object = node_object
    imported_armature = None
    if mesh_id and mesh_id in mesh_assets_by_id:
        mesh_asset = mesh_assets_by_id[mesh_id]
        mesh_path = resolve_asset_path(mesh_asset.get("exportUrl") or mesh_asset.get("sourcePath"), search_roots)
        if mesh_path and os.path.exists(mesh_path):
            debug_color = node_document.get("debugColor")
            if debug_color is not None:
                print(f"Applying debug color {debug_color} to {node_document['id']} from {mesh_path}")
            imported_objects = import_mesh_asset(
                mesh_path,
                collection,
                search_roots,
                node_object,
                material_mode=render_settings["material_mode"],
                debug_color=debug_color,
                scene_variant_color_hex=render_settings.get("scene_variant_color_hex"),
                clip_floor=bool(render_settings["clip_floor"]),
                floor_z=float(render_settings["floor_z"]),
            )
            apply_pose_to_imported_objects(imported_objects, resolve_node_pose_document(node_document, scene_variant))
            imported_armature = next((obj for obj in imported_objects if obj.type == "ARMATURE"), None)
        else:
            print(
                f"Missing mesh asset for {node_document['id']}: {mesh_asset.get('exportUrl') or mesh_asset.get('sourcePath')}"
            )

    for child_document in node_document.get("children", []):
        child_parent_object = imported_armature if imported_armature is not None and child_document.get("attachBoneName") else node_object
        instantiate_node(child_document, collection, mesh_assets_by_id, search_roots, render_settings, scene_variant, child_parent_object)

    return node_object


def import_render_scene(scene_document, search_roots, replace_existing=False, scene_variant=None, clip_bounds_mode: str = "modifier"):
    structure = scene_document["structure"]
    collection_name = f"FoxWatch:{structure['id']}"
    if replace_existing and collection_by_name(collection_name) is not None:
        remove_collection(collection_name)

    collection = ensure_collection(collection_name)
    mesh_assets_by_id = {mesh_asset["id"]: mesh_asset for mesh_asset in scene_document.get("assets", {}).get("meshes", [])}
    resolved_scene_variant = resolve_scene_variant_id(scene_document, scene_variant)
    resolved_scene_variant_document = resolve_scene_variant_document(scene_document, resolved_scene_variant)
    render_settings = render_settings_from_document(scene_document, resolved_scene_variant_document)
    bpy.context.scene["foxwatch_render_settings"] = {
        "clip_floor": render_settings["clip_floor"],
        "floor_z": render_settings["floor_z"],
    }

    set_scene_background_transparency(render_settings["transparent_background"])

    root_objects = []
    for root_document in scene_document.get("scene", {}).get("roots", []):
        instantiated_root = instantiate_node(root_document, collection, mesh_assets_by_id, search_roots, render_settings, resolved_scene_variant)
        if instantiated_root is not None:
            root_objects.append(instantiated_root)

    if clip_bounds_mode == "bake":
        apply_collection_clip_bounds_baked(collection, render_settings.get("clip_bounds"))
    elif clip_bounds_mode == "shader":
        apply_collection_clip_bounds_shader(collection, render_settings.get("clip_bounds"))
    else:
        apply_collection_clip_bounds(collection, render_settings.get("clip_bounds"))

    return collection
