import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeStructureCatalog,
    getFoxholeStructureAsset,
} from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import {
    buildFoxholeStructureModAvailabilityContext,
    computeFoxholeSocketConnectionMask,
    filterAvailableModificationVariants,
    isFoxholeModificationSlotBlocked,
    isFoxholeModificationVariantAvailable,
    prepareFoxholeModificationSelection,
    sanitizeFoxholeModificationSelections,

} from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';
import type { FoxholeStructureModAvailabilitySceneNode } from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';

const BASE_ASSETS_URL = '/foxhole/assets/';
const manifest = getFoxholeManifest(BASE_ASSETS_URL);
const catalog = buildFoxholeStructureCatalog(manifest);

function getStructure(foxholeKey: string) {
    const asset = getFoxholeStructureAsset(foxholeKey, BASE_ASSETS_URL);
    const structure = catalog.structureByKey[foxholeKey];
    assert.ok(asset);
    assert.ok(structure);
    return { asset, structure };
}

function createSceneNode(
    nodeId: string,
    foxholeKey: string,
): FoxholeStructureModAvailabilitySceneNode {
    const structure = catalog.structureByKey[foxholeKey];
    assert.ok(structure);
    return {
        nodeId,
        foxholeKey,
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {},
    };
}

function findSlot(asset: ReturnType<typeof getStructure>['asset'], slotName: string) {
    const slot = asset.modificationSlots.find(entry => entry.name === slotName);
    assert.ok(slot, `missing slot ${slotName}`);
    return slot;
}

function findVariant(
    asset: ReturnType<typeof getStructure>['asset'],
    slotName: string,
    variantId: string,
) {
    const slot = findSlot(asset, slotName);
    const variant = slot.variantById[variantId];
    assert.ok(variant, `missing variant ${variantId}`);
    return { slot, variant };
}

test('computeFoxholeSocketConnectionMask stays empty without socket attachments', () => {
    const { asset, structure } = getStructure('artilleryait1');

    const connectionMask = computeFoxholeSocketConnectionMask({
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {},
        sceneNodes: [],
    });

    assert.equal(connectionMask, 0n);
    assert.equal(asset.foxholeKey, 'artilleryait1');
});

test('back fort socket connection hides infra variants such as bunkbed', () => {
    const { asset, structure } = getStructure('artilleryait2');
    const neighbor = createSceneNode('neighbor-1', 'fortbaset1');
    const { slot, variant } = findVariant(asset, 'BackInfraModSlot', 'bunkbed');

    const context = buildFoxholeStructureModAvailabilityContext({
        nodeId: 'artillery-1',
        asset,
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {
            BackFortSocket: {
                nodeId: neighbor.nodeId,
                socketName: 'FrontFortSocket',
            },
        },
        modificationVariantIds: {},
        sceneNodes: [neighbor],
    });

    assert.equal(isFoxholeModificationVariantAvailable(variant, context, slot), false);
    assert.equal(
        filterAvailableModificationVariants(findSlot(asset, 'BackInfraModSlot'), context)
            .some(entry => entry.id === 'bunkbed'),
        false,
    );
});

test('a joined back wall does not hide Desk on the other walls of the pasted bunker', () => {
    const { asset, structure } = getStructure('fortt3');
    const neighbor = createSceneNode('d5dc7d9d-1f94-4bbb-8c05-a48d92c9cd9f', 'fortt3');
    const context = buildFoxholeStructureModAvailabilityContext({
        nodeId: 'bb008667-5aa5-4e56-ab71-d9abb44e5811', asset,
        buildSockets: structure.buildSockets,
        socketAttachments: { 'FortCommon:BackFortSocket': {
            nodeId: neighbor.nodeId, socketName: 'FortCommon:FrontFortSocket',
        } },
        modificationVariantIds: { FrontInfraModSlot: 'desk' }, sceneNodes: [neighbor],
    });
    for (const slotName of ['FrontInfraModSlot', 'LeftInfraModSlot', 'RightInfraModSlot']) {
        assert.ok(filterAvailableModificationVariants(findSlot(asset, slotName), context).some(variant => variant.id === 'desk'), slotName);
    }
    assert.equal(filterAvailableModificationVariants(findSlot(asset, 'BackInfraModSlot'), context).some(variant => variant.id === 'desk'), false);
    assert.deepEqual(sanitizeFoxholeModificationSelections(asset, { FrontInfraModSlot: 'desk' }, context), { FrontInfraModSlot: 'desk' });
});

