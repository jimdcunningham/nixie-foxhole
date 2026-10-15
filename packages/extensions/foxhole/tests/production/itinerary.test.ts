import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeProductionItineraryRouteOptions,
    collectFoxholeProductionItineraryLeafRequirements,
    listFoxholeProductionOutputs,
    projectFoxholeProductionItinerarySteps,
    queryFoxholeProductionItinerary,
    resolveFoxholeProductionOutputRef,
    searchFoxholeProductionOutputs,
} from '../../app/plugins/foxhole/nixie/production/itinerary.ts';
import { planFoxholeProduction } from '../../app/plugins/foxhole/nixie/production/planner.ts';
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

function createTestIndex(): FoxholeProductionIndex {
    const dieselRecipe = recipe({
        id: 'structure:facilitypowerdiesel:recipe:0',
        sourceStructureId: 'facilitypowerdiesel',
        sourceStructureName: 'Diesel Power Plant',
        durationSeconds: 45,
        liquidInput: { Diesel: { quantity: 25, limit: 1000 } },
        // power-only; no item output — use a craftable mat instead for simple chain
    });

    const bmatsRecipe = recipe({
        id: 'structure:facilityrefinery1:recipe:0',
        sourceStructureId: 'facilityrefinery1',
        sourceStructureName: 'Materials Factory',
        durationSeconds: 25,
        itemInput: { Metal: { quantity: 10, limit: null } },
        itemOutput: { Cloth: { quantity: 20, limit: null } },
    });

    // Tradeoff pair: neither Pareto-dominates (cheaper vs faster).
    const steelRecipeA = recipe({
        id: 'structure:facilityrefinery2:recipe:0',
        sourceStructureId: 'facilityrefinery2',
        sourceStructureName: 'Metalworks A',
        durationSeconds: 120,
        itemInput: { Cloth: { quantity: 3, limit: null } },
        itemOutput: { FacilityMaterials3: { quantity: 1, limit: null } },
    });

    const steelRecipeB = recipe({
        id: 'structure:facilityrefinery2b:recipe:0',
        sourceStructureId: 'facilityrefinery2b',
        sourceStructureName: 'Metalworks B',
        durationSeconds: 30,
        itemInput: { Cloth: { quantity: 12, limit: null } },
        itemOutput: { FacilityMaterials3: { quantity: 1, limit: null } },
    });

    // World refinery route for Cloth that needs Petrol (town-logi fork).
    const bmatsWorldRecipe = recipe({
        id: 'structure:worldrefinery:recipe:0',
        sourceStructureId: 'worldrefinery',
        sourceStructureName: 'Refinery',
        durationSeconds: 20,
        itemInput: { Salvage: { quantity: 10, limit: null } },
        liquidInput: { Petrol: { quantity: 5, limit: null } },
        itemOutput: { Cloth: { quantity: 20, limit: null } },
    });

    // Ambiguous Petrol producers (facility-only) — stall without public_logi external.
    const petrolRecipeA = recipe({
        id: 'structure:facilityoilrefinery:recipe:0',
        sourceStructureId: 'facilityoilrefinery',
        sourceStructureName: 'Oil Refinery A',
        durationSeconds: 60,
        liquidInput: { Oil: { quantity: 50, limit: null } },
        liquidOutput: { Petrol: { quantity: 1, limit: null } },
    });

    const petrolRecipeB = recipe({
        id: 'structure:facilityoilrefineryb:recipe:0',
        sourceStructureId: 'facilityoilrefineryb',
        sourceStructureName: 'Oil Refinery B',
        durationSeconds: 30,
        liquidInput: { Oil: { quantity: 80, limit: null } },
        liquidOutput: { Petrol: { quantity: 1, limit: null } },
    });

    // Give diesel plant a real output for search tests
    dieselRecipe.itemOutput = { PowerToken: { quantity: 1, limit: null } };

    return {
        recipeById: {
            [dieselRecipe.id]: dieselRecipe,
            [bmatsRecipe.id]: bmatsRecipe,
            [bmatsWorldRecipe.id]: bmatsWorldRecipe,
            [steelRecipeA.id]: steelRecipeA,
            [steelRecipeB.id]: steelRecipeB,
            [petrolRecipeA.id]: petrolRecipeA,
            [petrolRecipeB.id]: petrolRecipeB,
        },
        recipeIdsByOutput: {
            'item:PowerToken': [dieselRecipe.id],
            'item:Cloth': [bmatsRecipe.id, bmatsWorldRecipe.id],
            'item:FacilityMaterials3': [steelRecipeA.id, steelRecipeB.id],
            'liquid:Petrol': [petrolRecipeA.id, petrolRecipeB.id],
        },
        structureRecipeIdsByStructureId: {
            facilitypowerdiesel: [dieselRecipe.id],
            facilityrefinery1: [bmatsRecipe.id],
            worldrefinery: [bmatsWorldRecipe.id],
            facilityrefinery2: [steelRecipeA.id],
            facilityrefinery2b: [steelRecipeB.id],
            facilityoilrefinery: [petrolRecipeA.id],
            facilityoilrefineryb: [petrolRecipeB.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

function createWorldStructureCatalog() {
    return {
        assets: [],
        assetByKey: {
            worldrefinery: { isWorldStructure: true, name: 'Refinery' },
            facilityrefinery1: { isWorldStructure: false, name: 'Materials Factory' },
            facilityrefinery2: { isWorldStructure: false, name: 'Metalworks A' },
            facilityrefinery2b: { isWorldStructure: true, name: 'Metalworks B' },
        },
    } as any;
}

test('searchFoxholeProductionOutputs finds a known output by id', () => {
    const index = createTestIndex();
    const hits = searchFoxholeProductionOutputs('cloth', index);
    assert.ok(hits.some(entry => entry.commodityKey === 'item:Cloth'));
    assert.equal(resolveFoxholeProductionOutputRef('item:Cloth', index)?.commodityKey, 'item:Cloth');
});

test('listFoxholeProductionOutputs enumerates producer samples', () => {
    const index = createTestIndex();
    const entries = listFoxholeProductionOutputs(index);
    const steel = entries.find(entry => entry.commodityKey === 'item:FacilityMaterials3');
    assert.ok(steel);
    assert.equal(steel!.producerCount, 2);
    assert.ok(steel!.sampleProducerNames.length >= 1);
});

test('itinerary for a simple single-recipe output returns leaf then produce steps', () => {
    const index = createTestIndex();
    const result = queryFoxholeProductionItinerary({
        index,
        demand: { channel: 'item', resourceId: 'Cloth', quantity: 40 },
        assumptions: 'full',
        preferredRecipeIdByOutput: {
            'item:Cloth': 'structure:facilityrefinery1:recipe:0',
        },
        externalSupplyByCommodityKey: {
            'item:Metal': 'unbounded',
        },
    });

    assert.equal(result.goal.commodityKey, 'item:Cloth');
    assert.equal(result.status, 'ok');
    assert.equal(result.assumptions, 'full');
    assert.deepEqual(result.pendingChoices, []);
    assert.ok(result.steps.some(step => step.kind === 'obtain'));
    assert.ok(result.steps.some(step => step.kind === 'produce' && step.recipeId?.includes('facilityrefinery1')));
    assert.ok(result.leafRequirements.length >= 1);
    const metalLeaf = result.leafRequirements.find(leaf => leaf.commodityKey === 'item:Metal');
    assert.ok(metalLeaf);
    assert.ok(metalLeaf!.gatherSources?.some(source => source.structureId === 'salvagefield'));

    const produceIndex = result.steps.findIndex(step => step.kind === 'produce');
    const leafStepIndex = result.steps.findIndex(step => step.kind === 'obtain');
    assert.ok(leafStepIndex >= 0);
    assert.ok(produceIndex >= 0);
    assert.ok(leafStepIndex < produceIndex, 'leaves should appear before produce steps');
    assert.match(String(result.steps[leafStepIndex]?.summary ?? ''), /Salvage Field/);
});

test('ambiguous output surfaces choose steps and blockers', () => {
    const index = createTestIndex();
    const result = queryFoxholeProductionItinerary({
        index,
        demand: { channel: 'item', resourceId: 'FacilityMaterials3', quantity: 1 },
        assumptions: 'full',
        externalSupplyByCommodityKey: {
            'item:Cloth': 'unbounded',
        },
    });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.assumptions, 'full');
    assert.ok(result.steps.some(step => step.kind === 'choose'));
    assert.ok(result.blockers.some(blocker => blocker.kind === 'ambiguous'));
    assert.ok(
        (result.steps.find(step => step.kind === 'choose')?.candidateRecipeIds.length ?? 0) >= 2,
    );

    const steps = projectFoxholeProductionItinerarySteps(result.plan, index);
    assert.ok(steps.some(step => step.kind === 'choose'));
});

test('choose steps include ranked route options with labels', () => {
    const index = createTestIndex();
    const structureCatalog = createWorldStructureCatalog();
    const result = queryFoxholeProductionItinerary({
        index,
        structureCatalog,
        demand: { channel: 'item', resourceId: 'FacilityMaterials3', quantity: 1 },
        assumptions: 'full',
        externalSupplyByCommodityKey: {
            'item:Cloth': 'unbounded',
        },
    });

    const choose = result.steps.find(step => step.kind === 'choose');
    assert.ok(choose);
    assert.ok(choose!.options.length >= 2);
    assert.ok(choose!.options.every(option => option.label.length > 0));
    assert.equal(choose!.options[0]!.isWorldStructure, true);
    assert.equal(choose!.options[0]!.structureId, 'facilityrefinery2b');
    assert.ok(result.pendingChoices.some(choice => choice.commodityKey === 'item:FacilityMaterials3'));
    assert.ok((result.pendingChoices[0]?.options.length ?? 0) >= 2);

    const ranked = buildFoxholeProductionItineraryRouteOptions(
        index,
        'item:FacilityMaterials3',
        1,
        index.recipeIdsByOutput['item:FacilityMaterials3']!,
        { structureCatalog },
    );
    assert.equal(ranked[0]!.recipeId, 'structure:facilityrefinery2b:recipe:0');
    assert.ok(ranked[0]!.rankHints.includes('worldStructure'));
});

test('public_logi prefers world Cloth recipe and treats Petrol as external', () => {
    const index = createTestIndex();
    const structureCatalog = createWorldStructureCatalog();

    const full = queryFoxholeProductionItinerary({
        index,
        structureCatalog,
        demand: { channel: 'item', resourceId: 'Cloth', quantity: 100 },
        assumptions: 'full',
    });
    assert.equal(full.status, 'ambiguous');
    assert.ok(
        full.pendingChoices.some(choice => choice.commodityKey === 'liquid:Petrol')
        || full.steps.some(step => step.kind === 'choose' && step.commodityKey === 'liquid:Petrol')
        || full.steps.some(step => step.kind === 'choose' && step.commodityKey === 'item:Cloth'),
        'full assumptions should stall on a route choice',
    );

    const publicLogi = queryFoxholeProductionItinerary({
        index,
        structureCatalog,
        demand: { channel: 'item', resourceId: 'Cloth', quantity: 100 },
        assumptions: 'public_logi',
    });
    assert.equal(publicLogi.assumptions, 'public_logi');
    assert.ok(
        !publicLogi.pendingChoices.some(choice => choice.commodityKey === 'liquid:Petrol'),
        'public_logi should not leave a Petrol choose pending',
    );
    assert.ok(
        !publicLogi.steps.some(step => step.kind === 'choose' && step.commodityKey === 'liquid:Petrol'),
    );
    assert.ok(publicLogi.steps.some(step => (
        step.kind === 'produce'
        && step.recipeId === 'structure:worldrefinery:recipe:0'
    )));
    assert.ok(publicLogi.leafRequirements.some(leaf => (
        leaf.commodityKey === 'liquid:Petrol' && leaf.source === 'external'
    )));
    assert.notEqual(publicLogi.status, 'ambiguous');
});

test('public_logi keeps multiple Refinery gravel recipes choosable', () => {
    const result = queryFoxholeProductionItinerary({
        baseAssetsUrl: '/foxhole/assets/',
        demand: { channel: 'item', resourceId: 'GroundMaterials', quantity: 1 },
        assumptions: 'public_logi',
    });
    assert.equal(result.status, 'ambiguous');
    const choice = result.pendingChoices.find(entry => entry.commodityKey === 'item:GroundMaterials');
    assert.ok(choice);
    assert.equal(choice!.options.length, 2);
    assert.ok(choice!.options.every(option => option.structureId === 'refinery'));
    assert.ok(choice!.options.every(option => option.label.includes('·')));
    assert.ok(choice!.options.some(option => /Coal/i.test(option.label)));
    assert.ok(choice!.options.some(option => /Salvage|Metal/i.test(option.label)));
    assert.ok(result.steps.some(step => (
        step.kind === 'choose'
        && (step.title.includes('Gravel') || step.title.includes('Ground Materials'))
    )));
    assert.ok(result.steps.some(step => step.title.startsWith('Choose') || step.kind === 'choose'));
    const choose = result.steps.find(step => step.kind === 'choose');
    assert.ok(choose?.options.every(option => option.label.includes('·')));
});

test('itinerary step titles use xN amount formatting', () => {
    const index = createTestIndex();
    const result = queryFoxholeProductionItinerary({
        index,
        demand: { channel: 'item', resourceId: 'Cloth', quantity: 20 },
        preferredRecipeIdByOutput: {
            'item:Cloth': 'structure:facilityrefinery1:recipe:0',
        },
        externalSupplyByCommodityKey: {
            'item:Metal': 'unbounded',
        },
    });
    assert.ok(result.steps.some(step => /x\d+/.test(step.title)));
    assert.ok(!result.steps.some(step => /×/.test(step.title)));
});

test('scene snapshots attach board coverage summary', () => {
    const index = createTestIndex();
    const result = queryFoxholeProductionItinerary({
        index,
        demand: { channel: 'item', resourceId: 'Cloth', quantity: 20 },
        preferredRecipeIdByOutput: {
            'item:Cloth': 'structure:facilityrefinery1:recipe:0',
        },
        externalSupplyByCommodityKey: {
            'item:Metal': 'unbounded',
        },
        sceneSnapshots: [{
            nodeId: 'node-1',
            state: {
                foxholeKey: 'facilityrefinery1',
                modificationVariantIds: {},
            },
        }],
    });

    assert.ok(result.board);
    assert.equal(
        result.board!.coveredRequirementCount
        + result.board!.upgradeableRequirementCount
        + result.board!.uncoveredRequirementCount,
        result.board!.rows.length,
    );
    assert.ok(result.board!.rows.some(row => row.structureId === 'facilityrefinery1'));
});

test('leaf requirement collector aggregates obtain nodes', () => {
    const index = createTestIndex();
    const plan = planFoxholeProduction(index, {
        demands: [{ channel: 'item', resourceId: 'Cloth', quantity: 20 }],
        preferredRecipeIdByOutput: {
            'item:Cloth': 'structure:facilityrefinery1:recipe:0',
        },
        externalSupplyByCommodityKey: {
            'item:Metal': 'unbounded',
        },
    });
    const leaves = collectFoxholeProductionItineraryLeafRequirements(plan);
    assert.ok(leaves.some(leaf => leaf.commodityKey === 'item:Metal'));
});

test('world structure rebuild costs are framed as reconstruction, not free placement', () => {
    const index = createTestIndex();
    const rebuildRecipe = recipe({
        id: 'build:structure:worldrefinery:recipe:0',
        sourceStructureId: 'worldrefinery',
        sourceStructureName: 'Refinery',
        itemInput: { Cloth: { quantity: 400, limit: null } },
        buildOutput: { 'structure:worldrefinery': { quantity: 1, limit: null } },
        durationSeconds: null,
        powerDelta: null,
    });
    index.recipeById[rebuildRecipe.id] = rebuildRecipe;
    index.recipeIdsByOutput['build:structure:worldrefinery'] = [rebuildRecipe.id];

    const structureCatalog = createWorldStructureCatalog();
    const result = queryFoxholeProductionItinerary({
        index,
        structureCatalog,
        demand: { channel: 'build', resourceId: 'structure:worldrefinery', quantity: 1 },
        assumptions: 'full',
        externalSupplyByCommodityKey: {
            'item:Cloth': 'unbounded',
        },
    });

    assert.equal(result.goal.isWorldStructure, true);
    assert.equal(result.goal.label, 'Refinery');
    const buildStep = result.steps.find(step => step.kind === 'build');
    assert.ok(buildStep);
    assert.equal(buildStep!.isWorldStructure, true);
    assert.match(buildStep!.title, /^Rebuild /);
    assert.match(buildStep!.summary, /World structure/i);
    assert.match(buildStep!.summary, /cannot place/i);
    assert.match(buildStep!.summary, /Construction Vehicle/i);
    assert.doesNotMatch(buildStep!.title, /^Build /);
});
