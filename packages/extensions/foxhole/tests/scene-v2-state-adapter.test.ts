import { prepareFoxholePreviewAssets } from '../app/utils/scene-v2-preview-assets.ts';
import { setActiveNixieStructureModificationHoverPreview } from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { buildFoxholeSceneV2RenderPreview } from '../app/plugins/foxhole/nixie/scene-v2-inspector-preview.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { NixieSceneV2TransformFinalizerAdapter } from '../../../nixie/app/utils/nixie-scene-v2-transform-finalizer-adapter.ts';
import { finalizeFoxholeSceneV2Transform } from '../../../../extensions/foxhole-planner/src/scene-v2-transform-finalizer.ts';
import { buildNixieSceneV2GeometryWheelUpdates } from '../../../nixie/desktop-extensions/scene-v2-geometry-wheel.ts';
import { foxholeConnectorGeometryWheel } from '../../../../extensions/foxhole-planner/src/connector-gesture-policy.ts';
import assets from '../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../../../../extensions/foxhole-planner/src/scene-v2-spline-connectors.ts';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentDefinitionV1 } from '@nixiejs/extension-sdk';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NixieSceneV2ComponentHost } from '../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { NIXIE_SCENE_V2_CORE_COMPONENTS } from '../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { foxholeSceneV2StateAdapter } from '../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import { getFoxholeRangeSelectionLocalBounds } from '../app/plugins/nixie/board/types/foxhole-range.ts';
import { resolveFoxholeRangeState } from '../app/plugins/foxhole/nixie/range.ts';
import { getPolylineEditableLocalHandles, movePolylineLocalVertex } from '../../../nixie/app/plugins/nixie/board/utils/polyline-editing.ts';
import type { FoxholeRangeState } from '../app/plugins/foxhole/nixie/range.ts';
import { registerNixieSceneV2StateAdapter } from '../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { getNixieSceneV2EditableHandles, buildNixieSceneV2EditableHandleUpdates, previewNixieSceneV2EditableHandleUpdates } from '../../../nixie/app/utils/nixie-scene-v2-editable-handles.ts';
import { NixieSceneV2EditorRuntimeController } from '../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { getFoxholeTriangulationSelectionLocalBounds } from '../app/plugins/nixie/board/types/foxhole-triangulation.ts';
import { resolveFoxholeTriangulationState } from '../app/plugins/foxhole/nixie/triangulation.ts';
import { getFoxholeSplineLocalEditableHandles } from '../app/plugins/foxhole/nixie/spline-connector-handles.ts';
import { normalizeFoxholeSplineConnectorState } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveNixieSceneV2Transforms } from '../../../nixie/desktop-extensions/scene-v2-transforms.ts';
import { resolveFoxholePowerlineSelectionQuad } from '../app/plugins/foxhole/nixie/connector.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeStructureTierMutation } from '../app/plugins/foxhole/nixie/structure-tier-actions.ts';
import { resolveFoxholeStructureDimensions } from '../app/plugins/foxhole/nixie/structure-dimensions.ts';
import { collectNixieSceneV2FoxholeSockets, isNixieSceneV2FoxholeSocketAvailable } from '../app/plugins/foxhole/nixie/scene-v2-socket-geometry.ts';

test('composite facet hosts use Native primary-sprite dimensions across operational and alternative visuals', () => {
    const { host, id } = fixture();
    const asset = getFoxholeStructureCatalog('/foxhole/assets/').assetByKey.artilleryait1!;
    assert.ok(asset.renderLayers.length > 1);
    assert.deepEqual(foxholeSceneV2StateAdapter.hitboxHostMetrics!(host.readEntity(id)),
        { width: 308, height: 178.5, anchorX: 0.5, anchorY: 0.5 });
    for (const state of [{ packaged: true, destroyed: true }, { packaged: false, destroyed: true }, { packaged: false, destroyed: false }]) {
        const entity = host.readEntity(id);
        const appearance = { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1,
            definitionAvailable: true, data: state };
        const alternative = state.packaged && asset.packaged ? asset.packaged : state.destroyed ? asset.destroyed : null;
        const dimensions = resolveFoxholeStructureDimensions(asset, alternative, null);
        assert.deepEqual(foxholeSceneV2StateAdapter.hitboxHostMetrics!({ ...entity,
            components: [...entity.components.filter(component => component.componentId !== 'appearance'), appearance] }),
        { width: Math.max(1, dimensions.width ?? 1), height: Math.max(1, dimensions.height ?? 1), anchorX: 0.5, anchorY: 0.5 });
    }
    const source = host.exportDocument();
    assert.equal(foxholeSceneV2StateAdapter.hitboxHostMetrics!({ ...host.readEntity(id),
        components: host.readEntity(id).components.map(component => ({ ...component, definitionAvailable: false })) }), null);
    assert.deepEqual(host.exportDocument(), source);
    assert.deepEqual(resolveFoxholeStructureDimensions({ width: 616, height: 357 }, { width: null, height: 100 },
        { textureWidth: 300, textureHeight: null }), { width: 150, height: null });
});

test('tier 1 and 2 trenches trim vertical selection padding while tier 3 keeps its sprite bounds', () => {
    for (const [id, maximumHeight] of [['trencht1', 110], ['trencht2', 140], ['trencht3', 170]] as const) {
        const { host, id: entityId } = fixture('foxholeAsset', { foxholeKey: id });
        const bounds = foxholeSceneV2StateAdapter.selectionLocalBounds!(host.readEntity(entityId), 1)!;
        assert.ok(bounds.maxY - bounds.minY < maximumHeight, id);
        assert.equal(bounds.maxX - bounds.minX, id === 'trencht3' ? 771 * 0.5 : 784 * 0.5 + 6);
        if (id === 'trencht3') {
            assert.equal(bounds.maxY - bounds.minY, 327 * 0.5);
        }
    }
});

test('power placement targets hovered structure sockets and reanchors like Native without intermediate writes', () => {
    const { host } = fixture();
    const converted = convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 0 }, children: [] },
        { id: 'switch', type: 'foxholeAsset', state: { foxholeKey: 'powerbox', x: -256, y: 192 }, children: [] },
        { id: 'line', type: 'foxholeSplineConnector', state: { foxholeKey: 'powerline',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 192, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 3.2, maxLength: 800 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    host.replaceDocument(converted.content);
    const entities = host.listEntities();
    const before = host.exportDocument();
    const line = entities[2]!;
    const placement = foxholeSceneV2StateAdapter.startPlacement!(line)!;
    const context = (index: number, worldPoint: { x: number; y: number; }) => ({ entities, worldPoint,
        hoveredEntityIds: [entities[index]!.entityId], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) });
    assert.equal(placement.confirm({ x: -109.5, y: 56 }, context(0, { x: -109.5, y: 56 })).complete, false);
    const result = placement.confirm({ x: -248.5, y: 193 }, context(1, { x: -248.5, y: 193 }));
    assert.equal(result.complete, true);
    const preview = previewNixieSceneV2EditableHandleUpdates(line, result.updates);
    const transform = preview.components.find(component => component.componentId === 'transform')!.data;
    const spline = preview.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.ok(Math.abs(Number(transform.x) + 109.20288) < 1e-9);
    assert.ok(Math.abs(Number(transform.y) - 55.86112) < 1e-9);
    assert.deepEqual([spline.startX, spline.startY], [0, 0]);
    assert.ok(Math.abs(Number(spline.endX) + 108.39712) < 1e-9);
    assert.ok(Math.abs(Number(spline.endY) - 136.15168) < 1e-9);
    assert.equal(spline.startAttachmentNodeId, entities[0]!.entityId);
    assert.equal(spline.endAttachmentNodeId, entities[1]!.entityId);
    assert.deepEqual(host.exportDocument(), before);
});

registerNixieSceneV2StateAdapter('nixie.foxhole-planner', foxholeSceneV2StateAdapter);

