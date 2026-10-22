"""Flatten the authored tint graph before glTF's image discovery can mistake its mask for albedo.

Only the MixRGB/SeparateColor graph authored by ensure_sidecar_material is supported.
This changes the spatial export copy, leaving flat-render materials and source images intact.
"""
import bpy
import numpy as np


def prepare_gltf_base_colors(materials):
    changed = 0
    for material in set(materials):
        if not material or not material.use_nodes:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        for shader in list(nodes):
            if shader.type != 'BSDF_PRINCIPLED' or not shader.inputs['Base Color'].is_linked:
                continue
            root = shader.inputs['Base Color'].links[0].from_socket
            if root.node.type != 'MIX_RGB':
                continue
            images = []
            def collect(socket):
                node = socket.node
                if node.type == 'TEX_IMAGE':
                    if node.image and node.image not in images:
                        images.append(node.image)
                else:
                    for input in node.inputs:
                        if input.is_linked:
                            collect(input.links[0].from_socket)
            collect(root)
            if not images:
                raise ValueError('Tint graph has no albedo: ' + material.name)
            # Color1 of the authored tint graph is always the actual albedo.
            albedo_socket = root.node.inputs['Color1'].links[0].from_socket
            if albedo_socket.node.type != 'TEX_IMAGE':
                raise ValueError('Unsupported albedo tint graph: ' + material.name)
            albedo_node = albedo_socket.node
            width, height = albedo_node.image.size
            cache = {}
            def sample(image, extension="REPEAT"):
                key = (image.name, extension)
                if key in cache:
                    return cache[key]
                w, h = image.size
                data = np.empty(w * h * 4, dtype=np.float32)
                image.pixels.foreach_get(data)
                data = data.reshape(h, w, 4)
                if image.colorspace_settings.name == 'sRGB':
                    rgb = data[...,:3]
                    data[...,:3] = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)
                if (w, h) != (width, height):
                    # Image textures use normalized UVs; resample at destination texel centers.
                    x = (np.arange(width) + .5) * w / width - .5
                    y = (np.arange(height) + .5) * h / height - .5
                    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
                    fx, fy = (x-x0)[None,:,None], (y-y0)[:,None,None]
                    if extension == "REPEAT":
                        x0, x1 = x0 % w, (x0+1) % w
                        y0, y1 = y0 % h, (y0+1) % h
                    elif extension == "EXTEND":
                        x0, x1 = np.clip(x0,0,w-1), np.clip(x0+1,0,w-1)
                        y0, y1 = np.clip(y0,0,h-1), np.clip(y0+1,0,h-1)
                    else:
                        raise ValueError("Unsupported spatial tint image extension: " + extension)
                    data = (data[y0[:,None],x0]*(1-fx)+data[y0[:,None],x1]*fx)*(1-fy)+(data[y1[:,None],x0]*(1-fx)+data[y1[:,None],x1]*fx)*fy
                cache[key] = data
                return data
            def input_value(input):
                return evaluate(input.links[0].from_socket) if input.is_linked else np.asarray(input.default_value, dtype=np.float32)
            def evaluate(socket):
                node = socket.node
                if node.type == 'TEX_IMAGE':
                    pixels = sample(node.image, node.extension)
                    return pixels[...,3:4] if socket.name == 'Alpha' else pixels
                if node.type == 'RGB':
                    return np.asarray(socket.default_value, dtype=np.float32)
                if node.type == 'SEPARATE_COLOR' and node.mode == 'RGB':
                    channel = {'Red':0,'Green':1,'Blue':2}[socket.name]
                    return input_value(node.inputs[0])[...,channel:channel+1]
                if node.type == 'MIX_RGB' and node.blend_type in ('MIX','MULTIPLY'):
                    factor = np.clip(input_value(node.inputs['Fac']),0,1)
                    a, b = input_value(node.inputs['Color1']), input_value(node.inputs['Color2'])
                    result = a*(1-factor)+(a*b if node.blend_type == 'MULTIPLY' else b)*factor
                    return np.clip(result,0,1) if node.use_clamp else result
                raise ValueError('Unsupported spatial tint node ' + node.type + ' in ' + material.name)
            result = np.array(evaluate(root), dtype=np.float32, copy=True)
            result[...,3] = sample(albedo_node.image)[...,3]
            if albedo_node.image.colorspace_settings.name == 'sRGB':
                rgb = np.maximum(result[...,:3],0)
                result[...,:3] = np.where(rgb <= .0031308, 12.92*rgb, 1.055*rgb**(1/2.4)-.055)
            image = bpy.data.images.new(material.name + ':spatial-albedo', width=width, height=height, alpha=True)
            image.colorspace_settings.name = albedo_node.image.colorspace_settings.name
            image.pixels.foreach_set(result.ravel())
            image.update()
            baked = nodes.new('ShaderNodeTexImage')
            baked.image = image
            baked.interpolation = albedo_node.interpolation
            baked.extension = albedo_node.extension
            if albedo_node.inputs['Vector'].is_linked:
                links.new(albedo_node.inputs['Vector'].links[0].from_socket, baked.inputs['Vector'])
            links.new(baked.outputs['Color'], shader.inputs['Base Color'])
            changed += 1
    return changed
