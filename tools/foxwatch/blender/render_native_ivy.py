"""Static surface branches of the two qualified GrassBlades ivy instances.

Their grayscale atlas supplies leaf cutouts and a two-color foliage ramp. The
PM_Normals sidecar alias describes the inherited snow layer, not these leaves.
Wind, snow and per-instance color variation stay outside the static export.
"""
import bpy
import numpy as np


def is_native_ivy(sidecar):
    normalized = str(sidecar).replace('\\', '/').lower()
    return any(normalized.endswith('/war/content/materials/environment/' + name + '.json')
               for name in ('ivy', 'ivy2'))


def build_native_ivy_material(material, document, search_roots, resolve_texture):
    textures = document['Textures']
    parameters = document['Parameters']
    switches = parameters.get('Switches', {})
    scalars = parameters.get('Scalars', {})
    colors = parameters.get('Colors', {})
    overrides = parameters.get('Properties', {}).get('BasePropertyOverrides', {})
    def image(reference):
        file = resolve_texture(reference, search_roots)
        if not file:
            raise ValueError('Missing native ivy texture: ' + str(reference))
        return bpy.data.images.load(file, check_existing=True)
    atlas = image(textures['basecolor'])
    albedo = atlas
    if switches.get('Use Lerp Color', False):
        first = np.array([colors['Grass Color 1'][c] for c in 'RGB'], dtype=np.float32)
        second = np.array([colors['Grass Color 2'][c] for c in 'RGB'], dtype=np.float32)
        if not np.all(np.isfinite([first, second])):
            raise ValueError('Invalid native ivy colors')
        width, height = atlas.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        atlas.pixels.foreach_get(pixels)
        pixels = pixels.reshape(height, width, 4)
        weight = pixels[...,0:1]
        if atlas.colorspace_settings.name == 'sRGB':
            weight = np.where(weight <= .04045, weight/12.92, ((weight+.055)/1.055)**2.4)
        rgb = first*(1-weight) + second*weight
        rgb = np.where(rgb <= .0031308, 12.92*rgb, 1.055*np.maximum(rgb,0)**(1/2.4)-.055)
        baked = np.concatenate((rgb, pixels[...,3:4]), axis=2).astype(np.float32)
        label = material.name.rsplit('/',1)[-1].replace('.uasset','') + ':foliage-albedo'
        albedo = bpy.data.images.new(label, width=width, height=height, alpha=True)
        albedo.colorspace_settings.name = 'sRGB'
        albedo.pixels.foreach_set(baked.ravel())
        albedo.update()
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    color = nodes.new('ShaderNodeTexImage')
    color.image = albedo
    links.new(color.outputs['Color'], shader.inputs['Base Color'])
    # GrassBlades Use Alpha=false selects the atlas alpha. Materiality is not opacity.
    cutoff = float(overrides.get('OpacityMaskClipValue', .333))
    clip = nodes.new('ShaderNodeMath')
    clip.operation = 'GREATER_THAN'
    clip.inputs[1].default_value = cutoff
    links.new(color.outputs['Alpha'], clip.inputs[0])
    links.new(clip.outputs[0], shader.inputs['Alpha'])
    material.blend_method = 'CLIP'
    material.alpha_threshold = cutoff
    if hasattr(material, 'shadow_method'):
        material.shadow_method = 'CLIP'
    material.use_backface_culling = not bool(overrides.get('TwoSided', True))
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Specular IOR Level'].default_value = float(scalars.get('Spec', .1))
    shader.inputs['Roughness'].default_value = float(scalars.get('Roughness', .95))
    if switches.get('RoughnessMaterial', False):
        if switches.get('UseMaskedColourMult', False):
            raise ValueError('Unsupported native ivy masked materiality branch')
        packed = nodes.new('ShaderNodeTexImage')
        packed.image = image(textures['Materiality'])
        packed.image.colorspace_settings.name = 'Non-Color'
        channels = nodes.new('ShaderNodeSeparateColor')
        links.new(packed.outputs['Color'], channels.inputs[0])
        links.new(channels.outputs['Red'], shader.inputs['Metallic'])
        links.new(channels.outputs['Green'], shader.inputs['Roughness'])
    if switches.get('Use Normals', False):
        normal = nodes.new('ShaderNodeTexImage')
        normal.image = image(textures['Normal Map'])
        normal.image.colorspace_settings.name = 'Non-Color'
        mapped = nodes.new('ShaderNodeNormalMap')
        links.new(normal.outputs['Color'], mapped.inputs['Color'])
        links.new(mapped.outputs['Normal'], shader.inputs['Normal'])
    return material

