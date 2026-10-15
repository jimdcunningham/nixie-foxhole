"""Run with Blender --background --python-exit-code 1 --python this_file."""
import json
import math
import os
import sys
import unittest
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
from export_scene_lights import collect_blueprint_lights

class LightPlacementTests(unittest.TestCase):
    def test_nested_rotated_fixture_keeps_its_direction_and_visibility_group(self):
        collection=bpy.data.collections.new('fixture-test')
        bpy.context.scene.collection.children.link(collection)
        root=bpy.data.objects.new('fixture-root',None)
        lamp=bpy.data.objects.new('fixture-bulb',None)
        collection.objects.link(root);collection.objects.link(lamp)
        root.location=(2,3,4);root.rotation_euler.z=math.pi/2
        root['foxwatchSpatialGroup']='mod-group'
        lamp.parent=root;lamp.location=(1,0,2)
        lamp['foxwatchBlueprintLight']=json.dumps({'type':'spot','enabled':False})
        bpy.context.view_layer.update()
        rows=collect_blueprint_lights(collection,Vector((1,1,1)))
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['group'],'mod-group')
        self.assertFalse(rows[0]['source']['enabled'])
        for actual,expected in zip(rows[0]['translation'],[1,5,-3]):self.assertAlmostEqual(actual,expected,places=5)
        for actual,expected in zip(rows[0]['direction'],[0,0,-1]):self.assertAlmostEqual(actual,expected,places=5)
        lamp.hide_render=True
        self.assertEqual(collect_blueprint_lights(collection,Vector()),[])

suite=unittest.defaultTestLoader.loadTestsFromTestCase(LightPlacementTests)
if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():raise RuntimeError('Light export tests failed')
