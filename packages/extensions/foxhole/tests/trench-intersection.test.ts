import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveFoxholeOccupiedSocketTags, resolveFoxholeStructureRenderLane,
    shouldShowFoxholeStructureRenderLayer } from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import { buildFoxholeStructureModAvailabilityContext, filterAvailableModificationVariants }
    from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';
import { areFoxholeSnapSocketsCompatible, normalizeFoxholeSocketTags }
    from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { createFoxholeStructureFloorMaskPoints } from '../app/plugins/foxhole/nixie/structure-floor-mask.ts';

const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
const sides = ['Back', 'Front', 'Left', 'Right'];

test('all intersection sides can snap to trenches, connectors, emplacements, bunkers, and intersections', () => {
    for (const tier of [1, 2, 3]) {
        const sockets = catalog.structureByKey[`trenchintt${tier}`]!.buildSockets;
        for (const socket of sockets) {
            const source = { socketName: socket.name, socketTags: normalizeFoxholeSocketTags(socket.socketTags) };
            for (const neighborKey of ['trencht1', 'trencht2', 'trencht3', 'trenchconnectort1', 'trenchconnectort2',
                'trenchconnectort3', 'trenchempt1', 'trenchempt2', 'trenchempt3', 'fortt1', 'fortt2', 'fortt3',
                'trenchintt1', 'trenchintt2', 'trenchintt3']) {
                const targets = catalog.structureByKey[neighborKey]!.buildSockets;
                assert.ok(targets.some(target => areFoxholeSnapSocketsCompatible(source,
                    { socketName: target.name, socketTags: normalizeFoxholeSocketTags(target.socketTags) })),
                `${tier} ${socket.name} ${neighborKey}`);
            }
        }
    }
});

test('intersection connections open wall faces and select tier-specific approach pieces', () => {
    for (const tier of [1, 2, 3]) {
        const key = `trenchintt${tier}`;
        const asset = catalog.assetByKey[key]!;
        const structure = catalog.structureByKey[key]!;
        assert.equal(structure.buildSockets.length, 4);
        assert.equal(asset.renderLayers.length, tier === 3 ? 9 : 17);
        assert.equal(asset.renderLayers.filter(layer => layer.id.startsWith('corner')).length, 4);
        for (const side of sides) {
            const socket = structure.buildSockets.find(socket => socket.name.endsWith(`${side}Socket`))!;
            assert.ok(socket);
            assert.equal(Math.hypot(socket.x ?? 0, socket.y ?? 0), 250);
            const tags = resolveFoxholeOccupiedSocketTags(structure.buildSockets,
                new Set([`intersection:${socket.name}`]), 'intersection');
            assert.deepEqual([...tags], [side.toLowerCase()]);
            for (const layer of asset.renderLayers) {
                const expected = tier === 3 && layer.id.startsWith('corner') ? true : layer.id.startsWith('openwall')
                    ? (layer.componentTags ?? []).includes(side)
                    : !(layer.componentTags ?? []).includes(side);
                assert.equal(shouldShowFoxholeStructureRenderLayer(layer, tags, { structureCodeName: asset.codeName }),
                    expected, `${key} ${side} ${layer.id}`);
                if (layer.id.startsWith('corner')) {
                    assert.equal(resolveFoxholeStructureRenderLane(layer, asset.codeName), 'corners');
                }
            }
        }
        const allTags = new Set(sides.map(side => side.toLowerCase()));
        const openLayers = asset.renderLayers.filter(layer => shouldShowFoxholeStructureRenderLayer(layer,
            allTags, { structureCodeName: asset.codeName }));
        assert.equal(openLayers.length, tier === 3 ? 5 : 9);
        assert.ok(openLayers.every(layer => layer.id === 'floor'
            || (tier === 3 ? layer.id.startsWith('corner') : layer.id.startsWith('openwall'))));
    }
});

test('intersection floors retain socket-reaching pixels but reveal only connected approaches', () => {
    for (const tier of [1, 2, 3]) {
        const asset = catalog.assetByKey[`trenchintt${tier}`]!;
        const floor = asset.renderLayers.find(layer => layer.id === 'floor')!;
        assert.ok(floor.width >= 320 && floor.height >= 320, '5 m source footprint must reach the authored sockets');
        for (let mask = 0; mask < 16; mask++) {
            const occupied = new Set(sides.filter((_side, index) => mask & (1 << index)).map(side => side.toLowerCase()));
            const points = createFoxholeStructureFloorMaskPoints(asset.codeName, floor, 320, occupied);
            assert.ok(points.length >= 4);
            assert.equal(Math.min(...points.map(point => point.x)), occupied.has('back') ? -160 : -96);
            assert.equal(Math.max(...points.map(point => point.x)), occupied.has('front') ? 160 : 96);
            assert.equal(Math.min(...points.map(point => point.y)), occupied.has('left') ? -160 : -96);
            assert.equal(Math.max(...points.map(point => point.y)), occupied.has('right') ? 160 : 96);
            assert.ok(points.every(point => Math.abs(point.x) <= 96 || Math.abs(point.y) <= 96),
                'approaches must not reveal dirt beyond the diagonal corners');
        }
    }
});

test('intersection defense mods are per side and only T3 offers a roof', () => {
    for (const tier of [1, 2, 3]) {
        const key = `trenchintt${tier}`;
        const asset = catalog.assetByKey[key]!;
        const structure = catalog.structureByKey[key]!;
        const defenseSlots = asset.modificationSlots.filter(slot => slot.componentType === 'BPTrenchDefenseModSlot_C');
        assert.equal(defenseSlots.length, 4);
        const roofSlots = asset.modificationSlots.filter(slot => slot.variants.some(variant => variant.id === 'trenchroof'));
        assert.equal(roofSlots.length, tier === 3 ? 1 : 0);
        for (const side of sides) {
            const socket = structure.buildSockets.find(socket => socket.name.endsWith(`${side}Socket`))!;
            const neighborKey = 'trencht2';
            const neighbor = { nodeId: 'neighbor', foxholeKey: neighborKey,
                buildSockets: catalog.structureByKey[neighborKey]!.buildSockets, socketAttachments: {} };
            const context = buildFoxholeStructureModAvailabilityContext({ nodeId: 'intersection', asset,
                buildSockets: structure.buildSockets, modificationVariantIds: {},
                socketAttachments: { [socket.name]: { nodeId: 'neighbor', socketName: 'BackSocket' } },
                sceneNodes: [neighbor] });
            for (const slot of defenseSlots) {
                const linked = slot.linkedSocketNames.includes(`${side}Socket`);
                assert.deepEqual(filterAvailableModificationVariants(slot, context).map(variant => variant.id),
                    linked ? [] : ['barbedwire', 'sandbags'], `${key} ${side} ${slot.name}`);
                assert.equal(slot.variantById.sandbags!.name, 'Berm');
                assert.ok(slot.variantById.sandbags!.textureUrl);
                assert.ok(slot.variantById.barbedwire!.textureUrl?.includes(`/${key}/`));
            }
            for (const slot of roofSlots) {
                assert.deepEqual(filterAvailableModificationVariants(slot, context).map(variant => variant.id), ['trenchroof']);
            }
        }
    }
});
