// A bounded CPU-built Voronoi distance field keeps GPU cost independent of the
// number of towns. It is rebuilt only when territory/style data changes.
export const MAP_OVERLAY_SIZE=512;
export function planningTerritories(state,now=Date.now()){
 const reference=state?.referenceTimestamp??now;
 return (state?.labels||[]).filter(label=>label.mapMarkerType==='Major'&&Number.isFinite(label.x)&&Number.isFinite(label.y)&&label.x>=0&&label.x<=1&&label.y>=0&&label.y<=1).map(label=>{
  const captured=label.capturedTimestamp,warStart=state?.warStart;
  const alpha=!captured||!warStart||captured===warStart ? .15 : .35-.2*Math.min(1,Math.max(0,(reference-captured)/43200000));
  return [(label.x-.5)*2184,(.5-label.y)*1890,state?.suppressFaction?0:label.teamId==='WARDENS'?2:label.teamId==='COLONIALS'?1:0,Math.round(alpha*255)];
 }).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}
export function rasterizePlanningTerritories(sites){
 const size=MAP_OVERLAY_SIZE,data=new Uint8Array(size*size*4);
 if(!sites.length)return data;
 for(let y=0;y<size;y++){
  const z=(.5-(y+.5)/size)*1890;
  for(let x=0;x<size;x++){
   const px=((x+.5)/size-.5)*2184;
   let nearest=0,distance=Infinity;
   for(let i=0;i<sites.length;i++){const s=sites[i],d=(px-s[0])**2+(z-s[1])**2;if(d<distance){distance=d;nearest=i;}}
   const a=sites[nearest];let edge=32,neighbor=nearest;
   for(let i=0;i<sites.length;i++){if(i===nearest)continue;const b=sites[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.0001)continue;const d=((px-b[0])**2+(z-b[1])**2-distance)/(2*length);if(d<edge){edge=d;neighbor=i;}}
   const at=(y*size+x)*4;data[at+3]=nearest%255+1;data[at]=a[2];data[at+1]=a[3];data[at+2]=Math.round((.5+(nearest<=neighbor?1:-1)*Math.max(0,edge)/64)*255);
  }
 }
 return data;
}
