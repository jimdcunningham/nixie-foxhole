"""Shared top-down lighting and geometry-derived contact shading.

Surface framing is untouched. Contact shadows have their own padded frame and
projection metadata, so they never enlarge placement or selection geometry.
"""
import math
import os
import copy
import bpy
from mathutils import Vector
import render_scene_common as common

PROFILE_ID = 'topdown-contact-v2'
SURFACE_DISTANCE = 0.5
SURFACE_STRENGTH = 0.15
CONTACT_DISTANCE = 1.0
CONTACT_STRENGTH = 0.62
SAMPLES = 12
CONTACT_SAMPLES = 6
_floor_bounds = {}


def uses_readability_profile(document, mode):
    return mode == 'topdown' and document.get('structure', {}).get('assetType') in {'structures', 'vehicles'}


def has_contact_shadow(document, mode):
    if not uses_readability_profile(document, mode):
        return False
    render = document.get('render') or {}
    # Repeated terrain and ground/roof layers are receiving surfaces. They do
    # not emit another footprint halo; wall and interior layers still do.
    part = str(render.get('outputKey', '')).split('/')[-1].lower()
    return not render.get('repeatAxis') and not (
        part in {'floor', 'roof'} or part.startswith('dirt')
    )


def shadow_output_path(output_path):
    return output_path.removesuffix('.webp').removesuffix('.texture') + '.shadow.webp'


def _ao(nodes, links, distance, amount, normal=None):
    ao = nodes.new('ShaderNodeAmbientOcclusion')
    ao.inputs['Distance'].default_value = distance
    ao.samples = 32
    if normal is not None:
        ao.inputs['Normal'].default_value = normal
    inverse = nodes.new('ShaderNodeMath')
    inverse.operation = 'SUBTRACT'
    inverse.inputs[0].default_value = 1
    links.new(ao.outputs['AO'], inverse.inputs[1])
    strength = nodes.new('ShaderNodeMath')
    strength.operation = 'MULTIPLY'
    strength.inputs[1].default_value = amount
    links.new(inverse.outputs[0], strength.inputs[0])
    black = nodes.new('ShaderNodeEmission')
    black.inputs['Color'].default_value = (0, 0, 0, 1)
    return strength, black


_cycles_device = None


def configure_cycles_device(scene):
    global _cycles_device
    if _cycles_device is None:
        requested = os.environ.get('FOXWATCH_CYCLES_DEVICE', 'AUTO').strip().upper()
        if requested not in {'AUTO', 'CPU', 'CUDA', 'OPTIX', 'HIP', 'ONEAPI', 'METAL'}:
            raise ValueError('Unsupported FOXWATCH_CYCLES_DEVICE: ' + requested)
        preferences = bpy.context.preferences.addons['cycles'].preferences
        backends = ['CUDA', 'OPTIX', 'HIP', 'ONEAPI', 'METAL'] if requested == 'AUTO' else [requested]
        _cycles_device = 'CPU'
        if requested != 'CPU':
            for backend in backends:
                try:
                    preferences.compute_device_type = backend
                    preferences.refresh_devices()
                    devices = [device for device in preferences.devices if device.type == backend]
                    if not devices:
                        continue
                    for device in preferences.devices:
                        device.use = device.type == backend
                    _cycles_device = 'GPU'
                    print('FoxWatch Cycles device: ' + backend + ' - ' + ', '.join(device.name for device in devices), flush=True)
                    break
                except (TypeError, ValueError, RuntimeError):
                    continue
        if _cycles_device == 'CPU':
            print('FoxWatch Cycles device: CPU' + (' (no supported GPU found)' if requested != 'CPU' else ' (requested)'), flush=True)
    scene.cycles.device = _cycles_device

