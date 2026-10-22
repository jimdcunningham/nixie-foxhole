import {worldShadowBit,shadowAppearanceId} from './shadow-appearance.mjs';
import {simpleTerrainBit} from './simple-terrain-shader.mjs';
import {compileNativeTerrainShader,nativeTerrainGlobalGroup} from './native-terrain-bindings.mjs';
import {terrainExcavationBit} from './terrain-excavation-mask.mjs';
import {shoulderChunk} from './road-shoulder-geometry.mjs';
import {framedMaterialBits,framedTerrainTemplate} from '../runtime/spatial-frame.mjs';
import {BufferImageSource,UniformGroup,BindGroup,State,CubeTexture} from 'pixi.js';
import {Geometry3D,Pass3D,RenderPass,getCameraData,pbrLightingBit,iblBit,envSourceCubeBit,envSourceHemisphereBit,envSourceDefaultBit,shadowBitsGpu,shadowBitsGl,acesToneMappingBit} from '@pixi/3d';
import {liveTerrainBit,liveTerrainTemplate} from './live-terrain-shader.mjs';

const maskGL=`
vec2 shoulderUV=((vPosition.xz-vec2(-1092.0,-945.0))/.5+vec2(.5))/vec2(4369.0,3781.0);
float shoulderDistance=texture(uRoadEdgeField,shoulderUV).r*4.0;
float shoulderNoise=sin(vPosition.x*2.31+sin(vPosition.z*1.51))*.11+sin(vPosition.z*5.17+vPosition.x*3.1)*.045;
alpha=(1.0-smoothstep(.2,edgeParams.x,shoulderDistance+shoulderNoise))*(1.0-smoothstep(.65,1.25,vRoadHeight));
if(alpha<.003){discard;}
`;
const maskGPU=maskGL.replaceAll('vPosition','input.vPosition').replaceAll('vRoadHeight','input.vRoadHeight').replaceAll('edgeParams','roadEdges.edgeParams').replaceAll('texture(uRoadEdgeField,','textureSample(uRoadEdgeField,uRoadEdgeSampler,').replace(/vec2 (\w+)=/g,'let $1=').replace(/float (\w+)=/g,'let $1=').replaceAll('vec2(','vec2<f32>(').replace(/(?<![\w\d])(\.\d+)/g,'0$1');
const maskBit={name:'nativeRoadShoulderMask',attributes:{aUV:'float32x2'},interStage:{vRoadHeight:'f32'},bindings:{roadEdges:{edgeParams:'vec4<f32>',uRoadEdgeField:'texture_2d<f32>',uRoadEdgeSampler:'sampler'}},gpu:{fragment:{material:maskGPU}},gl:{fragment:{material:maskGL}}};
const template={bindGroups:[...liveTerrainTemplate.bindGroups,'roadEdges'],gpu:liveTerrainTemplate.gpu.replace('out.vNormal=input.aNormal;','out.vNormal=input.aNormal;out.vRoadHeight=input.aUV.x;').replace('vec4<f32>(finalColor,1.0)','vec4<f32>(finalColor*alpha,alpha)'),gl:{vertex:liveTerrainTemplate.gl.vertex.replace('vNormal=aNormal;','vNormal=aNormal;vRoadHeight=aUV.x;'),fragment:liveTerrainTemplate.gl.fragment.replace('vec4(finalColor,1.0)','vec4(finalColor*alpha,alpha)')}};

// Share the road-edge group: WebGPU's portable limit is four groups.
export function roadShoulderShader(meta,excavation,surface='native'){return {template,bits:[maskBit,surface==='plain'||surface==='map'?simpleTerrainBit(surface):liveTerrainBit(meta),...(excavation?[terrainExcavationBit('roadEdges')]:[])]};}

class RoadShoulderDraw extends RenderPass{
 constructor(renderer,owner){super({renderer,name:'native-road-shoulders'});this.owner=owner;this.shader=null;this.key='';this.state=new State();this.state.depthTest=true;this.state.depthMask=true;this.state.culling=false;this.state.blendMode='normal';this.state.blend=true;}
 setup(b){b.writeColor(b.targetColor);b.writeDepth(b.targetDepth);}
 condition(){const o=this.owner;return o.visible&&o.geometry&&o.group&&o.terrainPass.current?.geometry;}
 render(session){const o=this.owner,current=o.terrainPass.current;if(!o.visible||!o.geometry||!o.geometry.attributes||!o.group||!current?.geometry)return;const gl='gl' in session.renderer,env=session.view3d.environment instanceof CubeTexture?'cube':session.view3d.environment?'hemisphere':'none',filter=session.view3d.shadowFilter||'pcf',key=shadowAppearanceId(session.view3d)+current.meta.region+env+filter+(current.surface||'native')+o.terrainPass.generation;
  if(!this.shader||this.key!==key){this.shader?.destroy();const shadows=(gl?shadowBitsGl:shadowBitsGpu)[filter]||(gl?shadowBitsGl:shadowBitsGpu).pcf;const {template:base,bits}=roadShoulderShader(current.meta,o.terrainPass.excavationMask,current.surface);this.shader=compileNativeTerrainShader(this.pipe.renderer,[...(o.terrainPass.frame?framedMaterialBits(bits,'terrain'):bits),worldShadowBit(shadows,session.view3d),env==='cube'?envSourceCubeBit:env==='hemisphere'?envSourceHemisphereBit:envSourceDefaultBit,iblBit,worldShadowBit(pbrLightingBit,session.view3d),acesToneMappingBit],o.terrainPass.frame?framedTerrainTemplate(base):base);this.key=key;}
  this.shader.groups[0]=gl?session.globalBindGroup:(this.globalGroup=nativeTerrainGlobalGroup(session,this.globalGroup));this.shader.groups[1]=getCameraData(session.view3d.camera).bindGroup;this.shader.groups[2]=current.group;this.shader.groups[3]=o.group;this.pipe.renderGeometry(o.geometry,this.shader,this.state);
 }
 destroy(){this.shader?.destroy();this.shader=null;this.globalGroup?.destroy();this.globalGroup=null;}
}