test('liquid pipeline previews snap and anchor both endpoints before the finalizer', () => {
    const { host } = fixture();
    const converted = convertNixieSceneV1ToV2([
        { id: 'source', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 160 }, children: [] },
        { id: 'sink', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 209.8336, y: -160, rotation: Math.PI }, children: [] },
        { id: 'pipe', type: 'foxholeSplineConnector', state: { foxholeKey: 'facilitypipe',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 96, maxLength: 640 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    host.replaceDocument(converted.content);
    const entities = host.listEntities();
    const before = host.exportDocument();
    const pipe = entities[2]!;
    const placement = foxholeSceneV2StateAdapter.startPlacement!(pipe)!;
    const context = (worldPoint: { x: number; y: number; }) => ({ entities, worldPoint,
        hoveredEntityIds: [], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) });
    const start = { x: 114.5, y: 104 };
    const hover = previewNixieSceneV2EditableHandleUpdates(pipe, placement.update(start, false, context(start)));
    const hoverSpline = hover.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.ok(Math.abs(Number(hoverSpline.startX) - 104.9168) < 1e-9);
    assert.ok(Math.abs(Number(hoverSpline.startY) - 100.04) < 1e-9);
    assert.equal(hoverSpline.startAttachmentNodeId, entities[0]!.entityId);
    assert.equal(placement.confirm(start, context(start)).complete, false);
    const end = { x: 112.5, y: -95 };
    const result = placement.confirm(end, context(end));
    assert.equal(result.complete, true);
    const preview = previewNixieSceneV2EditableHandleUpdates(pipe, result.updates);
    const transform = preview.components.find(component => component.componentId === 'transform')!.data;
    const spline = preview.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.ok(Math.abs(Number(transform.x) - 104.9168) < 1e-9);
    assert.ok(Math.abs(Number(transform.y) - 100.04) < 1e-9);
    assert.deepEqual([spline.startX, spline.startY], [0, 0]);
    assert.ok(Math.abs(Number(spline.endX)) < 1e-9);
    assert.ok(Math.abs(Number(spline.endY) + 200.08) < 1e-9);
    assert.equal(spline.startAttachmentNodeId, entities[0]!.entityId);
    assert.equal(spline.endAttachmentNodeId, entities[1]!.entityId);
    assert.deepEqual(host.exportDocument(), before);
});

test('older Barbed Wire splines expose endpoint targets without reusing an occupied socket', () => {
    const { host } = fixture();
    const converted = convertNixieSceneV1ToV2([{ id: 'wire', type: 'foxholeSplineConnector', state: {
        foxholeKey: 'barbedwirespline', start: { x: 0, y: 0, rotation: 0 },
        end: { x: 160, y: 0, rotation: 0 },
    }, children: [] }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const data = converted.content.entities[0]!.components.find(component => component.componentId === 'spline-connector')!.data;
    delete data.startSocketName;
    delete data.endSocketName;
    data.startAttachmentNodeId = 'occupied';
    data.startAttachmentSocketName = 'FrontSocket';
    host.replaceDocument(converted.content);
    const entities = host.listEntities();
    const context = { entities, worldPoint: { x: 0, y: 0 }, hoveredEntityIds: [], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) };
    const sockets = collectNixieSceneV2FoxholeSockets(context);
    assert.deepEqual(sockets.map(socket => socket.socketName), ['BackSocket', 'FrontSocket']);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, sockets[0]!, 'new-wire', 'FrontSocket'), false);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, sockets[1]!, 'new-wire', 'FrontSocket'), true);
});

test('pipe side placement uses Native connector targets and rejects occupied endpoints', () => {
    const { host } = fixture();
    host.replaceDocument(convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 160 }, children: [] },
        { id: 'target-pipe', type: 'foxholeSplineConnector', state: { foxholeKey: 'facilitypipe', x: 104.9168, y: 100.04,
            start: { x: 0, y: 0, rotation: -Math.PI / 2 }, end: { x: 0, y: -200.08, rotation: Math.PI / 2 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
            startAttachment: { nodeId: 'plant', socketName: 'PipeInput0' }, minLength: 96, maxLength: 640 }, children: [] },
        { id: 'new-pipe', type: 'foxholeSplineConnector', state: { foxholeKey: 'facilitypipe',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 96, maxLength: 640 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content);
    const entities = host.listEntities();
    const target = entities[1]!;
    const moving = entities[2]!;
    const context = { entities, worldPoint: { x: 0, y: 0 }, hoveredEntityIds: [], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) };
    const sockets = collectNixieSceneV2FoxholeSockets(context).filter(socket => socket.nodeId === target.entityId);
    assert.deepEqual(sockets.map(socket => socket.socketName), ['BackSocket', 'FrontSocket', 'LeftSocket', 'RightSocket']);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, sockets[0]!, moving.entityId, 'BackSocket'), false);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, sockets[2]!, moving.entityId, 'BackSocket'), true);
    const side = sockets[2]!;
    context.worldPoint = { x: side.x + 4, y: side.y + 4 };
    const before = host.exportDocument();
    const placement = foxholeSceneV2StateAdapter.startPlacement!(moving)!;
    const preview = previewNixieSceneV2EditableHandleUpdates(moving, placement.update(context.worldPoint, false, context));
    const spline = preview.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.equal(spline.startAttachmentNodeId, target.entityId);
    assert.equal(spline.startAttachmentSocketName, 'LeftSocket');
    assert.ok(Math.abs(Number(spline.startX) - side.x) < 1e-9);
    assert.ok(Math.abs(Number(spline.startY) - side.y) < 1e-9);
    assert.deepEqual(host.exportDocument(), before);
});

test('placement occupancy matches Native aliases and counts every power endpoint', () => {
    const { host } = fixture();
    const multi = getFoxholeManifest('/foxhole/assets/').assets.find(asset => Number(asset.powerGridInfo?.maxConnections) > 1)!;
    assert.ok(multi);
    const converted = convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel',
            socketAttachments: { 'Blueprint:PipeInput0_GEN_VARIABLE': { nodeId: 'occupied', socketName: 'FrontSocket' } } }, children: [] },
        { id: 'multi', type: 'foxholeAsset', state: { foxholeKey: multi.id }, children: [] },
        ...Array.from({ length: Number(multi.powerGridInfo!.maxConnections) }, (_, index) => ({
            id: `line-${index}`, type: 'foxholeSplineConnector', state: { foxholeKey: 'powerline',
                start: { x: 0, y: 0, rotation: 0 }, end: { x: 192, y: 0, rotation: 0 },
                startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
                startAttachment: { nodeId: 'multi', socketName: 'PowerSocket' } }, children: [],
        })),
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    host.replaceDocument(converted.content);
    const entities = host.listEntities();
    const context = { entities, worldPoint: { x: 0, y: 0 }, hoveredEntityIds: [], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) };
    const sockets = collectNixieSceneV2FoxholeSockets(context);
    const liquid = sockets.find(socket => socket.nodeId === entities[0]!.entityId && socket.socketName === 'PipeInput0')!;
    const power = sockets.find(socket => socket.nodeId === entities[1]!.entityId && socket.socketName === 'PowerSocket')!;
    assert.ok(liquid);
    assert.ok(power);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, liquid, 'new-pipe', 'BackSocket'), false);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, power, 'new-line', 'BackSocket'), false);
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(context, power, entities[2]!.entityId, 'BackSocket'), true,
        'an existing endpoint retains its own capacity slot');
    const partial = { ...context, entities: entities.slice(0, -1) };
    assert.equal(isNixieSceneV2FoxholeSocketAvailable(partial, power, 'new-line', 'BackSocket'), true);
});

test('manifest structures retain their Native authored transform origin', () => {
    const { host, id } = fixture('foxholeAsset', { foxholeKey: 'powerbox' });
    assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(host.readEntity(id)), { x: 0, y: 0 });
    assert.equal(foxholeSceneV2StateAdapter.requestsTransformGizmo!(host.readEntity(id)), true);
    assert.equal(foxholeSceneV2StateAdapter.requestsTransformGizmo!({ ...host.readEntity(id), components: [] }), false);
});

test('power selection retains Native chord geometry and endpoint midpoint', () => {
    const { host, id } = fixture('foxholeSplineConnector', { foxholeKey: 'powerline',
        start: { x: 0, y: 0, rotation: Math.PI }, end: { x: -108, y: 136, rotation: -Math.PI } });
    const entity = host.readEntity(id);
    assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalQuad!(entity),
        resolveFoxholePowerlineSelectionQuad({ x: 0, y: 0 }, { x: -108, y: 136 }, 3));
    assert.equal(foxholeSceneV2StateAdapter.selectionFrameAngleLocal!(entity), Math.atan2(136, -108));
    assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(entity), { x: -54, y: 68 });
    assert.equal(foxholeSceneV2StateAdapter.selectionLocalQuad!({ ...entity, components: [] }), null);
});

test('deleting a connected entity clears reciprocal sockets atomically and rejected saves restore them', () => {
    for (const accepted of [true, false]) {
        const { host, manifest } = fixture();
        const converted = convertNixieSceneV1ToV2([
            { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel',
                socketAttachments: { PowerSocket: { nodeId: 'line', socketName: 'BackSocket' } } }, children: [] },
            { id: 'line', type: 'foxholeSplineConnector', state: { foxholeKey: 'powerline',
                start: { x: 0, y: 0, rotation: Math.PI }, end: { x: 192, y: 0, rotation: 0 },
                startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
                startAttachment: { nodeId: 'plant', socketName: 'PowerSocket' } }, children: [] },
        ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
        host.replaceDocument(converted.content);
        const controller = new NixieSceneV2EditorRuntimeController();
        controller.setEditable(true);
        let saves = 0;
        controller.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
            applyEntityMutations: () => {
                saves += 1;
                return accepted;
            } });
        controller.load(host.exportDocument(), [{ ownerId: 'nixie.foxhole-planner', name: 'Foxhole',
            contribution: manifest.contributes.experimentalComponents }]);
        const before = controller.exportDocument();
        assert.equal(controller.deleteEntities([converted.content.entities[1]!.entityId]).ok, accepted);
        assert.equal(saves, 1);
        if (accepted) {
            assert.deepEqual(controller.entities[0]!.components.find(component => component.componentId === 'socket-attachments')!.data.attachments, []);
        } else {
            assert.deepEqual(controller.exportDocument(), before);
        }
    }
});

test('manifest Wall placement previews and confirms two endpoints without persisting intermediate state', () => {
    const { host, id } = fixture('foxholeSplineConnector', { foxholeKey: 'wallsplinet1',
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
        minLength: 96, maxLength: 320, minRadius: 1, maxRadius: 1, maxBuffer: 0.32, curveT: 0 });
    const before = host.exportDocument();
    const placement = foxholeSceneV2StateAdapter.startPlacement?.(host.readEntity(id));
    assert.ok(placement);
    const preview = placement.update({ x: -224, y: -192 });
    const set = preview[0]!.set!;
    assert.deepEqual([set.startX, set.startY, set.endX, set.endY], [-224, -192, -128, -192]);
    assert.equal(placement.confirm({ x: -224, y: -192 }).complete, false);
    const result = placement.confirm({ x: -64, y: -192 });
    assert.equal(result.complete, true);
    assert.deepEqual([result.updates[0]!.set!.startX, result.updates[0]!.set!.endX], [-224, -64]);
    assert.deepEqual(host.exportDocument(), before);
    host.applyEditorComponentPatches(result.updates.map(update => ({ ...update, entityId: id })));
    const after = host.exportDocument();
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    host.redo();
    assert.deepEqual(host.exportDocument(), after);
    assert.equal(placement.removeOnCancel, true);
});

