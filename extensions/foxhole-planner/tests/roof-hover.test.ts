import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { isFoxholeRoofRenderLayer } from '../src/structure-render-layer-visibility.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

const entity = (assetId: string): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: 'bunker', revision: 1, components: [
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
            assert.ok(!normal.experimentalSpatial?.hiddenModelNodes?.includes(name));
            assert.ok(hidden.experimentalSpatial?.hiddenModelNodes?.includes(name));
        }
    }
    assert.equal(isFoxholeRoofRenderLayer({ id: 'teamflagmesh' }, 'UnrelatedStructure'), false);
});

test('roof hover hides immediately and completely, includes flags, and leaves Hide Roofs authoritative', () => {
    const subject = entity('observationbunkert3');
    const before = structuredClone(subject);
    const hover = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'foxhole.structure.hideRoofsOnHover': true, 'foxhole.structure.useStaticRender': true } }));
    assert.equal(hover.experimentalHover!.opacity, 0);
    assert.equal(hover.experimentalHover!.fadeDurationMs, 0);
    assert.ok(hover.experimentalHover!.hiddenNodeIds!.includes('structure-layer-teamflagmesh'));
    assert.ok(hover.experimentalHover!.hiddenModelNodes!.includes('structure-layer-teamflagmesh'));
    assert.ok(hover.experimentalHover!.hiddenModelNodes!.includes('structure-layer-observationbunkert3'));
    assert.ok(!hover.experimentalHover!.hiddenNodeIds!.includes('structure-layer-floor'));
    assert.deepEqual(subject, before);
    const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'foxhole.structure.hideRoofsOnHover': true, 'foxhole.structure.hideRoofs': true } });
    assert.equal(hidden.experimentalHover, undefined);
    assert.ok(hidden.experimentalSpatial!.hiddenModelNodes!.includes('structure-layer-teamflagmesh'));
    assert.equal(renderFoxholeSceneV2Entity(subject).experimentalHover, undefined);
});

test('connected roof hover follows fort sockets while excluding foundation sockets and unrelated structures', () => {
    const subject = entity('fortt3'), neighbor = entity('observationbunkert3');
    neighbor.entityId = 'neighbor';
    const socket = assets.fortt3!.buildSockets.find(socket => socket.socketTags?.some(tag => tag.category === 4 && (tag.mask & ~8) !== 0))!;
    assert.ok(socket);
    subject.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: [{ localSocketName: socket.name, targetEntityId: 'neighbor', targetSocketName: socket.name }] } });
    const context = { contractVersion: 1 as const, entities: [subject, neighbor], settings: { 'foxhole.structure.hideRoofsOnHover': true } };
    assert.deepEqual(renderFoxholeSceneV2Entity(subject, context).experimentalHover!.relatedEntityIds, ['neighbor']);
    neighbor.components[0]!.data.assetId = 'facilityrefinery1';
    assert.deepEqual(renderFoxholeSceneV2Entity(subject, context).experimentalHover!.relatedEntityIds, []);
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
            assert.ok(hovered.experimentalHover!.hiddenNodeIds!.includes(`structure-layer-${layerId}`), `${id}:${layerId} planar hover`);
            for (const node of asset.model!.structuralProfile!.layers[layerId]!) {
                assert.ok(hidden.experimentalSpatial!.hiddenModelNodes!.includes(node), `${id}:${node} fixed roof hiding`);
                assert.ok(hovered.experimentalHover!.hiddenModelNodes!.includes(node), `${id}:${node} model hover`);
            }
        }
        assert.equal(hovered.experimentalHover!.opacity, 0);
        assert.equal(hovered.experimentalHover!.fadeDurationMs, 0);
    }
    assert.equal(isFoxholeRoofRenderLayer({ id: 'flagmesh' }, 'UnrelatedStructure'), false);
});
