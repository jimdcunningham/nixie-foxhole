import assert from 'node:assert/strict';
import test from 'node:test';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { bindFoxholeSceneV2Models, getFoxholeSceneV2ModelComponentData, getFoxholeSceneV2PackagedModelPath,
    selectFoxholeSceneV2ModelBuild } from '../src/scene-v2-models.ts';

const first = `shared.${'a'.repeat(64)}`, second = `shared.${'b'.repeat(64)}`;
const resource = (id: string) => ({ resourceId: `foxhole.model.${id}`, path: `shared/models/${id.slice(7)}.glb` });
const metadata = (id: string, dependency: string) => ({ resourceId: `foxhole.model.${id}`, codeName: id,
    path: `models/${id}.glb`, width: 32, height: 32, depth: 32, offsetX: 0, offsetY: 0, offsetZ: 0,
    modelParts: { version: 1, parts: [{ nodeName: 'connector', resourceId: `foxhole.model.${dependency}` }] } });
const assets = () => Object.fromEntries(['facilityrefinery1', 'facilitycrane'].map(id => [id,
    { codeName: id, category: 'structures' }])) as Record<string, FoxholeSceneV2AssetMetadata>;
const manifest = () => ({ schemaVersion: 1, assets: { facilityrefinery1: metadata('facilityrefinery1', first),
    facilitycrane: metadata('facilitycrane', second) }, sharedParts: { [first]: resource(first), [second]: resource(second) } });

test('shared models package once and remain presentation-only dependencies', () => {
    const input = manifest();
    input.assets.facilitycrane.modelParts.parts[0]!.resourceId = `foxhole.model.${first}`;
    const catalog = assets(), models = bindFoxholeSceneV2Models(catalog, input);
    const shared = models.filter(model => model.sharedPart);
    assert.equal(shared.length, 1, 'unreferenced canonical output is not packaged');
    assert.equal(getFoxholeSceneV2PackagedModelPath(shared[0]!), resource(first).path);
    assert.deepEqual(models[0]!.dependencyIds, [first]);
    assert.deepEqual(Object.keys(getFoxholeSceneV2ModelComponentData(catalog.facilityrefinery1!.model!)).sort(),
        ['depth', 'height', 'offsetX', 'offsetY', 'offsetZ', 'resourceId', 'width']);
});

test('focused builds include only the selected owners and their complete shared dependency set', () => {
    const catalog = assets(), models = bindFoxholeSceneV2Models(catalog, manifest());
    const selected = selectFoxholeSceneV2ModelBuild(catalog, models, 'facilitycrane');
    assert.deepEqual(selected.map(model => model.id), ['facilitycrane', second]);
    assert.equal(catalog.facilityrefinery1!.model, undefined);
    assert.throws(() => selectFoxholeSceneV2ModelBuild(catalog, models, first), /must name exported allowlisted assets/);
});

test('missing, aliased, unsafe and nested shared outputs fail binding', () => {
    const missing = manifest();
    delete missing.sharedParts[first];
    assert.throws(() => bindFoxholeSceneV2Models(assets(), missing), /Invalid Foxhole shared model binding/);
    const aliased = manifest();
    aliased.sharedParts[first]!.resourceId = `foxhole.model.${second}`;
    assert.throws(() => bindFoxholeSceneV2Models(assets(), aliased), /Invalid Foxhole shared model binding/);
    const unsafe = manifest();
    unsafe.sharedParts[first]!.path = '../models/escape.glb';
    assert.throws(() => bindFoxholeSceneV2Models(assets(), unsafe), /Invalid Foxhole shared model binding/);
    const nested = manifest();
    Object.assign(nested.sharedParts[first]!, { modelParts: { version: 1, parts: [] } });
    assert.throws(() => bindFoxholeSceneV2Models(assets(), nested), /Invalid Foxhole shared model binding/);
    assert.throws(() => getFoxholeSceneV2PackagedModelPath({ id: first, assetId: 'facilitycrane',
        path: resource(first).path, sharedPart: true }), /Invalid Foxhole shared model identity/);
});

test('selected upgrade resources bring their canonical dependencies into a focused build', () => {
    const catalog = assets(), input = manifest();
    const upgradeId = 'facilityrefinery1.upgrade.smelter';
    const models = bindFoxholeSceneV2Models(catalog, { ...input, resources: {
        [upgradeId]: { ...metadata(upgradeId, second), assetId: 'facilityrefinery1' },
    } });
    assert.deepEqual(selectFoxholeSceneV2ModelBuild(catalog, models, 'facilityrefinery1').map(model => model.id),
        ['facilityrefinery1', upgradeId, first, second]);
});