test('component placement rejects stale, locked, read-only and failed saves atomically', async () => {
    for (const scenario of ['accepted', 'stale', 'locked', 'read-only', 'rejected'] as const) {
        const { host, id, manifest } = fixture('foxholeSplineConnector', { foxholeKey: 'wallsplinet1',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 } });
        const document = host.exportDocument();
        if (scenario === 'locked') {
            document.entities[0]!.components.find(component => component.componentId === 'locking')!.data.locked = true;
        }
        const controller = new NixieSceneV2EditorRuntimeController();
        controller.setEditable(scenario !== 'read-only');
        let saves = 0;
        controller.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
            applyEntityMutations: () => {
                saves += 1;
                return scenario !== 'rejected';
            } });
        assert.equal(controller.load(document, [{ ownerId: 'nixie.foxhole-planner', name: 'Foxhole',
            contribution: manifest.contributes.experimentalComponents }]).ok, true);
        const initial = controller.entities[0]!;
        const placement = foxholeSceneV2StateAdapter.startPlacement!(initial)!;
        placement.confirm({ x: -224, y: -192 });
        const { updates } = placement.confirm({ x: -64, y: -192 });
        const before = controller.exportDocument();
        const result = await controller.commitComponentPlacement({ entityId: id,
            sourceRevision: initial.revision + (scenario === 'stale' ? 1 : 0), updates });
        assert.equal(result.ok, scenario === 'accepted', scenario);
        assert.equal(saves, ['accepted', 'rejected'].includes(scenario) ? 1 : 0, scenario);
        if (scenario !== 'accepted') {
            assert.deepEqual(controller.exportDocument(), before, scenario);
        }
    }
});

test('Wall handles reuse Native endpoints and omit unsupported rotation handles', () => {
    const { host, id, project } = fixture('foxholeSplineConnector', { foxholeKey: 'wallsplinet1',
        start: { x: -224, y: -192, rotation: 0 }, end: { x: -64, y: -192, rotation: 0 },
        minLength: 96, maxLength: 320, minRadius: 1, maxRadius: 1, maxBuffer: 0.32, curveT: 0 });
    const entity = host.readEntity(id);
    const state = normalizeFoxholeSplineConnectorState(project().state);
    const handles = foxholeSceneV2StateAdapter.editableHandles!(entity);
    const connector = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'wallsplinet1')!.connector!;
    assert.deepEqual(handles, getFoxholeSplineLocalEditableHandles(state, connector.pathStyle, state.maxArcAngleDeg));
    assert.deepEqual(handles.map(handle => handle.id), ['start', 'end']);
    const patch = foxholeSceneV2StateAdapter.editableHandlePatch!(entity, 'end', { x: -200, y: -192 }, false)!;
    assert.deepEqual(patch.end, { x: -128, y: -192, rotation: 0 });
    assert.deepEqual(host.readEntity(id), entity);
});

