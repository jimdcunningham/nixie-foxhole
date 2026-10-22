import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferImageSource,Texture} from 'pixi.js';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
import {simpleTerrainBit} from '../authoring/simple-terrain-shader.mjs';
const forbidden=()=>{throw Error('Detailed terrain assets must not load');};
const options={json:forbidden,zipped:forbidden,terrainDescriptor:forbidden,texturePool:{acquire:forbidden},status(){}};
test('plain terrain retains native geometry and requests no terrain textures',async()=>{
 const pass=new LiveTerrainPass(),geometry={bounds3D:{max:{y:100}}};
 await pass.load('test',geometry,{...options,surface:'plain',texture:forbidden});
 assert.equal(pass.current.geometry,geometry);assert.equal(pass.current.surface,'plain');assert.equal(pass.current.sources.length,0);
 pass.updateQuality({position:[0,100,0],height:800,fov:45});assert.equal(pass.textureContext,null);pass.destroy();
});
test('map terrain requests only the existing processed map and borrows its image',async()=>{
 const pass=new LiveTerrainPass(),geometry={},source=new BufferImageSource({resource:new Uint8Array(4),width:1,height:1}),paint=new Texture({source}),calls=[];
 pass.frame=new Float32Array([10,20,32,0]);
 await pass.load('test',geometry,{...options,surface:'map',texture:async id=>{calls.push(id);return paint;}});
 assert.deepEqual(calls,['test/map/terrain.webp']);assert.equal(pass.current.geometry,geometry);assert.equal(pass.current.sources[0],source);
 assert.equal(pass.current.uniforms.uniforms.foxholeFrame,pass.frame);pass.destroy();assert.equal(source.destroyed,false);paint.destroy(true);
});
test('retiring a pending map prevents its late image from attaching',async()=>{
 const pass=new LiveTerrainPass();let resolve;const wait=new Promise(r=>resolve=r),source=new BufferImageSource({resource:new Uint8Array(4),width:1,height:1});
 const load=pass.load('test',{}, {...options,surface:'map',texture:()=>wait});pass.clear();resolve({source});
 await assert.rejects(load,{name:'AbortError'});assert.equal(pass.current,null);source.destroy();
});
test('simple shaders preserve native hex boundaries, north-up UVs and linear color',()=>{
 const plain=simpleTerrainBit('plain'),map=simpleTerrainBit('map');assert.deepEqual(Object.keys(plain.bindings.terrain),['surfaceColor']);
 for(const bit of [plain,map])for(const backend of ['gl','gpu'])assert.match(bit[backend].fragment.material,/945.0/);
 assert.match(map.gl.fragment.material,/945.0-vPosition.z/);assert.match(map.gpu.fragment.material,/945.0-input.vPosition.z/);
 assert.ok(map.gpu.fragment.material.includes('c/12.92'));assert.doesNotMatch(JSON.stringify(map),/uTerrainWeights|uTerrainNormals|terrainNoise/);
});

test('plain terrain draws without native weather uniforms in the shared render pass',async()=>{
 const pass=new LiveTerrainPass(),geometry={},drawn=[];await pass.load('test',geometry,{...options,surface:'plain',texture:forbidden});
 const pipe={renderGeometry:(...args)=>drawn.push(args)},renderer={gl:{},renderPipes:{view3d:pipe},material3d:{compilePassShader:()=>({groups:[],destroy(){}})}};pipe.renderer=renderer;
 let draw;pass.build({addPass:value=>draw=value},{renderer});
 const session={renderer,view3d:{shadowFilter:'pcf',camera:{_cameraData:{bindGroup:{}}}},globalBindGroup:{}};
 assert.equal(draw.condition(),true);draw.render(session);assert.equal(drawn.length,1);assert.equal(drawn[0][0],geometry);draw.destroy();pass.destroy();
});

import {roadShoulderShader} from '../authoring/road-shoulders.mjs';
test('road shoulders share the chosen simple surface without requiring native terrain metadata',()=>{
 for(const mode of ['plain','map']){const shader=roadShoulderShader({region:'test'},true,mode);assert.equal(shader.bits[1].name,'simpleLandscapeSurface:'+mode);assert.ok(shader.bits.some(b=>b.name.includes('nativeGroundExcavation')));assert.doesNotMatch(JSON.stringify(shader.bits),/uTerrainWeights|uTerrainNormals|terrainNoise/);}
});

test('direct terrain pass draws only the chunk geometries accepted by the current camera',async()=>{
 const pass=new LiveTerrainPass(),geometry={},a={},b={},drawn=[],planes=new Float32Array(24);await pass.load('fixture',geometry,{...options,surface:'plain',texture:forbidden});
 let visible=[a,b];pass.geometryLod={getDraws:value=>{assert.equal(value,planes);return visible;}};
 const pipe={renderGeometry:(...args)=>drawn.push(args)},renderer={gl:{},renderPipes:{view3d:pipe},material3d:{compilePassShader:()=>({groups:[],destroy(){}})}};pipe.renderer=renderer;
 let draw;pass.build({addPass:value=>draw=value},{renderer});const session={renderer,view3d:{shadowFilter:'pcf',camera:{_cameraData:{bindGroup:{},frustum:{planesData:planes}}}},globalBindGroup:{}};
 draw.render(session);assert.deepEqual(drawn.map(args=>args[0]),[a,b]);visible=[];draw.render(session);assert.equal(drawn.length,2);draw.destroy();pass.destroy();
});
