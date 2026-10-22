// All viewer cameras use world Y as up. Bound the farthest possible receiver
// using the upper frustum ray and the lowest point in the complete scene.
// Looking toward/above the horizon keeps the original full shadow reach.
// Round upward to keep cascade sizes stable during small camera movements.
export function fitShadowDistance({position,target,fov,minY,maxDistance=4000,step=100}){
 const dx=target[0]-position[0],dy=target[1]-position[1],dz=target[2]-position[2],length=Math.hypot(dx,dy,dz);
 if(!length||!Number.isFinite(minY)||!Number.isFinite(fov))return maxDistance;
 const fy=dy/length,upperSlope=fy+Math.sqrt(Math.max(0,1-fy*fy))*Math.tan(fov*Math.PI/360);
 if(upperSlope>=-1e-6||position[1]<=minY)return maxDistance;
 const farthest=(position[1]-minY)/-upperSlope;
 return Math.min(maxDistance,Math.max(step,Math.ceil((farthest+10)/step)*step));
}
export function sceneFloor(root,modelMinY){
 let floor=Math.min(-55,Number.isFinite(modelMinY)?modelMinY:-55);
 // Ordinary world meshes already contain transformed world-space vertices;
 // their scene nodes only add translations (road offset, faction overlay).
 function visit(node,parentY=0){const y=parentY+(node.position?.y||0);if(node.geometry?.bounds3D)floor=Math.min(floor,node.geometry.bounds3D.min.y+y);for(const child of node.children||[])visit(child,y);}
 visit(root);return floor-1; // Conservative margin for Float32 bounds.
}
