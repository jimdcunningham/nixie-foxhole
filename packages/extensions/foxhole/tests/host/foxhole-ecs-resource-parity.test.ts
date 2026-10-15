import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { aggregateFoxholeEcsResources } from '../../../../../extensions/foxhole-planner/src/resource-statistics.ts';
import { getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeStructureLiquidCapacity, resolveFoxholeLiquidCapacityKind, accumulateFoxholeLiquidCapacity, createEmptyFoxholeLiquidCapacityBreakdown } from '../../app/plugins/foxhole/nixie/liquid-capacity.ts';
import { resolveFoxholePowerDeltaMw, accumulateFoxholeFacilityPower, createEmptyFoxholeFacilityPowerBreakdown } from '../../app/plugins/foxhole/nixie/facility-power.ts';
import { resolveFoxholeMaintenanceSupplyDrain, resolveFoxholeMaintenanceSuppliesForInterval } from '../../app/plugins/foxhole/nixie/maintenance-supplies.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const quantities = (source: Record<string, { quantity: number; }>) => Object.fromEntries(Object.entries(source).map(([id, resource]) => [id, resource.quantity]));

test('SDK structure and modification costs match the bundled resolved catalog', () => {
    for (const asset of catalog.assets) {
        const sdk = assets[asset.foxholeKey]!;
        assert.ok(sdk, asset.foxholeKey);
        assert.deepEqual(sdk.statistics!.cost, quantities(catalog.structureByKey[asset.foxholeKey]!.totalCost ?? asset.cost), asset.foxholeKey);
        for (const slot of asset.modificationSlots) {
            for (const variant of slot.variants) {
                assert.deepEqual(sdk.statistics!.modificationCosts[slot.id]?.[variant.id], quantities(variant.cost), `${asset.foxholeKey}/${slot.id}/${variant.id}`);
            }
        }
    }
});

test('ECS liquid, power, maintenance and construction totals match bundled scope rules', () => {
    const entities: NixieExperimentalComponentEntitySnapshotV1[] = catalog.assets.map(asset => ({ entityId: asset.foxholeKey, revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId: asset.foxholeKey } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
                data: { selections: asset.modificationSlots.flatMap(slot => slot.variants[0] ? [{ slotId: slot.id, variantId: slot.variants[0].id }] : []) } }] }));
    const costs = new Map<string, number>();
    const liquid = createEmptyFoxholeLiquidCapacityBreakdown();
    const power = createEmptyFoxholeFacilityPowerBreakdown();
    let maintenance = 0;
    let missing = 0;
    for (const asset of catalog.assets) {
        const structure = catalog.structureByKey[asset.foxholeKey]!;
        let published = false;
        for (const source of [structure.totalCost ?? structure.cost, ...asset.modificationSlots.flatMap(slot => slot.variants[0] ? [slot.variants[0].cost] : [])]) {
            for (const [id, resource] of Object.entries(source)) {
                if (!Number.isFinite(resource.quantity) || resource.quantity <= 0) {
                    continue;
                }
                published = true;
                const key = id.trim().toLowerCase();
                costs.set(key, (costs.get(key) ?? 0) + resource.quantity);
            }
        }
        if (!published) {
            missing += 1;
        }
        accumulateFoxholeLiquidCapacity(liquid, resolveFoxholeStructureLiquidCapacity({ foxholeKey: asset.foxholeKey, codeName: structure.codeName,
            legacyKey: structure.legacyKey, liquidCapacity: structure.liquidCapacity }), resolveFoxholeLiquidCapacityKind(asset.foxholeKey, structure.codeName, structure.legacyKey));
        accumulateFoxholeFacilityPower(power, resolveFoxholePowerDeltaMw(structure.powerGridInfo?.powerDelta));
        maintenance += resolveFoxholeMaintenanceSupplyDrain(structure);
    }
    const before = structuredClone(entities);
    for (const interval of [900, 3600, 259200]) {
        const actual = aggregateFoxholeEcsResources(entities, assets, interval);
        assert.deepEqual(actual.liquid, liquid);
        assert.deepEqual(actual.power, power);
        assert.equal(actual.maintenanceSupplies, resolveFoxholeMaintenanceSuppliesForInterval(maintenance, interval));
        assert.equal(actual.missingCostCount, missing);
        assert.deepEqual(actual.costs, [...costs].map(([resourceId, quantity]) => ({ resourceId, quantity })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)));
    }
    assert.deepEqual(entities, before);
});
