import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import {
    buildFoxholeProductionDescribeUiBlocks,
    buildFoxholeProductionItineraryUiBlocks,
    buildFoxholeProductionResolveUiBlocks,
    buildFoxholeProductionSearchUiBlocks,
} from '../app/plugins/foxhole/nixie/production/assistant-ui-blocks.ts';
import type {
    FoxholeProductionItineraryResult,
    FoxholeProductionOutputCatalogEntry,
} from '../app/plugins/foxhole/nixie/production/types.ts';

const cloth: FoxholeProductionOutputCatalogEntry = {
    commodityKey: 'item:Cloth',
    label: 'Basic Materials',
    searchText: 'basic materials cloth bmats',
    producerCount: 2,
    sampleProducerNames: ['Factory'],
    channel: 'item',
    resourceId: 'Cloth',
};

test('search uiBlocks include item chips for outputs', () => {
    const blocks = buildFoxholeProductionSearchUiBlocks([cloth], {});
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.kind, 'item');
    assert.equal(blocks[0]?.kind === 'item' ? blocks[0].resourceId : '', 'Cloth');
});

test('resolve uiBlocks wrap a single output', () => {
    const blocks = buildFoxholeProductionResolveUiBlocks(cloth, {});
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.id, 'item:Cloth');
});

test('resolve uiBlocks include producer structures when index is provided', () => {
    const binoculars: FoxholeProductionOutputCatalogEntry = {
        commodityKey: 'crate:Binoculars',
        label: 'Binoculars',
        searchText: 'binoculars',
        producerCount: 1,
        sampleProducerNames: ['Factory'],
        channel: 'crate',
        resourceId: 'Binoculars',
    };
    const index = {
        recipeById: {
            'structure:factory:recipe:0': {
                id: 'structure:factory:recipe:0',
                sourceStructureId: 'factory',
                sourceStructureName: 'Factory',
            },
        },
        recipeIdsByOutput: {
            'crate:Binoculars': ['structure:factory:recipe:0'],
        },
    } as never;
    const blocks = buildFoxholeProductionResolveUiBlocks(binoculars, {}, index);
    const ids = blocks.map(block => block.id);
    assert.ok(ids.includes('item:Binoculars'));
    assert.ok(ids.includes('item:structure:factory'));
});

test('describe uiBlocks include producer and consumer structures', () => {
    const gravel: FoxholeProductionOutputCatalogEntry = {
        commodityKey: 'item:GroundMaterials',
        label: 'Gravel',
        searchText: 'gravel groundmaterials',
        producerCount: 2,
        sampleProducerNames: ['Refinery', 'Concrete Mixer'],
        channel: 'item',
        resourceId: 'GroundMaterials',
    };
    const blocks = buildFoxholeProductionDescribeUiBlocks(
        gravel,
        {
            producers: [
                { structureId: 'refinery', structureName: 'Refinery' },
                { structureId: 'concretemixer', structureName: 'Concrete Mixer' },
            ],
            consumers: [
                { structureId: 'foundation01t1', structureName: 'Foundation (1x1)' },
                { structureId: 'facilityroad', structureName: 'Provisional Road' },
            ],
        },
        {},
    );
    const ids = blocks.map(block => block.id);
    assert.ok(ids.includes('item:GroundMaterials'));
    assert.ok(ids.includes('item:structure:refinery'));
    assert.ok(ids.includes('item:structure:concretemixer'));
    assert.ok(ids.includes('item:structure:foundation01t1'));
    assert.ok(ids.includes('item:structure:facilityroad'));
});

test('describe uiBlocks include obtain-note related items', () => {
    const hammer: FoxholeProductionOutputCatalogEntry = {
        commodityKey: 'item:WorkHammer',
        label: 'Hammer',
        searchText: 'hammer workhammer',
        producerCount: 0,
        sampleProducerNames: [],
        channel: 'item',
        resourceId: 'WorkHammer',
    };
    const blocks = buildFoxholeProductionDescribeUiBlocks(
        hammer,
        {
            relatedItems: [
                {
                    channel: 'crate',
                    resourceId: 'SledgeHammer',
                    label: 'Sledge Hammer',
                    commodityKey: 'crate:SledgeHammer',
                },
            ],
            relatedStructures: [
                { structureId: 'factory', structureName: 'Factory' },
            ],
        },
        {},
    );
    const ids = blocks.map(block => block.id);
    assert.ok(ids.includes('item:WorkHammer'));
    assert.ok(ids.includes('item:SledgeHammer'));
    assert.ok(ids.includes('item:structure:factory'));
});

