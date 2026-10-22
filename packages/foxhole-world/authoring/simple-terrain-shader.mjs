// Use the native direct geometry pass for every surface; never duplicate it into
// the mesh atlas just to compare materials. Coordinates remain native metres.
export function simpleTerrainBit(surface){
 const map=surface==='map',fields={surfaceColor:'vec4<f32>'};
 if(map)Object.assign(fields,{uTerrainMap:'texture_2d<f32>',uTerrainMapSampler:'sampler'});
 const clip='if(vPosition.y<-220.0||abs(vPosition.z)>945.0||abs(vPosition.x)+abs(vPosition.z)*0.577777778>1092.0){discard;}';
 const color=map?'vec3 c=texture(uTerrainMap,vec2((vPosition.x+1092.0)/2184.0,(945.0-vPosition.z)/1890.0)).rgb;albedo=mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));':'albedo=surfaceColor.rgb;';
 const gl=clip+color+'roughness=1.0;';
 const gpu=(clip+(map?'var c=textureSample(uTerrainMap,uTerrainMapSampler,vec2<f32>((vPosition.x+1092.0)/2184.0,(945.0-vPosition.z)/1890.0)).rgb;albedo=mix(c/12.92,pow((c+0.055)/1.055,vec3<f32>(2.4)),step(vec3<f32>(0.04045),c));':'albedo=terrain.surfaceColor.rgb;')+'roughness=1.0;').replaceAll('vPosition','input.vPosition');
 return {name:'simpleLandscapeSurface:'+surface,attributes:{aPosition:'float32x3',aNormal:'float32x3'},interStage:{vPosition:'vec3<f32>',vNormal:'vec3<f32>'},bindings:{terrain:fields},gpu:{fragment:{material:gpu}},gl:{fragment:{material:gl}}};
}
