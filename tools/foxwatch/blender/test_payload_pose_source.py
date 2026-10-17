"""Integration proof: Blender skin deformation must equal sampled Unreal frames.

Run PayloadPoseTests with FOXWATCH_TEST_POSE_PROOF first, then:
blender -b --python test_payload_pose_source.py -- SCENE_ROOT ASSET_ROOT PROOF_JSON
All inputs are local generated artifacts; no game assets are checked in.
"""
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
from render_scene_graph import import_render_scene
from render_scene_transforms import UNREAL_TO_BLENDER_BASIS as basis

scene_root, asset_root, proof_path = sys.argv[sys.argv.index("--") + 1:]
def local(value):
    q = value["rotation"]
    return Matrix.LocRotScale(Vector(value["position"]), Quaternion((q[3], *q[:3])), Vector(value["scale"]))

for proof in json.loads(Path(proof_path).read_text(encoding="utf8")):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    document = json.loads((Path(scene_root) / proof["id"] / "scene.json").read_text(encoding="utf8"))
    collection = import_render_scene(document, [asset_root])
    bpy.context.view_layer.update()
    # The launcher armature contains every expected source bone. Other armatures
    # (e.g. Squire wheels) must not accidentally receive the launcher's pose.
    names = {bone["name"] for bone in proof["bones"]}
    def nodes(values):
        for value in values:
            yield value
            yield from nodes(value.get("children", []))
    posed_node = next(node for node in nodes(document["scene"]["roots"]) if node.get("pose", {}).get("profile") == "payload-firing-ready")
    armature = next(obj for obj in collection.all_objects if obj.type == "ARMATURE" and obj.parent.name == posed_node["name"] and names <= set(obj.pose.bones.keys()))
    node = armature.parent
    rest, posed = [], []
    worst = 0
    for bone in proof["bones"]:
        parent = bone["parent"]
        rest.append((rest[parent] if parent >= 0 else Matrix.Identity(4)) @ local(bone["rest"]))
        posed.append((posed[parent] if parent >= 0 else Matrix.Identity(4)) @ local(bone["posed"]))
        actual = armature.matrix_world @ armature.pose.bones[bone["name"]].matrix @ armature.data.bones[bone["name"]].matrix_local.inverted() @ armature.matrix_world.inverted()
        expected = node.matrix_world @ basis @ posed[-1] @ rest[-1].inverted() @ basis @ node.matrix_world.inverted()
        error = max(abs(actual[row][col]-expected[row][col]) for row in range(4) for col in range(4))
        worst = max(worst, error)
        assert error < 0.0001, (proof["id"], bone["name"], error)
    print("SOURCE_POSE_VERIFIED", proof["id"], len(rest), "bones", "max_error", worst)
