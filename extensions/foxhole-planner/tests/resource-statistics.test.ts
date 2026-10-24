import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFoxholeEcsResources, resolveFoxholeStatisticsCosts } from '../src/resource-statistics.ts';
import type { FoxholeResourceStatisticsAsset } from '../src/resource-statistics.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

test('resource totals retain authored costs, modification choices and legacy volume/power/maintenance rules', () => {
    const assets: Record<string, FoxholeResourceStatisticsAsset> = {
        facilitypipe: { codeName: 'FacilityPipe', isItem: false, statistics: { cost: { Material: 10 }, modificationCosts: { slot: { chosen: { Material: 2 } } },
            powerDelta: -2000, decays: true, fuelCapacity: 3, inventorySlots: 4, repairCost: 5 } },
        facilitysilooil: { codeName: 'FacilitySiloOil', isItem: false, statistics: { cost: {}, modificationCosts: {}, powerDelta: 4000, decaySupplyDrain: 2, fuelCapacity: 0 } },
        item: { codeName: 'Item', isItem: true, statistics: { cost: { Material: 999 }, modificationCosts: {}, fuelCapacity: 0 } },
    };
    const entities: NixieExperimentalComponentEntitySnapshotV1[] = Object.keys(assets).map((assetId): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: assetId, revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
            data: { selections: [{ slotId: 'slot', variantId: 'chosen' }] } },
    ] }));
    const before = structuredClone(entities);
    const result = aggregateFoxholeEcsResources(entities, assets, 1800);
    assert.deepEqual(result.costs, [{ resourceId: 'material', quantity: 12 }]);
    assert.deepEqual(result.liquid, { total: 5100, silo: 5000, pipeline: 100 });
    assert.deepEqual(result.power, { producedMw: 4, consumedMw: 2, netMw: 2 });
    assert.equal(result.maintenanceSupplies, 1.5);
    assert.equal(result.missingCostCount, 1);
    assert.equal(result.repairCost, 5);
    assert.equal(result.inventorySlots, 4);
    assert.deepEqual(entities, before);
});

test('construction ancestry uses the authored upgrade eligibility rather than browser filter classification', () => {
    const assets: Record<string, FoxholeResourceStatisticsAsset> = {
        base: { codeName: 'Base', isItem: false, isUpgrade: true, statistics: { cost: { Cloth: 35 }, modificationCosts: {}, upgradeCodeName: 'Tier3', canBackfillUpgrade: true, fuelCapacity: 0 } },
        tier3: { codeName: 'Tier3', isItem: false, statistics: { cost: { Concrete: 10 }, modificationCosts: {}, fuelCapacity: 0 } },
    };
    resolveFoxholeStatisticsCosts(assets, {});
    assert.deepEqual(assets.tier3!.statistics!.cost, { Cloth: 35, Concrete: 10 });
});