function fixture(type = 'foxholeAsset', state: Record<string, unknown> = { foxholeKey: 'artilleryait1' }) {
    const source = [{ id: 'node', type, state, children: [] }];
    const converted = convertNixieSceneV1ToV2(source, { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.core', NIXIE_SCENE_V2_CORE_COMPONENTS);
    host.registerExtension('nixie.foxhole-planner', manifest.contributes.experimentalComponents);
    host.replaceDocument(converted.content);
    const id = converted.content.entities[0]!.entityId;
    const apply = (patch: Record<string, unknown>) => {
        const result = foxholeSceneV2StateAdapter.patch(host.readEntity(id), patch);
        assert.deepEqual([...result.handledKeys].sort(), Object.keys(patch).sort());
        host.applyEditorComponentPatches(result.updates.map(update => ({ ...update, entityId: id })));
    };
    return { source, host, id, apply, manifest, project: () => foxholeSceneV2StateAdapter.project(host.readEntity(id))! };
}

test('asset switches reconcile stored cargo with the destination hold', () => {
    const { apply, project } = fixture('foxholeAsset', {
        foxholeKey: 'fortt3', markedItemCodenames: ['Concrete', 'Diesel', 'Petrol'],
    });
    apply({ foxholeKey: 'engineroomt3' });
    assert.deepEqual(project().state.markedItemCodenames, ['Diesel']);
    apply({ foxholeKey: 'fortt3' });
    assert.deepEqual(project().state.markedItemCodenames, ['Diesel']);
});

test('Bowhead grouped cargo survives conversion, edits and Undo without rewriting legacy source', () => {
    const { host, id, apply, project } = fixture('foxholeAsset', { foxholeKey: 'largeshipresourceship', markedItemCodenames: ['Harvester'],
        markedStockpileItems: { 'GenericStockpileComponent1:0': ['Coal'], 'GenericStockpileComponent2:0': ['Sulfur'] } });
    assert.ok(project().state.markedStockpileItems, JSON.stringify(host.readEntity(id).components.find(component => component.componentId === 'cargo')));
    assert.deepEqual((project().state.markedStockpileItems as Record<string, string[]>)['GenericStockpileComponent:0'], ['Harvester']);
    const before = host.exportDocument();
    const original = project().state.markedStockpileItems as Record<string, string[]>;
    apply({ markedStockpileItems: { ...original, 'GenericStockpileComponent1:0': ['Components'] } });
    assert.deepEqual((project().state.markedStockpileItems as Record<string, string[]>)['GenericStockpileComponent1:0'], ['Components']);
    assert.deepEqual((project().state.markedStockpileItems as Record<string, string[]>)['GenericStockpileComponent2:0'], ['Sulfur']);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    apply({ foxholeKey: 'fortt3' });
    assert.equal(project().state.markedStockpileItems, undefined);
});

test('Foxhole appearance creates typed state, resets, and undoes without rewriting V1 preservation', () => {
    const { host, id, source, apply, project } = fixture();
    const before = host.exportDocument();
    assert.equal(host.readEntity(id).components.some(component => component.componentId === 'appearance'), false);
    apply({ blueprint: true, brightness: 1.5 });
    assert.equal(project().state.blueprint, true);
    assert.equal(project().state.brightness, 1.5);
    const preserved = before.entities[0]!.components.find(component => component.componentId === 'legacy-source')!.data;
    assert.deepEqual(host.readEntity(id).components.find(component => component.componentId === 'legacy-source')!.data, preserved);
    apply({ blueprint: false, brightness: 1 });
    assert.equal(project().state.blueprint, false);
    assert.equal(project().state.brightness, 1);
    host.undo();
    assert.equal(project().state.blueprint, true);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    assert.deepEqual(source[0]!.state, { foxholeKey: 'artilleryait1' });
});

test('spline Inspector edits tolerate existing conversion parity notices and reject malformed endpoints', () => {
    const { host, apply, project } = fixture('foxholeSplineConnector', { foxholeKey: 'facilitypipeoverhead',
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 }, maxArcAngleDeg: -1 });
    apply({ start: { x: 20, y: 10, rotation: 0 } });
    assert.deepEqual(project().state.start, { x: 20, y: 10, rotation: 0 });
    const before = host.exportDocument();
    assert.throws(() => apply({ end: { x: 'bad' } }), /malformed/);
    assert.deepEqual(host.exportDocument(), before);
});

test('Foxhole production edits leave other components and order identities untouched', () => {
    const { host, id, apply, project } = fixture('foxholeAsset', { foxholeKey: 'facilityfactoryammo',
        productionOrders: [{ recipeId: 'shell', cycles: 2, parent: true }] });
    const orders = host.readEntity(id).components.find(component => component.componentId === 'production-order')!.data.orders;
    apply({ brightness: 0.75 });
    assert.deepEqual(host.readEntity(id).components.find(component => component.componentId === 'production-order')!.data.orders, orders);
    apply({ disableProduction: true });
    assert.equal(project().state.disableProduction, true);
    assert.deepEqual(project().state.productionOrders, orders);
});

test('socket Inspector projection reads the canonical local socket name and preserves topology during appearance edits', () => {
    const { host, id, apply, project } = fixture('foxholeAsset', { foxholeKey: 'facilitypowerdiesel' });
    const attachments = [{ localSocketName: 'PowerSocket', targetEntityId: 'power-pole', targetSocketName: 'PowerSocket' }];
    host.applyEditorComponentPatches([{ entityId: id, ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments',
        createIfMissing: true, set: { attachments } }]);
    assert.deepEqual(project().state.socketAttachments, { PowerSocket: { nodeId: 'power-pole', socketName: 'PowerSocket' } });
    apply({ brightness: 0.75 });
    assert.deepEqual(host.readEntity(id).components.find(component => component.componentId === 'socket-attachments')!.data.attachments, attachments);
});

test('legacy point connector edits and target deletion preserve their nested endpoint bindings', () => {
    const { host } = fixture();
    host.replaceDocument(convertNixieSceneV1ToV2([
        { id: 'source', type: 'foxholeAsset', state: { foxholeKey: 'powerbox' }, children: [] },
        { id: 'sink', type: 'foxholeAsset', state: { foxholeKey: 'powerbox', x: 160 }, children: [] },
        { id: 'line', type: 'foxholeConnector', state: { foxholeKey: 'powerline', points: [0, 0, 160, 0],
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
            startAttachment: { nodeId: 'source', socketName: 'PowerSocket' },
            endAttachment: { nodeId: 'sink', socketName: 'PowerSocket' } }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content);
    const [source, sink, line] = host.listEntities();
    const before = host.exportDocument();
    const expectedStart = { nodeId: source!.entityId, socketName: 'PowerSocket' };
    const expectedEnd = { nodeId: sink!.entityId, socketName: 'PowerSocket' };
    const projected = foxholeSceneV2StateAdapter.project(line!)!;
    assert.deepEqual(projected.state.startAttachment, expectedStart);
    assert.deepEqual(projected.state.endAttachment, expectedEnd);
    const edit = foxholeSceneV2StateAdapter.patch(line!, { points: [0, 0, 180, 20] });
    host.applyEditorComponentPatches(edit.updates.map(update => ({ ...update, entityId: line!.entityId })));
    const edited = host.readEntity(line!.entityId).components.find(component => component.componentId === 'connector')!.data;
    assert.deepEqual(edited.startAttachment, expectedStart);
    assert.deepEqual(edited.endAttachment, expectedEnd);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    const cleanup = foxholeSceneV2StateAdapter.deletionUpdates!(line!, new Set([source!.entityId]));
    host.applyEditorComponentPatches(cleanup.map(update => ({ ...update, entityId: line!.entityId })));
    const remaining = host.readEntity(line!.entityId).components.find(component => component.componentId === 'connector')!.data;
    assert.equal(remaining.startAttachment, undefined);
    assert.deepEqual(remaining.endAttachment, expectedEnd);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
});

function portableCurveUpdates(entity: NixieExperimentalComponentEntitySnapshotV1, delta: number) {
    const geometry = entity.components.find(c => c.componentId === 'spline-connector' && c.ownerId === 'nixie.foxhole-planner');
    if (!geometry) return null;
    const data = geometry.data as unknown as FoxholeSceneV2SplineConnectorData;
    const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));
    const definitions = new Map<string, NixieExperimentalComponentDefinitionV1>(manifest.contributes.experimentalComponents.components.map((c: NixieExperimentalComponentDefinitionV1) => ['nixie.foxhole-planner\0' + c.id, c]));
    return buildNixieSceneV2GeometryWheelUpdates(entity, 'nixie.foxhole-planner', foxholeConnectorGeometryWheel(data, assets[data.foxholeKey]), delta, definitions);
}

test('placed pipeline wheel edits preserve bindings through history and skip unsupported or unchanged curves', () => {
    const { host, id } = fixture('foxholeSplineConnector', { foxholeKey: 'facilitypipe',
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: Math.PI }, curveT: 0,
        startAttachment: { nodeId: 'source', socketName: 'PipeOutput0' } });
    const before = host.exportDocument();
    const entity = host.readEntity(id);
    const updates = portableCurveUpdates(entity, -120)!;
    assert.deepEqual(updates, [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', set: { curveT: 0.05 } }]);
    assert.equal(host.applyEditorComponentPatches(updates.map(update => ({ ...update, entityId: id }))).length, 1);
    const after = host.exportDocument();
    const original = before.entities[0]!.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.deepEqual(host.readEntity(id).components.find(component => component.componentId === 'spline-connector')!.data,
        { ...original, curveT: 0.05 });
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    host.redo();
    assert.deepEqual(host.exportDocument(), after);
    assert.deepEqual(portableCurveUpdates(entity, 120), []);
    assert.equal(portableCurveUpdates(entity, Number.NaN), null);
    assert.equal(portableCurveUpdates({ ...entity,
        components: entity.components.map(component => ({ ...component, definitionAvailable: false })) }, -120), null);
    for (const key of ['wallsplinet1', 'powerline']) {
        const unsupported = fixture('foxholeSplineConnector', { foxholeKey: key,
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 } });
        assert.equal(portableCurveUpdates(unsupported.host.readEntity(unsupported.id), -120), null);
    }
});

test('pipeline wheel writes reject stale, locked, read-only, detached and failed persistence', () => {
    for (const scenario of ['accepted', 'stale', 'locked', 'read-only', 'detached', 'rejected'] as const) {
        const { host, id, manifest } = fixture('foxholeSplineConnector', { foxholeKey: 'facilitypipe',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: Math.PI }, curveT: 0 });
        const document = host.exportDocument();
        if (scenario === 'locked') {
            document.entities[0]!.components.find(component => component.componentId === 'locking')!.data.locked = true;
        }
        const controller = new NixieSceneV2EditorRuntimeController();
        controller.setEditable(scenario !== 'read-only');
        let saves = 0;
        controller.attachPersistence({ isAttached: () => scenario !== 'detached', canUndo: false, canRedo: false,
            undo: () => false, redo: () => false, applyEntityMutations: () => {
                saves++;
                return scenario !== 'rejected';
            } });
        assert.equal(controller.load(document, [{ ownerId: 'nixie.foxhole-planner', name: 'Foxhole',
            contribution: manifest.contributes.experimentalComponents }]).ok, true);
        const entity = controller.entities[0]!;
        const before = controller.exportDocument();
        const result = controller.reshapeComponentGeometry({ entityId: id,
            sourceRevision: entity.revision + (scenario === 'stale' ? 1 : 0),
            updates: portableCurveUpdates(entity, -120)! });
        assert.equal(result.ok, scenario === 'accepted', scenario);
        assert.equal(saves, scenario === 'accepted' || scenario === 'rejected' ? 1 : 0, scenario);
        if (!result.ok) {
            assert.deepEqual(controller.exportDocument(), before, scenario);
        }
    }
});

test('range selection reuses V1 bounds and its authored origin from current typed points', () => {
    const { host, id, apply } = fixture('foxholeRange', {
        points: [20, 30, 180, 30], sweepAngle: 90, showRadius: false, showAngle: false,
    });
    const initial = host.readEntity(id);
    const before = host.exportDocument();
    const range = initial.components.find(component => component.componentId === 'range')!;
    for (const renderScale of [0.25, 1, 2]) {
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(initial, renderScale),
            getFoxholeRangeSelectionLocalBounds(resolveFoxholeRangeState(range.data as Partial<FoxholeRangeState>), renderScale));
    }
    assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(initial), { x: 20, y: 30 });
    assert.deepEqual(host.exportDocument(), before);
    apply({ points: [-40, 25, 120, 25] });
    const edited = host.readEntity(id);
    assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(edited), { x: -40, y: 25 });
    assert.notDeepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(edited, 1), foxholeSceneV2StateAdapter.selectionLocalBounds!(initial, 1));
    assert.deepEqual(edited.components.find(component => component.componentId === 'legacy-source')!.data,
        initial.components.find(component => component.componentId === 'legacy-source')!.data);
});

test('range selection adapters ignore unresolved definitions and other owners', () => {
    const { host, id } = fixture('foxholeRange', { points: [0, 0, 160, 0], showRadius: false, showAngle: false });
    const unresolved = structuredClone(host.readEntity(id));
    const range = unresolved.components.find(component => component.componentId === 'range')!;
    range.definitionAvailable = false;
    assert.equal(foxholeSceneV2StateAdapter.selectionLocalBounds!(unresolved, 1), null);
    assert.equal(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(unresolved), null);
    assert.deepEqual(getNixieSceneV2EditableHandles(unresolved), []);
    assert.equal(buildNixieSceneV2EditableHandleUpdates(unresolved, 'point-0', { x: 20, y: 20 }, true), null);
    range.definitionAvailable = true;
    range.ownerId = 'another.owner';
    assert.equal(foxholeSceneV2StateAdapter.selectionLocalBounds!(unresolved, 1), null);
    assert.equal(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(unresolved), null);
});

test('range endpoint preview and accepted center reanchoring share V1 geometry without rewriting preserved data', () => {
    const { host, id } = fixture('foxholeRange', { x: -120, points: [0, 0, 160, 0], showRadius: false, showAngle: false });
    const before = host.exportDocument();
    const initial = host.readEntity(id);
    assert.deepEqual(getNixieSceneV2EditableHandles(initial), getPolylineEditableLocalHandles([0, 0, 160, 0], { canDeleteVertex: () => false }));
    assert.deepEqual(movePolylineLocalVertex([0, 0, 160, 0], 1, { x: 200, y: 20 }), [0, 0, 200, 20]);
    const updates = buildNixieSceneV2EditableHandleUpdates(initial, 'point-1', { x: 200, y: 20 }, false)!;
    const preview = previewNixieSceneV2EditableHandleUpdates(initial, updates);
    assert.deepEqual(preview.components.find(component => component.componentId === 'range')!.data.points, [0, 0, 200, 20]);
    assert.deepEqual(host.exportDocument(), before, 'preview does not write to the host or its history');
    const center = buildNixieSceneV2EditableHandleUpdates(initial, 'point-0', { x: 20, y: 20 }, true)!;
    host.applyEditorComponentPatches(center.map(update => ({ ...update, entityId: id })));
    const changed = host.readEntity(id);
    assert.deepEqual(changed.components.find(component => component.componentId === 'range')!.data.points, [0, 0, 140, -20]);
    const transform = changed.components.find(component => component.componentId === 'transform')!.data;
    assert.deepEqual([transform.x, transform.y], [-100, 20]);
    assert.deepEqual(changed.components.find(component => component.componentId === 'legacy-source')!.data,
        initial.components.find(component => component.componentId === 'legacy-source')!.data);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    assert.equal(buildNixieSceneV2EditableHandleUpdates(initial, 'missing', { x: 20, y: 20 }, true), null);
    assert.equal(buildNixieSceneV2EditableHandleUpdates(initial, 'point-0', { x: Number.NaN, y: 20 }, true), null);
});

