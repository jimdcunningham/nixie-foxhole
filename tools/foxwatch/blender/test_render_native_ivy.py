import json, os, sys, tempfile, struct
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from render_scene_common import ensure_sidecar_material
from render_native_ivy import is_native_ivy
bpy.ops.wm.read_factory_settings(use_empty=True)
assert is_native_ivy('root/War/Content/Materials/Environment/IVy.json')
assert is_native_ivy('root/War/Content/Materials/Environment/IVy2.json')
assert not is_native_ivy('root/War/Content/Materials/Environment/Props/Ivy.json')
assert not is_native_ivy('root/Other/IVy.json')
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder)
 def texture(name, pixels, color_space='sRGB'):
  path=root/'War/Content/Textures'/name;path.parent.mkdir(parents=True,exist_ok=True)
  image=bpy.data.images.new(name,width=2,height=2,alpha=True)
  image.colorspace_settings.name=color_space;image.pixels.foreach_set(np.array(pixels,dtype=np.float32).ravel());image.update()
  image.filepath_raw=str(path.with_suffix('.png'));image.file_format='PNG';image.save()
  return 'War/Content/Textures/'+name+'.'+name
 atlas=texture('Atlas',[[0,0,0,0],[.25,.25,.25,1],[.5,.5,.5,1],[1,1,1,1]])
 packed=texture('Materiality',[[1,1,1,1]]*4,'Non-Color')
 normal=texture('LeafNormal',[[.5,.5,1,1]]*4,'Non-Color')
 for index in [1,2]:
  colors={'Grass Color 1':{'R':.05,'G':.09,'B':.01},'Grass Color 2':{'R':.10,'G':.15,'B':.02}}
  document={'Textures':{'basecolor':atlas,'PM_Diffuse':atlas,'Materiality':packed,'Normal Map':normal,'PM_Normals':'Winter/Snow.Missing'},'Parameters':{'Colors':colors,'Scalars':{'Spec':.1,'Roughness':.8},'Switches':{'Use Lerp Color':True,'RoughnessMaterial':index==2},'Properties':{'BasePropertyOverrides':{'BlendMode':'BLEND_Masked','OpacityMaskClipValue':.333,'TwoSided':True}}}}
  sidecar=root/'War/Content/Materials/Environment'/('IVy'+('2' if index==2 else '')+'.json');sidecar.parent.mkdir(parents=True,exist_ok=True);sidecar.write_text(json.dumps(document))
  material=ensure_sidecar_material(sidecar.stem,str(sidecar),[str(root)])
  nodes=material.node_tree.nodes;shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
  color=shader.inputs['Base Color'].links[0].from_node
  pixels=np.array(color.image.pixels[:]).reshape(4,4)
  assert np.all(pixels[:,1]>pixels[:,0]) and np.all(pixels[:,0]>pixels[:,2]),pixels
  np.testing.assert_allclose(pixels[:,3],[0,1,1,1],atol=.005)
  opacity=shader.inputs['Alpha'].links[0].from_node
  assert opacity.operation=='GREATER_THAN' and opacity.inputs[0].links[0].from_node==color
  assert not shader.inputs['Normal'].is_linked,'Inherited snow normal must not render'
  assert abs(shader.inputs['Specular IOR Level'].default_value-.1)<.0001
  if index==1:
   assert not shader.inputs['Roughness'].is_linked
   assert abs(shader.inputs['Roughness'].default_value-.8)<.0001
   assert not shader.inputs['Metallic'].is_linked
  else:
   assert shader.inputs['Roughness'].links[0].from_socket.name=='Green'
   assert shader.inputs['Metallic'].links[0].from_socket.name=='Red'
  bpy.ops.mesh.primitive_plane_add();obj=bpy.context.object;obj.data.materials.append(material)
  output=root/('ivy'+str(index)+'.glb');bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True)
  binary=output.read_bytes();length=struct.unpack_from('<I',binary,12)[0];doc=json.loads(binary[20:20+length]);mat=doc['materials'][0]
  assert mat['alphaMode']=='MASK' and mat['doubleSided'] and 'normalTexture' not in mat
  assert abs(mat['alphaCutoff']-.333)<.0001
  image=doc['images'][doc['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']];view=doc['bufferViews'][image['bufferView']]
  png=root/('exported'+str(index)+'.png');start=28+length+view.get('byteOffset',0);png.write_bytes(binary[start:start+view['byteLength']]);decoded=bpy.data.images.load(str(png),check_existing=False)
  rgba=np.array(decoded.pixels[:]).reshape(4,4)
  np.testing.assert_allclose(rgba[:,3],[0,1,1,1],atol=.005)
  assert np.all(rgba[:,1]>rgba[:,0]),rgba
  bpy.data.objects.remove(obj,do_unlink=True)
 # The explicit native leaf normal branch remains available when authored.
 document['Parameters']['Switches']['Use Normals']=True;sidecar.write_text(json.dumps(document))
 material=ensure_sidecar_material('Native Ivy Normals',str(sidecar),[str(root)])
 shader=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 normal_map=shader.inputs['Normal'].links[0].from_node
 assert normal_map.inputs['Color'].links[0].from_node.image.name.startswith('LeafNormal')
print('Native ivy material regressions passed')
