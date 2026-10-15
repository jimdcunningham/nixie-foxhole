import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOXHOLE_ASSET_COMPLETION_MARKERS_ENABLED,
    isFoxholeAssetComplete,
    resolveFoxholeAssetCompletionMetadata,
} from '../app/plugins/foxhole/nixie/asset-completion.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';

test('previously finished categories remain complete', () => {
    assert.equal(isFoxholeAssetComplete('assaultriflew', 'smallarms'), true);
    assert.equal(isFoxholeAssetComplete('unknown-weapon', 'smallarms'), true);
    assert.equal(isFoxholeAssetComplete('aircraftpartsmallenginew', 'parts'), true);
    assert.equal(isFoxholeAssetComplete('diesel', 'supplies'), true);
    assert.equal(isFoxholeAssetComplete('firstaidkit', 'medical'), true);
    assert.equal(isFoxholeAssetComplete('deployedwindsockt', 'deployable'), true);
    assert.equal(isFoxholeAssetComplete('aircraftscoutc', 'aircraft'), true);
    assert.equal(isFoxholeAssetComplete('mediumtank3c', 'armor'), true);
    assert.equal(isFoxholeAssetComplete('lightboatinfantryw', 'naval'), true);
    assert.equal(isFoxholeAssetComplete('relicarmouredcar', 'relics'), true);
    assert.equal(isFoxholeAssetComplete('mediumtankoffensivec', 'tank'), true);
    assert.equal(isFoxholeAssetComplete('motorcycleoffensivec', 'vehicles'), true);
    assert.equal(isFoxholeAssetComplete('traincombatcarc', 'trains'), true);
    assert.equal(isFoxholeAssetComplete('largefieldlightartilleryc', 'weaponry'), true);
    assert.equal(isFoxholeAssetComplete('facilitypipe', 'liquids'), true);
    assert.equal(isFoxholeAssetComplete('unknown-liquid', 'liquids'), true);
    assert.equal(isFoxholeAssetComplete('townwsmall1', 'fortifications'), true);
    assert.equal(isFoxholeAssetComplete('facilitymineresource1', 'mining'), true);
    assert.equal(isFoxholeAssetComplete('garrisonbarn2', 'garrisons'), true);
    assert.equal(isFoxholeAssetComplete('emplacedinfantryc', 'shippables'), true);
    assert.equal(isFoxholeAssetComplete('facilityrefinerycoal', 'facility'), true);
    assert.equal(isFoxholeAssetComplete('facilitypoweroil', 'power'), true);
    assert.equal(isFoxholeAssetComplete('engineeringcenter', 'logistics'), true);
    assert.equal(isFoxholeAssetComplete('fieldbridge', 'misc'), true);
    assert.equal(isFoxholeAssetComplete('unknown-reference', 'world'), true);
    assert.equal(isFoxholeAssetComplete('railtrackspline', 'foundation'), true);
});

test('previously unfinished categories and unknown assets now default to finished', () => {
    assert.equal(isFoxholeAssetComplete('artilleryait1', 'bunker'), true);
    assert.equal(isFoxholeAssetComplete('trencht1', 'trenches'), true);
    assert.equal(isFoxholeAssetComplete('unknown-defense', 'defense'), true);
});

test('previously finished assets remain complete', () => {
    assert.equal(isFoxholeAssetComplete('facilitytransfermaterial', 'facilities'), true);
    assert.equal(isFoxholeAssetComplete('facilitytransfermaterialdestroyed', 'facilities'), true);
    assert.equal(isFoxholeAssetComplete('facilitytransferresource', 'facilities'), true);
    assert.equal(isFoxholeAssetComplete('facilitytransferresourcedestroyed', 'facilities'), true);
    assert.equal(isFoxholeAssetComplete('riflepillbox', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('tankmine', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('tankstop', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('tankstopsplinet3', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('barbedwirewallspline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('isgpillbox', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('atpillbox', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('mgpillbox', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('watchtower', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('gatet1', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('gatet2', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('gatet3', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('wallsplinet1', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('wallsplinet2', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('wallsplinet3', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('minespline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('infantryminespline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('tankminespline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('surfacewaterminespline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('waterminespline', 'defense'), true);
    assert.equal(isFoxholeAssetComplete('custom-bunker-piece', 'bunker'), true);
});

test('completion metadata marks assets in every category finished', () => {
    assert.deepEqual(
        resolveFoxholeAssetCompletionMetadata('riflew', 'smallarms'),
        { assetComplete: true },
    );
    assert.deepEqual(
        resolveFoxholeAssetCompletionMetadata('atgunait1', 'bunker'),
        { assetComplete: true },
    );
});

test('every published Foxhole asset is finished while completion tracking remains enabled', () => {
    assert.equal(FOXHOLE_ASSET_COMPLETION_MARKERS_ENABLED, true);
    const manifest = getFoxholeManifest('/foxhole/assets/');
    assert.ok(manifest.assets.length > 0);
    for (const asset of manifest.assets) {
        assert.deepEqual(resolveFoxholeAssetCompletionMetadata(asset.id, asset.categoryId),
            { assetComplete: true }, asset.id);
    }
});