test('range geometry commits are atomic, revision guarded, capability checked and recover from rejected persistence', () => {
    for (const scenario of ['accepted', 'stale', 'locked', 'no-capability', 'read-only', 'invalid', 'rejected'] as const) {
        const { host, id, manifest } = fixture('foxholeRange', { x: -120, points: [0, 0, 160, 0] });
        const document = host.exportDocument();
        if (scenario === 'locked') {
            document.entities[0]!.components.find(component => component.componentId === 'locking')!.data.locked = true;
        } else if (scenario === 'no-capability') {
            document.entities[0]!.components = document.entities[0]!.components.filter(component => component.componentId !== 'capability-geometry-reshape');
        }
        const controller = new NixieSceneV2EditorRuntimeController();
        controller.setEditable(scenario !== 'read-only');
        let saves = 0;
        controller.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false,
            undo: () => false, redo: () => false, applyEntityMutations: () => {
                saves += 1;
                return scenario !== 'rejected';
            } });
        assert.equal(controller.load(document, [{ ownerId: 'nixie.foxhole-planner', name: 'Foxhole',
            contribution: manifest.contributes.experimentalComponents }]).ok, true);
        const initial = controller.entities[0]!;
        const updates = buildNixieSceneV2EditableHandleUpdates(initial, 'point-0', { x: 20, y: 20 }, true)!;
        if (scenario === 'invalid') {
            updates.find(update => update.componentId === 'range')!.set!.points = [0, 'invalid', 140, -20];
        }
        const before = controller.exportDocument();
        const result = controller.reshapeComponentGeometry({ entityId: id, sourceRevision: initial.revision + (scenario === 'stale' ? 1 : 0), updates });
        assert.equal(result.ok, scenario === 'accepted', scenario);
        if (scenario === 'accepted') {
            assert.equal(saves, 1);
            assert.equal(controller.entities[0]!.revision, initial.revision + 1);
            assert.equal(controller.reshapeComponentGeometry({ entityId: id, sourceRevision: initial.revision, updates }).ok, false);
            assert.equal(saves, 1, 'stale repeats do not save');
        } else {
            assert.deepEqual(controller.exportDocument(), before, scenario);
            assert.equal(saves, scenario === 'rejected' ? 1 : 0, scenario);
        }
    }
});

test('point-provider handles edit typed geometry with shared V1 indices and preserve unrelated state', () => {
    const cases = [
        { type: 'foxholeTacticalLine', component: 'tactical-line', field: 'points', points: [0, 0, 80, -20, 180, 40],
            handleId: 'point-1', expected: [0, 0, 115, 2, 180, 40], point: { x: 115, y: 2 } },
        { type: 'foxholeBinocularLine', component: 'binocular-line', field: 'points', points: [0, 0, 160, 0, 240, 40],
            handleId: 'point-1', expected: [0, 0, 195, 22, 240, 40], point: { x: 195, y: 22 } },
        { type: 'foxholeTriangulation', component: 'triangulation', field: 'edgePoints', points: [60, 0, -30, 52, -30, -52],
            handleId: 'edge-0', expected: [95, 22, -30, 52, -30, -52], point: { x: 95, y: 22 } },
    ];
    for (const scenario of cases) {
        const { host, id } = fixture(scenario.type, { x: -120, y: 20, [scenario.field]: scenario.points });
        const before = host.exportDocument();
        const initial = host.readEntity(id);
        assert.deepEqual(getNixieSceneV2EditableHandles(initial), getPolylineEditableLocalHandles(scenario.points,
            scenario.field === 'edgePoints' ? { idPrefix: 'edge', minimumPointCount: 3 } : {}));
        const updates = buildNixieSceneV2EditableHandleUpdates(initial, scenario.handleId, scenario.point, false)!;
        const preview = previewNixieSceneV2EditableHandleUpdates(initial, updates);
        assert.deepEqual(preview.components.find(component => component.componentId === scenario.component)!.data[scenario.field], scenario.expected);
        assert.deepEqual(host.exportDocument(), before);
        const committed = buildNixieSceneV2EditableHandleUpdates(initial, scenario.handleId, scenario.point, true)!;
        assert.deepEqual(committed, updates, 'these providers retain their local points on serialization');
        host.applyEditorComponentPatches(committed.map(update => ({ ...update, entityId: id })));
        const changed = host.readEntity(id);
        assert.deepEqual(changed.components.filter(component => component.componentId !== scenario.component),
            initial.components.filter(component => component.componentId !== scenario.component));
        host.undo();
        assert.deepEqual(host.exportDocument(), before);
        const unresolved = structuredClone(initial);
        unresolved.components.find(component => component.componentId === scenario.component)!.definitionAvailable = false;
        assert.deepEqual(getNixieSceneV2EditableHandles(unresolved), []);
        assert.equal(buildNixieSceneV2EditableHandleUpdates(unresolved, scenario.handleId, scenario.point, true), null);
    }
});

test('triangulation rejects a degenerate point drag instead of substituting fallback geometry', () => {
    const { host, id } = fixture('foxholeTriangulation', { edgePoints: [60, 0, -30, 52, -30, -52] });
    const before = host.exportDocument();
    assert.equal(buildNixieSceneV2EditableHandleUpdates(host.readEntity(id), 'edge-0', { x: -30, y: 0 }, false), null);
    assert.equal(buildNixieSceneV2EditableHandleUpdates(host.readEntity(id), 'edge-0', { x: -30, y: 0 }, true), null);
    assert.deepEqual(host.exportDocument(), before);
});

test('triangulation bounds reuse V1 fitted-circle padding at every render scale', () => {
    const state = { x: 80, y: 170, edgePoints: [60, 0, -30, 52, -30, -52], showRadius: false };
    const { host, id } = fixture('foxholeTriangulation', state);
    const initial = host.readEntity(id);
    for (const scale of [0.25, 1, 2]) {
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(initial, scale),
            getFoxholeTriangulationSelectionLocalBounds(resolveFoxholeTriangulationState(state), scale));
    }
    const unresolved = structuredClone(initial);
    unresolved.components.find(component => component.componentId === 'triangulation')!.definitionAvailable = false;
    assert.equal(foxholeSceneV2StateAdapter.selectionLocalBounds!(unresolved, 1), null);
});


test('spline assets defer selection bounds to the rendered path and use the endpoint midpoint', () => {
    for (const foxholeKey of ['facilitypipeoverhead', 'facilitypipe', 'railtrackspline', 'powerline']) {
        const { host, id, apply } = fixture('foxholeSplineConnector', { foxholeKey,
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 448, y: 224, rotation: 0 } });
        // Explorer products retain asset identity alongside their editable spline component.
        const input = () => ({ ...host.readEntity(id), components: [...host.readEntity(id).components,
            { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
                data: { catalogId: 'foxhole.structures', assetId: foxholeKey } }] });
        const before = host.exportDocument();
        assert.equal(foxholeSceneV2StateAdapter.selectionLocalBounds!(input(), 1), null, foxholeKey);
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(input()), { x: 224, y: 112 }, foxholeKey);
        assert.deepEqual(host.exportDocument(), before);
        apply({ end: { x: 320, y: -160, rotation: 0 } });
        assert.equal(foxholeSceneV2StateAdapter.selectionLocalBounds!(input(), 1), null, foxholeKey);
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal!(input()), { x: 160, y: -80 }, foxholeKey);
        assert.equal(Boolean(foxholeSceneV2StateAdapter.selectionLocalQuad!(input())), foxholeKey === 'powerline');
    }
});

test('Inspector tier actions update model resources and dimensions with identity in one undo step', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    for (const [source, direction, target] of [['fortt2', 'up', 'fortt3'], ['fortt2', 'down', 'fortt1']] as const) {
        const { host, id, apply, project } = fixture('foxholeAsset', {
            foxholeKey: source, x: 123, y: -47, rotation: 0.75, scaleX: -1.25, scaleY: 0.8,
        });
        const before = host.exportDocument();
        const retained = host.readEntity(id).components.filter(component => !['asset', 'model'].includes(component.componentId));
        const mutation = resolveFoxholeStructureTierMutation(catalog, project().state, direction)!;
        assert.equal(mutation.targetAsset.foxholeKey, target);
        apply(mutation.patch);
        const changed = host.readEntity(id);
        const expected = fixture('foxholeAsset', { foxholeKey: target }).host.listEntities()[0]!
            .components.find(component => component.componentId === 'model')!.data;
        assert.equal(project().state.foxholeKey, target);
        assert.deepEqual(changed.components.find(component => component.componentId === 'model')!.data, expected);
        assert.deepEqual(changed.components.filter(component => !['asset', 'model'].includes(component.componentId)), retained);
        const after = host.exportDocument();
        host.undo();
        assert.deepEqual(host.exportDocument(), before);
        host.redo();
        assert.deepEqual(host.exportDocument(), after);
    }
});

