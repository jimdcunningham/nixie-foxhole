import argparse
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--mesh", required=True, help="Absolute path to the GLB to inspect")
    return parser.parse_args(raw_args)


def object_world_bounds(obj):
    if obj.type != "MESH":
        return None

    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
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


def main():
    args = parse_args()
    mesh_path = os.path.abspath(args.mesh)
    if not os.path.exists(mesh_path):
        raise FileNotFoundError(mesh_path)

    existing_names = {obj.name for obj in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=mesh_path)
    imported_objects = [obj for obj in bpy.data.objects if obj.name not in existing_names]

    print(f"Imported {len(imported_objects)} objects from {mesh_path}")
    for obj in imported_objects:
        parent_name = obj.parent.name if obj.parent is not None else "<none>"
        print(
            f"OBJECT {obj.name} type={obj.type} parent={parent_name} "
            f"location={tuple(round(value, 4) for value in obj.location)} "
            f"rotation={tuple(round(value, 4) for value in obj.rotation_euler)} "
            f"scale={tuple(round(value, 4) for value in obj.scale)}"
        )

        bounds = object_world_bounds(obj)
        if bounds is not None:
            min_corner, max_corner = bounds
            print(
                f"BOUNDS {obj.name} min={tuple(round(value, 4) for value in min_corner)} "
                f"max={tuple(round(value, 4) for value in max_corner)}"
            )

        if obj.type == "MESH":
            print(f"MATERIALS {obj.name} slots={len(obj.material_slots)}")
            for slot in obj.material_slots:
                material = slot.material
                material_name = material.name if material is not None else "<none>"
                blend_method = getattr(material, "blend_method", "<unknown>") if material is not None else "<none>"
                print(f"MATERIAL {obj.name} name={material_name} blend={blend_method}")


if __name__ == "__main__":
    main()