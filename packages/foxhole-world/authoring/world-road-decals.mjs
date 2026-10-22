import {surfaceDecalMaterial} from './surface-decal-pass.mjs';
import {orientDecalMaterial} from "./decal-uv.mjs";
import{loadRailGeometry}from'./rail-geometry.mjs';
import {Geometry3D,Material3D,Mesh3D} from '@pixi/3d';
export function decalGeometry(row,terrain){
 const m=row.matrix,halfY=row.size[1]/100,halfZ=row.size[2]/100,ny=Math.min(64,Math.max(2,Math.ceil(halfY*2*Math.hypot(m[8],m[10])))),nz=Math.min(64,Math.max(2,Math.ceil(halfZ*2*Math.hypot(m[4],m[6])))),positions=[],normals=[],uvs=[],indices=[];
 for(let z=0;z<=nz;z++)for(let y=0;y<=ny;y++){
  const u=y/ny,v=z/nz,ly=(v*2-1)*halfZ,lz=-(u*2-1)*halfY,x=m[4]*ly+m[8]*lz+m[12],wz=m[6]*ly+m[10]*lz+m[14],height=terrain(x,wz)??0;
  positions.push(x,height+.065+(row.sortOrder||0)*.003,wz);const dx=(terrain(x+.25,wz)??height)-(terrain(x-.25,wz)??height),dz=(terrain(x,wz+.25)??height)-(terrain(x,wz-.25)??height),length=Math.hypot(dx,.5,dz);normals.push(-dx/length,.5/length,-dz/length);uvs.push(u,v);
 }
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const a=z*(ny+1)+y,b=a+1,c=a+ny+1,d=c+1;indices.push(a,c,b,b,c,d);}return{positions:new Float32Array(positions),normals:new Float32Array(normals),uvs:new Float32Array(uvs),indices:new Uint32Array(indices)};
}
export async function loadRoadDecals({region,json,zipped,texture,geo,mat,root,terrain,hexBit,weatherSurfaceBit,groundBit,weatherMaterial=m=>m,bridgeRoadSeams,includeRails=true}){
 const source=await json(`${region}/roads/decals.json`),materials=new Map();let restored=null;{restored=await json(region+'/world-fixes/decals.json');source.decals.push(...restored.decals);Object.assign(source.materials,restored.materials);for(const row of source.decals)row.sortOrder=restored.sortOrders?.[row.actor+'/'+row.name]??row.sortOrder??0;source.decals.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));}const fixes=await json('deadlands/world-fixes/road-materials.json');for(const [key,m] of Object.entries(fixes))if(source.materials[key])source.materials[key]=m;for(const[key,item]of Object.entries(source.materials)){const [image,normal,orm]=await Promise.all([texture(`${item.region||region}/${item.file}`),item.normalFile?texture(`${item.region||region}/${item.normalFile}`):undefined,item.ormFile?texture(`${item.region||region}/${item.ormFile}`):undefined]);materials.set(key,surfaceDecalMaterial(orientDecalMaterial(mat(weatherMaterial(new Material3D({baseColorTexture:image,normalTexture:normal,normalScale:item.normalScale??1,metallicRoughnessTexture:orm,baseColor:item.tint,roughness:1,metallic:item.metallic??0,alphaMode:'blend',alpha:item.opacity,doubleSided:true,extraBits:[hexBit,...(weatherSurfaceBit?[weatherSurfaceBit]:[]),...(groundBit?[groundBit]:[])]}))),item)));}
 bridgeRoadSeams=await bridgeRoadSeams;
 let triangles=0;for(const row of source.decals){const raw=decalGeometry(row,terrain),cut=bridgeRoadSeams?bridgeRoadSeams.cut({p:raw.positions,n:raw.normals,uv:raw.uvs,indices:raw.indices,offset:0}):null,g=cut?{positions:cut.p,normals:cut.n,uvs:cut.uv,indices:cut.indices}:raw;triangles+=g.indices.length/3;root.addChild(new Mesh3D({label:row.actor,geometry:geo(new Geometry3D(g)),material:materials.get(row.material),castShadow:false}));}
 const railGeometry=includeRails?await loadRailGeometry({region,json,zipped,root,texture,geo,mat,hexBit,weatherSurfaceBit,weatherMaterial}):undefined;return{railGeometry,placements:source.decals.length,materials:materials.size,triangles,restoredPlacements:restored?.decals.length||0,restoredRailDecals:restored?.decals.filter(d=>/RailDecal/.test(d.material)).length||0,method:source.method};
}

