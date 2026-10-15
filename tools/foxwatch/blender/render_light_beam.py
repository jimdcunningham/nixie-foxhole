"""Static LightBeam surface mask recovered from the UE4.24 base-pass pixel shader.

The cooked editor graph omits its Multiply/Panner nodes. The compiled shader
retains 200*v^5*(1-v)^5 * 50*u^3*(1-u)^3, two NoiseMask green samples,
the Opacity multiplier and unlit Light Color. Publication freezes time at zero.
Native scene-depth fading (500 cm) remains a separate render-parity limitation.
"""


def light_beam_uv_opacity(u, v, opacity=1.0):
    return max(0.0, min(1.0,
        200.0 * max(v, 0.0)**5 * max(1.0-v, 0.0)**5
        * 50.0 * max(u, 0.0)**3 * max(1.0-u, 0.0)**3 * opacity))


def build_light_beam_material(material, noise_image, color, opacity):
    import bpy

    if noise_image is None:
        raise ValueError('LightBeam requires the authored NoiseMask texture')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()

    def math(operation, a, b):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, (float, int)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    uv = nodes.new('ShaderNodeTexCoord')
    xy = nodes.new('ShaderNodeSeparateXYZ')
    links.new(uv.outputs['UV'], xy.inputs[0])
    x = math('MULTIPLY', xy.outputs['X'], math('SUBTRACT', 1.0, xy.outputs['X']))
    y = math('MULTIPLY', xy.outputs['Y'], math('SUBTRACT', 1.0, xy.outputs['Y']))
    x = math('POWER', math('MAXIMUM', x, 0.0), 3.0)
    y = math('POWER', math('MAXIMUM', y, 0.0), 5.0)
    alpha = math('MULTIPLY', math('MULTIPLY', x, y), 10000.0 * opacity)

    noise_image.colorspace_settings.name = 'Non-Color'
    for scale in (1.0, 3.0):
        coordinates = nodes.new('ShaderNodeVectorMath')
        coordinates.operation = 'SCALE'
        coordinates.inputs['Scale'].default_value = scale
        links.new(uv.outputs['UV'], coordinates.inputs[0])
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = noise_image
        texture.extension = 'REPEAT'
        links.new(coordinates.outputs['Vector'], texture.inputs['Vector'])
        channels = nodes.new('ShaderNodeSeparateColor')
        links.new(texture.outputs['Color'], channels.inputs[0])
        alpha = math('MULTIPLY', alpha, channels.outputs['Green'])

    alpha = math('MINIMUM', math('MAXIMUM', alpha, 0.0), 1.0)
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*color[:3], 1.0)
    emission.inputs['Strength'].default_value = 1.0
    mix = nodes.new('ShaderNodeMixShader')
    links.new(alpha, mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(mix.outputs[0], output.inputs['Surface'])
    material.use_backface_culling = False
    material['foxwatch_lightbeam_static_time'] = 0.0
    material['foxwatch_lightbeam_native_depth_fade_cm'] = 500.0
    return material
