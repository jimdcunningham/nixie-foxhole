import assert from 'node:assert/strict';
import test from 'node:test';
import {
    formatFoxholeProductionLeafGatherSummary,
    listFoxholeProductionLeafGatherSources,
} from '../../app/plugins/foxhole/nixie/production/leaf-sources.ts';

test('listFoxholeProductionLeafGatherSources maps salvage to Salvage Field', () => {
    const sources = listFoxholeProductionLeafGatherSources('item:Metal');
    assert.ok(sources.some(source => (
        source.kind === 'resource_field' && source.structureId === 'salvagefield'
    )));
    const mine = sources.find(source => source.structureId === 'scrapmine');
    assert.ok(mine);
    assert.equal(mine?.kind, 'resource_mine');
    assert.ok(mine?.note?.toLowerCase().includes('diesel'));
    assert.ok(mine?.note?.toLowerCase().includes('petrol'));
    assert.ok(sources.some(source => source.kind === 'stationary_harvester'));
});

test('listFoxholeProductionLeafGatherSources covers coal, sulfur, and components fields', () => {
    assert.equal(
        listFoxholeProductionLeafGatherSources('item:Coal').find(source => source.kind === 'resource_field')?.structureId,
        'coalfield',
    );
    assert.equal(
        listFoxholeProductionLeafGatherSources('item:Sulfur').find(source => source.kind === 'resource_field')?.structureId,
        'sulfurfield',
    );
    assert.equal(
        listFoxholeProductionLeafGatherSources('item:Components').find(source => source.kind === 'resource_field')?.structureId,
        'componentsfield',
    );
});

test('listFoxholeProductionLeafGatherSources maps tech mats to Salvage Field only', () => {
    for (const key of ['item:Copper', 'item:Aluminum', 'item:Iron'] as const) {
        const sources = listFoxholeProductionLeafGatherSources(key);
        assert.equal(sources.length, 1);
        assert.equal(sources[0]?.structureId, 'salvagefield');
        assert.equal(sources[0]?.kind, 'resource_field');
        assert.ok(sources[0]?.note?.toLowerCase().includes('no'));
        assert.ok(!sources.some(source => source.kind === 'resource_mine'));
    }
});

test('formatFoxholeProductionLeafGatherSummary prefers resource fields', () => {
    assert.equal(
        formatFoxholeProductionLeafGatherSummary('item:Metal'),
        'Gather from Salvage Field (or Salvage Mine)',
    );
    assert.equal(
        formatFoxholeProductionLeafGatherSummary('item:Coal'),
        'Gather from Coal Field',
    );
    assert.equal(formatFoxholeProductionLeafGatherSummary('item:Cloth'), null);
});
