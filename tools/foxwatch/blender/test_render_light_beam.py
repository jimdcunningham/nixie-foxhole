"""Run with Blender --background --factory-startup --python to test actual opacity."""
import os
import sys
import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(__file__))
from render_light_beam import build_light_beam_material

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 256
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 64
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
bpy.ops.object.camera_add(location=(0, 0, 5))
scene.camera = bpy.context.object
scene.camera.data.type = 'ORTHO'
scene.camera.data.ortho_scale = 2
bpy.ops.mesh.primitive_plane_add(size=2)
surface = bpy.context.object
material = bpy.data.materials.new('LightBeamRegression')
surface.data.materials.append(material)
noise = bpy.data.images.new('ControlledNoiseMask', width=1, height=1)
noise.colorspace_settings.name = 'Non-Color'

for green in [1.0, 0.0]:
    noise.pixels[:] = [1.0, green, 1.0, 1.0]
    noise.update()
    noise.pack()
    build_light_beam_material(material, noise, [.14, .14, .14], 1.0)
    bpy.ops.render.render()
    image = bpy.data.images['Render Result']
    # Render Result pixels are exposed after saving/reloading on current Blender builds.
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, 'opacity.exr')
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_mode = 'RGBA'
        image.save_render(path, scene=scene)
        loaded = bpy.data.images.load(path, check_existing=False)
        alpha = list(loaded.pixels)[3::4]
        if green:
            assert .10 < max(alpha) < .21, f'UV mask became opaque: {max(alpha)}'
            assert max(alpha[:64]) < .01, 'UV edge lost its fade'
        else:
            assert max(alpha) < .001, 'NoiseMask must use green, not red or blue'
        bpy.data.images.remove(loaded)
print('LightBeam rendered opacity: PASS (native mask envelope and NoiseMask green channel)')
