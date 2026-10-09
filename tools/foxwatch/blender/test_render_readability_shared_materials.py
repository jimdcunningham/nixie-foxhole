"""Preserve shared mesh materials across top-down shading and later previews."""
import os
import sys
import bpy

sys.path.insert(0, os.path.dirname(__file__))
import render_scene_common as common
from render_readability import configure_readability, restore_materials

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
common.configure_world_lighting()
common.configure_sun('topdown')
mesh = bpy.data.meshes.new('Shared mesh')
material = bpy.data.materials.new('Original textured material')
mesh.materials.append(material)
collection = bpy.data.collections.new('Instances')
scene.collection.children.link(collection)
for name in ['First', 'Second', 'Third']:
    collection.objects.link(bpy.data.objects.new(name, mesh))
# Import-cache templates share mesh data but are outside the render collection.
template = bpy.data.objects.new('Cached template', mesh)
original_nodes = len(material.node_tree.nodes)
for _ in range(2):
    state = configure_readability(collection)
    assert len(state[1]) == 1, 'Shared slots must reuse one shaded material'
    assert all(original == material for _, original in state[0]), 'Snapshot must precede slot writes'
    replacement_names = [copy.name for copy in state[1].values()]
    restore_materials(state)
    assert all(obj.material_slots[0].material == material for obj in collection.objects), 'Preview materials must survive cleanup'
    assert template.material_slots[0].material == material, 'Cached mesh material must survive cleanup'
    assert len(material.node_tree.nodes) == original_nodes, 'Original shader must remain unchanged'
    assert all(bpy.data.materials.get(name) is None for name in replacement_names), 'Temporary materials must be removed'
print('Shared instance and cached-template materials survive repeated readability passes')