test('identity changes create a missing model binding without resetting unrelated state', () => {
    const { host, id, apply } = fixture('foxholeAsset', { foxholeKey: 'fortt2' });
    const document = host.exportDocument();
    document.entities[0]!.components = document.entities[0]!.components.filter(component => component.componentId !== 'model');
    host.replaceDocument(document);
    apply({ foxholeKey: 'fortt3' });
    assert.equal(host.readEntity(id).components.find(component => component.componentId === 'model')?.data.resourceId, 'foxhole.model.fortt3');
    host.undo();
    assert.deepEqual(host.exportDocument(), document);
});

test('tier changes carry compatible modifications through canonical SDK state and undo redo', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const engineMods = { BackDefenseModSlot: 'sandbags', FrontFortStairsModSlot: 'stairs', LeftModSlot: 'powerconnection' };
    const trenchMods = { BackDefenseModSlot: 'barbedwire', FrontEndModSlot: 'stairs' };
    for (const [source, direction, target, mods] of [
        ['engineroomt2', 'up', 'engineroomt3', engineMods], ['engineroomt3', 'down', 'engineroomt2', engineMods],
        ['trencht1', 'up', 'trencht2', trenchMods], ['trencht2', 'up', 'trencht3', trenchMods],
        ['trencht3', 'down', 'trencht2', { ...trenchMods, BPTrenchRoofModSlot: 'trenchroof' }],
    ] as const) {
        const { host, id, apply, project } = fixture('foxholeAsset', { foxholeKey: source, modificationVariantIds: mods,
            x: 123, y: -47, rotation: 0.75, scaleX: -1.25, scaleY: 0.8 });
        const before = host.exportDocument();
        const retained = host.readEntity(id).components.filter(component => !['asset', 'model', 'modification'].includes(component.componentId));
        const mutation = resolveFoxholeStructureTierMutation(catalog, project().state, direction)!;
        apply(mutation.patch);
        assert.equal(project().state.foxholeKey, target);
        const expectedMods = source === 'trencht3' ? trenchMods : mods;
        assert.deepEqual(project().state.modificationVariantIds, expectedMods);
        const selections = host.readEntity(id).components.find(component => component.componentId === 'modification')!.data.selections as Array<{ slotId: string; variantId: string }>;
        assert.deepEqual(Object.fromEntries(selections.map(selection => [selection.slotId, selection.variantId])), expectedMods);
        assert.equal(host.readEntity(id).components.find(component => component.componentId === 'model')!.data.resourceId, 'foxhole.model.' + target);
        assert.deepEqual(host.readEntity(id).components.filter(component => !['asset', 'model', 'modification'].includes(component.componentId)), retained);
        const after = host.exportDocument();
        host.undo();
        assert.deepEqual(host.exportDocument(), before);
        host.redo();
        assert.deepEqual(host.exportDocument(), after);
    }
});

test('power handle hover targets a building socket away from its point and detaches in the free preview', () => {
    const { host } = fixture();
    const converted = convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 0 }, children: [] },
        { id: 'line', type: 'foxholeSplineConnector', state: { foxholeKey: 'powerline',
            start: { x: -300, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 3.2, maxLength: 800 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    host.replaceDocument(converted.content);
    const entities = host.listEntities(), line = entities[1]!, building = entities[0]!;
    const context = { entities, worldPoint: { x: 100, y: 100 }, hoveredEntityIds: [building.entityId], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) };
    const socket = collectNixieSceneV2FoxholeSockets(context).find(socket => socket.nodeId === building.entityId && socket.socketName.includes('PowerSocket'))!;
    assert.ok(Math.hypot(socket.x - context.worldPoint.x, socket.y - context.worldPoint.y) > 32);
    const before = host.exportDocument();
    const updates = buildNixieSceneV2EditableHandleUpdates(line, 'end', context.worldPoint, false, undefined, context)!;
    const preview = previewNixieSceneV2EditableHandleUpdates(line, updates);
    const geometry = preview.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.equal(geometry.endAttachmentNodeId, building.entityId);
    assert.equal(geometry.endAttachmentSocketName, socket.socketName);
    assert.ok(Math.abs(Number(geometry.endX) - socket.x) < 1e-8);
    assert.ok(Math.abs(Number(geometry.endY) - socket.y) < 1e-8);
    const away = { ...context, entities: [building, preview], hoveredEntityIds: [], worldPoint: { x: 500, y: 400 } };
    const detached = previewNixieSceneV2EditableHandleUpdates(preview,
        buildNixieSceneV2EditableHandleUpdates(preview, 'end', away.worldPoint, false, undefined, away)!);
    assert.equal(detached.components.find(component => component.componentId === 'spline-connector')!.data.endAttachmentNodeId, undefined);
    const disabled = { ...context, isSettingEnabled: () => false };
    const unsnapped = previewNixieSceneV2EditableHandleUpdates(line,
        buildNixieSceneV2EditableHandleUpdates(line, 'end', context.worldPoint, false, undefined, disabled)!);
    assert.equal(unsnapped.components.find(component => component.componentId === 'spline-connector')!.data.endAttachmentNodeId, undefined);
    assert.deepEqual(host.exportDocument(), before, 'hover and drag previews do not persist');
});

test('Explorer powerline drafts preview socket links and retain the snapped anchor through commit', async () => {
    const { manifest } = fixture();
    const content = convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 0 }, children: [] },
        { id: 'pole', type: 'foxholeAsset', state: { foxholeKey: 'powerpole', x: 400, y: 0 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content;
    const runtime = new NixieSceneV2EditorRuntimeController();
    let writes = 0;
    runtime.setEditable(true);
    runtime.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
        applyEntityMutations: () => { writes++; return true; } });
    assert.equal(runtime.load(content, [{ ownerId: manifest.id, name: manifest.name,
        contribution: manifest.contributes.experimentalComponents }]).ok, true);
    runtime.attachTransformFinalizer(new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => [{ ownerId: manifest.id, name: manifest.name, generationHash: 'test',
            contribution: manifest.contributes.experimentalComponents!, transformFinalizers: manifest.contributes.experimentalTransformFinalizers! }],
        isSettingEnabled: () => true,
        getClient: () => ({ finalizeSceneV2Transform: async (_owner, _generation, _system, request) => finalizeFoxholeSceneV2Transform(request) }),
    }));
    runtime.canvas.attach({} as never);
    const { listFoxholeSceneV2Products } = await import('../../../../extensions/foxhole-planner/src/scene-v2-products.ts');
    const product = listFoxholeSceneV2Products({ contractVersion: 1, query: 'powerline', offset: 0, limit: 100 }).items
        .find(item => item.product.id === 'asset.powerline')!.product;
    assert.equal(runtime.beginProductPlacement(product, manifest.id, 'Power Line', () => 'drawing-line', () => true), true);
    const [plant, pole] = runtime.entities;
    const context = (targetId: string, worldPoint: { x: number; y: number; }) => ({ entities: runtime.entities, worldPoint,
        hoveredEntityIds: [targetId], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(runtime.entities)].map(([id, resolved]) => [id, resolved.world])) });
    const start = { x: 100, y: 100 }, startContext = context(plant!.entityId, start);
    const first = await runtime.previewProductPlacement(start, startContext);
    assert.equal(first?.components.find(c => c.componentId === 'spline-connector')!.data.startAttachmentNodeId, plant!.entityId);
    assert.equal(writes, 0);
    const socket = collectNixieSceneV2FoxholeSockets(startContext).find(s => s.nodeId === plant!.entityId && s.socketName.includes('PowerSocket'))!;
    assert.equal((await runtime.commitProductPlacement(start, false, startContext)).ok, true);
    assert.ok(Math.abs(runtime.productPlacement!.anchor!.x - socket.x) < 1e-8);
    assert.ok(Math.abs(runtime.productPlacement!.anchor!.y - socket.y) < 1e-8);
    const end = { x: 400, y: 100 }, endContext = context(pole!.entityId, end);
    runtime.updateProductPlacement(end);
    const preview = await runtime.previewProductPlacement(end, endContext);
    const spline = preview!.components.find(c => c.componentId === 'spline-connector')!.data;
    assert.equal(spline.startAttachmentNodeId, plant!.entityId);
    assert.equal(spline.endAttachmentNodeId, pole!.entityId);
    assert.equal(writes, 0);
    assert.equal((await runtime.commitProductPlacement(end, false, endContext)).ok, true);
    assert.equal(writes, 1);
    const saved = runtime.entities.find(entity => entity.entityId === 'drawing-line')!.components.find(c => c.componentId === 'spline-connector')!.data;
    assert.equal(saved.startAttachmentNodeId, plant!.entityId);
    assert.equal(saved.endAttachmentNodeId, pole!.entityId);
});

