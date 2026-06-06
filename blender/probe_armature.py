import argparse
import os
import sys

import bpy


def parse_args():
    raw_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--mesh", required=True, help="Absolute path to the GLB to inspect")
    return parser.parse_args(raw_args)


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
        print(f"OBJECT {obj.name} type={obj.type} parent={parent_name}")
        if obj.type == "ARMATURE":
            print(f"ARMATURE {obj.name} bones={len(obj.data.bones)}")
            for bone in obj.data.bones:
                parent_bone = bone.parent.name if bone.parent is not None else "<none>"
                print(f"BONE {bone.name} parent={parent_bone} head={tuple(round(value, 4) for value in bone.head_local)} tail={tuple(round(value, 4) for value in bone.tail_local)}")


if __name__ == "__main__":
    main()