import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { isFoxholeRoofRenderLayer } from '../src/structure-render-layer-visibility.ts';
import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';

const entity = (assetId: string): NixieComponentEntitySnapshotV1 => ({ entityId: 'bunker', revision: 1, components: [
    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
        data: { catalogId: 'foxhole.structures', assetId } },
] });

test('observation bunker flags hide together with their roofs in planar and model views', () => {
    for (const id of ['observationbunkert1', 'observationbunkert2', 'observationbunkert3']) {
        const asset = assets[id]!;
        const flag = asset.renderLayers.teamflagmesh!;
        assert.equal(isFoxholeRoofRenderLayer({ id: 'teamflagmesh', ...flag }, asset.codeName), true, id);
        const normal = renderFoxholeSceneV2Entity(entity(id));
        const hidden = renderFoxholeSceneV2Entity(entity(id), { contractVersion: 1, entities: [], settings: { 'foxhole.structure.hideRoofs': true } });
        assert.ok(normal.root.children.some(node => node.id === 'structure-layer-teamflagmesh'));
        assert.ok(!hidden.root.children.some(node => node.id === 'structure-layer-teamflagmesh'));
        for (const name of asset.model!.structuralProfile!.layers.teamflagmesh!) {
            assert.ok(!normal.spatial?.hiddenModelNodes?.includes(name));
            assert.ok(hidden.spatial?.hiddenModelNodes?.includes(name));
        }
    }
    assert.equal(isFoxholeRoofRenderLayer({ id: 'teamflagmesh' }, 'UnrelatedStructure'), false);
});

test('roof hover fades completely, includes flags, and leaves Hide Roofs authoritative', () => {
    const subject = entity('observationbunkert3');
    const before = structuredClone(subject);
    const hover = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'foxhole.structure.hideRoofsOnHover': true, 'foxhole.structure.useStaticRender': true } }));
    assert.equal(hover.hover!.opacity, 0);
    assert.equal(hover.hover!.fadeDurationMs, 110);
    assert.ok(hover.hover!.hiddenNodeIds!.includes('structure-layer-teamflagmesh'));
    assert.ok(hover.hover!.hiddenModelNodes!.includes('structure-layer-teamflagmesh'));
    assert.ok(hover.hover!.hiddenModelNodes!.includes('structure-layer-observationbunkert3'));
    assert.ok(!hover.hover!.hiddenNodeIds!.includes('structure-layer-floor'));
    assert.deepEqual(subject, before);
    const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'foxhole.structure.hideRoofsOnHover': true, 'foxhole.structure.hideRoofs': true } });
    assert.equal(hidden.hover, undefined);
    assert.ok(hidden.spatial!.hiddenModelNodes!.includes('structure-layer-teamflagmesh'));
    assert.equal(renderFoxholeSceneV2Entity(subject).hover, undefined);
});

test('an Inspector preview reveals interior bunker modifications in planar and model views', () => {
    const subject = entity('fortt3');
    subject.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
        data: { selections: [{ slotId: 'BackInfraModSlot', variantId: 'lockers' }] } });
    const normal = renderFoxholeSceneV2Entity(subject);
    const preview = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'nixie.scene.inspectorPreview': true, 'foxhole.structure.useStaticRender': true } });
    const asset = assets.fortt3!;
    const roofs = Object.entries(asset.renderLayers).filter(([id, layer]) =>
        isFoxholeRoofRenderLayer({ id, ...layer }, asset.codeName));
    assert.ok(roofs.length);
    for (const [id] of roofs) {
        assert.ok(normal.root.children.some(node => node.id === 'structure-layer-' + id), id);
        assert.ok(!preview.root.children.some(node => node.id === 'structure-layer-' + id), id);
        for (const name of asset.model?.structuralProfile?.layers[id] ?? []) {
            assert.ok(preview.spatial?.hiddenModelNodes?.includes(name), name);
        }
    }
    assert.ok(preview.root.children.some(node => node.id.startsWith('modification-')));
});

