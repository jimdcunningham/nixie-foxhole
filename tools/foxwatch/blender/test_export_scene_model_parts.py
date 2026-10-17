"""Shared source placement regression; run with Blender --background --python-exit-code 1."""
import os
import sys
import unittest
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from export_scene_model_parts import extract_shared_model_parts


class SharedModelPartsTests(unittest.TestCase):
    def setUp(self):
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)

    def test_local_geometry_and_world_placement_are_preserved_for_mirrored_rotated_source(self):
        collection = bpy.context.scene.collection
        source = bpy.data.objects.new("Authored Source", None)
        collection.objects.link(source)
        source.matrix_world = Matrix.Translation((1, -2, 3)) @ Matrix.Rotation(0.7, 4, "Z") @ Matrix.Diagonal((-1, 2, 1, 1))
        source["foxwatchSharedPart"] = {"nodeName": "shared-part-0000", "resourceId": "owner.shared"}
        data = bpy.data.meshes.new("Local Mesh")
        data.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
        mesh = bpy.data.objects.new("Source Mesh", data)
        collection.objects.link(mesh)
        mesh.parent = source
        mesh.matrix_local = Matrix.Translation((0.1, 0.2, 0.3))
        bpy.context.view_layer.update()
        world = mesh.matrix_world.copy()
        center = Vector((4, 5, 6))
        replacements, parts = extract_shared_model_parts([mesh], collection, center)
        bpy.context.view_layer.update()
        placeholder = replacements[mesh]
        for vertex in mesh.data.vertices:
            expected = world @ vertex.co - center
            actual = placeholder.matrix_world @ mesh.matrix_local @ vertex.co
            self.assertLess((actual - expected).length, 0.00001)
        self.assertLess(placeholder.matrix_world.determinant(), 0)
        self.assertEqual(parts, [{"nodeName": "shared-part-0000", "resourceId": "owner.shared"}])
        self.assertEqual(tuple(data.vertices[1].co), (1, 0, 0))

    def test_evaluated_sources_fail_before_geometry_is_removed(self):
        collection = bpy.context.scene.collection
        source = bpy.data.objects.new("Source", None)
        collection.objects.link(source)
        source["foxwatchSharedPart"] = {"nodeName": "part", "resourceId": "owner.part"}
        mesh = bpy.data.objects.new("Mesh", bpy.data.meshes.new("Mesh"))
        collection.objects.link(mesh)
        mesh.parent = source
        mesh.modifiers.new("Pose", "ARMATURE")
        with self.assertRaisesRegex(RuntimeError, "modifiers"):
            extract_shared_model_parts([mesh], collection, Vector((0, 0, 0)))


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SharedModelPartsTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
