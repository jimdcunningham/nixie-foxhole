import assert from 'node:assert/strict';
import test from 'node:test';
import { foxholeFiringVolumeSchema, foxholeManifestSchema } from '../../../packages/foxhole-schema/src/manifest-schema.ts';
import { publishFiringVolumes } from './publish-firing-volumes.mjs';
import { alignFiringVolume } from './firing-volume-metadata.mjs';
import { readFileSync } from 'node:fs';
const volume = { source: 'mount-dynamic-data', origin: [-0.116,0.321,1.75], orientation: [0,0,0,1], minYaw: -45, maxYaw: 45, minPitch: -15, maxPitch: 15 };
test('source-backed aim metadata preserves heights and independent limits', () => {
    assert.deepEqual(foxholeFiringVolumeSchema.parse(volume), volume);
    for (const patch of [{ source: 'spread-cone' }, { orientation: [0,0,0,0] }, { minPitch: null }, { maxPitch: 95 }, { minYaw: 90 }, { maxYaw: 400 }])
        assert.equal(foxholeFiringVolumeSchema.safeParse({ ...volume,...patch }).success,false);
});
test('metadata migration preserves authored origins and headings and every unrelated field', () => {
    const source = {assets:[{id:'test',ranges:[{type:'killboxAT',codeName:'Gun',x:1,y:2,min:1,max:35,firingVolume:volume}]}]};
    const published = { unrelated:{sha256:'unchanged'}, assets:[{id:'test',model:'unchanged',ranges:[{t:'killboxAT',c:'Gun',x:4,y:5,r:90,a:90,mn:1,mx:35}]}]};
    const before = structuredClone(published), result = publishFiringVolumes(source,published);
    assert.equal(result.count,1);assert.deepEqual(published,before);
    const range = result.manifest.assets[0].ranges[0];
    assert.deepEqual(range.fv.origin,[4,5,1.75]);assert.equal(range.a,45);
    assert.ok(Math.abs(range.fv.orientation[2]-Math.SQRT1_2)<1e-6);
    delete range.fv;range.a=90;assert.deepEqual(result.manifest,before);
    const raw = alignFiringVolume({x:4,y:5,rotation:90,firingVolume:volume});
    assert.deepEqual(raw.origin,[4,5,1.75]);assert.ok(Math.abs(raw.orientation[2]-Math.SQRT1_2)<1e-6);
});
test('generated fixture hydrates compact firing metadata through the shared schema', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/foxhole/manifest.v1.fixture.json',import.meta.url),'utf8'));
    const parsed = foxholeManifestSchema.parse(fixture);
    const tankette = parsed.assets.find(asset=>asset.id==='tankettec');
    assert.equal(tankette.ranges[0].firingVolume.minPitch,-15);
    assert.equal(tankette.ranges[0].arc,45);
});


test('AI cone metadata hydrates separately from mount limits and preserves authored heading overrides', () => {
    const cone={source:'ai-turret',origin:[1,2,3],orientation:[0,0,0,1],coneHalfAngle:45};
    assert.deepEqual(foxholeFiringVolumeSchema.parse(cone),cone);
    for(const coneHalfAngle of [0,181,NaN])assert.equal(foxholeFiringVolumeSchema.safeParse({...cone,coneHalfAngle}).success,false);
    const aligned=alignFiringVolume({x:4,y:5,r:90},cone);
    assert.deepEqual(aligned.origin,[4,5,3]);assert.ok(Math.abs(aligned.orientation[2]-Math.SQRT1_2)<1e-6);
    const source={assets:[{id:'ai',ranges:[{type:'killbox',max:33.5,firingVolume:cone}]}]};
    const published={assets:[{id:'ai',ranges:[{t:'killbox',a:45,mx:33.5}]}]};
    const result=publishFiringVolumes(source,published);
    assert.equal(result.count,1);assert.equal(result.manifest.assets[0].ranges[0].a,45);
    assert.equal(result.manifest.assets[0].ranges[0].fv.source,'ai-turret');
});

test('muzzle offsets survive publication and rotate around the authored range frame exactly once', () => {
    const muzzle = { source:'ai-turret',origin:[2.68,-0.01,2.62],orientation:[0,0,0,1],coneHalfAngle:45,
        reference:{origin:[0,0],heading:0},originSource:'muzzle-component',originName:'MuzzleFxLocationComponent' };
    const range={x:10,y:20,r:90};
    const aligned=alignFiringVolume(range,muzzle);
    assert.ok(Math.abs(aligned.origin[0]-10.01)<1e-6);
    assert.ok(Math.abs(aligned.origin[1]-22.68)<1e-6);
    assert.equal(aligned.origin[2],2.62);
    assert.ok(Math.abs(aligned.orientation[2]-Math.SQRT1_2)<1e-6);
    assert.equal(aligned.originName,'MuzzleFxLocationComponent');
    assert.deepEqual(alignFiringVolume(range,aligned),aligned,'publishing an aligned frame twice must not apply the correction twice');
    assert.deepEqual(alignFiringVolume({},muzzle),muzzle,'an uncorrected structure must keep its source muzzle');
    const result=publishFiringVolumes({assets:[{id:'mg',ranges:[{type:'killbox',max:33.5,firingVolume:muzzle}]}]},
        {assets:[{id:'mg',ranges:[{t:'killbox',a:45,mx:33.5}]}]});
    assert.deepEqual(result.manifest.assets[0].ranges[0].fv,muzzle);
});

