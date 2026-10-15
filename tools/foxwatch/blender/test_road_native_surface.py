import sys,os,json,tempfile
import bpy
sys.path.insert(0,os.path.dirname(__file__))
from road_native_surface import extract_surface_mesh,road_surface_document,render_road_material_tile


def fixture(name,cap=False):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(0,-1,.1),(0,1,.1),(4.5,-1,-.4 if cap else .1),(4.5,1,-.4 if cap else .1)],[],[(0,2,1),(1,2,3)])
    uv=mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        vertex=mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv=((vertex.y+1)/2,1-vertex.x/4.5)
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    obj.location.z=.05
    return obj


body=fixture('FacilityRoad_Test');cap=fixture('FacilityRoadEnd',True)
document,chosen=road_surface_document(bpy.context.scene.collection)
assert chosen==body and document['version']==1
assert abs(document['verticalOffsetCm']-5)<1e-5
assert document['groundHeightCm']==0
assert abs(document['body']['lengthCm']-450)<1e-5
assert document['body']['positions'][1:3]==[100,document['body']['positions'][2]]
assert len(document['body']['indices'])==6
assert max(document['body']['uvs'])==1 and min(document['body']['uvs'])==0
assert 'cap' not in document, 'planner surface must not carry end-cap geometry'
assert min(extract_surface_mesh(cap)['positions'][2::3])<0, 'retain below-ground native vertices; renderer owns terrain intersection'
before=json.dumps(extract_surface_mesh(body))
# A uniform material makes camera/border opacity a deterministic integration
# check without depending on copyrighted native images.
material=bpy.data.materials.new('road-fixture');material.use_nodes=True
nodes=material.node_tree.nodes;nodes.clear()
emission=nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(.25,.5,.75,1)
output=nodes.new('ShaderNodeOutputMaterial');material.node_tree.links.new(emission.outputs[0],output.inputs[0])
body.data.materials.append(material)
camera_data=bpy.data.cameras.new('road-fixture-camera');camera_data.type='ORTHO'
camera=bpy.data.objects.new('road-fixture-camera',camera_data);bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera=camera;camera.location=(2,3,10);camera.data.ortho_scale=7
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1
bpy.context.scene.cycles.use_denoising=False;bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.film_transparent=True;bpy.context.scene.render.image_settings.file_format='PNG'
with tempfile.TemporaryDirectory(prefix='native-road-') as directory:
    path=os.path.join(directory,'material.png')
    render_road_material_tile(bpy.context.scene.collection,body,path)
    image=bpy.data.images.load(path,check_existing=False)
    assert tuple(image.size)==(1024,1024)
    assert min(list(image.pixels[:])[3::4])>.999,'material tile must not contain a baked shape or antialiased transparent repeat edges'
    bpy.data.images.remove(image)
assert json.dumps(extract_surface_mesh(body))==before,'native geometry changed during material rendering'
assert tuple(camera.location)==(2,3,10) and camera.data.ortho_scale==7
assert not body.hide_render and not cap.hide_render
print('PASS native road geometry and UVs remain separate from the opaque material tile')
