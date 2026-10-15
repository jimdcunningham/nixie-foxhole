import { createHash } from 'node:crypto';

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
        const nodes=[];
        const visit=node=>{nodes.push(node);(node.children??[]).forEach(visit);};result.scene.roots.forEach(visit);
        const exact=nodes.filter(node=>node.name===name);
        const aliases=nodes.filter(node=>node.name?.split(':').at(-1)===name.split(':').at(-1));
        const matches=exact.length?exact:!name.startsWith('mesh:')&&aliases.length===1?aliases:[];
        for(const node of matches)node.spatialGroup=group;
        if(matches.length)result.spatialLayerGroups[id]=group;
    }
    return result;
}
export function spatialStructureProfile(scene,exported){
    const layers={};
    for(const [id,group] of Object.entries(scene.spatialLayerGroups??{})){
        const name=exported.semanticGroups?.[group];
        if(name)layers[id]=[name];
    }
    const modifications=(scene.spatialModifications??[]).flatMap(part=>{
        const name=exported.semanticGroups?.[part.group];
        return name?[{slotId:part.slotId,variantId:part.variantId,nodeNames:[name],replacesLayers:part.replacesLayers}]:[];
    });
    return Object.keys(layers).length||modifications.length?{version:1,layers,...(modifications.length?{modifications}:{})}:undefined;
}

/** Assemble optional structural parts in the original slot hierarchy, with independent visibility groups. */
export async function prepareSpatialStructureModifications(asset,input,load,sharedIds=new Map()){
    if(!input.spatialLayerGroups&&!asset.modifications?.length)return input;
    const result=structuredClone(input),all=[];
    result.spatialLayerGroups??={};
    const visit=node=>{all.push(node);(node.children??[]).forEach(visit);};result.scene.roots.forEach(visit);
    // Filtered component scenes are the authority for composite roles (e.g. roof plus roof dirt).
    const sourcePaths=new Map();
    const index=(node,path=[])=>{const key=[...path,node.id];sourcePaths.set(JSON.stringify(key),node);
        (node.children??[]).forEach(child=>index(child,key));};result.scene.roots.forEach(node=>index(node));
    for(const layer of asset.renderLayers??[]){
        const id=layer.i??layer.id,component=await load(asset.id+'/components/'+id+'.scene.json');
        if(!component)continue;
        const group='structure-layer-'+id;let found=false;
        const bind=(node,path=[])=>{const key=[...path,node.id],target=sourcePaths.get(JSON.stringify(key));
            if(target&&(node.meshId||node.primitive||node.light)){target.spatialGroup=group;found=true;}
            (node.children??[]).forEach(child=>bind(child,key));};component.scene.roots.forEach(node=>bind(node));
        if(found)result.spatialLayerGroups[id]=group;
    }
    const structural=asset.isBunker||/^trench/i.test(asset.codeName);
    const hasLight=node=>Boolean(node.light)||(node.children??[]).some(hasLight);
    result.spatialModifications=[];
    for(const slot of asset.modifications??[])for(const [variantId,variant] of Object.entries(slot.variants??{})){
        if(variant.isUpgrade)continue;
        const candidates=all.filter(node=>node.name===slot.name||node.name?.endsWith(':'+slot.name));

        const sharedId=sharedIds.get(asset.id+':'+slot.name+':'+variantId)??variant.sharedModificationId;
        const paths=[asset.id+'/modifications/'+variantId+'--slot-'+slot.name.toLowerCase()+'.scene.json',
            ...(sharedId?['mods/'+sharedId+'.scene.json']:[]),
            asset.id+'/modifications/'+variantId+'.scene.json'];
        let source;
        for(const path of paths){source=await load(path);if(source)break;}
        if(!structural&&(!source||!source.scene.roots.some(hasLight)))continue;
        if(!source)throw Error('Missing structural modification scene: '+asset.id+':'+slot.name+':'+variantId);
        if(candidates.length!==1)throw Error('Ambiguous structural modification slot: '+asset.id+':'+slot.name);
        const slotNode=candidates[0];
        const group='structure-mod-'+createHash('sha256').update(slot.name+':'+variantId).digest('hex').slice(0,16);
        const part=structuredClone(source),qualified=new Map();
        for(const mesh of part.assets?.meshes??[]){const id=group+':'+mesh.id;qualified.set(mesh.id,id);mesh.id=id;result.assets.meshes.push(mesh);}
        result.assets.materials.push(...part.assets?.materials??[]);
        const qualify=node=>{node.id=group+':'+node.id;delete node.spatialGroup;
            if(node.meshId)node.meshId=qualified.get(node.meshId);(node.children??[]).forEach(qualify);};
        part.scene.roots.forEach(qualify);
        (slotNode.children??=[]).push({id:group,name:group,spatialGroup:group,visible:true,children:part.scene.roots});
        const replacesLayers=Object.entries(result.spatialLayerGroups).filter(([,key])=>key===slotNode.spatialGroup).map(([id])=>id);
        result.spatialModifications.push({slotId:slot.name,variantId,group,replacesLayers});
    }
    return result;
}
