import assert from 'node:assert/strict';
import test from 'node:test';
import {
    executeFoxholeProductionAssistantTool,
    FOXHOLE_PRODUCTION_ASSISTANT_TOOLS,
} from '../../app/plugins/foxhole/nixie/production/assistant-tools.ts';
import type {
    FoxholeProductionIndex,
    FoxholeProductionRecipe,
} from '../../app/plugins/foxhole/nixie/production/types.ts';

function recipe(partial: Partial<FoxholeProductionRecipe> & Pick<FoxholeProductionRecipe, 'id' | 'sourceStructureId' | 'sourceStructureName'>): FoxholeProductionRecipe {
    return {
        sourceType: 'structure',
        sourceStructureKey: partial.sourceStructureId,
        sourceSlotId: null,
        sourceSlotName: null,
        sourceVariantId: null,
        sourceVariantName: null,
        sourceModificationId: null,
        isUpgrade: false,
        durationSeconds: 10,
        powerDelta: -1000,
        consumesResourceNodes: false,
        itemInput: {},
        crateInput: {},
        liquidInput: {},
        itemOutput: {},
        crateOutput: {},
        liquidOutput: {},
        buildOutput: {},
        ...partial,
    };
}

function createItineraryIndex(): FoxholeProductionIndex {
    const bmatsRecipe = recipe({
        id: 'structure:facilityrefinery1:recipe:0',
        sourceStructureId: 'facilityrefinery1',
        sourceStructureName: 'Materials Factory',
        durationSeconds: 25,
        itemInput: { Metal: { quantity: 10, limit: null } },
        itemOutput: { Cloth: { quantity: 20, limit: null } },
    });

    return {
        recipeById: {
            [bmatsRecipe.id]: bmatsRecipe,
        },
        recipeIdsByOutput: {
            'item:Cloth': [bmatsRecipe.id],
        },
        structureRecipeIdsByStructureId: {
            facilityrefinery1: [bmatsRecipe.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

function createRefineryIndex(): FoxholeProductionIndex {
    const worldBmats = recipe({
        id: 'structure:refinery:recipe:0',
        sourceStructureId: 'refinery',
        sourceStructureName: 'Refinery',
        durationSeconds: 30,
        itemInput: { Salvage: { quantity: 10, limit: null } },
        itemOutput: { Cloth: { quantity: 1, limit: null } },
    });
    const worldDiesel = recipe({
        id: 'structure:refinery:recipe:1',
        sourceStructureId: 'refinery',
        sourceStructureName: 'Refinery',
        durationSeconds: 30,
        itemInput: { Oil: { quantity: 30, limit: null } },
        liquidOutput: { Diesel: { quantity: 1, limit: null } },
    });

    return {
        recipeById: {
            [worldBmats.id]: worldBmats,
            [worldDiesel.id]: worldDiesel,
        },
        recipeIdsByOutput: {
            'item:Cloth': [worldBmats.id],
            'liquid:Diesel': [worldDiesel.id],
        },
        structureRecipeIdsByStructureId: {
            refinery: [worldBmats.id, worldDiesel.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

const structureCatalog = {
    assetByKey: {
        facilityrefinery1: {
            foxholeKey: 'facilityrefinery1',
            name: 'Materials Factory',
            isWorldStructure: false,
            aliases: [],
        },
        refinery: {
            foxholeKey: 'refinery',
            name: 'Refinery',
            isWorldStructure: true,
            aliases: [],
        },
    },
    assets: [
        {
            foxholeKey: 'facilityrefinery1',
            name: 'Materials Factory',
            isWorldStructure: false,
            aliases: [],
        },
        {
            foxholeKey: 'refinery',
            name: 'Refinery',
            isWorldStructure: true,
            aliases: [],
        },
    ],
} as never;

const itineraryContext = {
    baseAssetsUrl: '/foxhole/assets/',
    index: createItineraryIndex(),
};

function createCopperIndex(): FoxholeProductionIndex {
    const copperAlloy = recipe({
        id: 'structure:refinery:recipe:8',
        sourceStructureId: 'refinery',
        sourceStructureName: 'Refinery',
        durationSeconds: 0.24,
        itemInput: { Copper: { quantity: 1, limit: null } },
        itemOutput: { CopperA: { quantity: 1, limit: null } },
    });
    return {
        recipeById: {
            [copperAlloy.id]: copperAlloy,
        },
        recipeIdsByOutput: {
            'item:CopperA': [copperAlloy.id],
        },
        structureRecipeIdsByStructureId: {
            refinery: [copperAlloy.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

const copperContext = {
    baseAssetsUrl: '/foxhole/assets/',
    index: createCopperIndex(),
};

function createGravelIndex(): FoxholeProductionIndex {
    const refineryGravel = recipe({
        id: 'structure:refinery:recipe:gravel',
        sourceStructureId: 'refinery',
        sourceStructureName: 'Refinery',
        itemInput: { Coal: { quantity: 5, limit: null } },
        itemOutput: { GroundMaterials: { quantity: 20, limit: null } },
    });
    const mixerGravel = recipe({
        id: 'structure:concretemixer:recipe:gravel',
        sourceStructureId: 'concretemixer',
        sourceStructureName: 'Concrete Mixer',
        itemInput: { Salvage: { quantity: 20, limit: null } },
        itemOutput: { GroundMaterials: { quantity: 5, limit: null } },
    });
    const foundation = recipe({
        id: 'build:structure:foundation01t1:recipe:0',
        sourceStructureId: 'foundation01t1',
        sourceStructureName: 'Foundation (1x1)',
        itemInput: { GroundMaterials: { quantity: 75, limit: null } },
        buildOutput: {
            'structure:foundation01t1': { quantity: 1, limit: null },
        },
    });
    const road = recipe({
        id: 'build:structure:facilityroad:recipe:0',
        sourceStructureId: 'facilityroad',
        sourceStructureName: 'Provisional Road',
        itemInput: { GroundMaterials: { quantity: 25, limit: null } },
        buildOutput: {
            'structure:facilityroad': { quantity: 1, limit: null },
        },
    });
    return {
        recipeById: {
            [refineryGravel.id]: refineryGravel,
            [mixerGravel.id]: mixerGravel,
            [foundation.id]: foundation,
            [road.id]: road,
        },
        recipeIdsByOutput: {
            'item:GroundMaterials': [refineryGravel.id, mixerGravel.id],
            'build:structure:foundation01t1': [foundation.id],
            'build:structure:facilityroad': [road.id],
        },
        structureRecipeIdsByStructureId: {
            refinery: [refineryGravel.id],
            concretemixer: [mixerGravel.id],
            foundation01t1: [foundation.id],
            facilityroad: [road.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

const gravelContext = {
    baseAssetsUrl: '/foxhole/assets/',
    index: createGravelIndex(),
    itemCatalog: {
        assetByKey: {
            GroundMaterials: {
                foxholeKey: 'GroundMaterials',
                name: 'Gravel',
                aliases: [],
            },
        },
        assets: [
            {
                foxholeKey: 'GroundMaterials',
                name: 'Gravel',
                aliases: [],
            },
        ],
    } as never,
    structureCatalog: {
        assetByKey: {
            refinery: { foxholeKey: 'refinery', name: 'Refinery', aliases: [] },
            concretemixer: { foxholeKey: 'concretemixer', name: 'Concrete Mixer', aliases: [] },
            foundation01t1: { foxholeKey: 'foundation01t1', name: 'Foundation (1x1)', aliases: [] },
            facilityroad: { foxholeKey: 'facilityroad', name: 'Provisional Road', aliases: [] },
        },
        assets: [],
    } as never,
};

const refineryContext = {
    baseAssetsUrl: '/foxhole/assets/',
    index: createRefineryIndex(),
    structureCatalog,
};

test('FOXHOLE_PRODUCTION_ASSISTANT_TOOLS exposes the production tool descriptors', () => {
    const names = FOXHOLE_PRODUCTION_ASSISTANT_TOOLS.map(tool => tool.name);
    assert.deepEqual(names, [
        'search_production_outputs',
        'list_structure_production',
        'describe_commodity',
        'resolve_production_output',
        'query_production_itinerary',
    ]);
    for (const tool of FOXHOLE_PRODUCTION_ASSISTANT_TOOLS) {
        assert.equal(tool.parameters.type, 'object');
        assert.ok(tool.parameters.properties);
        assert.ok(tool.description.length > 0);
    }
});

test('search_production_outputs returns compact hits', () => {
    const result = executeFoxholeProductionAssistantTool(
        'search_production_outputs',
        { query: 'cloth', limit: 5 },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { outputs: Array<{ commodityKey: string; label: string; producerCount: number; }>; };
    assert.ok(payload.outputs.some(entry => entry.commodityKey === 'item:Cloth'));
    assert.ok(!('searchText' in (payload.outputs[0] ?? {})));
});

test('list_structure_production returns only that structure\'s conversion products', () => {
    const result = executeFoxholeProductionAssistantTool(
        'list_structure_production',
        { structureId: 'structure:refinery' },
        refineryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        structureId: string;
        structureName: string;
        isWorldStructure: boolean;
        products: Array<{ commodityKey: string; label: string; }>;
    };
    assert.equal(payload.structureId, 'refinery');
    assert.equal(payload.structureName, 'Refinery');
    assert.equal(payload.isWorldStructure, true);
    const keys = payload.products.map(entry => entry.commodityKey.toLowerCase());
    assert.ok(keys.includes('item:cloth'));
    assert.ok(keys.includes('liquid:diesel'));
    assert.ok(!keys.some(key => key.includes('facilityrefinerycoal')));
    assert.ok(!payload.products.some(entry => /coal refinery/i.test(entry.label)));
});

test('list_structure_production resolves structure by display name', () => {
    const result = executeFoxholeProductionAssistantTool(
        'list_structure_production',
        { query: 'Refinery' },
        refineryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { structureId: string; products: unknown[]; };
    assert.equal(payload.structureId, 'refinery');
    assert.ok(payload.products.length >= 2);
});

test('resolve_production_output resolves item:Cloth', () => {
    const result = executeFoxholeProductionAssistantTool(
        'resolve_production_output',
        { query: 'item:Cloth' },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { commodityKey: string; };
    assert.equal(payload.commodityKey, 'item:Cloth');
});

test('query_production_itinerary returns steps/leaves and omits plan', () => {
    const result = executeFoxholeProductionAssistantTool(
        'query_production_itinerary',
        {
            query: 'Cloth',
            quantity: 40,
            assumptions: 'full',
            externalSupplyByCommodityKey: {
                'item:Metal': 'unbounded',
            },
        },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        goal: { commodityKey: string; };
        assumptions: string;
        steps: unknown[];
        leafRequirements: unknown[];
        pendingChoices: unknown[];
        plan?: unknown;
    };
    assert.equal(payload.goal.commodityKey, 'item:Cloth');
    assert.equal(payload.assumptions, 'full');
    assert.ok(payload.steps.length > 0);
    assert.ok(payload.leafRequirements.length > 0);
    assert.ok(Array.isArray(payload.pendingChoices));
    assert.equal('plan' in payload, false);
});

test('query_production_itinerary defaults assumptions to public_logi', () => {
    const result = executeFoxholeProductionAssistantTool(
        'query_production_itinerary',
        {
            query: 'Cloth',
            quantity: 20,
            externalSupplyByCommodityKey: {
                'item:Metal': 'unbounded',
            },
        },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { assumptions: string; plan?: unknown; };
    assert.equal(payload.assumptions, 'public_logi');
    assert.equal('plan' in payload, false);

    const descriptor = FOXHOLE_PRODUCTION_ASSISTANT_TOOLS.find(
        tool => tool.name === 'query_production_itinerary',
    );
    assert.ok(descriptor);
    assert.deepEqual(
        (descriptor!.parameters.properties.assumptions as { enum?: string[]; }).enum,
        ['full', 'public_logi'],
    );
});

test('describe_commodity resolves copper to raw Copper with salvage gather sources', () => {
    const result = executeFoxholeProductionAssistantTool(
        'describe_commodity',
        { query: 'copper' },
        copperContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        commodityKey: string;
        resourceId: string;
        gatherSources: Array<{ structureId: string; note?: string; }>;
        useNotes: string | null;
        consumers: Array<{ structureName: string; }>;
    };
    assert.equal(payload.commodityKey, 'item:Copper');
    assert.equal(payload.resourceId, 'Copper');
    assert.ok(payload.gatherSources.some(source => source.structureId === 'salvagefield'));
    assert.ok(payload.useNotes);
    assert.ok(payload.consumers.some(consumer => consumer.structureName === 'Refinery'));
});

test('describe_commodity explains Copper Alloy engineering-center use', () => {
    const result = executeFoxholeProductionAssistantTool(
        'describe_commodity',
        { query: 'Copper Alloy' },
        copperContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        commodityKey: string;
        consumers: unknown[];
        useNotes: string | null;
    };
    assert.equal(payload.commodityKey, 'item:CopperA');
    assert.equal(payload.consumers.length, 0);
    assert.ok(payload.useNotes?.toLowerCase().includes('engineering center'));
});

test('describe_commodity gravel uiBlocks include producers and build consumers', () => {
    const result = executeFoxholeProductionAssistantTool(
        'describe_commodity',
        { query: 'Gravel' },
        gravelContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        commodityKey: string;
        consumers: Array<{ structureId: string; outputLabels: string[]; }>;
        uiBlocks: Array<{ id: string; label: string; }>;
    };
    assert.equal(payload.commodityKey, 'item:GroundMaterials');
    assert.ok(payload.consumers.some(consumer => consumer.structureId === 'foundation01t1'));
    assert.ok(payload.consumers.some(consumer => (
        consumer.structureId === 'foundation01t1'
        && consumer.outputLabels.some(label => /foundation/i.test(label))
    )));
    const ids = payload.uiBlocks.map(block => block.id);
    assert.ok(ids.includes('item:GroundMaterials'));
    assert.ok(ids.includes('item:structure:refinery'));
    assert.ok(ids.includes('item:structure:concretemixer'));
    assert.ok(ids.includes('item:structure:foundation01t1'));
    assert.ok(ids.includes('item:structure:facilityroad'));
});

test('describe_commodity salvage includes description and mine note without craft uiBlocks', () => {
    const salvageRecipe = recipe({
        id: 'structure:refinery:recipe:0',
        sourceStructureId: 'refinery',
        sourceStructureName: 'Refinery',
        itemInput: { Metal: { quantity: 10, limit: null } },
        itemOutput: { Cloth: { quantity: 1, limit: null } },
    });
    const result = executeFoxholeProductionAssistantTool(
        'describe_commodity',
        { query: 'Salvage' },
        {
            baseAssetsUrl: '/foxhole/assets/',
            index: {
                recipeById: { [salvageRecipe.id]: salvageRecipe },
                recipeIdsByOutput: { 'item:Cloth': [salvageRecipe.id] },
                structureRecipeIdsByStructureId: { refinery: [salvageRecipe.id] },
                modificationRecipeIdsBySlotVariantKey: {},
                parentBuildTargetIdByTargetId: {},
            },
            itemCatalog: {
                assetByKey: {
                    metal: {
                        foxholeKey: 'metal',
                        name: 'Salvage',
                        description: 'Salvage that can be recycled into other resources at a Refinery',
                        aliases: [],
                    },
                },
                assets: [],
            } as never,
            structureCatalog: {
                assetByKey: {
                    scrapmine: {
                        foxholeKey: 'scrapmine',
                        name: 'Salvage Mine',
                        description: 'An old mine that automatically gathers Salvage using Fuel.',
                        aliases: [],
                    },
                    salvagefield: {
                        foxholeKey: 'salvagefield',
                        name: 'Salvage Field',
                        description: 'A resource field for collecting Salvage.',
                        aliases: [],
                    },
                    facilitymineresource1: {
                        foxholeKey: 'facilitymineresource1',
                        name: 'Stationary Harvester (Salvage)',
                        description: '',
                        aliases: [],
                    },
                    facilityrefinery1: {
                        foxholeKey: 'facilityrefinery1',
                        name: 'Materials Factory',
                        aliases: [],
                    },
                },
                assets: [],
            } as never,
        },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        commodityKey: string;
        description: string | null;
        gatherSources: Array<{ structureId: string; note?: string; description?: string; }>;
        uiBlocks: Array<{ id: string; }>;
    };
    assert.equal(payload.commodityKey, 'item:Metal');
    assert.ok(payload.description?.toLowerCase().includes('refinery'));
    const mine = payload.gatherSources.find(source => source.structureId === 'scrapmine');
    assert.ok(mine?.note?.toLowerCase().includes('petrol'));
    assert.ok(mine?.description?.toLowerCase().includes('fuel'));
    const ids = payload.uiBlocks.map(block => block.id);
    assert.ok(ids.includes('item:Metal'));
    assert.ok(ids.includes('item:structure:scrapmine'));
    assert.ok(!ids.includes('item:structure:facilityrefinery1'));
});

test('unknown tool name returns ok: false', () => {
    const result = executeFoxholeProductionAssistantTool('nope', {}, itineraryContext);
    assert.equal(result.ok, false);
    if (result.ok) {
        return;
    }
    assert.equal(result.tool, 'nope');
    assert.match(result.error, /unknown tool/i);
});

test('search_production_outputs returns found false when empty', () => {
    const result = executeFoxholeProductionAssistantTool(
        'search_production_outputs',
        { query: 'helicopter that does not exist xyzzy' },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found: boolean;
        error: string;
        query: string;
        outputs: unknown[];
        guidance: string;
    };
    assert.equal(payload.found, false);
    assert.equal(payload.error, 'not_found');
    assert.equal(payload.outputs.length, 0);
    assert.match(payload.query, /helicopter/i);
    assert.match(payload.guidance, /do not invent/i);
    assert.match(payload.guidance, /insists/i);
});

test('resolve_production_output returns found false with query echo', () => {
    const result = executeFoxholeProductionAssistantTool(
        'resolve_production_output',
        { query: 'helicopter-that-does-not-exist' },
        itineraryContext,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found: boolean;
        error: string;
        query: string;
        guidance: string;
    };
    assert.equal(payload.found, false);
    assert.equal(payload.error, 'not_found');
    assert.ok(payload.query);
    assert.match(payload.guidance, /do not invent/i);
});