test('describe uiBlocks skip craft consumers when gather sources exist', () => {
    const salvage: FoxholeProductionOutputCatalogEntry = {
        commodityKey: 'item:Metal',
        label: 'Salvage',
        searchText: 'salvage metal',
        producerCount: 0,
        sampleProducerNames: [],
        channel: 'item',
        resourceId: 'Metal',
    };
    const blocks = buildFoxholeProductionDescribeUiBlocks(
        salvage,
        {
            gatherSources: [
                { structureId: 'salvagefield', structureName: 'Salvage Field' },
                { structureId: 'scrapmine', structureName: 'Salvage Mine' },
            ],
            consumers: [
                { structureId: 'facilityrefinery1', structureName: 'Materials Factory' },
                { structureId: 'concretemixer', structureName: 'Concrete Mixer' },
            ],
            preferGatherOverConsumers: true,
        },
        {},
    );
    const ids = blocks.map(block => block.id);
    assert.ok(ids.includes('item:Metal'));
    assert.ok(ids.includes('item:structure:salvagefield'));
    assert.ok(ids.includes('item:structure:scrapmine'));
    assert.ok(!ids.includes('item:structure:facilityrefinery1'));
    assert.ok(!ids.includes('item:structure:concretemixer'));
});

test('itinerary uiBlocks include goal items and recipes', () => {
    const itinerary = {
        goal: {
            commodityKey: 'item:Cloth',
            channel: 'item',
            resourceId: 'Cloth',
            label: 'Basic Materials',
            quantity: 1,
        },
        status: 'ok',
        assumptions: 'public_logi',
        steps: [
            {
                id: 'step-1',
                kind: 'produce',
                title: 'Produce Basic Materials',
                summary: 'Factory',
                commodityKey: 'item:Cloth',
                channel: 'item',
                resourceId: 'Cloth',
                recipeId: 'structure:factory:recipe:0',
                structureId: 'factory',
                structureName: 'Factory',
                quantity: 1,
                runCount: 1,
                durationSeconds: 10,
                candidateRecipeIds: ['structure:factory:recipe:0'],
                options: [],
            },
        ],
        leafRequirements: [
            {
                commodityKey: 'item:Salvage',
                channel: 'item',
                resourceId: 'Salvage',
                label: 'Salvage',
                quantity: 10,
                source: 'external',
            },
        ],
        producers: [
            {
                recipeId: 'structure:factory:recipe:0',
                structureId: 'factory',
                structureName: 'Factory',
                runCount: 1,
                durationSeconds: 10,
                label: 'Factory',
            },
        ],
        blockers: [],
        pendingChoices: [],
        board: null,
        plan: {} as FoxholeProductionItineraryResult['plan'],
    } as FoxholeProductionItineraryResult;

    const blocks = buildFoxholeProductionItineraryUiBlocks(itinerary, {});
    const cloth = blocks.find(block => block.kind === 'item' && block.resourceId === 'Cloth');
    assert.ok(cloth);
    assert.equal(cloth?.kind === 'item' ? cloth.label : '', 'Basic Materials');
    assert.ok(blocks.some(block => block.kind === 'item' && block.resourceId === 'Salvage'));
    const recipe = blocks.find(block => block.kind === 'recipe' && block.recipeId === 'structure:factory:recipe:0');
    assert.ok(recipe);
    assert.equal(recipe?.kind === 'recipe' ? recipe.label : '', 'Factory');
});

