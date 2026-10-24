"""Build a self-contained development GLB from a local FoxWatch render bundle.

Run with Blender --background --python this_file -- --foxwatch-root ...
--asset-root ... --scene ... --output ... . Source assets remain untouched.
"""
import argparse
import json
import os
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector


parser = argparse.ArgumentParser()
parser.add_argument("--foxwatch-root", required=True)
parser.add_argument("--asset-root", required=True)
parser.add_argument("--scene", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--temp-dir", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
os.makedirs(args.temp_dir, exist_ok=True)
tempfile.tempdir = args.temp_dir
sys.path.insert(0, os.path.join(args.foxwatch_root, "blender"))
from render_scene_common import collection_world_bounds
from render_scene_graph import import_render_scene

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
with open(args.scene, encoding="utf-8") as source_file:
    document = json.load(source_file)
# Floor clipping belongs to the flat render, not the original 3D geometry.
document["render"]["clipFloor"] = False
document["render"].pop("clipBounds", None)
collection = import_render_scene(document, [args.asset_root])
bpy.context.view_layer.update()
low, high = collection_world_bounds(collection)
dimensions = high - low
center = (low + high) * 0.5

# Bake the authored blueprint placement and center the model's actual bounds.
# The host adapter supplies Y-up -> Z-up and places the center above ground.
meshes = [obj for obj in collection.all_objects if obj.type == "MESH" and not obj.hide_render]
if not meshes:
    raise RuntimeError("The station scene did not resolve any meshes")
for obj in meshes:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(Matrix.Translation(-center) @ world)
    obj.matrix_world = Matrix.Identity(4)
    obj.select_set(True)

# Keep this experiment reasonably small without changing source textures.
for image in bpy.data.images:
    if image.source == "FILE" and max(image.size) > 1024:
        factor = 1024 / max(image.size)
        image.scale(max(1, round(image.size[0] * factor)), max(1, round(image.size[1] * factor)))

os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", use_selection=True,
                          export_yup=True, export_animations=False, export_cameras=False,
                          export_lights=False, export_extras=False, export_tangents=True)
metadata = {
    "sourceScene": os.path.abspath(args.scene),
    "sourceAssetRoot": os.path.abspath(args.asset_root),
    "dimensionsMeters": list(dimensions),
    "sceneDimensions": {"width": dimensions.x * 64, "height": dimensions.z * 64, "depth": dimensions.y * 64},
    "meshCount": len(meshes),
    "triangles": sum(len(obj.data.loop_triangles) for obj in meshes),
    "materials": sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}),
}
with open(args.output + ".json", "w", encoding="utf-8") as metadata_file:
    json.dump(metadata, metadata_file, indent=2)
print(json.dumps(metadata))
