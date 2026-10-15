/** Keep authored component identities through Blender transform baking. */
export function prepareSpatialStructureScene(asset,input){
    const layers=asset.renderLayers??[];
    if(!layers.length) return input;
    const result=structuredClone(input);
    result.spatialLayerGroups={};
    for(const layer of layers){
        const id=layer.i??layer.id, name=layer.cn??layer.componentName;
        if(!id||!name) continue;
        const group='structure-layer-'+id;
        let found=false;
        const visit=node=>{if(node.name===name){node.spatialGroup=group;found=true;}(node.children??[]).forEach(visit);};
        result.scene.roots.forEach(visit);
        if(found) result.spatialLayerGroups[id]=group;
    }
    return result;
}
export function spatialStructureProfile(scene,exported){
    const layers={};
    for(const [id,group] of Object.entries(scene.spatialLayerGroups??{})){
        const name=exported.semanticGroups?.[group];
        if(name)layers[id]=[name];
    }
    return Object.keys(layers).length?{version:1,layers}:undefined;
}
