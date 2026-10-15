import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { foxholeManifestSchema } from '@nixie/foxhole-schema';

const source=await readFile(new URL('./publish-manifest.mjs',import.meta.url),'utf8');
const declarations=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)];
function productionFunction(name) {
    const index=declarations.findIndex(match=>match[1]===name);
    assert.ok(index>=0,name);
    return source.slice(declarations[index].index,declarations[index+1].index);
}
const names=['isPlainObject','isJsonEqual','hasOwn','compactJsonValue','compactObject','compactArray',
    'compactStructureRenderLayer','getTextureSidecarPath','readRenderSidecar','applyTextureMetadata',
    'compactEnumToken','compactConnectorMeshMode','compactSplineMeshAxis','compactConnectorMeshConfig',
    'compactNullableObject','isEmptyPlainObject','compactConnectorBehavior','compactSplineComponentConfig','compactConnector'];
const context=vm.createContext({readFile,readImageDimensions:()=>{throw Error('native metadata lost');}});
vm.runInContext(names.map(productionFunction).join('\n'),context);
const nativeSurface={version:1,verticalOffsetCm:5.000000074505806,groundHeightCm:0,
    body:{lengthCm:450.000017608005,positions:[0,0,1,450.000017608005,0,1,0,100,1],
        uvs:[-.0027027130126953125,.5,1.0049,.5,0,1],indices:[0,1,2]}};

test('native longitudinal material scaling retains sub-millimetre coefficient precision',()=>{
    const scale=[0,0.0022219999227672815];
    assert.deepEqual(JSON.parse(JSON.stringify(context.compactConnectorMeshConfig({splineMaterialScaling:scale}))).materialScale,scale);
});

test('native body metadata survives sidecar publication and compaction without rounding UVs',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'native-road-publish-'));
    try {
        const image=join(directory,'span.texture.webp');
        await writeFile(join(directory,'span.texture.json'),JSON.stringify({mode:'topdown',width:864,height:410,nativeSurface}));
        const entry={id:'span',textureUrl:'/foxhole/assets/types/structures/facilityroad/components/span/span.texture.webp'};
        await context.applyTextureMetadata(entry,image,'width','height');
        const compact=JSON.parse(JSON.stringify(context.compactStructureRenderLayer(entry)));
        assert.deepEqual(compact.ns,nativeSurface);
        assert.equal('cap' in compact.ns,false);
        const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/foxhole/manifest.v1.fixture.json',import.meta.url),'utf8'));
        fixture.assets=[{...fixture.assets[0],renderLayers:[compact]}];
        const parsed=foxholeManifestSchema.parse(fixture);
        assert.deepEqual(parsed.assets[0].renderLayers[0].nativeSurface,nativeSurface);
        compact.ns.body.indices=[0,1,99];
        assert.equal(foxholeManifestSchema.safeParse({...fixture,assets:[{...fixture.assets[0],renderLayers:[compact]}]}).success,false);
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('connector publication preserves the precise UV coefficient after nested compaction',()=>{
    const scale=[0,0.0022219999227672815];
    const connector=context.compactConnector({meshConfigs:[{splineMaterialScaling:scale,nativeMeshLengthCm:450.0000305175781}]});
    const published=JSON.parse(JSON.stringify(connector));
    assert.deepEqual(published.meshConfigs[0].materialScale,scale);
    assert.equal(published.meshConfigs[0].length,450,'ordinary dimensions retain compact rounding');
});
