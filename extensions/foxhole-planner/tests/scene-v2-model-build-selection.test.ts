import assert from 'node:assert/strict';
import test from 'node:test';
import { selectFoxholeSceneV2ModelBuild } from '../src/scene-v2-models.ts';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';

test('a focused development build retains selected models and their upgrades without changing the default', () => {
    const assets = { facilitypipe: { model: {} }, powerpole: { model: {} }, facilityrefinery1: { model: {} } } as unknown as Record<string, FoxholeSceneV2AssetMetadata>;
    const models = ['facilitypipe', 'facilitypipe.upgrade.insulation', 'powerpole', 'facilityrefinery1'].map(id => ({
        id, assetId: id.split('.')[0]!, path: `models/${id}.glb`,
    }));
    assert.equal(selectFoxholeSceneV2ModelBuild(assets, models), models);
    assert.equal(selectFoxholeSceneV2ModelBuild(assets, models, '  '), models);
    assert.deepEqual(selectFoxholeSceneV2ModelBuild(assets, models, 'facilitypipe,powerpole').map(row => row.id),
        ['facilitypipe', 'facilitypipe.upgrade.insulation', 'powerpole']);
    assert.ok(assets.facilitypipe!.model);
    assert.equal(assets.facilityrefinery1!.model, undefined);
    for (const selection of ['aircraftcarrier', 'facilitypipe,typo', '../facilitypipe']) {
        assert.throws(() => selectFoxholeSceneV2ModelBuild(assets, models, selection), /allowlisted assets/);
    }
});