def configure_readability(collection):
    scene = bpy.context.scene
    background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    sun = bpy.data.objects[common.SUN_NAME]
    lighting = {
        'engine': scene.render.engine,
        'view_transform': scene.view_settings.view_transform,
        'look': scene.view_settings.look,
        'exposure': scene.view_settings.exposure,
        'gamma': scene.view_settings.gamma,
        'world_color': tuple(background.inputs['Color'].default_value),
        'world_strength': background.inputs['Strength'].default_value,
        'sun_energy': sun.data.energy,
        'sun_angle': sun.data.angle,
        'sun_color': tuple(sun.data.color),
        'sun_rotation': tuple(sun.rotation_euler),
    }
    scene.render.engine = 'CYCLES'
    configure_cycles_device(scene)
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.seed = 0
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.8
    scene.view_settings.gamma = 1
    background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (0.050876, 0.050876, 0.050876, 1)
    background.inputs['Strength'].default_value = 2.6
    sun = bpy.data.objects[common.SUN_NAME]
    sun.data.energy = 9
    sun.data.angle = 2.3579402
    sun.data.color = (1, 1, 1)
    sun.rotation_euler = (0, 0, 0)
    # Snapshot every slot before writing: instances share mesh DATA slots, so
    # reading originals while replacing them captures temporary copies.
    originals = [(slot, slot.material) for obj in collection.all_objects
                 if obj.type == 'MESH' for slot in obj.material_slots
                 if slot.material is not None and slot.material.node_tree is not None]
    copies = {}
    for slot, original in originals:
        if original not in copies:
            mat = original.copy()
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            # Shade the opaque BSDF inside any clip/transparency wrappers.
            # Wrapping the material output itself fills foliage cutouts and
            # shader-clipped geometry with the black shading closure.
            for shader in [node for node in nodes if node.type == 'BSDF_PRINCIPLED']:
                destinations = [link.to_socket for link in shader.outputs['BSDF'].links]
                if not destinations:
                    continue
                amount, black = _ao(nodes, links, SURFACE_DISTANCE, SURFACE_STRENGTH)
                transparent = nodes.new('ShaderNodeBsdfTransparent')
                opaque_black = nodes.new('ShaderNodeMixShader')
                alpha = shader.inputs.get('Alpha')
                if alpha is not None and alpha.links:
                    links.new(alpha.links[0].from_socket, opaque_black.inputs[0])
                else:
                    opaque_black.inputs[0].default_value = alpha.default_value if alpha is not None else 1
                links.new(transparent.outputs[0], opaque_black.inputs[1])
                links.new(black.outputs[0], opaque_black.inputs[2])
                mix = nodes.new('ShaderNodeMixShader')
                links.new(amount.outputs[0], mix.inputs[0])
                links.new(shader.outputs['BSDF'], mix.inputs[1])
                links.new(opaque_black.outputs[0], mix.inputs[2])
                for destination in destinations:
                    links.new(mix.outputs[0], destination)
            copies[original] = mat
        slot.material = copies[original]
    return originals, copies, lighting


def restore_materials(state):
    originals, copies, lighting = state
    for slot, original in originals:
        slot.material = original
    for material in copies.values():
        bpy.data.materials.remove(material)
    # Preview/icon passes keep their legacy lighting and Eevee renderer. Restore
    # settings not reset by configure_scene_render (notably color transform and
    # sun angle), as well as the settings the top-down profile changed.
    scene = bpy.context.scene
    scene.render.engine = lighting['engine']
    scene.view_settings.view_transform = lighting['view_transform']
    scene.view_settings.look = lighting['look']
    scene.view_settings.exposure = lighting['exposure']
    scene.view_settings.gamma = lighting['gamma']
    background = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs['Color'].default_value = lighting['world_color']
    background.inputs['Strength'].default_value = lighting['world_strength']
    sun = bpy.data.objects[common.SUN_NAME]
    sun.data.energy = lighting['sun_energy']
    sun.data.angle = lighting['sun_angle']
    sun.data.color = lighting['sun_color']
    sun.rotation_euler = lighting['sun_rotation']
    common._LAST_RENDER_CONFIGURATION = None


