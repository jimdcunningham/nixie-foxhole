import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeItemCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';
import {
    resolveFoxholeProductionCommodityRef,
} from '../../app/plugins/foxhole/nixie/production/commodity-uses.ts';
import {
    resolveFoxholeProductionOutputRef,
    searchFoxholeProductionOutputs,
} from '../../app/plugins/foxhole/nixie/production/itinerary.ts';
import {
    getFoxholeCommodityObtainNote,
    getFoxholeCrateLogisticsNote,
    listFoxholeObtainRelatedForDescribe,
} from '../../app/plugins/foxhole/nixie/production/obtain-notes.ts';

const BASE = '/foxhole/assets/';

test('search prefers Hammer over Sledge Hammer for query hammer', () => {
    const index = getFoxholeProductionIndex(BASE);
    const catalogs = { itemCatalog: getFoxholeItemCatalog(BASE) };
    const hits = searchFoxholeProductionOutputs('hammer', index, catalogs, 5);
    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.resourceId, 'WorkHammer');
    assert.equal(hits[0]?.label, 'Hammer');
});

test('resolve hammer maps to WorkHammer with spawn obtain note', () => {
    const index = getFoxholeProductionIndex(BASE);
    const catalogs = { itemCatalog: getFoxholeItemCatalog(BASE) };
    const resolved = resolveFoxholeProductionCommodityRef('hammer', index, catalogs);
    assert.equal(resolved?.commodityKey, 'item:WorkHammer');
    assert.equal(resolved?.label, 'Hammer');
    const output = resolveFoxholeProductionOutputRef('hammer', index, catalogs);
    assert.equal(output?.resourceId, 'WorkHammer');
    assert.ok(getFoxholeCommodityObtainNote('item:WorkHammer')?.toLowerCase().includes('spawn'));
});

test('crate logistics note applies to factory crate outputs', () => {
    const note = getFoxholeCrateLogisticsNote('crate', 1);
    assert.ok(note?.toLowerCase().includes('stockpile'));
    assert.equal(getFoxholeCrateLogisticsNote('item', 1), null);
});

test('hammer obtain related includes Sledge Hammer and Factory', () => {
    const related = listFoxholeObtainRelatedForDescribe('item:WorkHammer', 'item', 0);
    assert.ok(related.some(ref => ref.kind === 'item' && ref.resourceId === 'SledgeHammer'));
    assert.ok(related.some(ref => ref.kind === 'structure' && ref.structureId === 'factory'));
});
