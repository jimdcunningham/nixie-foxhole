"""Render a cutout and clipped surface beside an occluder to catch alpha leaks."""
import sys
import os
import tempfile
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import render_scene_common as common
from render_readability import configure_readability, restore_materials

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
common.configure_scene_render(64, 64, True, file_format='PNG')
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
common.configure_sun('topdown')
camera = common.configure_topdown_camera_object(common.TOPDOWN_CAMERA_NAME, Vector((0,0,5)))
camera.data.ortho_scale = 2
camera.data.clip_end = 20
scene.camera = camera
collection = bpy.data.collections.new('OpacityRegression')
scene.collection.children.link(collection)
bpy.ops.mesh.primitive_plane_add(size=2)
surface = bpy.context.object
for parent in list(surface.users_collection):
    parent.objects.unlink(surface)
collection.objects.link(surface)
material = bpy.data.materials.new('CutoutRegression')
nodes, links = material.node_tree.nodes, material.node_tree.links
nodes.clear()
position = nodes.new('ShaderNodeNewGeometry')
separate = nodes.new('ShaderNodeSeparateXYZ')
links.new(position.outputs['Position'], separate.inputs[0])
cutout = nodes.new('ShaderNodeMath')
cutout.operation = 'LESS_THAN'
cutout.inputs[1].default_value = 0
links.new(separate.outputs['X'], cutout.inputs[0])
shader = nodes.new('ShaderNodeBsdfPrincipled')
shader.inputs['Base Color'].default_value = (0.5,0.5,0.5,1)
links.new(cutout.outputs[0], shader.inputs['Alpha'])
transparent = nodes.new('ShaderNodeBsdfTransparent')
clip = nodes.new('ShaderNodeMath')
clip.operation = 'GREATER_THAN'
clip.inputs[1].default_value = -0.5
links.new(separate.outputs['Y'], clip.inputs[0])
outer = nodes.new('ShaderNodeMixShader')
links.new(clip.outputs[0], outer.inputs[0])
links.new(transparent.outputs[0], outer.inputs[1])
links.new(shader.outputs[0], outer.inputs[2])
output = nodes.new('ShaderNodeOutputMaterial')
links.new(outer.outputs[0], output.inputs['Surface'])
surface.data.materials.append(material)
bpy.ops.mesh.primitive_cube_add(size=1.5, location=(0,0,0.8))
occluder = bpy.context.object
occluder.visible_camera = False

def render_alpha(filename):
    scene.render.filepath = filename
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(filename, check_existing=False)
    try:
        return list(image.pixels[:])[3::4]
    finally:
        bpy.data.images.remove(image)

with tempfile.TemporaryDirectory() as directory:
    # Match sampling and lighting; only the material shading changes.
    restore_materials(configure_readability(collection))
    original = render_alpha(os.path.join(directory,'original.png'))
    state = configure_readability(collection)
    shaded = render_alpha(os.path.join(directory,'shaded.png'))
    restore_materials(state)
    assert surface.material_slots[0].material == material, 'Original materials must be restored for other render modes'
    hidden = [index for index, alpha in enumerate(original) if alpha < 0.001]
    assert len(hidden) > 2000, 'Fixture must contain substantial transparent regions'
    assert max(shaded[index] for index in hidden) < 0.001, 'Shading must not fill cutouts or clip-mask regions'
    assert sum(alpha > 0.99 for alpha in shaded) == sum(alpha > 0.99 for alpha in original)
print('Readability shading preserves cutouts, clip masks and original materials')
