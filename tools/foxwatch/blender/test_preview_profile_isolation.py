"""Preview and icon pixels must not depend on a preceding top-down pass."""
import os
import sys
import tempfile
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import render_scene_common as common
from render_readability import configure_readability, restore_materials, uses_readability_profile, has_contact_shadow

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.object
collection = obj.users_collection[0]
material = bpy.data.materials.new('Preview material')
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.3, 0.4, 0.2, 1)
obj.data.materials.append(material)
document = {'structure': {'id': 'test', 'assetType': 'structures'}, 'render': {'outputKey': 'test', 'transparentBackground': True}}
bounds = (Vector((-1,-1,-1)), Vector((1,1,1)))

def render(mode, filename):
    common.apply_render_mode(document, collection, mode, bounds=bounds, preview_size=64, icon_size=64)
    scene = bpy.context.scene
    print('PROFILE', mode, scene.render.engine, scene.view_settings.view_transform, bpy.data.objects[common.SUN_NAME].data.angle)
    scene.render.filepath = filename
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(filename, check_existing=False)
    pixels = list(image.pixels[:])
    bpy.data.images.remove(image)
    return pixels

with tempfile.TemporaryDirectory() as directory:
    baseline = {mode: render(mode, os.path.join(directory, mode + '-baseline.png')) for mode in ('preview', 'icon')}
    common.apply_render_mode(document, collection, 'topdown', bounds=bounds)
    state = configure_readability(collection)
    assert bpy.context.scene.render.engine == 'CYCLES'
    restore_materials(state)
    for mode in ('preview', 'icon'):
        assert not uses_readability_profile(document, mode)
        assert not has_contact_shadow(document, mode)
        pixels = render(mode, os.path.join(directory, mode + '-after.png'))
        delta = max(abs(a-b) for a,b in zip(baseline[mode], pixels))
        print('PIXEL DELTA', mode, delta)
        assert delta < 1e-6, mode + ' inherited top-down lighting'
print('Preview and icon lighting remain identical after top-down rendering')
