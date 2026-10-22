const namesBySource=new WeakMap();

/** Preserve glTF slot names: Pixi's name dictionary overwrites duplicate names. */
export function retainModelMaterialNames(source,document){
 namesBySource.set(source,(document.materials||[]).map(material=>material.name||''));
 return source;
}

export function modelMaterialNames(source,fallback=[]){
 const recorded=namesBySource.get(source),named=new Map(Object.entries(source.material||{}).map(([name,material])=>[material,name]));
 const names=source.materials.map((material,index)=>recorded?.[index]??named.get(material)??'');
 // The standalone authoring loader exposes only the name dictionary. Use its
 // exported slot list only when its length and every known index agree.
 if(!recorded&&fallback.length===names.length&&names.every((name,index)=>!name||name===fallback[index])){
  for(let i=0;i<names.length;i++)if(!names[i])names[i]=fallback[i]||'';
 }
 return new Map(source.materials.map((material,index)=>[material,names[index]]));
}
