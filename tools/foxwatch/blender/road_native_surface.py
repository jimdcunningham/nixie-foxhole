"""Keep native road geometry separate from its repeating material tile."""
import json
import bpy


def extract_surface_mesh(obj):
    """UV0 and native XYZ, without silhouette edits or longitudinal repetition."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers[0]
    minimum = min(v.co.x for v in mesh.vertices)
    maximum = max(v.co.x for v in mesh.vertices)
    result = {'lengthCm': (maximum - minimum) * 100, 'positions': [], 'uvs': [], 'indices': []}
    seen = {}
    for triangle in mesh.loop_triangles:
        for loop_index in triangle.loops:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            texture = uv.data[loop_index].uv
            # Blender Y is up on the top-down image; exported board Y is down.
            # The material tile is rendered with image U along the native road.
            values = ((vertex.x-minimum)*100, -vertex.y*100, vertex.z*100, 1-texture.y, 1-texture.x)
            key = tuple(values)
            if key not in seen:
                seen[key] = len(result['positions']) // 3
                result['positions'].extend(values[:3])
                result['uvs'].extend(values[3:])
            result['indices'].append(seen[key])
    return result


def road_surface_document(collection):
    bpy.context.view_layer.update()
    meshes = [o for o in collection.all_objects if o.type == 'MESH']
    body = next(o for o in meshes if o.name.startswith('FacilityRoad_Test'))
    return {'version': 1, 'verticalOffsetCm': body.matrix_world.translation.z*100,
            'groundHeightCm': 0, 'body': extract_surface_mesh(body)}, body


def render_road_material_tile(collection, body, output_path):
    """Render one opaque UV period, not the native shape or its terrain skirt."""
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    camera = scene.camera
    old_matrix = camera.matrix_world.copy()
    old_scale = camera.data.ortho_scale
    old_resolution = (scene.render.resolution_x, scene.render.resolution_y)
    old_path = scene.render.filepath
    hidden = [(obj, obj.hide_render) for obj in collection.all_objects]
    mesh = bpy.data.meshes.new('road-material-tile')
    # Overscan keeps raster AA off the sampled tile boundary. Source UVs repeat.
    mesh.from_pydata([(-.01,-.01,0),(1.01,-.01,0),(1.01,1.01,0),(-.01,1.01,0)], [], [(0,1,2,3)])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        point = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (point.y, 1-point.x)
    mesh.materials.append(body.data.materials[0])
    plane = bpy.data.objects.new('road-material-tile', mesh)
    collection.objects.link(plane)
    try:
        for obj, _ in hidden: obj.hide_render = True
        camera.location = (.5,.5,10)
        camera.rotation_euler = (0,0,0)
        camera.data.ortho_scale = 1
        scene.render.resolution_x = scene.render.resolution_y = 1024
        scene.render.filepath = output_path
        bpy.ops.render.render(write_still=True)
    finally:
        for obj, visible in hidden: obj.hide_render = visible
        bpy.data.objects.remove(plane, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        camera.matrix_world = old_matrix
        camera.data.ortho_scale = old_scale
        scene.render.resolution_x, scene.render.resolution_y = old_resolution
        scene.render.filepath = old_path


def publish_road_surface(collection, output_path, sidecar_paths):
    document, body = road_surface_document(collection)
    render_road_material_tile(collection, body, output_path)
    for path in sidecar_paths:
        with open(path, encoding='utf8') as handle: sidecar = json.load(handle)
        sidecar['nativeSurface'] = document
        sidecar['materialTextureWidth'] = sidecar['materialTextureHeight'] = 1024
        with open(path, 'w', encoding='utf8') as handle:
            json.dump(sidecar, handle, separators=(',', ':'))
            handle.write('\n')
