"""Default native slot identities survive selected-variant resolution."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import bpy
sys.path.insert(0, os.path.dirname(__file__))
import render_scene_graph as graph


class DefaultBindingTests(unittest.TestCase):
    def resolve(self, overrides, variant):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        collection = bpy.data.collections.new('Binding Test')
        bpy.context.scene.collection.children.link(collection)
        with tempfile.TemporaryDirectory() as directory:
            mesh_path = Path(directory) / 'fixture.glb'
            mesh_path.write_bytes(b'')
            with patch.object(graph, 'resolve_asset_path', return_value=str(mesh_path)), patch.object(graph, 'import_mesh_asset', return_value=[]) as imported:
                graph.instantiate_node({'id':'fixture','name':'fixture','meshId':'mesh','children':[]}, collection, {'mesh':{'sourcePath':'fixture.glb','materialSidecarNameOverridesByVariant':overrides}}, [], {'material_mode':'sidecar','clip_floor':False,'floor_z':0}, variant)
                return imported.call_args.kwargs['material_sidecar_name_overrides']

    def test_default_native_paths_apply_without_selected_variant(self):
        bindings={'0':'War/Content/Materials/Environment/IVy.uasset','1':'War/Content/Materials/Environment/IVy2.uasset'}
        self.assertEqual(self.resolve({'default':bindings}, None), bindings)

    def test_selected_variant_wins_only_its_slots(self):
        self.assertEqual(self.resolve({'default':{'0':'default0','1':'default1'},'C':{'0':'colonial'}}, 'c'), {'0':'colonial','1':'default1'})

    def test_unknown_variant_keeps_defaults(self):
        self.assertEqual(self.resolve({'default':{'0':'native'},'w':{'0':'warden'}}, 'other'), {'0':'native'})

    def test_existing_variant_only_bindings_preserved(self):
        self.assertEqual(self.resolve({'w':{'2':'warden'}}, 'w'), {'2':'warden'})

    def test_existing_unbound_mesh_stays_unbound(self):
        self.assertEqual(self.resolve({}, None), {})


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]], verbosity=2)
