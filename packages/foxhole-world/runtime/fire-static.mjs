import {Material3D} from '@pixi/3d';
const profiles=new WeakMap();
// Cooked exports retain texture/palette/power but strip panner speeds and intermediate math.
// This bounded four-channel translation uses conservative motion, not claimed UE parity.
function code(gpu){const v=gpu?'input.vUV':'vUV',v2=gpu?'vec2<f32>':'vec2',v3=gpu?'vec3<f32>':'vec3',v4=gpu?'vec4<f32>':'vec4',decl=(type,name,value)=>gpu?`let ${name} = ${value};`:`${type} ${name} = ${value};`;
 return `${decl(v2,'fireUV',`${v}*material.fireControls.w`)}
 ${decl(v4,'fireMask',`pow(max(${v4}(sampleFireRGB(fract(fireUV+${v2}(0.0,-.07)*material.fireTime)).rgb,sampleFireAlpha(fract(fireUV+${v2}(.015,-.05)*material.fireTime)).r),${v4}(0.0)),${v4}(material.fireControls.x))`)}
 ${decl('float','fireCoverage',`clamp(dot(fireMask,${v4}(.25))*material.fireControls.z,0.0,1.0)`)}
 albedo=${v3}(0.0);fresnelF0=${v3}(0.0);f90=0.0;occlusion=1.0;
 emissive=(material.fire01.rgb*fireMask.r+material.fire02.rgb*fireMask.g+material.fire03.rgb*fireMask.b+material.fire04.rgb*fireMask.a)*material.fireControls.y;
 alpha=fireCoverage;
 `;
}
export const fireStaticBit={name:'foxholeNativeFireStatic',textures:['fireRGB','fireAlpha'],bindings:{material:{fire01:'vec4<f32>',fire02:'vec4<f32>',fire03:'vec4<f32>',fire04:'vec4<f32>',fireControls:'vec4<f32>',fireTime:'f32'}},gl:{fragment:{material:code(false)}},gpu:{fragment:{material:code(true)}}};
export function retainFireStaticMaterials(source,doc){const rows=new Map();for(const [i,m]of (doc.materials||[]).entries()){
 const p=m.extras?.foxholeFireStatic;if(m.extras?.foxholeMaterialFamily!=='fire-static'||m.extras?.foxholeFireStaticVersion!==1||p?.source!==m.extras.foxholeMaterialSource)continue;
 if(!Array.isArray(p.palette)||p.palette.length!==4||p.palette.some(c=>!Array.isArray(c)||c.length!==3||!c.every(v=>Number.isFinite(v)&&v>=0))||!['power','brightness','opacity','tiling'].every(k=>Number.isFinite(p[k])&&p[k]>=0)||p.power===0||p.tiling===0)continue;
 if(source.materials[i])rows.set(source.materials[i],p);
 }profiles.set(source,rows);return source;}
export function createFireStaticMaterial(original,p){
 const material=new Material3D({alphaMode:'blend',doubleSided:true,extraBits:[fireStaticBit]});
 material.textures.fireRGB=original.textures.metallicRoughness;material.textures.fireAlpha=original.textures.occlusion;
 p.palette.forEach((c,i)=>material.data['fire0'+(i+1)]=[...c,1]);material.data.fireControls=[p.power,p.brightness,p.opacity,p.tiling];material.data.fireTime=0;
 return material;
}
export function createFireStaticResolver(create){const pending=new Map();return async source=>{const overrides=new Map();for(const [original,p]of profiles.get(source)||[]){const key=JSON.stringify(p);if(!pending.has(key))pending.set(key,Promise.resolve().then(()=>create(original,p)));overrides.set(original,{material:await pending.get(key)});}return overrides;};}
