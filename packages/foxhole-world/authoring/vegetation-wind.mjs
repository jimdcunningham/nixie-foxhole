import {Material3D} from '@pixi/3d';

export function vegetationWindTransform(gpu,{normal=true,project=true}={}){const m='material.',decl=(name,value)=>gpu?'let '+name+' = '+value+';':'float '+name+' = '+value+';',vec=gpu?'vec3<f32>':'vec3';return [
 decl('fwHeight','clamp((position.y-'+m+'foliageShape.x)/'+m+'foliageShape.y,0.0,1.0)'),
 decl('fwPhase','dot(modelMatrix[3].xyz/'+m+'foliageScale,'+vec+'(0.173,0.119,0.137))'),
 decl('fwTime',m+'foliageUp.w'),
 // Sample a shared horizontal field at each plant anchor, before camera-relative projection.
 // x - speed*t advects both wave bands downwind at 5 metres/second. Strength
 // controls bending, so changing it cannot teleport an already passing front.
 decl('fwFront','dot(modelMatrix[3].xyz/'+m+'foliageScale,'+m+'foliageWind.xyz)-fwTime*5.0'),
 decl('fwBroad','0.5+0.5*sin(fwFront*0.157079633)'),
 decl('fwDetail','0.5+0.5*sin(fwFront*0.369599136+1.3)'),
 decl('fwGust','0.25+0.5*fwBroad*fwBroad+0.25*fwDetail*fwDetail'),
 decl('fwFlutter','sin(fwTime*3.4+fwPhase+position.x*2.1+position.z*1.7)*'+m+'foliageShape.w'),
 (gpu?'let fwOffset = ':'vec3 fwOffset = ')+m+'foliageWind.xyz*'+m+'foliageWind.w*('+m+'foliageShape.z+fwFlutter)*fwGust;',
 'worldPosition = '+(gpu?'vec4<f32>':'vec4')+'(worldPosition.xyz+fwOffset*fwHeight*fwHeight,worldPosition.w);',
 normal?'worldNormal = normalize(worldNormal-'+m+'foliageUp.xyz*dot(worldNormal,fwOffset)*(2.0*fwHeight/('+m+'foliageShape.y*'+m+'foliageScale)));':'',
 project?(gpu?'clipPosition = camera.uViewProjectionMatrix * worldPosition;':'gl_Position = uViewProjectionMatrix * worldPosition;'):'',
 ].join('\n');}
export const vegetationWindBit={name:'foxholeVegetationWind',bindings:{material:{foliageWind:'vec4<f32>',foliageUp:'vec4<f32>',foliageShape:'vec4<f32>',foliageScale:'f32'}},gpu:{vertex:{afterTransform:vegetationWindTransform(true)}},gl:{vertex:{afterTransform:vegetationWindTransform(false)}}};

/** Native Y-up geometry retains its own root; buildings and fallen/dead timber stay rigid. */
export function vegetationWindProfile(prototype,parts){
 if(!['vegetation','trees'].includes(prototype.category)||/dead|fallen|stump|log(?:_|[0-9]|$)/i.test(prototype.path||prototype.name||''))return null;
 const root=Math.max(0,Math.min(...parts.map(p=>p.bounds.min[1]))),height=Math.max(...parts.map(p=>p.bounds.max[1]))-root;
 if(!Number.isFinite(height)||height<.15)return null;
 const tree=prototype.category==='trees';return {root,height,amplitude:Math.min(tree?.45:.22,height*(tree?.018:.10)),flutter:tree?.035:.018};
}
function keys(value){const result=new Set();for(let p=value;p&&p!==Object.prototype;p=Object.getPrototypeOf(p))for(const key of Object.getOwnPropertyNames(p))if(!key.startsWith('_')&&key!=='constructor')result.add(key);return result;}
function cloneMaterial(source){
 const material=new Material3D({extraBits:[...(source._featureBits||[]),...(source._extraBits||[]),vegetationWindBit],alphaMode:source.alphaMode,alphaCutoff:source.alphaCutoff,doubleSided:source.doubleSided,vertexColors:source.vertexColors,flatShading:source.flatShading,fog:source.fog});
 for(const key of keys(source.data)){const v=source.data[key];if(key in material.data&&(typeof v==='number'||ArrayBuffer.isView(v)||Array.isArray(v)))material.data[key]=ArrayBuffer.isView(v)?v.slice():v;}
 for(const key of keys(source.textures))if(source.textures[key]?.source)material.textures[key]=source.textures[key];
 material._passBit=source._passBit;material.state.depthMask=source.state.depthMask;material.state.blendMode=source.state.blendMode;return material;
}
/** One uniform update per resident material profile, never per placed plant or vertex. */
export function createVegetationWind({frame,enabled=true}={}){
 const cache=new Map(),records=new Set(),scale=frame?.scale||1,windVector=new Float32Array([1,0,0,0]),upVector=new Float32Array(frame?[0,0,1,0]:[0,1,0,0]);let disposed=false,currentTime=0,currentWind;
 function updateVectors(){const strength=enabled&&Number.isFinite(currentWind?.strength)?Math.max(0,Math.min(1,currentWind.strength)):0,angle=(Number.isFinite(currentWind?.directionDeg)?currentWind.directionDeg:0)*Math.PI/180;
  windVector[0]=Math.cos(angle);windVector[1]=frame?-Math.sin(angle):0;windVector[2]=frame?0:-Math.sin(angle);windVector[3]=strength;upVector[3]=currentTime;
 }
 function updateRecord(record){record.material.data.foliageWind=windVector;record.material.data.foliageUp=upVector;}

 return {get size(){return records.size;},setEnabled(value){if(enabled===(value!==false))return;enabled=value!==false;updateVectors();for(const r of records)updateRecord(r);},update(time,wind){if(disposed)return;currentTime=Number.isFinite(time)?time:0;currentWind=wind;updateVectors();for(const r of records)updateRecord(r);},
  acquire(prototype,parts){const profile=vegetationWindProfile(prototype,parts);if(!profile)return {parts,release(){}};if(disposed)throw Error('Vegetation wind owner retired');const used=[];
   const animated=parts.map(part=>{if(part.flag)return part;const flutter=/trunk|bark|wood/i.test(part.materialName)?0:profile.flutter,key=[profile.root,profile.height,profile.amplitude,flutter].join(':');let variants=cache.get(part.material);if(!variants)cache.set(part.material,variants=new Map());let record=variants.get(key);
    if(!record){const material=cloneMaterial(part.material);material.data.foliageShape=[profile.root,profile.height,profile.amplitude*scale,flutter*scale];material.data.foliageScale=scale;record={material,refs:0,source:part.material,key};records.add(record);variants.set(key,record);updateRecord(record);}
    record.refs++;used.push(record);return {...part,material:record.material};});let released=false;
   return {parts:animated,release(){if(released)return;released=true;for(const r of used)if(--r.refs===0){cache.get(r.source)?.delete(r.key);if(!cache.get(r.source)?.size)cache.delete(r.source);records.delete(r);r.material.destroy();}}};
  },destroy(){if(disposed)return;disposed=true;for(const r of records)r.material.destroy();records.clear();cache.clear();}
 };
}