test('wall-local furniture conditions do not inherit other connections in a joined bunker group', () => {
    const sides = ['Back', 'Front', 'Left', 'Right'];
    for (const tier of ['fortt2', 'fortt3']) {
        const { asset, structure } = getStructure(tier);
        for (const connectedSide of sides) {
            const host = createSceneNode('host', tier);
            const neighbor = createSceneNode('neighbor', tier);
            const remote = createSceneNode('remote', tier);
            host.socketAttachments = { [`FortCommon:${connectedSide}FortSocket`]: { nodeId: 'neighbor', socketName: 'FortCommon:FrontFortSocket' } };
            neighbor.socketAttachments = {
                'FortCommon:FrontFortSocket': { nodeId: 'host', socketName: `${connectedSide}FortSocket` },
                'FortCommon:BackFortSocket': { nodeId: 'remote', socketName: 'FrontFortSocket' },
            };
            remote.socketAttachments = { FrontFortSocket: { nodeId: 'neighbor', socketName: 'BackFortSocket' } };
            const selections = Object.fromEntries(sides.map(side => [`${side}InfraModSlot`, 'desk']));
            const context = buildFoxholeStructureModAvailabilityContext({ nodeId: 'host', asset,
                buildSockets: structure.buildSockets, socketAttachments: host.socketAttachments,
                modificationVariantIds: selections, sceneNodes: [host, neighbor, remote] });
            for (const side of sides) {
                const slot = findSlot(asset, `${side}InfraModSlot`);
                assert.equal(filterAvailableModificationVariants(slot, context).some(variant => variant.id === 'desk'),
                    side !== connectedSide, `${tier}/${connectedSide}/${side}`);
            }
            assert.deepEqual(sanitizeFoxholeModificationSelections(asset, selections, context),
                Object.fromEntries(sides.filter(side => side !== connectedSide).map(side => [`${side}InfraModSlot`, 'desk'])));
        }
    }
});

test('door variant requires wall connection and hides when back fort is connected', () => {
    const { asset, structure } = getStructure('fortt2');
    const { slot, variant } = findVariant(asset, 'BackModSlot', 'door');

    const isolatedContext = buildFoxholeStructureModAvailabilityContext({
        nodeId: 'fort-1',
        asset,
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {},
        modificationVariantIds: {},
        sceneNodes: [],
    });
    assert.equal(isFoxholeModificationVariantAvailable(variant, isolatedContext, slot), false);

    const connectedBackContext = buildFoxholeStructureModAvailabilityContext({
        nodeId: 'fort-1',
        asset,
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {
            BackFortSocket: {
                nodeId: 'neighbor-1',
                socketName: 'FrontFortSocket',
            },
        },
        modificationVariantIds: {},
        sceneNodes: [createSceneNode('neighbor-1', 'fortbaset1')],
    });
    assert.equal(isFoxholeModificationVariantAvailable(variant, connectedBackContext, slot), false);
});

test('doorway is available only on bunker walls joined to trench-family sockets', () => {
    for (const tier of [1, 2, 3]) {
        const { asset, structure } = getStructure(`fortt${tier}`);
        for (const side of ['Back', 'Front', 'Left', 'Right']) {
            const { slot, variant } = findVariant(asset, `${side}ModSlot`, 'door');
            for (const neighborKey of ['trencht1', 'trencht2', 'trencht3', 'trenchintt1', 'trenchintt2', 'trenchintt3',
                'trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3']) {
                const neighbor = createSceneNode('trench', neighborKey);
                const context = buildFoxholeStructureModAvailabilityContext({
                    nodeId: 'host', asset, buildSockets: structure.buildSockets,
                    socketAttachments: { [`FortCommon:${side}FortSocket`]: { nodeId: 'trench', socketName: 'FrontSocket' } },
                    modificationVariantIds: { [slot.id]: 'door' }, sceneNodes: [neighbor],
                });
                const label = `fortt${tier}/${side}/${neighborKey}`;
                assert.equal(isFoxholeModificationVariantAvailable(variant, context, slot), true, label);
                assert.deepEqual(sanitizeFoxholeModificationSelections(asset, context.modificationVariantIds, context),
                    { [slot.id]: 'door' }, label);
                const otherSide = side === 'Back' ? 'Front' : 'Back';
                const other = findVariant(asset, `${otherSide}ModSlot`, 'door');
                assert.equal(isFoxholeModificationVariantAvailable(other.variant, context, other.slot), false, label);
            }
        }
    }
});

