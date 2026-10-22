import test from 'node:test';import assert from 'node:assert/strict';
import {restoreNativeFoliageMasks} from '../runtime/native-foliage-masks.mjs';
import native from '../authoring/native-foliage-masks.json' with {type:'json'};
test('legacy bush restoration preserves geometry, UV binding, sampler and unrelated solid material',()=>{
 const rule=native.materials[0],material={name:'BirchBushSmall',pbrMetallicRoughness:{baseColorTexture:{index:0,texCoord:1},roughnessFactor:.94},extras:{foxholeMaterialSource:rule.material,foxholeAlbedoSource:rule.albedo}};
 const doc={materials:[material,{...structuredClone(material),extras:{foxholeMaterialSource:'Other/BirchBushSmall.uasset',foxholeAlbedoSource:rule.albedo}}],images:[{uri:'rgb.png'}],textures:[{source:0,sampler:2}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_1:1},material:0}]}],accessors:[{count:112}]},before=structuredClone(doc);
 const refs=restoreNativeFoliageMasks(doc,'https://fixture.test/foxhole/assets/world/');
 assert.deepEqual(refs,[rule.resource]);assert.equal(doc.images[1].uri,'https://fixture.test/foxhole/assets/world/'+rule.resource.path);
 assert.equal(material.alphaMode,'MASK');assert.equal(material.alphaCutoff,.333);assert.equal(material.pbrMetallicRoughness.baseColorTexture.texCoord,1);assert.equal(doc.textures[1].sampler,2);
 assert.deepEqual(doc.images[0],before.images[0]);assert.deepEqual(doc.materials[1],before.materials[1]);assert.deepEqual(doc.meshes,before.meshes);assert.deepEqual(doc.accessors,before.accessors);
 assert.equal(material.extras.foxholeOpacitySource,rule.source);assert.deepEqual(restoreNativeFoliageMasks(doc,'https://fixture.test/world/'),[],'already-normalized exports retain their own alpha');
});
