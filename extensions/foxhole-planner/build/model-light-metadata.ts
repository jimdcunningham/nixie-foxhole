import {readFoxholeModelLightHints} from '../src/model-light-hints.ts';
import {buildFoxholeModelLightOverrides} from '../src/model-light-presentation.ts';
import type {FoxholeModelLightCatalog,FoxholeModelLightMetadata} from '../src/model-light-presentation.ts';
import type {FoxholeSceneV2ModelSource} from '../src/scene-v2-models.ts';
/** Translate source-only blueprint hints before packaging; the host never interprets them. */
export async function createFoxholeModelLightCatalog(models: readonly FoxholeSceneV2ModelSource[], read: (path: string)=>Promise<Uint8Array>): Promise<FoxholeModelLightCatalog> {
    const own=new Map<string,FoxholeModelLightMetadata[]>(),byId=new Map(models.map(model=>[model.id,model]));
    for(const model of models){
        const bytes=await read(model.path),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        if(bytes.length<20||bytes.length>32*1024*1024||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length
            ||view.getUint32(16,true)!==0x4e4f534a||view.getUint32(12,true)>bytes.length-20)throw Error('Invalid light metadata GLB: '+model.path);
        const document=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))));
        own.set(model.id,[...readFoxholeModelLightHints(document)].map(([nodeName,hint])=>({nodeName,castShadow:hint.shadows,
            ...(hint.poweredIntensity===undefined?{}:{poweredIntensity:hint.poweredIntensity})})));
    }
    const catalog:FoxholeModelLightCatalog={};
    function collect(id:string,visiting=new Set<string>()):FoxholeModelLightMetadata[]{
        if(visiting.has(id)||!byId.has(id))throw Error('Invalid light metadata dependency: '+id);
        const next=new Set(visiting).add(id),nodes=new Map<string,FoxholeModelLightMetadata>();
        for(const row of [...own.get(id)!,...(byId.get(id)!.dependencyIds??[]).flatMap(dependency=>collect(dependency,next))]){
            const previous=nodes.get(row.nodeName);
            if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw Error('Conflicting named light metadata: '+row.nodeName);
            nodes.set(row.nodeName,row);
        }
        return [...nodes.values()];
    }
    for(const model of models){const resourceId='foxhole.model.'+model.id,rows=collect(model.id);if(rows.length){catalog[resourceId]=rows;buildFoxholeModelLightOverrides(resourceId,catalog,true);}}
    return catalog;
}