test('connector keyboard rotation persists through confirmation and leaves the source untouched', () => {
    for (const key of ['facilitypipe', 'powerline']) {
        const { host, id } = fixture('foxholeSplineConnector', { foxholeKey: key,
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 }, minLength: 10, maxLength: 800 });
        const entity = host.readEntity(id);
        const before = host.exportDocument();
        const draft = foxholeSceneV2StateAdapter.startPlacement!(entity)!;
        const component = (updates: ReturnType<typeof draft.update>) => previewNixieSceneV2EditableHandleUpdates(entity, updates)
            .components.find(value => value.componentId === 'spline-connector')!.data;
        draft.update({ x: 0, y: 0 });
        assert.ok(draft.rotateBy!(Math.PI / 2), key);
        assert.equal(draft.confirm({ x: 0, y: 0 }).complete, false);
        const beforeRotation = component(draft.update({ x: 200, y: 0 }));
        const rotated = component(draft.rotateBy!(Math.PI / 2)!);
        if (key === 'powerline') {
            assert.ok(Math.abs(Number(rotated.endX)) < 1e-8, JSON.stringify(rotated));
            assert.ok(Number(rotated.endY) > 190);
            const confirmed = component(draft.confirm({ x: 200, y: 0 }).updates);
            assert.ok(Math.abs(Number(confirmed.endX)) < 1e-8);
            assert.ok(Number(confirmed.endY) > 190);
        } else {
            assert.ok(Math.abs(Number(rotated.endRotation) - Number(beforeRotation.endRotation) - Math.PI / 2) < 1e-8);
            const confirmed = component(draft.confirm({ x: 200, y: 0 }).updates);
            assert.ok(Math.abs(Number(confirmed.endRotation) - Number(rotated.endRotation)) < 1e-8);
        }
        assert.deepEqual(host.exportDocument(), before);
    }
});

test('connector keyboard rotation rejects invalid steps and preserves socket alignment', () => {
    const { host } = fixture();
    host.replaceDocument(convertNixieSceneV1ToV2([
        { id: 'source', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 160 }, children: [] },
        { id: 'pipe', type: 'foxholeSplineConnector', state: { foxholeKey: 'facilitypipe',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 96, maxLength: 640 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content);
    const entities = host.listEntities();
    const pipe = entities[1]!;
    const draft = foxholeSceneV2StateAdapter.startPlacement!(pipe)!;
    const point = { x: 114.5, y: 104 };
    const context = { entities, worldPoint: point, hoveredEntityIds: [], isSettingEnabled: () => true,
        worldTransforms: new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world])) };
    const snapped = draft.update(point, false, context);
    assert.equal(draft.rotateBy!(Number.NaN), null);
    assert.equal(draft.rotateBy!(Math.PI / 2), null);
    const result = draft.confirm(point, context);
    const before = previewNixieSceneV2EditableHandleUpdates(pipe, snapped).components.find(c => c.componentId === 'spline-connector')!.data;
    const after = previewNixieSceneV2EditableHandleUpdates(pipe, result.updates).components.find(c => c.componentId === 'spline-connector')!.data;
    assert.equal(after.startAttachmentNodeId, entities[0]!.entityId);
    assert.equal(after.startRotation, before.startRotation);
});

