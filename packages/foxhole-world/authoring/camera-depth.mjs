// Move the near plane only through empty space in front of the scene. A fixed
// 0.5 m near plane wastes most perspective depth precision in kilometre views.
export function fitNearPlane(position,target,bounds,mode='perspective'){
 if(mode!=='perspective'||!bounds)return .5;
 const forward=target.map((v,i)=>v-position[i]),length=Math.hypot(...forward);if(length<1e-6)return .5;
 if(!Number.isFinite(bounds.minY)||!Number.isFinite(bounds.maxY))return .5;
 const f=forward.map(v=>v/length),y=f[1]>=0?bounds.minY:bounds.maxY;
 // The scene is clipped to this convex hexagonal prism. Using its actual
 // footprint also keeps useful precision beside a diagonal region boundary.
 let nearest=Infinity;
 for(const [x,z]of[[-1092,0],[-546,945],[546,945],[1092,0],[546,-945],[-546,-945]])nearest=Math.min(nearest,(x-position[0])*f[0]+(y-position[1])*f[1]+(z-position[2])*f[2]);
 return Math.max(.5,Math.min(1000,nearest*.25));
}
