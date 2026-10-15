import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { buildFoxholeStructureModAvailabilityContext, filterAvailableModificationVariants,
    isFoxholeModificationSlotAvailable, prepareFoxholeModificationSelection,
    sanitizeFoxholeModificationSelections } from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
for (const key of ['fortt2', 'fortt3', 'fortcornert2', 'fortcornert3']) {
    const asset = catalog.assetByKey[key];
    const infrastructure = asset.modificationSlots.filter(slot => slot.componentType === 'BPFortInfraModSlot_C');
    const walls = asset.modificationSlots.filter(slot => slot.componentType === 'BPFortWallModSlot_C');
    const context = (selections: Record<string, string>) => buildFoxholeStructureModAvailabilityContext({
        nodeId: 'host', asset, buildSockets: [], socketAttachments: {}, modificationVariantIds: selections, sceneNodes: [],
    });

    test(`${key}: infrastructure conflicts only with a firing port on its own wall, in either selection order`, () => {
        for (const infra of infrastructure) {
            for (const wall of walls) {
                const sameWall = infra.linkedSocketNames.some(name => wall.linkedSocketNames.includes(name));
                for (const variant of infra.variants) {
                    const portSelection = { [wall.id]: 'firingport' };
                    const infraSelection = { [infra.id]: variant.id };
                    const combined = { ...portSelection, ...infraSelection };
                    assert.equal(filterAvailableModificationVariants(infra, context(portSelection)).some(value => value.id === variant.id), !sameWall);
                    assert.equal(isFoxholeModificationSlotAvailable(infra, context(portSelection)), !sameWall);
                    assert.equal(filterAvailableModificationVariants(wall, context(infraSelection)).some(value => value.id === 'firingport'), !sameWall);
                    assert.deepEqual(prepareFoxholeModificationSelection(asset, portSelection, infra, variant.id), sameWall ? portSelection : combined);
                    assert.deepEqual(prepareFoxholeModificationSelection(asset, infraSelection, wall, 'firingport'), sameWall ? infraSelection : combined);
                    assert.deepEqual(sanitizeFoxholeModificationSelections(asset, combined, context(combined)), sameWall ? portSelection : combined);
                    assert.deepEqual(portSelection, { [wall.id]: 'firingport' });
                    assert.deepEqual(infraSelection, { [infra.id]: variant.id });
                }
            }
        }
    });

    test(`${key}: removing the port restores infrastructure; doorways remain independent`, () => {
        const infra = infrastructure[0];
        const wall = walls.find(slot => slot.linkedSocketNames.some(name => infra.linkedSocketNames.includes(name)))!;
        const removed = prepareFoxholeModificationSelection(asset, { [wall.id]: 'firingport' }, wall, '');
        assert.ok(filterAvailableModificationVariants(infra, context(removed)).some(value => value.id === 'kitchen'));
        const combined = { [wall.id]: 'door', [infra.id]: 'kitchen' };
        assert.deepEqual(prepareFoxholeModificationSelection(asset, { [wall.id]: 'door' }, infra, 'kitchen'), combined);
        assert.ok(filterAvailableModificationVariants(infra, context(combined)).some(value => value.id === 'kitchen'));
    });
}
