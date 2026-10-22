// Distances are native Foxhole metres, before the planner's board transform.
// https://foxhole.wiki.gg/wiki/Decay#Rapid_Decay_Zone
export const RDZ_WIDTH=150, RDZ_EXEMPT_RADIUS=50, CONTOUR_INTERVAL=10;
const slope=546/945, diagonal=Math.hypot(1,slope);
const exemptionIcons=new Set([20,21,23,27,32,35,38,40,45,46,47,56,57,58,61,62]);
export function regionBorderDistance(x,z){return Math.min(945-Math.abs(z),(1092-Math.abs(x)-Math.abs(z)*slope)/diagonal);}
export function rdzExemptions(state){
 const circles=new Map();
 for(const item of state?.items||[]){
  if(!exemptionIcons.has(Number(item.iconType))||!Number.isFinite(item.x)||!Number.isFinite(item.y)||item.x<0||item.x>1||item.y<0||item.y>1)continue;
  const x=(item.x-.5)*2184,z=(.5-item.y)*1890,d=regionBorderDistance(x,z);
  if(d>RDZ_WIDTH+RDZ_EXEMPT_RADIUS||d< -RDZ_EXEMPT_RADIUS)continue;
  circles.set(x+':'+z,[x,z,RDZ_EXEMPT_RADIUS,0]);
 }
 // Reordering an otherwise identical API snapshot must not upload new GPU data.
 return [...circles.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}
export function inRapidDecayZone(x,z,circles=[]){const d=regionBorderDistance(x,z);return d>=0&&d<=RDZ_WIDTH&&!circles.some(([cx,cz,r])=>(x-cx)**2+(z-cz)**2<=r*r);}
export function contourDistance(height,interval=CONTOUR_INTERVAL){return Math.abs(((height/interval+.5)%1+1)%1-.5)*interval;}
