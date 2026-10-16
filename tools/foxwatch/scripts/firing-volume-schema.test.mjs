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