test('itinerary pendingChoices uiBlocks include structures and input items', () => {
    const itinerary = {
        goal: {
            commodityKey: 'item:GroundMaterials',
            channel: 'item',
            resourceId: 'GroundMaterials',
            label: 'Gravel',
            quantity: 1,
        },
        status: 'ok',
        assumptions: 'public_logi',
        steps: [],
        leafRequirements: [],
        producers: [],
        blockers: [],
        pendingChoices: [
            {
                commodityKey: 'item:GroundMaterials',
                channel: 'item',
                resourceId: 'GroundMaterials',
                label: 'Gravel',
                requestedQuantity: 1,
                options: [
                    {
                        recipeId: 'structure:refinery:recipe:6',
                        label: 'Refinery · Coal x5',
                        structureId: 'refinery',
                        structureName: 'Refinery',
                        isWorldStructure: true,
                        runCount: 1,
                        durationSeconds: 1.2,
                        powerDelta: 0,
                        inputSummary: [
                            { commodityKey: 'item:Coal', label: 'Coal', quantity: 5 },
                        ],
                        score: 1,
                        rankHints: [],
                    },
                    {
                        recipeId: 'structure:refinery:recipe:3',
                        label: 'Refinery · Salvage x6',
                        structureId: 'refinery',
                        structureName: 'Refinery',
                        isWorldStructure: true,
                        runCount: 1,
                        durationSeconds: 1.44,
                        powerDelta: 0,
                        inputSummary: [
                            { commodityKey: 'item:Metal', label: 'Salvage', quantity: 6 },
                        ],
                        score: 1,
                        rankHints: [],
                    },
                ],
            },
        ],
        board: null,
        plan: {} as FoxholeProductionItineraryResult['plan'],
    } as FoxholeProductionItineraryResult;

    const blocks = buildFoxholeProductionItineraryUiBlocks(itinerary, {});
    const ids = blocks.map(block => block.id);
    assert.ok(ids.includes('item:GroundMaterials'));
    assert.ok(ids.includes('item:structure:refinery'));
    assert.ok(ids.includes('item:Coal'));
    assert.ok(ids.includes('item:Metal'));
    assert.ok(ids.includes('recipe:structure:refinery:recipe:6'));
});

test('world rebuild itinerary uiBlocks include Construction Vehicle', () => {
    const itinerary = {
        goal: {
            commodityKey: 'build:structure:worldrefinery',
            channel: 'build',
            resourceId: 'structure:worldrefinery',
            label: 'Refinery',
            quantity: 1,
            isWorldStructure: true,
        },
        status: 'ok',
        assumptions: 'public_logi',
        steps: [
            {
                id: 'step-1',
                kind: 'build',
                title: 'Rebuild Refinery',
                summary: 'World structure',
                commodityKey: 'build:structure:worldrefinery',
                channel: 'build',
                resourceId: 'structure:worldrefinery',
                recipeId: 'build:structure:worldrefinery:recipe:0',
                structureId: 'worldrefinery',
                structureName: 'Refinery',
                isWorldStructure: true,
                quantity: 1,
                runCount: 1,
                durationSeconds: null,
                candidateRecipeIds: [],
                options: [],
            },
        ],
        leafRequirements: [
            {
                commodityKey: 'item:Cloth',
                channel: 'item',
                resourceId: 'Cloth',
                label: 'Basic Materials',
                quantity: 400,
                source: 'external',
            },
        ],
        producers: [],
        blockers: [],
        pendingChoices: [],
        board: null,
        plan: {} as FoxholeProductionItineraryResult['plan'],
    } as FoxholeProductionItineraryResult;

    const blocks = buildFoxholeProductionItineraryUiBlocks(itinerary, {
        structureCatalog: {
            assetByKey: {
                worldrefinery: { name: 'Refinery' },
                construction: { name: 'Construction Vehicle' },
            },
        } as never,
    });
    assert.ok(blocks.some(block => (
        block.kind === 'item'
        && block.resourceId === 'construction'
        && block.label === 'Construction Vehicle'
    )));
    assert.ok(blocks.some(block => (
        block.kind === 'item'
        && block.resourceId === 'structure:worldrefinery'
        && block.label === 'Refinery'
    )));
});

test('LAS train outputs resolve as vehicles with icons via structure catalog', () => {
    const catalogs = {
        itemCatalog: getFoxholeItemCatalog('/foxhole/assets/'),
        structureCatalog: getFoxholeStructureCatalog('/foxhole/assets/'),
    };
    const trainEngine: FoxholeProductionOutputCatalogEntry = {
        commodityKey: 'item:TrainEngine',
        label: 'BMS Black Bolt',
        searchText: 'bms black bolt trainengine',
        producerCount: 1,
        sampleProducerNames: ['Large Assembly Station'],
        channel: 'item',
        resourceId: 'TrainEngine',
    };
    const blocks = buildFoxholeProductionSearchUiBlocks([trainEngine], catalogs);
    assert.equal(blocks.length, 1);
    const block = blocks[0];
    assert.ok(block && block.kind === 'item');
    if (!block || block.kind !== 'item') {
        return;
    }
    assert.equal(block.channel, 'build');
    assert.equal(block.resourceId, 'vehicle:trainengine');
    assert.equal(block.label, 'BMS Black Bolt');
    assert.equal(block.commodityKey, 'item:TrainEngine');
    assert.ok(block.iconUrl?.includes('/vehicles/trainengine/'));
});