test('powerline rotation follows subsequent pointer movement and checks sockets at the virtual endpoint', () => {
    const { host } = fixture();
    host.replaceDocument(convertNixieSceneV1ToV2([
        { id: 'plant', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 0 }, children: [] },
        { id: 'line', type: 'foxholeSplineConnector', state: { foxholeKey: 'powerline',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 3.2, maxLength: 800 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content);
    const entities = host.listEntities();
    const line = entities[1]!;
    const transforms = new Map([...resolveNixieSceneV2Transforms(entities)].map(([id, resolved]) => [id, resolved.world]));
    const queries: { x: number; y: number; }[] = [];
    const context = (worldPoint: { x: number; y: number; }) => ({ entities, worldPoint, hoveredEntityIds: [],
        hoveredEntityIdsAt: (world: { x: number; y: number; }) => {
            queries.push(world);
            return [entities[0]!.entityId];
        },
        isSettingEnabled: () => true, worldTransforms: transforms });
    const draft = foxholeSceneV2StateAdapter.startPlacement!(line)!;
    const before = host.exportDocument();
    draft.update({ x: 0, y: 0 }, false, context({ x: 0, y: 0 }));
    draft.confirm({ x: 0, y: 0 }, context({ x: 0, y: 0 }));
    const cursor = { x: 45, y: 100 };
    draft.update(cursor, false, context(cursor));
    draft.rotateBy!(Math.PI / 2);
    const moved = { x: 56, y: 109.5 };
    const result = draft.update(moved, false, context(moved));
    const value = previewNixieSceneV2EditableHandleUpdates(line, result).components.find(c => c.componentId === 'spline-connector')!.data;
    assert.equal(value.endAttachmentNodeId, entities[0]!.entityId);
    assert.ok(Math.abs(queries.at(-1)!.x + 109.5) < 1e-8);
    assert.ok(Math.abs(queries.at(-1)!.y - 56) < 1e-8);
    assert.equal(draft.rotateBy!(Math.PI / 2), null);
    const final = previewNixieSceneV2EditableHandleUpdates(line, draft.confirm(moved, context(moved)).updates)
        .components.find(c => c.componentId === 'spline-connector')!.data;
    assert.equal(final.endAttachmentNodeId, entities[0]!.entityId);
    assert.deepEqual(host.exportDocument(), before);
});

test('repeated keyboard steps rotate chord-driven drafts in world space under mirrored transforms', () => {
    const { host, id } = fixture('foxholeSplineConnector', { foxholeKey: 'powerline',
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 }, minLength: 10, maxLength: 800 });
    const entity = host.readEntity(id);
    const matrix = { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const context = (point: { x: number; y: number; }) => ({ entities: [entity], worldPoint: { x: -point.x, y: point.y },
        hoveredEntityIds: [], isSettingEnabled: () => false, worldTransforms: new Map([[id, matrix]]) });
    const draft = foxholeSceneV2StateAdapter.startPlacement!(entity)!;
    const start = { x: 0, y: 0 };
    draft.update(start, false, context(start));
    draft.confirm(start, context(start));
    const point = { x: 200, y: 0 };
    draft.update(point, false, context(point));
    draft.rotateBy!(Math.PI / 4);
    const step = draft.rotateBy!(Math.PI / 4)!;
    const rotated = previewNixieSceneV2EditableHandleUpdates(entity, step).components.find(c => c.componentId === 'spline-connector')!.data;
    assert.ok(Math.abs(Number(rotated.endX)) < 1e-8);
    assert.ok(Number(rotated.endY) < -190);
    draft.rotateBy!(-Math.PI / 4);
    const restored = draft.rotateBy!(-Math.PI / 4)!;
    const value = previewNixieSceneV2EditableHandleUpdates(entity, restored).components.find(c => c.componentId === 'spline-connector')!.data;
    assert.ok(Math.abs(Number(value.endX) - 200) < 1e-8);
    assert.ok(Math.abs(Number(value.endY)) < 1e-8);
});

test('maintenance filters convert, edit, and survive a document reload', () => {
    const { host, id, apply, project, manifest } = fixture('foxholeAsset', {
        foxholeKey: 'maintenancetunnel', maintenanceFilters: { range: 65, exclusions: ['defenses', 'factories'] },
    });
    assert.deepEqual(project().state.maintenanceFilters, { range: 65, exclusions: ['defense', 'facility'] });
    apply({ maintenanceFilters: { range: 20, exclusions: ['power'] } });
    assert.deepEqual(project().state.maintenanceFilters, { range: 20, exclusions: ['power'] });
    const reloaded = new NixieSceneV2ComponentHost();
    reloaded.registerExtension('nixie.core', NIXIE_SCENE_V2_CORE_COMPONENTS);
    reloaded.registerExtension('nixie.foxhole-planner', manifest.contributes.experimentalComponents);
    reloaded.replaceDocument(host.exportDocument());
    assert.deepEqual(foxholeSceneV2StateAdapter.project(reloaded.readEntity(id))!.state.maintenanceFilters, { range: 20, exclusions: ['power'] });
});

test('older tunnel products acquire maintenance filters on their first Inspector edit', () => {
    const { host, id } = fixture('foxholeAsset', { foxholeKey: 'maintenancetunnel' });
    const entity = host.readEntity(id);
    const older = { ...entity, components: entity.components.filter(component => component.componentId !== 'maintenance-supply') };
    assert.deepEqual(foxholeSceneV2StateAdapter.project(older)!.state.maintenanceFilters, { range: 100, exclusions: [] });
    const patch = foxholeSceneV2StateAdapter.patch(older, { maintenanceFilters: { range: 0, exclusions: [] } });
    assert.deepEqual(patch.handledKeys, ['maintenanceFilters']);
    assert.equal(patch.updates[0]!.componentId, 'maintenance-supply');
    assert.equal(patch.updates[0]!.createIfMissing, true);
    assert.deepEqual(patch.updates[0]!.set, { range: 0, exclusions: [] });
});

test('maintenance preview edits remain detached and create the typed component for older stencils', () => {
    const { host, id, manifest } = fixture('foxholeAsset', { foxholeKey: 'maintenancetunnel' });
    const runtime = new NixieSceneV2EditorRuntimeController();
    runtime.setEditable(true);
    runtime.load(host.exportDocument(), [{ ownerId: 'nixie.foxhole-planner', name: 'Foxhole', contribution: manifest.contributes.experimentalComponents }]);
    runtime.selection.set([id]);
    const draftEntity = { ...host.readEntity(id), entityId: 'maintenance-draft', components: host.readEntity(id).components.filter(component => component.componentId !== 'maintenance-supply') };
    const draft = { entities: [draftEntity], rootIds: ['maintenance-draft'], label: 'Maintenance Tunnel', x: 0, y: 0, rotation: 0,
        followingPointer: true, ready: true, canMove: true, canRotate: true };
    runtime.canvas.attach({ placementInspector: () => draft,
        patchPlacementInspectorComponents: (_updates: unknown, entities: typeof draft.entities) => {
            draft.entities = entities.filter(entity => entity.entityId === 'maintenance-draft');
            return true;
        } } as never);
    const before = runtime.exportDocument();
    assert.equal(runtime.patchPlacementInspectorNodes(['maintenance-draft'], { maintenanceFilters: { range: 30, exclusions: ['facility'] } }), true, runtime.actionError);
    assert.deepEqual(foxholeSceneV2StateAdapter.project(draft.entities[0]!)!.state.maintenanceFilters, { range: 30, exclusions: ['facility'] });
    assert.deepEqual(runtime.exportDocument(), before);
    assert.deepEqual(runtime.selection.ids, [id]);
    assert.deepEqual(foxholeSceneV2StateAdapter.project(host.readEntity(id))!.state.maintenanceFilters, { range: 100, exclusions: [] });
});


test('Inspector bunkbed hover previews reveal the interior without saving', () => {
 const {host,id,project}=fixture('foxholeAsset',{foxholeKey:'fortt3',modificationVariantIds:{FrontInfraModSlot:'desk'}});
 const original=host.readEntity(id),before=host.exportDocument(),selected=project().state.modificationVariantIds;
 const hover={nodeId:id,slotId:'BackInfraModSlot',variantId:'bunkbed'};
 const bunkbed=assets.fortt3.modifications.BackInfraModSlot!.variants.bunkbed!;
 const shadow={resourceId:'foxhole.visual.bunkbed-shadow',width:12,height:12,offsetX:0,offsetY:0,surfaceWidth:10,surfaceHeight:10,surfaceOffsetX:0,surfaceOffsetY:0};
 const metadata={...assets.fortt3,contactShadows:{[bunkbed.resourceId]:shadow}};
 const preview=buildFoxholeSceneV2RenderPreview(original,hover,{},metadata,foxholeSceneV2StateAdapter)!;
 assert.ok(preview);assert.equal(preview.settings?.['foxhole.structure.hideRoofs'],true);
 assert.equal((foxholeSceneV2StateAdapter.project(preview.entity)!.state.modificationVariantIds as Record<string,string>).BackInfraModSlot,'bunkbed');
 assert.ok(Object.values(preview.resourceOpacity!).includes(.52));assert.ok(Object.values(preview.modelNodeOpacity!).includes(.52));
 assert.equal(preview.resourceOpacity![shadow.resourceId],.52);
 const plan=renderFoxholeSceneV2Entity(preview.entity,{contractVersion:1,entities:[preview.entity],settings:preview.settings});
 assert.ok(plan.experimentalSpatial?.hiddenModelNodes?.includes('structure-layer-roof'));
 assert.deepEqual(host.exportDocument(),before);assert.deepEqual(project().state.modificationVariantIds,selected);
 assert.equal(buildFoxholeSceneV2RenderPreview(original,null,{},assets.fortt3,foxholeSceneV2StateAdapter),null);
 assert.equal(buildFoxholeSceneV2RenderPreview(original,{...hover,nodeIds:['other']},{},assets.fortt3,foxholeSceneV2StateAdapter),null);
 const exterior=buildFoxholeSceneV2RenderPreview(original,{...hover,slotId:'BackDefenseModSlot',variantId:'sandbags'},{},assets.fortt3,foxholeSceneV2StateAdapter)!;
 assert.equal(exterior.settings?.['foxhole.structure.hideRoofs'],undefined);
});

test('Inspector upgrade and default hovers use V1 opacity without saving',()=>{
 const {host,id}=fixture('foxholeAsset',{foxholeKey:'facilityrefinery2'});const original=host.readEntity(id),before=host.exportDocument();
 const upgrade=buildFoxholeSceneV2RenderPreview(original,{nodeId:id,slotId:'UpgradeSlotComponent',variantId:'engineeringstation',mode:'replacement'},{},assets.facilityrefinery2,foxholeSceneV2StateAdapter)!;
 assert.equal(upgrade.opacity,.52);
 const base=buildFoxholeSceneV2RenderPreview(upgrade.entity,{nodeId:id,slotId:'UpgradeSlotComponent',variantId:'',mode:'replacement'},{},assets.facilityrefinery2,foxholeSceneV2StateAdapter)!;
 assert.equal(base.opacity,.52);assert.deepEqual(host.exportDocument(),before);
});


test('Inspector preview projection follows hover lifecycle and never changes the placement or saved source',async()=>{
 const activate=await prepareFoxholePreviewAssets({generationHash:'test',readProductCatalog:async()=>({baseUrl:'https://example.com/',sha256:'test',text:JSON.stringify({products:[{id:'fortt3',data:assets.fortt3}]})})});activate();
 const {host,id}=fixture('foxholeAsset',{foxholeKey:'fortt3'});const original=host.readEntity(id),before=host.exportDocument(),settings={};
 try{
  setActiveNixieStructureModificationHoverPreview({nodeId:id,nodeIds:[id,'other'],slotId:'BackInfraModSlot',variantId:'bunkbed'});
  const first=foxholeSceneV2StateAdapter.renderPreview!(original,settings)!;
  assert.ok(first);assert.equal(foxholeSceneV2StateAdapter.renderPreview!(original,settings),first);
  assert.equal(foxholeSceneV2StateAdapter.renderPreview!(first.entity,settings),first,'a render snapshot must not apply twice');
  setActiveNixieStructureModificationHoverPreview({nodeId:id,slotId:'FrontInfraModSlot',variantId:'bunkbed'});
  const next=foxholeSceneV2StateAdapter.renderPreview!(original,settings)!;
  assert.notDeepEqual(next.modelNodeOpacity,first.modelNodeOpacity,'orientation uses the newly hovered slot');
  assert.deepEqual(host.exportDocument(),before);
  setActiveNixieStructureModificationHoverPreview(null);assert.equal(foxholeSceneV2StateAdapter.renderPreview!(original,settings),null);
 }finally{setActiveNixieStructureModificationHoverPreview(null);(await prepareFoxholePreviewAssets(null))();}
});

test('Scene V2 bracket tier edits use typed finalized updates and one persistence batch', async () => {
    const { buildFoxholeSceneV2SelectionTierUpdates } = await import('../app/plugins/foxhole/nixie/scene-v2-tier-commands.ts');
    const { host, id, manifest } = fixture('foxholeAsset', { foxholeKey: 'trencht1', x: 123, y: -47, rotation: 0.75 });
    const runtime = new NixieSceneV2EditorRuntimeController();
    let writes = 0;
    runtime.setEditable(true);
    runtime.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
        applyEntityMutations: () => { writes++; return true; } });
    assert.equal(runtime.load(host.exportDocument(), [{ ownerId: manifest.id, name: manifest.name,
        contribution: manifest.contributes.experimentalComponents }]).ok, true);
    runtime.selection.set([id]);
    for (const [direction, target] of [['up', 'trencht2'], ['up', 'trencht3'], ['down', 'trencht2'], ['down', 'trencht1']] as const) {
        const updates = buildFoxholeSceneV2SelectionTierUpdates(runtime, direction);
        assert.ok(updates.length);
        assert.equal((await runtime.updateEntityComponentsFinalized(updates)).ok, true);
        const entity = runtime.entities.find(entity => entity.entityId === id)!;
        assert.equal(foxholeSceneV2StateAdapter.project(entity)!.state.foxholeKey, target);
        assert.equal(entity.components.find(component => component.componentId === 'model')!.data.resourceId, 'foxhole.model.' + target);
        assert.deepEqual(runtime.selection.ids, [id]);
        if (target === 'trencht3') assert.deepEqual(buildFoxholeSceneV2SelectionTierUpdates(runtime, 'up'), []);
    }
    assert.equal(writes, 4);

    runtime.setEditable(false);
    const before = runtime.exportDocument();
    assert.equal((await runtime.updateEntityComponentsFinalized(buildFoxholeSceneV2SelectionTierUpdates(runtime, 'up'))).ok, false);
    assert.deepEqual(runtime.exportDocument(), before);
});

test('Scene V2 tier commands batch mixed selections and reject locked tier targets', async () => {
    const { buildFoxholeSceneV2SelectionTierUpdates } = await import('../app/plugins/foxhole/nixie/scene-v2-tier-commands.ts');
    const { manifest } = fixture();
    for (const locked of [false, true]) {
        const content = convertNixieSceneV1ToV2([
            { id: 'a', type: 'foxholeAsset', state: { foxholeKey: 'trencht1' }, children: [] },
            { id: 'b', type: 'foxholeAsset', state: { foxholeKey: 'trencht2', locked }, children: [] },
            { id: 'c', type: 'foxholeAsset', state: { foxholeKey: 'fortt3', packaged: true }, children: [] },
        ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content;
        const runtime = new NixieSceneV2EditorRuntimeController();let writes = 0;
        runtime.setEditable(true);
        runtime.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
            applyEntityMutations: () => { writes++; return true; } });
        assert.equal(runtime.load(content, [{ ownerId: manifest.id, name: manifest.name, contribution: manifest.contributes.experimentalComponents }]).ok, true);
        runtime.selection.set(runtime.entities.map(entity => entity.entityId));
        const updates = buildFoxholeSceneV2SelectionTierUpdates(runtime, 'up');
        if (locked) { assert.deepEqual(updates, []);continue; }
        assert.equal(new Set(updates.map(update => update.entityId)).size, 2);
        assert.equal((await runtime.updateEntityComponentsFinalized(updates)).ok, true);
        assert.equal(writes, 1);
        assert.deepEqual(runtime.entities.map(entity => foxholeSceneV2StateAdapter.project(entity)!.state.foxholeKey), ['trencht2', 'trencht3', 'fortt3']);
    }
});
