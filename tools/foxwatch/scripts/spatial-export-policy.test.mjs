import assert from 'node:assert/strict';
import test from 'node:test';
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

test('vehicles, wrong categories, destroyed/breached IDs and unknown profiles cannot enter the export', () => {
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
