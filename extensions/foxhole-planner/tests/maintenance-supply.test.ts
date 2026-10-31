import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFoxholeMaintenanceFilters, resolveFoxholeMaintenanceCoverage, resolveFoxholeMaintenanceRanges } from '../src/maintenance-supply.ts';
import type { FoxholeMaintenanceCandidate } from '../src/maintenance-supply.ts';
import { renderFoxholeStructureRangeOverlays } from '../src/scene-v2-structure-range-overlays.ts';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';

test('maintenance filters retain old planner exclusions and bound the range', () => {
    assert.deepEqual(normalizeFoxholeMaintenanceFilters(undefined), { range: 100, exclusions: [] });
    assert.deepEqual(normalizeFoxholeMaintenanceFilters({ range: 130, exclusions: ['defenses', 'factories', 'facility', 'unknown'] }),
        { range: 100, exclusions: ['defense', 'facility'] });
    assert.equal(normalizeFoxholeMaintenanceFilters({ range: -20 }).range, 0);
    assert.equal(normalizeFoxholeMaintenanceFilters({ range: NaN }).range, 100);
});

const tunnel: FoxholeMaintenanceCandidate = { id: 'tunnel', assetId: 'maintenancetunnel', category: 'misc', x: 100, y: 200, drain: 1, operational: true };
const near = (id: string, patch: Partial<FoxholeMaintenanceCandidate> = {}): FoxholeMaintenanceCandidate => ({
    ...tunnel, id, assetId: 'factory', category: 'facility', x: tunnel.x + 50 * 32, drain: 2, ...patch,
});
test('coverage includes the tunnel, filters categories, and excludes out-of-range or inactive structures', () => {
    const candidates = [tunnel, near('boundary'), near('outside', { x: tunnel.x + 50 * 32 + 1 }),
        near('excluded', { category: 'defense' }), near('packaged', { operational: false }), near('no-decay', { drain: 0 })];
    const result = resolveFoxholeMaintenanceCoverage(tunnel, candidates, { range: 50, exclusions: ['defenses'] });
    assert.deepEqual(result.structures.map(entry => entry.id), ['tunnel', 'boundary']);
    assert.equal(result.suppliesPerHour, 3);
    assert.deepEqual(resolveFoxholeMaintenanceCoverage(tunnel, candidates, { range: 0, exclusions: ['misc'] }).structures, [tunnel]);
    assert.equal(resolveFoxholeMaintenanceCoverage({ ...tunnel, operational: false }, candidates, {}).structures.length, 0);
});
test('the Supply overlay follows saved range and selection policy without changing other assets', () => {
    const ranges = [{ type: 'preventDecay', max: 100 }, { type: 'build', max: 20 }];
    assert.deepEqual(resolveFoxholeMaintenanceRanges('MaintenanceTunnel', ranges, { range: 25 }), [{ type: 'preventDecay', max: 25 }, ranges[1]]);
    assert.deepEqual(resolveFoxholeMaintenanceRanges('other', ranges, { range: 25 }), ranges);
    const asset = { codeName: 'MaintenanceTunnel', ranges: [ranges[0]], isVehicle: false } as FoxholeSceneV2AssetMetadata;
    const settings = { 'foxhole.ranges.supply': true, 'foxhole.ranges.selectionOnly': true };
    const nodes = renderFoxholeStructureRangeOverlays(asset, settings, { destroyed: false, packaged: false }, { range: 25 });
    assert.match(JSON.stringify(nodes), /"radius":800/);
    assert.ok(!JSON.stringify(nodes).includes('"radius":3200'));
    assert.deepEqual(renderFoxholeStructureRangeOverlays(asset, settings, { destroyed: false, packaged: false }, { range: 0 }), []);
    assert.deepEqual(renderFoxholeStructureRangeOverlays(asset, settings, { destroyed: true, packaged: false }, { range: 25 }), []);
});

test('the real tunnel renderer consumes the saved maintenance component', async () => {
    const { renderFoxholeSceneV2Entity } = await import('../src/scene-v2-renderers.ts');
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'tunnel', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'maintenancetunnel' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'maintenance-supply', version: 1, definitionAvailable: true,
            data: { range: 17, exclusions: ['facility'] } },
    ] };
    const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings: { 'foxhole.ranges.supply': true } });
    assert.match(JSON.stringify(plan), /"radius":544/);
    assert.ok(!JSON.stringify(plan).includes('"radius":3200'));
});