export class RoadShoulderPass extends Pass3D{
 constructor({terrainPass,geo,release}){super();this.stage='afterOpaque';this.terrainPass=terrainPass;this.geo=geo;this.release=release;this.visible=true;this.geometry=null;this.group=null;this.source=null;this.summary=null;}
 build(graph,io){graph.addPass(new RoadShoulderDraw(io.renderer,this));}
 clear(){if(this.geometry)this.release(this.geometry);this.geometry=null;this.group?.destroy();this.group=null;this.source?.destroy();this.source=null;this.parts=[];this.field=null;}
 destroy(){this.clear();}
 async prepare({region,json,zipped,terrain}){this.clear();const start=performance.now(),meta=await json(`${region}/world-fixes/road-shoulders/field.json`),field=new Uint8Array(await zipped(`${region}/world-fixes/road-shoulders/distance.bin.gz`));if(field.length!==meta.width*meta.height)throw Error('Invalid shoulder distance field');this.meta=meta;this.field=field;this.terrain=terrain;this.started=start;this.summary={region,sourceTriangles:0,overlayTriangles:0,vertices:0,addedTextureBytes:field.byteLength,downloadBytes:meta.compressedBytes,fieldStepMetres:meta.step,fadeWidthMetres:1.65,method:meta.method};this.source=new BufferImageSource({resource:field,width:meta.width,height:meta.height,format:'r8unorm',alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:false,scaleMode:'linear',addressMode:'clamp-to-edge'});const excavation=this.terrainPass.excavationMask;this.uniforms=new UniformGroup({edgeParams:{value:new Float32Array([1.65,0,0,0]),type:'vec4<f32>'},...(excavation?{excavationInfo:{value:excavation.info,type:'vec4<f32>'}}:{})});this.group=new BindGroup({0:this.uniforms,1:this.source,2:this.source.style,...(excavation?{3:excavation.source}:{})});}
 distance(x,z){const m=this.meta,gx=(x-m.minX)/m.step,gz=(z-m.minZ)/m.step,ix=Math.floor(gx),iz=Math.floor(gz);if(ix<0||iz<0||ix>=m.width-1||iz>=m.height-1)return 0;const fx=gx-ix,fz=gz-iz,i=iz*m.width+ix,d=this.field;return ((d[i]*(1-fx)+d[i+1]*fx)*(1-fz)+(d[i+m.width]*(1-fx)+d[i+m.width+1]*fx)*fz)/255*m.range;}
 addChunk({p,indices}){const begin=performance.now();this.summary.sourceTriangles+=indices.length/3;const part=shoulderChunk({p,indices,distance:(x,z)=>this.distance(x,z),sample:this.terrain});if(part)this.parts.push(part);this.summary.assemblyCpuMs=(this.summary.assemblyCpuMs||0)+performance.now()-begin;return part;}

 finish(){let vertices=0,indexCount=0;for(const p of this.parts){vertices+=p.p.length/3;indexCount+=p.ix.length;}const p=new Float32Array(vertices*3),n=new Float32Array(p.length),uv=new Float32Array(vertices*2),ix=new Uint32Array(indexCount);let vo=0,io=0;for(const part of this.parts){p.set(part.p,vo*3);n.set(part.n,vo*3);uv.set(part.uv,vo*2);for(let k=0;k<part.ix.length;k++)ix[io+k]=part.ix[k]+vo;vo+=part.p.length/3;io+=part.ix.length;}this.parts=[];this.field=null;this.geometry=this.geo(new Geometry3D({positions:p,normals:n,uvs:uv,indices:ix,quantizeNormals:false}));this.summary.vertices=vertices;this.summary.overlayTriangles=indexCount/3;this.summary.totalPrepareMs=performance.now()-this.started;}
}
