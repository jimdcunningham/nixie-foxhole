"""Freeze render-scene mesh instances without changing shared source geometry."""
import bpy
from mathutils import Matrix


def bake_static_mesh_instances(meshes, center, depsgraph):
    # Snapshot every placement and posed mesh before changing the hierarchy.
    # FoxWatch intentionally shares cached mesh data between repeated objects.
    # In-place transforms would bake every instance into that same datablock.
    snapshots = []
    baked_mesh_count = 0
    for obj in meshes:
        world = obj.matrix_world.copy()
        skeletal = any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
        if skeletal:
            data = bpy.data.meshes.new_from_object(
                obj.evaluated_get(depsgraph), preserve_all_data_layers=True,
                depsgraph=depsgraph)
            baked_mesh_count += 1
        else:
            data = obj.data.copy()
        snapshots.append((obj, world, data, skeletal))

    for obj, world, data, skeletal in snapshots:
        obj.data = data
        if skeletal:
            obj.modifiers.clear()
        obj.parent = None
        obj.data.transform(Matrix.Translation(-center) @ world)
        obj.matrix_world = Matrix.Identity(4)
        obj.select_set(True)
    return baked_mesh_count
