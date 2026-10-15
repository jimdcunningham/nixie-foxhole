import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { filterSpatialModelManifest, resolveSpatialExportPolicy } from './spatial-export-policy.mjs';

const config = { schemaVersion: 1, categoryIds: ['facility', 'power'], assets: ['refinery', 'generator'] };
const catalog = { assets: [{ id: 'refinery', categoryId: 'facility', codeName: 'Refinery' },
    { id: 'generator', categoryId: 'power', codeName: 'Generator' },
    { id: 'ship', categoryId: 'naval', codeName: 'Ship', isVehicle: true },
    { id: 'refinerydestroyed', categoryId: 'facility', codeName: 'RefineryDestroyed' }] };

test('default packing is the approved profile and --only narrows the explicit allowlist', () => {
    const p = resolveSpatialExportPolicy(config, catalog, { only: ['refinery', 'ship'] });
    assert.equal(p.geometryProfile, 'curved50-compact16');
    assert.deepEqual(p.targets, ['refinery']);
    assert.deepEqual(p.skipped, ['ship']);
    assert.equal(resolveSpatialExportPolicy(config, catalog, { geometryProfile: 'lossless' }).geometryProfile, 'lossless');
});

test('out-of-scope assets, destroyed/breached IDs and unknown profiles cannot enter the export', () => {
    for (const id of ['ship', 'refinerydestroyed', 'refinerybreached', 'unknown']) {
        assert.throws(() => resolveSpatialExportPolicy({ ...config, assets: [id] }, catalog));
    }
    assert.throws(() => resolveSpatialExportPolicy(config, catalog, { geometryProfile: 'positionsuv16' }), /Unknown geometry profile/);
    assert.throws(() => resolveSpatialExportPolicy({ ...config, categoryIds: ['facility'] }, catalog), /outside spatial scope/);
});

test('stale model and upgrade references outside scope are removed without mutating the input manifest', () => {
    const original = { schemaVersion: 1, assets: { refinery: {}, ship: {}, refinerydestroyed: {} },
        resources: { 'refinery.default': { assetId: 'refinery' }, 'refinery.upgrade.good': { assetId: 'refinery' },
            'refinery.upgrade.breached': { assetId: 'refinery' }, 'ship.default': { assetId: 'ship' } } };
    const result = filterSpatialModelManifest(original, new Set(['refinery']));
    assert.deepEqual(Object.keys(result.assets), ['refinery']);
    assert.deepEqual(Object.keys(result.resources), ['refinery.default', 'refinery.upgrade.good']);
    assert.ok('ship' in original.assets);
});

test('catalog-wide policy includes every category, vehicles, items and damaged variants', () => {
    const authored = JSON.parse(readFileSync(new URL('../asset-overrides/spatial-models.json', import.meta.url)));
    const bundled = JSON.parse(readFileSync(new URL('../../../extensions/foxhole-planner/src/scene-v2-model-policy.json', import.meta.url)));
    assert.equal(authored.assetSelection, 'catalog');
    assert.equal(bundled.assetSelection, authored.assetSelection);
    const assets = [...catalog.assets, { id: 'newitem', categoryId: 'new-category', isItem: true },
        { id: 'breached', codeName: 'Breached', isBreached: true, categoryId: 'bunker' }];
    const policy = resolveSpatialExportPolicy(authored, { assets });
    assert.deepEqual(policy.targets, assets.map(asset => asset.id));
    assert.deepEqual(resolveSpatialExportPolicy(authored, { assets }, { only: ['ship', 'newitem', 'missing'] }).targets, ['ship', 'newitem']);
    assert.equal(authored.groundAllVehicles, true);
    assert.throws(() => resolveSpatialExportPolicy(authored, { assets: [{ id: '../escape' }] }), /Excluded spatial asset/);
    const kept = filterSpatialModelManifest({ assets: { breached: {} } }, policy.allowedIds, { includeDamaged: true });
    assert.ok(kept.assets.breached);
});
