import{PointLight,SpotLight}from'@pixi/3d';import{nightAmount,selectEmitters}from'./night-light-policy.mjs';
export function createLocalNightLights({view,world,readTime,target,layers,controls}){
 const limit=24,points=[],spots=[];for(let i=0;i<limit;i++){const p=new PointLight({label:'Lantern Spill',color:0xffbe77,range:12,visible:false}),s=new SpotLight({label:'Window Spill',color:0xffc782,range:11,coneAngle:78,penumbra:.6,visible:false,castShadow:false});view.root.addChild(p,s);points.push(p);spots.push(s);}
 let previousWorld=null,previous=new Set(),selected=[],lastSelection=-Infinity,lastBlend=-1,lastControl='',report={};
 function update(force=false){const w=world(),c=controls(),time=readTime(),amount=c.enabled&&time.enabled?nightAmount(time.hour)*c.brightness:0,now=performance.now(),key=[c.enabled,c.spill,c.brightness,...Object.values(layers())].join('/');
  if(w!==previousWorld){selected=[];previous.clear();previousWorld=w;lastSelection=-Infinity;lastBlend=-1;}
  if(w?.night&&amount!==lastBlend){for(const [material,strength]of w.night.materials)material.emissive.strength=strength*amount;lastBlend=amount;}
  if(!w?.night||amount<.001||!c.spill){selected=[];previous.clear();lastSelection=-Infinity;}
  else if(force||now-lastSelection>200||key!==lastControl){const camera=view.camera.position,t=target(),visibility=layers();selected=selectEmitters(w.night.emitters,{position:[camera.x,camera.y,camera.z],target:[t.x,t.y,t.z],visible:category=>visibility[category]!==false,project:p=>view.worldToScreen({x:p[0],y:p[1],z:p[2]},undefined,true),width:view.width,height:view.height,previous,limit});previous=new Set(selected);lastSelection=now;}
  for(let i=0;i<limit;i++){const e=selected[i],p=points[i],s=spots[i];p.visible=false;s.visible=false;if(!e)continue;const light=e.kind==='window'?s:p;light.visible=true;light.position.set(...e.position);light.range=e.range;light.intensity=e.intensity*amount;if(e.kind==='window')light.lookAt({x:e.position[0]+e.normal[0]*4,y:e.position[1]+e.normal[1]*4-2,z:e.position[2]+e.normal[2]*4});}
  lastControl=key;report={nightAmount:amount,emissiveMaterials:w?.night?.materials.size||0,sourceEmitters:w?.night?.emitters.length||0,activeLocalLights:selected.length,localLightBudget:limit,spillEnabled:c.spill,enabled:c.enabled,note:'Native glass and bulb surfaces glow region-wide; up to 24 visible nearby lights illuminate native PBR surfaces. Local lights are unshadowed.'};
 }
 return{update,snapshot:()=>report};
}
