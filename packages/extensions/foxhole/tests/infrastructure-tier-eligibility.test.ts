import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { buildFoxholeStructureModAvailabilityContext, filterAvailableModificationVariants,
    isFoxholeModificationSlotAvailable, prepareFoxholeModificationSelection,
    sanitizeFoxholeModificationSelections } from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const infra = 'BPFortInfraModSlot_C';

test('published T1 bunkers, corners and garrisons do not expose infrastructure', () => {
    for (const id of ['fortt1', 'fortcornert1', 'artilleryait1', 'atgunait1', 'mgait1', 'rifleait1', 'fortradart1', 'observationbunkert1']) {
        assert.equal(catalog.assetByKey[id].modificationSlots.some(slot => slot.componentType === infra), false, id);
    }
});

test('stale T1 metadata cannot offer, select or retain infrastructure', () => {
    const allowed = catalog.assetByKey.fortt2;
    const slot = allowed.modificationSlots.find(slot => slot.componentType === infra)!;
    const small = allowed.modificationSlots.find(slot => slot.componentType !== infra && !slot.variants.some(variant => variant.isUpgrade))!;
    for (const tier of [1, 2, 3]) {
        const asset = { ...allowed, tier };
        const selected = { [slot.id]: 'kitchen', [small.id]: small.variants[0].id };
        const context = buildFoxholeStructureModAvailabilityContext({ nodeId: 'host', asset,
            buildSockets: [], socketAttachments: {}, modificationVariantIds: selected, sceneNodes: [] });
        assert.equal(filterAvailableModificationVariants(slot, context).some(variant => variant.id === 'kitchen'), tier !== 1);
        assert.equal(isFoxholeModificationSlotAvailable(slot, context), tier !== 1);
        assert.deepEqual(prepareFoxholeModificationSelection(asset, {}, slot, 'kitchen'), tier === 1 ? {} : { [slot.id]: 'kitchen' });
        assert.deepEqual(sanitizeFoxholeModificationSelections(asset, selected, context), tier === 1 ? { [small.id]: small.variants[0].id } : selected);
    }
});

test('T2/T3 bunkers, corners and garrisons retain infrastructure without new network prerequisites', () => {
    for (const tier of [2, 3]) {
        for (const prefix of ['fortt', 'fortcornert', 'artilleryait', 'atgunait', 'mgait', 'rifleait', 'fortradart', 'observationbunkert']) {
            const asset = catalog.assetByKey[`${prefix}${tier}`];
            const slots = asset.modificationSlots.filter(slot => slot.componentType === infra);
            assert.ok(slots.length, asset.foxholeKey);
            const context = buildFoxholeStructureModAvailabilityContext({ nodeId: 'host', asset,
                buildSockets: [], socketAttachments: {}, modificationVariantIds: {}, sceneNodes: [] });
            for (const slot of slots) assert.ok(filterAvailableModificationVariants(slot, context).some(variant => variant.id === 'kitchen'), `${asset.foxholeKey}/${slot.id}`);
        }
    }
});
