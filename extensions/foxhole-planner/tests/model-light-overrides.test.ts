import assert from 'node:assert/strict';
import test from 'node:test';
import {createFakeNixieExtensionHost} from '@nixiejs/extension-sdk/testing';
import {createFoxholeModelLightCatalog} from '../build/model-light-metadata.ts';
import {buildFoxholeModelLightOverrides} from '../src/model-light-presentation.ts';

function glb(nodes: unknown[]) {
    const json = new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},nodes}));
    const length = Math.ceil(json.length/4)*4,bytes = new Uint8Array(20+length),view = new DataView(bytes.buffer);
    view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);
    view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20);bytes.set(json,20);
    return bytes;
}
const lamp = (name:string,sourceName='FortSpotLight:Light',candela=120,castShadows=true)=>({name,extras:{nixieBlueprintLight:{sourceName,candela,source:{castShadows}}}});

test('FoxWatch packages base, replacement and shared light metadata before public renderer RPC', async () => {
    const sources = new Map([['base.glb',glb([lamp('fort-lamp')])],['part.glb',glb([lamp('work-lamp','OrdinaryLamp',3,false)])],['replacement.glb',glb([lamp('replacement-lamp')])]]);
    const originals = new Map([...sources].map(([key,bytes])=>[key,bytes.slice()]));
    let reads=0;
    const catalog = await createFoxholeModelLightCatalog([
        {id:'base',assetId:'base',path:'base.glb',dependencyIds:['shared.part']},
        {id:'shared.part',assetId:'shared',path:'part.glb',sharedPart:true},
        {id:'base.destroyed',assetId:'base',path:'replacement.glb'},
    ],async path=>{reads++;return sources.get(path)!;});
    assert.equal(reads,3);
    assert.deepEqual(catalog['foxhole.model.base'],[{nodeName:'fort-lamp',castShadow:true,poweredIntensity:120},{nodeName:'work-lamp',castShadow:false}]);
    const host=createFakeNixieExtensionHost({extensionId:'nixie.foxhole-planner'});
    const entity={entityId:'structure',revision:1,components:[]};
    const saved=structuredClone(entity),connection=await host.connect({sceneV2:{entityRenderers:{light:(_entity,context)=>({schemaVersion:1,root:{id:'root',kind:'group',children:[]},experimentalSpatial:{
        contractVersion:1,supplementModel:true,nodes:[],modelLights:true,
        modelLightOverrides:buildFoxholeModelLightOverrides('foxhole.model.base',catalog,context.settings?.['foxhole.ranges.poweredSpotlights']===true),
    }})}}});
    try {
        for(const enabled of [true,false,true]){
            const plan=await host.renderEntity('light',entity,{contractVersion:1,entities:[entity],settings:{'foxhole.ranges.poweredSpotlights':enabled}});
            assert.deepEqual(plan.experimentalSpatial?.modelLightOverrides,[{nodeName:'fort-lamp',castShadow:true,intensity:120,enabled},{nodeName:'work-lamp',castShadow:false}]);
            assert.deepEqual(entity,saved);
        }
        assert.deepEqual(buildFoxholeModelLightOverrides('foxhole.model.base.destroyed',catalog,true),[{nodeName:'replacement-lamp',castShadow:true,intensity:120,enabled:true}]);
        assert.deepEqual(buildFoxholeModelLightOverrides('missing',catalog,true),[]);
        assert.deepEqual(buildFoxholeModelLightOverrides('foxhole.model.base',undefined,true),[],'old catalogs preserve authored defaults without private recovery');
        assert.deepEqual(sources,originals);
    } finally {connection.dispose();}
});

test('light metadata rejects malformed resources, conflicting dependencies and excessive declarations', async () => {
    const models=[{id:'base',assetId:'base',path:'base.glb',dependencyIds:['part']},{id:'part',assetId:'shared',path:'part.glb',sharedPart:true}];
    await assert.rejects(createFoxholeModelLightCatalog(models,async path=>glb([lamp('same','FortSpotLight:Light',path==='base.glb'?1:2)])),/Conflicting/);
    await assert.rejects(createFoxholeModelLightCatalog(models,async()=>new Uint8Array()),/Invalid/);
    await assert.rejects(createFoxholeModelLightCatalog([models[0]!],async()=>glb([])),/dependency/);
    await assert.rejects(createFoxholeModelLightCatalog([{...models[0]!,dependencyIds:['base']}],async()=>glb([])),/dependency/);
    await assert.rejects(createFoxholeModelLightCatalog([{...models[0]!,dependencyIds:[]}],async()=>glb(Array.from({length:65},(_,i)=>lamp('lamp-'+i)))),/Spatial plans/);
    assert.throws(()=>buildFoxholeModelLightOverrides('model',{model:[{nodeName:'lamp',castShadow:true,poweredIntensity:-1}]},true));
});
