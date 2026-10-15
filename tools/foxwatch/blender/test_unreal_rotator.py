"""Unreal rotation reference and assembly-station connector regressions.

Run with Blender --background --python-exit-code 1 --python this_file.
"""
import math
import os
import sys
import unittest
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(__file__))
from render_scene_transforms import node_transform, unreal_rotator_degrees_to_blender_matrix
from export_scene_model_geometry import bake_static_mesh_instances

BASIS = Matrix.Diagonal((1.0, -1.0, 1.0, 1.0))

def unreal_reference(rotation):
    # Independent FRotator.Quaternion definition from CUE4Parse/UE4/Core/Math.
    pitch, yaw, roll = [math.radians(value) / 2 for value in rotation]
    sp, cp = math.sin(pitch), math.cos(pitch)
    sy, cy = math.sin(yaw), math.cos(yaw)
    sr, cr = math.sin(roll), math.cos(roll)
    q = Quaternion((cr*cp*cy+sr*sp*sy, cr*sp*sy-sr*cp*cy,
        -cr*sp*cy-sr*cp*sy, cr*cp*sy-sr*sp*cy))
    return BASIS @ q.to_matrix().to_4x4() @ BASIS

class UnrealRotatorTests(unittest.TestCase):
    def assert_matrix(self, actual, expected):
        self.assertLess(max(abs(actual[row][column] - expected[row][column])
                            for row in range(4) for column in range(4)), 0.00001)

    def test_pitch_roll_yaw_and_combined_rotation_match_unreal(self):
        for rotation in [(90, 0, 0), (0, 90, 0), (0, 0, 90), (23, -47, 61),
                         (180, 180, 90), (180, 0, 90), (-37, 211, -19)]:
            with self.subTest(rotation=rotation):
                self.assert_matrix(unreal_rotator_degrees_to_blender_matrix(rotation), unreal_reference(rotation))

    def test_both_assembly_station_sockets_keep_position_and_bake_expected_orientation(self):
        fixtures = [
            ('facilityvehiclefactory1', [-661.803, 353.203, 89.968], [0, 180, 0], [-2.24, 45.348, -6.06], [180, 180, 90]),
            ('facilityvehiclefactory2', [-817.821, 401.44, 88.593], [0, 90, 0], [-0.001, -47.047, -6.802], [180, 0, 90]),
        ]
        for name, parent_location, parent_rotation, location, rotation in fixtures:
            with self.subTest(asset=name):
                parent = bpy.data.objects.new(name, None)
                bpy.context.scene.collection.objects.link(parent)
                parent.matrix_world = node_transform({'unrealLocationCentimeters': parent_location,
                    'unrealRotationDegrees': parent_rotation, 'scale': [1, 1, 1]})
                mesh = bpy.data.meshes.new('socket-reference')
                points = [Vector((0,0,0)), Vector((0,0,1)), Vector((0,1,0))]
                mesh.from_pydata(points, [], [(0,1,2)])
                obj = bpy.data.objects.new('PowerLineConnector', mesh)
                bpy.context.scene.collection.objects.link(obj)
                obj.parent = parent
                obj.matrix_basis = node_transform({'unrealLocationCentimeters': location,
                    'unrealRotationDegrees': rotation, 'scale': [1,1,1]})
                bpy.context.view_layer.update()
                translation = Matrix.Translation((location[0]*.01, -location[1]*.01, location[2]*.01))
                expected = parent.matrix_world @ translation @ unreal_reference(rotation)
                self.assertLess((obj.matrix_world.translation - expected.translation).length, 0.00001)
                center = Vector((1,2,3))
                bake_static_mesh_instances([obj], center, bpy.context.evaluated_depsgraph_get())
                bpy.context.view_layer.update()
                for vertex, point in zip(obj.data.vertices, points):
                    self.assertLess((vertex.co - (expected @ point - center)).length, 0.00001)

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(UnrealRotatorTests))
    if not result.wasSuccessful(): raise SystemExit(1)
    print('Unreal rotator regressions passed')
