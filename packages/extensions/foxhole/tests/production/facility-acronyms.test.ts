import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';
import { executeFoxholeProductionAssistantTool } from '../../app/plugins/foxhole/nixie/production/assistant-tools.ts';
import { searchFoxholeProductionOutputs } from '../../app/plugins/foxhole/nixie/production/itinerary.ts';

const BASE = '/foxhole/assets/';

function liveContext() {
    return {
        baseAssetsUrl: BASE,
        index: getFoxholeProductionIndex(BASE),
        itemCatalog: getFoxholeItemCatalog(BASE),
        structureCatalog: getFoxholeStructureCatalog(BASE),
    };
}

test('list_structure_production resolves LAS acronym to train products', () => {
    const result = executeFoxholeProductionAssistantTool(
        'list_structure_production',
        { query: 'LAS' },
        liveContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        structureId: string;
        structureName: string;
        products: Array<{ commodityKey: string; label: string; }>;
        modificationOptions: Array<{ label: string; }>;
    };
    assert.equal(payload.structureId, 'facilityvehiclefactory2');
    assert.equal(payload.structureName, 'Large Assembly Station');
    const labels = payload.products.map(entry => entry.label);
    assert.ok(labels.some(label => /Black Bolt/i.test(label)), `expected train products, got ${labels.join(', ')}`);
    assert.ok(labels.every(label => /BMS /i.test(label)), 'base LAS recipes should be trains only');
    assert.ok(
        !payload.products.some(entry => /FacilityMaterials|Assembly Materials/i.test(entry.commodityKey + entry.label)),
        'LAS must not list Metalworks assembly materials',
    );
    assert.ok(payload.modificationOptions.some(option => /Train Assembly/i.test(option.label)));
    assert.ok(payload.modificationOptions.some(option => /Aircraft Assembly/i.test(option.label)));
    assert.ok(payload.modificationOptions.some(option => /Heavy Tank Assembly/i.test(option.label)));
});

test('list_structure_production resolves MPF without inventing SAS upgrades', () => {
    const result = executeFoxholeProductionAssistantTool(
        'list_structure_production',
        { query: 'MPF' },
        liveContext(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        structureId: string;
        structureName: string;
        products: Array<{ commodityKey: string; label: string; }>;
        modificationOptions: Array<{ label: string; }>;
        uiBlocks: Array<{ id: string; label: string; }>;
    };
    assert.equal(payload.structureId, 'massproduction');
    assert.equal(payload.structureName, 'Mass Production Factory');
    assert.ok(payload.products.length > 20);
    assert.ok(payload.products.every(entry => entry.commodityKey.startsWith('crate:')));
    assert.deepEqual(payload.modificationOptions, []);
    assert.ok(!payload.uiBlocks.some(block => /facilityvehiclefactory1/i.test(block.id)));
    assert.ok(!payload.uiBlocks.some(block => /Small Assembly/i.test(block.label)));
});

test('search LAS no longer returns Assembly Materials via blast furnace', () => {
    const catalogs = {
        itemCatalog: getFoxholeItemCatalog(BASE),
        structureCatalog: getFoxholeStructureCatalog(BASE),
    };
    const hits = searchFoxholeProductionOutputs('LAS', getFoxholeProductionIndex(BASE), catalogs, 20);
    assert.ok(hits.some(hit => hit.commodityKey === 'build:structure:facilityvehiclefactory2'));
    assert.ok(!hits.some(hit => /FacilityMaterials6|FacilityMaterials7|blastfurnace/i.test(hit.commodityKey)));
});
