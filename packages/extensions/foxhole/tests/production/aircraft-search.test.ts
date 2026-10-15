import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '../../app/plugins/foxhole/nixie/production/index.ts';
import {
    isFoxholeProductionSelfReferentialRecipe,
    searchFoxholeProductionOutputs,
} from '../../app/plugins/foxhole/nixie/production/itinerary.ts';
import { buildFoxholeProductionSearchUiBlocks } from '../../app/plugins/foxhole/nixie/production/assistant-ui-blocks.ts';
import { executeFoxholeProductionAssistantTool } from '../../app/plugins/foxhole/nixie/production/assistant-tools.ts';

const BASE = '/foxhole/assets/';

test('aircraft search returns flyable vehicles without parts or maintenance factory products', () => {
    const index = getFoxholeProductionIndex(BASE);
    const catalogs = {
        itemCatalog: getFoxholeItemCatalog(BASE),
        structureCatalog: getFoxholeStructureCatalog(BASE),
    };
    const hits = searchFoxholeProductionOutputs('aircraft', index, catalogs, 40);
    assert.ok(hits.length >= 8);
    assert.ok(hits.every(hit => (
        hit.channel === 'build' && /^vehicle:aircraft/i.test(hit.resourceId)
    )));
    assert.ok(!hits.some(hit => /AircraftPart|AircraftAmmo|facilityfactoryaircraft/i.test(hit.commodityKey)));
});

test('aircraft search uiBlocks skip self-referential structure chips', () => {
    const index = getFoxholeProductionIndex(BASE);
    const catalogs = {
        itemCatalog: getFoxholeItemCatalog(BASE),
        structureCatalog: getFoxholeStructureCatalog(BASE),
    };
    const hits = searchFoxholeProductionOutputs('aircraft', index, catalogs, 20);
    const blocks = buildFoxholeProductionSearchUiBlocks(hits, catalogs, index);
    assert.ok(blocks.some(block => block.id === 'item:vehicle:aircraftbomberw'));
    assert.ok(!blocks.some(block => block.id === 'item:structure:aircraftbomberw'));
});

test('self-referential aircraft build recipes are detected', () => {
    const index = getFoxholeProductionIndex(BASE);
    const recipe = index.recipeById['build:vehicle:aircraftbomberw:recipe:0'];
    assert.ok(recipe);
    assert.equal(
        isFoxholeProductionSelfReferentialRecipe(recipe, 'vehicle:aircraftbomberw'),
        true,
    );
});

test('search_production_outputs aircraft includes build-site obtainNotes', () => {
    const result = executeFoxholeProductionAssistantTool(
        'search_production_outputs',
        { query: 'aircraft', limit: 20 },
        {
            baseAssetsUrl: BASE,
            index: getFoxholeProductionIndex(BASE),
            itemCatalog: getFoxholeItemCatalog(BASE),
            structureCatalog: getFoxholeStructureCatalog(BASE),
        },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        obtainNotes?: string;
        uiBlocks: Array<{ id: string; label: string; }>;
    };
    assert.ok(payload.obtainNotes?.toLowerCase().includes('hangar'));
    assert.ok(payload.obtainNotes?.toLowerCase().includes('parts only'));
    const ids = payload.uiBlocks.map(block => block.id);
    assert.ok(ids.includes('item:structure:aircraftfactory'));
    assert.ok(ids.includes('item:structure:facilityvehiclefactory2'));
    assert.ok(ids.includes('item:structure:facilityfactoryaircraft'));
    assert.ok(!ids.includes('item:structure:aircraftbomberw'));
});