test('mount frame corrections preserve socket elevation, pitch, and asymmetric yaw limits', () => {
    const pitch=Math.PI/12;
    const muzzle={...volume,origin:[3,4,5],orientation:[0,Math.sin(pitch),0,Math.cos(pitch)],minYaw:-20,maxYaw:40,
        reference:{origin:[1,2],heading:10},originSource:'muzzle-socket',originName:'S_Muzzle'};
    const aligned=alignFiringVolume({x:7,y:8,r:100},muzzle);
    assert.ok(Math.abs(aligned.origin[0]-5)<1e-6);
    assert.ok(Math.abs(aligned.origin[1]-10)<1e-6);
    assert.equal(aligned.origin[2],5);
    assert.deepEqual([aligned.minYaw,aligned.maxYaw],[-20,40]);
    const [x,y,z,w]=aligned.orientation;
    assert.ok(Math.abs(Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))-Math.PI/2)<1e-6);
    assert.ok(Math.abs(Math.asin(2*(w*y-z*x))-Math.PI/6)<1e-6);
});


test('repeated mount types match their source frame when extraction order changes', () => {
    const first={...volume,origin:[1,0,1],reference:{origin:[0,0],heading:0}};
    const second={...volume,origin:[12,0,2],reference:{origin:[10,0],heading:0}};
    const source={assets:[{id:'ship',ranges:[{type:'killboxAT',codeName:'MG',x:10,max:35,firingVolume:second},{type:'killboxAT',codeName:'MG',x:0,max:35,firingVolume:first}]}]};
    const target={assets:[{id:'ship',ranges:[{t:'killboxAT',c:'MG',x:0,mx:35},{t:'killboxAT',c:'MG',x:10,mx:35}]}]};
    const result=publishFiringVolumes(source,target);
    assert.deepEqual(result.manifest.assets[0].ranges.map(r=>r.fv.origin),[[1,0,1],[12,0,2]]);
});


test('model-frame migration ignores stale generated ground positions and keeps 2D fields intact', () => {
    const muzzle={...volume,origin:[2,3,4],reference:{origin:[0,0],heading:0}};
    const source={assets:[{id:'tank',ranges:[{type:'killboxAT',x:0,y:0,rotation:0,max:35,firingVolume:muzzle}]}]};
    const catalog={assets:[{id:'tank',ranges:[{t:'killboxAT',x:50,y:60,r:90,a:90,mx:35}]}]};
    const result=publishFiringVolumes(source,catalog,{sourceFrame:true});
    assert.deepEqual(result.manifest.assets[0].ranges[0].fv.origin,[2,3,4]);
    assert.deepEqual(result.manifest.assets[0].ranges[0].fv.orientation,[0,0,0,1]);
    const range=result.manifest.assets[0].ranges[0];delete range.fv;
    assert.deepEqual(range,catalog.assets[0].ranges[0]);
});

test('model-frame migration avoids adding unresolved volumes but marks existing uncertain ones', () => {
    const unknown={...volume,originSource:'firing-component'};
    const source={assets:[{id:'test',ranges:[{type:'killboxAT',max:35,firingVolume:unknown}]}]};
    const fresh={assets:[{id:'test',ranges:[{t:'killboxAT',mx:35}]}]};
    assert.deepEqual(publishFiringVolumes(source,fresh,{sourceFrame:true}),{manifest:fresh,count:0});
    const existing=structuredClone(fresh);existing.assets[0].ranges[0].fv=volume;
    const result=publishFiringVolumes(source,existing,{sourceFrame:true});
    assert.equal(result.count,1);
    assert.equal(result.manifest.assets[0].ranges[0].fv.originSource,'firing-component');
});

test('payload muzzle arrays and pose diagnostics follow canonical publication exactly once', () => {
    const input={...volume,reference:{origin:[0,0],heading:0},muzzleOrigins:[[1,0,2],[1,-1,3]],
        payloadPose:{animation:'Animation.uasset',blendSpace:'Blend.uasset',bone:'rack',inputPitch:65,maxInputPitch:80,
            requiresDeployment:true,pitchSpan:6,maximumOrigin:[2,0,4]}};
    const aligned=alignFiringVolume({x:10,y:20,r:90},input);
    assert.deepEqual(aligned.muzzleOrigins.map(point=>point.map(n=>Math.round(n))),[[10,21,2],[11,21,3]]);
    assert.deepEqual(aligned.payloadPose.maximumOrigin,[10,22,4]);
    assert.deepEqual(alignFiringVolume({x:10,y:20,r:90},aligned),aligned);
    assert.equal(foxholeFiringVolumeSchema.safeParse({...input,muzzleOrigins:Array(33).fill([0,0,0])}).success,false);
    assert.equal(foxholeFiringVolumeSchema.safeParse({...input,muzzleOrigins:[[0,NaN,0]]}).success,false);
});