test('blockedByModSlotNames still lists variants and prepare clears blockers on exchange', () => {
    const { asset, structure } = getStructure('trencht2');
    const bridgeSlot = findSlot(asset, 'BridgeModSlot');
    const defenseSlot = findSlot(asset, 'LeftMiddleDefenseModSlot');
    const barbedwireVariantId = defenseSlot.variants.find(entry => entry.id === 'barbedwire')?.id;
    assert.ok(barbedwireVariantId);

    const context = buildFoxholeStructureModAvailabilityContext({
        nodeId: 'trench-1',
        asset,
        buildSockets: structure.buildSockets ?? [],
        socketAttachments: {},
        modificationVariantIds: {
            [defenseSlot.id]: barbedwireVariantId,
        },
        sceneNodes: [],
    });

    assert.equal(isFoxholeModificationSlotBlocked(bridgeSlot, context), true);
    assert.equal(
        filterAvailableModificationVariants(bridgeSlot, context).some(entry => entry.id === 'bridge'),
        true,
    );

    const exchanged = prepareFoxholeModificationSelection(
        asset,
        context.modificationVariantIds,
        bridgeSlot,
        'bridge',
    );
    assert.deepEqual(exchanged, {
        [bridgeSlot.id]: 'bridge',
    });
});

test('sanitizeFoxholeModificationSelections drops invalid variants after socket changes', () => {
    const { asset, structure } = getStructure('artilleryait2');
    const infraSlot = findSlot(asset, 'BackInfraModSlot');

    const sanitized = sanitizeFoxholeModificationSelections(
        asset,
        { [infraSlot.id]: 'bunkbed' },
        {
            nodeId: 'artillery-1',
            buildSockets: structure.buildSockets ?? [],
            socketAttachments: {
                BackFortSocket: {
                    nodeId: 'neighbor-1',
                    socketName: 'FrontFortSocket',
                },
            },
            sceneNodes: [createSceneNode('neighbor-1', 'fortbaset1')],
        },
    );

    assert.deepEqual(sanitized, {});
});

test('selecting infrastructure replaces every other wall choice on the same bunker piece', () => {
    for (const tier of ['fortt2', 'fortt3']) {
        const { asset } = getStructure(tier);
        const slots = asset.modificationSlots.filter(slot => slot.componentType === 'BPFortInfraModSlot_C');
        assert.equal(slots.length, 4);
        const defenseSlot = findSlot(asset, 'BackDefenseModSlot');
        const defenseId = defenseSlot.variants[0].id;
        const existing = { ...Object.fromEntries(slots.map(slot => [slot.id, 'bunkbed'])), [defenseSlot.id]: defenseId };
        for (const slot of slots) {
            for (const variant of slot.variants) {
                const selected = prepareFoxholeModificationSelection(asset, existing, slot, variant.id);
                assert.deepEqual(selected, { [slot.id]: variant.id, [defenseSlot.id]: defenseId }, `${tier}/${slot.id}/${variant.id}`);
            }
        }
        assert.equal(Object.keys(existing).length, 5, 'selection must not mutate the original map');
    }
});

test('clearing or rejecting an infrastructure choice leaves other selections intact', () => {
    const { asset } = getStructure('fortt3');
    const front = findSlot(asset, 'FrontInfraModSlot');
    const left = findSlot(asset, 'LeftInfraModSlot');
    const existing = { [front.id]: 'desk', [left.id]: 'kitchen' };
    for (const variantId of ['', 'unknown-variant']) {
        assert.deepEqual(prepareFoxholeModificationSelection(asset, existing, front, variantId), { [left.id]: 'kitchen' });
    }
});

test('selecting an unrelated modification preserves infrastructure and separate pieces', () => {
    const { asset } = getStructure('fortt3');
    const front = findSlot(asset, 'FrontInfraModSlot');
    const left = findSlot(asset, 'LeftInfraModSlot');
    const ladder = findSlot(asset, 'FortRoofModSlot');
    const firstPiece = { [front.id]: 'desk' };
    const secondPiece = { [left.id]: 'kitchen' };
    assert.deepEqual(prepareFoxholeModificationSelection(asset, firstPiece, ladder, ladder.variants[0].id),
        { ...firstPiece, [ladder.id]: ladder.variants[0].id });
    assert.deepEqual(prepareFoxholeModificationSelection(asset, firstPiece, left, 'desk'), { [left.id]: 'desk' });
    assert.deepEqual(firstPiece, { [front.id]: 'desk' });
    assert.deepEqual(secondPiece, { [left.id]: 'kitchen' });
});
