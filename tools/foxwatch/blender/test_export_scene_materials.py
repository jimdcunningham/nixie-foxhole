import bpy
import numpy as np
import os, sys, json, struct, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from export_scene_materials import prepare_gltf_base_colors
bpy.ops.wm.read_factory_settings(use_empty=True)
for tint in [(1,1,1,1),(.35,.45,.75,1)]:
    material=bpy.data.materials.new('Tint '+str(tint[0])); material.use_nodes=True
    nodes, links=material.node_tree.nodes,material.node_tree.links
    shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    def image(name, rgba, width):
        img=bpy.data.images.new(name,width=width,height=1,alpha=True)
        img.pixels.foreach_set(np.tile(rgba,width).astype(np.float32));img.update()
        node=nodes.new('ShaderNodeTexImage');node.image=img;return node
    albedo=image('Actual Albedo',np.array([.6,.4,.2,.8]),2)
    mask=image('Packed Mask',np.array([0,1,.25,1]),1);mask.image.colorspace_settings.name='Non-Color';mask.image.pixels.foreach_set(np.array([0,1,.25,1],dtype=np.float32));mask.image.update()
    separate=nodes.new('ShaderNodeSeparateColor');links.new(mask.outputs['Color'],separate.inputs[0])
    rgb=nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=tint
    mul=nodes.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs['Fac'].default_value=1
    links.new(albedo.outputs['Color'],mul.inputs['Color1']);links.new(rgb.outputs[0],mul.inputs['Color2'])
    mix=nodes.new('ShaderNodeMixRGB');links.new(separate.outputs['Blue'],mix.inputs['Fac']);links.new(albedo.outputs['Color'],mix.inputs['Color1']);links.new(mul.outputs[0],mix.inputs['Color2']);links.new(mix.outputs[0],shader.inputs['Base Color'])
    links.new(albedo.outputs['Alpha'],shader.inputs['Alpha'])
    original=np.array(albedo.image.pixels[:])
    assert prepare_gltf_base_colors([material,material])==1
    baked=shader.inputs['Base Color'].links[0].from_node
    expected=np.tile([.6,.4,.2,.8],(2,1));linear=((expected[:,:3]+.055)/1.055)**2.4;linear*=.75+.25*np.array(tint[:3]);expected[:,:3]=1.055*linear**(1/2.4)-.055
    np.testing.assert_allclose(np.array(baked.image.pixels[:]).reshape(2,4),expected,atol=.005)
    np.testing.assert_array_equal(np.array(albedo.image.pixels[:]),original)
    assert shader.inputs['Alpha'].links[0].from_node==albedo
    assert prepare_gltf_base_colors([material])==0
    bpy.ops.mesh.primitive_plane_add();obj=bpy.context.object;obj.data.materials.append(material)
    with tempfile.TemporaryDirectory() as folder:
        path=os.path.join(folder,'test.glb');bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True)
        data=open(path,'rb').read();length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length])
        mat=doc['materials'][0];tex=doc['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
        image=doc['images'][tex['source']];assert 'Packed Mask' not in image['name'],doc['images']
        view=doc['bufferViews'][image['bufferView']];png=os.path.join(folder,'albedo.png');start=28+length+view.get('byteOffset',0)
        open(png,'wb').write(data[start:start+view['byteLength']]);decoded=bpy.data.images.load(png,check_existing=False)
        np.testing.assert_allclose(np.array(decoded.pixels[:]).reshape(2,4),expected,atol=.02)
    # Compare the authored shader and flattened image through Blender itself.
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
    scene.render.resolution_x=8;scene.render.resolution_y=8;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='Standard'
    camera_data=bpy.data.cameras.new('camera');camera=bpy.data.objects.new('camera',camera_data);scene.collection.objects.link(camera)
    camera.location=(0,0,2);camera_data.type='ORTHO';camera_data.ortho_scale=1;scene.camera=camera
    emission=nodes.new('ShaderNodeEmission');output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    links.new(emission.outputs[0],output.inputs['Surface'])
    with tempfile.TemporaryDirectory() as folder:
        captures=[]
        for index,socket in enumerate([mix.outputs[0],baked.outputs['Color']]):
            links.new(socket,emission.inputs['Color']);scene.render.filepath=os.path.join(folder,str(index)+'.png')
            bpy.ops.render.render(write_still=True)
            capture=bpy.data.images.load(scene.render.filepath,check_existing=False)
            captures.append(np.array(capture.pixels[:]))
        np.testing.assert_allclose(captures[0],captures[1],atol=.012)
    bpy.data.objects.remove(camera,do_unlink=True)
    bpy.data.objects.remove(obj,do_unlink=True)
# A smaller repeating mask wraps at both edges when resampled at texel centers.
albedo.image.scale(4,1);albedo.image.pixels.foreach_set(np.tile([.6,.4,.2,1],4).astype(np.float32));albedo.image.update()
mask.image.scale(2,1);mask.image.pixels.foreach_set(np.array([0,1,0,1,0,1,1,1],dtype=np.float32));mask.image.update()
links.new(mix.outputs[0],shader.inputs['Base Color'])
assert prepare_gltf_base_colors([material])==1
result=np.array(shader.inputs['Base Color'].links[0].from_node.image.pixels[:]).reshape(4,4)
linear=((np.array([.6,.4,.2])+.055)/1.055)**2.4
factor=np.array([.25,.25,.75,.75])[:,None]
expected=1.055*(linear*(1-factor+factor*np.array(tint[:3])))**(1/2.4)-.055
np.testing.assert_allclose(result[:,:3],expected,atol=.005)
print('Spatial albedo export regressions passed')