def host_floor_bounds(document, scene_path, search_roots):
    host_id = document['structure']['id']
    scene_dir = os.path.dirname(scene_path)
    # Component and modification bundles belong to their nearest asset folder.
    while os.path.basename(scene_dir).lower() != host_id.lower():
        parent = os.path.dirname(scene_dir)
        if parent == scene_dir:
            return None
        scene_dir = parent
    floor_path = os.path.join(scene_dir, 'components', 'floor.scene.json')
    if floor_path not in _floor_bounds:
        if not os.path.isfile(floor_path):
            _floor_bounds[floor_path] = None
        else:
            from render_scene_graph import import_render_scene
            floor_doc = common.load_json(floor_path)
            floor_doc = copy.deepcopy(floor_doc)
            floor_doc['structure']['id'] = 'shadow-receiver-' + host_id
            floor_collection = import_render_scene(floor_doc, search_roots, replace_existing=True, clip_bounds_mode='shader')
            _floor_bounds[floor_path] = common.collection_world_bounds(floor_collection)
            common.remove_collection(floor_collection.name)
    return _floor_bounds[floor_path]


def render_contact_shadow(document, collection, bounds, output_path, render_state, pixels_per_meter, floor_bounds):
    scene = bpy.context.scene
    camera = scene.camera
    saved_samples = scene.cycles.samples
    saved_resolution = (scene.render.resolution_x, scene.render.resolution_y)
    saved_scale = camera.data.ortho_scale
    saved_format = scene.render.image_settings.file_format
    saved_filepath = scene.render.filepath
    pad = math.ceil(CONTACT_DISTANCE * pixels_per_meter)
    width, height = saved_resolution[0] + pad * 2, saved_resolution[1] + pad * 2
    scene.render.resolution_x, scene.render.resolution_y = width, height
    camera.data.ortho_scale = max(width, height) / pixels_per_meter
    cx, cy = camera.location.x, camera.location.y
    x0, x1 = cx - width / (2*pixels_per_meter), cx + width / (2*pixels_per_meter)
    y0, y1 = cy - height / (2*pixels_per_meter), cy + height / (2*pixels_per_meter)
    z = bounds[0].z + 0.002
    if floor_bounds is not None:
        z = floor_bounds[1].z + 0.002
        x0, y0 = max(x0, floor_bounds[0].x), max(y0, floor_bounds[0].y)
        x1, y1 = min(x1, floor_bounds[1].x), min(y1, floor_bounds[1].y)
    mesh = bpy.data.meshes.new('FoxWatchContactReceiver')
    mesh.from_pydata([(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)], [], [(0,1,2,3)] if x1>x0 and y1>y0 else [])
    receiver = bpy.data.objects.new('FoxWatchContactReceiver', mesh)
    scene.collection.objects.link(receiver)
    material = bpy.data.materials.new('FoxWatchContactReceiver')
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    amount, black = _ao(nodes, links, CONTACT_DISTANCE, CONTACT_STRENGTH, (0,0,1))
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(amount.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(black.outputs[0], mix.inputs[2])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(mix.outputs[0], output.inputs['Surface'])
    receiver.data.materials.append(material)
    meshes = [obj for obj in collection.all_objects if obj.type == 'MESH']
    holdouts = [obj.is_holdout for obj in meshes]
    try:
        scene.cycles.samples = CONTACT_SAMPLES
        for obj in meshes:
            obj.is_holdout = True
        scene.render.filepath = shadow_output_path(output_path)
        bpy.context.view_layer.update()
        bpy.ops.render.render(write_still=True)
        roots = [obj for obj in collection.objects if obj.parent is None]
        origin = sum((obj.matrix_world.translation for obj in roots), Vector((0,0,0))) / max(len(roots), 1)
        anchor = common.project_world_point_to_render(camera, origin, width, height)
        render_state['contactShadow'] = {
            'profile': PROFILE_ID, 'file': os.path.basename(scene.render.filepath),
            'width': width, 'height': height,
            'anchorPixelX': anchor['pixelX'], 'anchorPixelY': anchor['pixelY'],
            'offsetX': width/2 - anchor['pixelX'], 'offsetY': height/2 - anchor['pixelY'],
            'receiverZ': z,
        }
    finally:
        scene.cycles.samples = saved_samples
        for obj, holdout in zip(meshes, holdouts):
            obj.is_holdout = holdout
        bpy.data.objects.remove(receiver, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        bpy.data.materials.remove(material)
        scene.render.resolution_x, scene.render.resolution_y = saved_resolution
        camera.data.ortho_scale = saved_scale
        scene.render.image_settings.file_format = saved_format
        scene.render.filepath = saved_filepath
        bpy.context.view_layer.update()