test('Inspector upgrade previews reveal bunker interiors and retain rooftop equipment', () => {
    const rooms = { engineroom: 'skeletalmesh', ammoroom: 'ammoroom', fortflame: 'fortflame', fortfirepit: 'firepitmesh',
        medicalroom: 'medicalroommesh', fortartilleryshelter: 'artilleryshelter' };
    for (const [room, interiorLayer] of Object.entries(rooms)) {
        for (const tier of [1, 2, 3]) {
            const id = room + 't' + tier;
            const asset = assets[id];
            if (!asset) continue;
            const subject = entity(id);
            const normal = renderFoxholeSceneV2Entity(subject);
            const preview = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
                settings: { 'nixie.scene.inspectorPreview': true, 'foxhole.structure.useStaticRender': true } });
            const roofs = Object.entries(asset.renderLayers).filter(([id, layer]) =>
                isFoxholeRoofRenderLayer({ id, ...layer }, asset.codeName));
            assert.ok(roofs.length, id);
            if (room === 'medicalroom') {
                assert.ok(roofs.some(([layerId]) => layerId === 'staticmesh'), id + ': ladder must hide with the roof');
            }
            for (const [layerId] of roofs) {
                assert.ok(normal.root.children.some(node => node.id === 'structure-layer-' + layerId), id);
                assert.ok(!preview.root.children.some(node => node.id === 'structure-layer-' + layerId), id + ': ' + layerId);
                for (const name of asset.model?.structuralProfile?.layers[layerId] ?? []) {
                    assert.ok(preview.spatial?.hiddenModelNodes?.includes(name), id + ': ' + name);
                }
            }
            assert.ok(preview.root.children.some(node => node.id === 'structure-layer-' + interiorLayer), id);
            for (const name of asset.model?.structuralProfile?.layers[interiorLayer] ?? []) {
                assert.ok(!preview.spatial?.hiddenModelNodes?.includes(name), id + ': ' + name);
            }
        }
    }
    for (const [id, layer] of [['fortradart3', 'radarmesh'], ['observationbunkert3', 'observationbunkert3'], ['mgait3', 'topmesh'], ['fortrampt3', 'floor']]) {
        const subject = entity(id!);
        const preview = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
            settings: { 'nixie.scene.inspectorPreview': true } });
        assert.ok(preview.root.children.some(node => node.id === 'structure-layer-roof'), id);
        assert.ok(preview.root.children.some(node => node.id === 'structure-layer-' + layer), id);
    }
});

test('Observation Bunker draws its upper section above the roof in 2D', () => {
    for (const tier of [1, 2, 3]) {
        const id = 'observationbunkert' + tier;
        const subject = entity(id);
        for (const settings of [undefined, { 'nixie.scene.inspectorPreview': true }]) {
            const { root } = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], settings });
            const roof = root.children.findIndex(node => node.id === 'structure-layer-roof');
            const top = root.children.findIndex(node => node.id === 'structure-layer-' + id);
            const flag = root.children.findIndex(node => node.id === 'structure-layer-teamflagmesh');
            assert.ok(roof >= 0 && top > roof && flag > top, id);
            assert.ok(root.children[flag]!.laneOrder! >= root.children[top]!.laneOrder!, id);
            assert.ok(root.children[top]!.laneOrder! >= root.children[roof]!.laneOrder!, id);
        }
    }
});

test('the Interior Firing Port preview hides the bunker roof', () => {
    const subject = entity('fortt3');
    subject.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
        data: { selections: [{ slotId: 'BackFortInteriorFiringPortModSlot', variantId: 'interiorfiringport' }] } });
    const normal = renderFoxholeSceneV2Entity(subject);
    const preview = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'nixie.scene.inspectorPreview': true } });
    assert.ok(normal.root.children.some(node => node.id === 'structure-layer-roof'));
    assert.ok(!preview.root.children.some(node => node.id === 'structure-layer-roof'));
    assert.ok(preview.root.children.some(node => node.id.startsWith('modification-')));
    assert.ok(preview.spatial?.hiddenModelNodes?.includes('structure-layer-roof'));
});

test('connected roof hover follows fort sockets while excluding foundation sockets and unrelated structures', () => {
    const subject = entity('fortt3'), neighbor = entity('observationbunkert3');
    neighbor.entityId = 'neighbor';
    const socket = assets.fortt3!.buildSockets.find(socket => socket.socketTags?.some(tag => tag.category === 4 && (tag.mask & ~8) !== 0))!;
    assert.ok(socket);
    subject.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: socket.name, targetEntityId: 'neighbor', targetSocketName: socket.name }] } });
    const context = { contractVersion: 1 as const, entities: [subject, neighbor], settings: { 'foxhole.structure.hideRoofsOnHover': true } };
    assert.deepEqual(renderFoxholeSceneV2Entity(subject, context).hover!.relatedEntityIds, ['neighbor']);
    neighbor.components[0]!.data.assetId = 'facilityrefinery1';
    assert.deepEqual(renderFoxholeSceneV2Entity(subject, context).hover!.relatedEntityIds, []);
});

