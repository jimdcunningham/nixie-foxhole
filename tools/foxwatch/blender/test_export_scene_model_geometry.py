"""Run with Blender --background --python-exit-code 1 --python this_file."""
import os
import sys
import unittest
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from export_scene_model_geometry import bake_static_mesh_instances


class StaticModelAssemblyTests(unittest.TestCase):
    def make_mesh(self, name, data=None):
        if data is None:
            data = bpy.data.meshes.new(name)
            data.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 1)], [], [(0, 1, 2)])
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def assert_points_equal(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for left, right in zip(actual, expected):
            self.assertLess((left - right).length, 0.00001)

    def test_repeated_mesh_instances_keep_independent_rotation_and_placement(self):
        first = self.make_mesh('first-pipe')
        second = self.make_mesh('second-pipe', first.data)
        source_data = first.data
        source_points = [vertex.co.copy() for vertex in source_data.vertices]
        first.matrix_world = Matrix.Translation((3, -2, 1)) @ Matrix.Rotation(0.8, 4, 'Z')
        second.matrix_world = Matrix.Translation((-4, 5, 2)) @ Matrix.Rotation(-1.2, 4, 'Z')
        bpy.context.view_layer.update()
        center = Vector((1, -1, 2))
        expected = [[obj.matrix_world @ point - center for point in source_points]
                    for obj in (first, second)]
        self.assertEqual(bake_static_mesh_instances([first, second], center,
            bpy.context.evaluated_depsgraph_get()), 0)
        bpy.context.view_layer.update()
        for obj, points in zip((first, second), expected):
            self.assert_points_equal([obj.matrix_world @ vertex.co for vertex in obj.data.vertices], points)
            self.assertIsNot(obj.data, source_data)
        self.assertIsNot(first.data, second.data)
        self.assert_points_equal([vertex.co for vertex in source_data.vertices], source_points)

    def test_mesh_parent_is_snapshotted_before_it_is_detached(self):
        parent = self.make_mesh('parent')
        child = self.make_mesh('child')
        parent.matrix_world = Matrix.Translation((7, 2, 3)) @ Matrix.Rotation(0.7, 4, 'Z')
        child.parent = parent
        child.matrix_local = Matrix.Translation((2, 4, -1))
        bpy.context.view_layer.update()
        expected = [[obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
                    for obj in (parent, child)]
        bake_static_mesh_instances([parent, child], Vector((0, 0, 0)),
                                  bpy.context.evaluated_depsgraph_get())
        bpy.context.view_layer.update()
        for obj, points in zip((parent, child), expected):
            self.assertIsNone(obj.parent)
            self.assert_points_equal([obj.matrix_world @ vertex.co for vertex in obj.data.vertices], points)

    def test_skeletal_instance_preserves_evaluated_pose(self):
        rig = bpy.data.objects.new('rig', bpy.data.armatures.new('rig'))
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bone = rig.data.edit_bones.new('bone')
        bone.head = (0, 0, 0)
        bone.tail = (0, 0, 1)
        bpy.ops.object.mode_set(mode='OBJECT')
        mesh = self.make_mesh('posed')
        mesh.vertex_groups.new(name='bone').add([0, 1, 2], 1, 'REPLACE')
        modifier = mesh.modifiers.new('rig', 'ARMATURE')
        modifier.object = rig
        rig.pose.bones['bone'].location = (0, 2, 0)
        mesh.matrix_world = Matrix.Translation((4, -2, 1))
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = mesh.evaluated_get(depsgraph)
        center = Vector((1, 2, 3))
        expected = [evaluated.matrix_world @ vertex.co - center for vertex in evaluated.data.vertices]
        self.assertEqual(bake_static_mesh_instances([mesh], center, depsgraph), 1)
        bpy.context.view_layer.update()
        self.assertEqual(len(mesh.modifiers), 0)
        self.assert_points_equal([mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices], expected)


suite = unittest.defaultTestLoader.loadTestsFromTestCase(StaticModelAssemblyTests)
if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
    raise RuntimeError('Static model assembly regression tests failed')