test('every modeled structural asset publishes valid bounded hover visibility', () => {
    for (const [id, asset] of Object.entries(assets)) {
        if (!asset.model?.structuralProfile) continue;
        assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity(id),
            { contractVersion: 1, entities: [], settings: { 'foxhole.structure.hideRoofsOnHover': true } })), id);
    }
});

test('roof-mounted flags on garrisons and intelligence buildings hide with fixed and hovered roofs', () => {
    const ids = ['artilleryait1', 'artilleryait2', 'artilleryait3', 'atgunait1', 'atgunait2', 'atgunait3',
        'mgait1', 'mgait2', 'mgait3', 'rifleait1', 'rifleait2', 'rifleait3',
        'observationbunkert1', 'observationbunkert2', 'observationbunkert3', 'fortradart1', 'fortradart2', 'fortradart3',
        'intelcenter', 'fortlargeradar', 'lrartillery', 'weatherstation'];
    for (const id of ids) {
        const asset = assets[id]!, subject = entity(id);
        const flags = Object.entries(asset.renderLayers).filter(([layerId]) => /^(?:team)?flag(?:mesh)?\d*$/.test(layerId));
        assert.ok(flags.length, `${id} must exercise a real flag layer`);
        const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], settings: { 'foxhole.structure.hideRoofs': true } });
        const hovered = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
            settings: { 'foxhole.structure.hideRoofsOnHover': true } }));
        for (const [layerId, layer] of flags) {
            assert.equal(isFoxholeRoofRenderLayer({ id: layerId, ...layer }, asset.codeName), true, `${id}:${layerId}`);
            assert.ok(hovered.hover!.hiddenNodeIds!.includes(`structure-layer-${layerId}`), `${id}:${layerId} planar hover`);
            for (const node of asset.model!.structuralProfile!.layers[layerId]!) {
                assert.ok(hidden.spatial!.hiddenModelNodes!.includes(node), `${id}:${node} fixed roof hiding`);
                assert.ok(hovered.hover!.hiddenModelNodes!.includes(node), `${id}:${node} model hover`);
            }
        }
        assert.equal(hovered.hover!.opacity, 0);
        assert.equal(hovered.hover!.fadeDurationMs, 110);
    }
    assert.equal(isFoxholeRoofRenderLayer({ id: 'flagmesh' }, 'UnrelatedStructure'), false);
});

test('roof hover resolves unqualified and generated bunker socket names across connected structures', () => {
    const first = entity('atgunait2'), middle = entity('fortt2'), last = entity('mgait2'), foundation = entity('fortt2');
    first.entityId = 'first';
    middle.entityId = 'middle';
    last.entityId = 'last';
    foundation.entityId = 'foundation';
    const attachments = (subject: NixieComponentEntitySnapshotV1, links: Array<{ localSocketName: string; targetEntityId: string; targetSocketName: string; }>) => {
        subject.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1,
            definitionAvailable: true, data: { attachments: links } });
    };
    attachments(first, [{ localSocketName: 'RightFortSocket', targetEntityId: 'middle', targetSocketName: 'LeftFortSocket' }]);
    attachments(middle, [{ localSocketName: 'FortCommon:LeftFortSocket_GEN_VARIABLE', targetEntityId: 'first', targetSocketName: 'RightFortSocket' },
        { localSocketName: 'FrontFortSocket', targetEntityId: 'last', targetSocketName: 'BackFortSocket' },
        { localSocketName: 'FoundationSocket', targetEntityId: 'foundation', targetSocketName: 'FoundationSocket' }]);
    attachments(last, [{ localSocketName: 'BackFortSocket', targetEntityId: 'middle', targetSocketName: 'FrontFortSocket' }]);
    const context = { contractVersion: 1 as const, entities: [first, middle, last, foundation], settings: { 'foxhole.structure.hideRoofsOnHover': true } };
    assert.deepEqual(renderFoxholeSceneV2Entity(first, context).hover!.relatedEntityIds, ['middle']);
    assert.deepEqual(renderFoxholeSceneV2Entity(middle, context).hover!.relatedEntityIds, ['first', 'last']);
    assert.deepEqual(renderFoxholeSceneV2Entity(last, context).hover!.relatedEntityIds, ['middle']);
});
