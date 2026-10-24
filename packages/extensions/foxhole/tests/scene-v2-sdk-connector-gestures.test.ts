import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseNixieExtensionManifestV1, parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk';
import { createFakeNixieExtensionHost } from '@nixie/extension-sdk/testing';
import { NixieSceneV2EditorRuntimeController } from '../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { NixieSceneV2TransformFinalizerAdapter } from '../../../nixie/app/utils/nixie-scene-v2-transform-finalizer-adapter.ts';
import { withNixieSceneV2CoreComponents, NIXIE_SCENE_V2_CORE_COMPONENTS } from '../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { getNixieSceneV2EditableHandles, buildNixieSceneV2EditableHandleUpdates } from '../../../nixie/app/utils/nixie-scene-v2-editable-handles.ts';
import { listNixieSceneV2StateAdapters } from '../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { getNixieInternalSceneV2Adapter } from '../../../nixie/desktop-extensions/internal-scene-v2-adapters.ts';
import { listFoxholeSceneV2Products } from '../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import { finalizeFoxholeSceneV2Transform } from '../../../../extensions/foxhole-planner/src/scene-v2-transform-finalizer.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { buildNixieSceneV2GeometryWheelUpdates } from '../../../nixie/desktop-extensions/scene-v2-geometry-wheel.ts';
import assets from '../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import type { NixieExperimentalGeometryGestureV1 } from '@nixie/extension-sdk';

test('Planner placement and endpoint gestures run through the SDK without the Nuxt integration', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const owner = manifest.id, contribution = manifest.contributes.experimentalComponents!;
    assert.equal(listNixieSceneV2StateAdapters().length, 0);
    assert.equal(getNixieInternalSceneV2Adapter(owner), undefined);
    const product = (id: string) => listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 }).items.find(item => item.product.id === 'asset.' + id)!.product;
    const structure = (id: string, asset: string, x: number) => ({ entityId: id, revision: 0,
        components: withNixieSceneV2CoreComponents(product(asset), { name: id, x, y: 0, capabilities: ['move', 'rotate'] }).components });
    const fake = createFakeNixieExtensionHost({ extensionId: owner });
    const connection = await fake.connect({ sceneV2: { transformFinalizers: {
        'transforms.spline-socket-snapping': finalizeFoxholeSceneV2Transform,
        'transforms.connector-socket-snapping': finalizeFoxholeSceneV2Transform,
        'transforms.socket-snapping': finalizeFoxholeSceneV2Transform,
    } } });
    let enabled = true, writes = 0;
    const adapter = new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => [{ ownerId: owner, name: manifest.name, generationHash: 'one', contribution,
            transformFinalizers: manifest.contributes.experimentalTransformFinalizers! }], isSettingEnabled: () => enabled,
        getClient: () => ({ finalizeSceneV2Transform: async (_owner, _generation, system, request) => fake.finalizeTransform(system, request) }),
    });
    const runtime = new NixieSceneV2EditorRuntimeController();
    runtime.setEditable(true);
    runtime.attachPersistence({ canUndo: false, canRedo: false, isAttached: () => true, undo: () => false, redo: () => false,
        applyEntityMutations: () => { writes++; return true; } });
    const catalog = [{ ownerId: owner, name: manifest.name, contribution }];
    const loaded = runtime.load({ type: 'scene-v2', contractVersion: 1, entities: [structure('plant', 'facilitypowerdiesel', 0),
        structure('pole', 'powerpole', 400), structure('other', 'powerpole', 650)] }, catalog);
    assert.equal(loaded.ok, true, loaded.error);
    runtime.attachTransformFinalizer(adapter);
    runtime.canvas.attach({} as never);
    assert.equal(runtime.beginProductPlacement(product('powerline'), owner, 'Power Line', () => 'line', () => true), true);
    const context = (id: string, x: number, y: number) => ({ entities: runtime.entities, worldTransforms: new Map(),
        hoveredEntityIds: id ? [id] : [], worldPoint: { x, y }, isSettingEnabled: () => enabled });
    const start = context('plant', 100, 100);
    const first = await runtime.previewProductPlacement(start.worldPoint, start);
    assert.equal(first?.components.find(c => c.componentId === 'spline-connector')?.data.startAttachmentNodeId, 'plant');
    assert.equal((await runtime.commitProductPlacement(start.worldPoint, false, start)).ok, true);
    const plantSocket = assets.facilitypowerdiesel!.buildSockets.find(s => s.name === 'PowerSocket')!;
    assert.ok(Math.abs(runtime.productPlacement!.anchor!.x - plantSocket.x) < 1e-8);
    const end = context('pole', 400, 100);
    runtime.updateProductPlacement(end.worldPoint);
    const preview = await runtime.previewProductPlacement(end.worldPoint, end);
    assert.equal(preview?.components.find(c => c.componentId === 'spline-connector')?.data.endAttachmentNodeId, 'pole');
    assert.equal(writes, 0);
    assert.equal((await runtime.commitProductPlacement(end.worldPoint, false, end)).ok, true);
    assert.equal(writes, 1);
    const geometry = () => runtime.entities.find(e => e.entityId === 'line')!.components.find(c => c.componentId === 'spline-connector')!.data;
    const line = runtime.entities.find(e => e.entityId === 'line')!;
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(line, { contractVersion: 1, entities: runtime.entities }));
    const definitions = new Map([...NIXIE_SCENE_V2_CORE_COMPONENTS.components.map(c => ['nixie.core\0' + c.id, c] as const),
        ...contribution.components.map(c => [owner + '\0' + c.id, c] as const)]);
    assert.deepEqual(getNixieSceneV2EditableHandles(line, definitions, plan.experimentalSelectionGeometry?.geometryHandles).map(h => h.id), ['start', 'end']);
    assert.match(JSON.stringify(plan.experimentalSpatial), /pole/);
    for (const id of ['plant', 'pole']) assert.ok(runtime.entities.find(e => e.entityId === id)!.components.find(c => c.componentId === 'socket-attachments')?.data.attachments?.length);
    const originalTransform = line.components.find(c => c.componentId === 'transform')!.data;
    const updates = buildNixieSceneV2EditableHandleUpdates(line, 'end', { x: 600, y: 50 }, false, definitions)!;
    const gesture: NixieExperimentalGeometryGestureV1 = { phase: 'preview', handleId: 'end', snappingEnabled: true,
        worldPoint: { x: 650, y: 100, z: 0 }, hoveredEntityIds: ['other'] };
    const before = runtime.exportDocument();
    const dragged = await runtime.previewEntityComponentsFinalized(updates.map(u => ({ ...u, entityId: 'line' })), 'line', 'transform', gesture);
    assert.equal(dragged?.find(e => e.entityId === 'line')?.components.find(c => c.componentId === 'spline-connector')?.data.endAttachmentNodeId, 'other');
    assert.deepEqual(runtime.exportDocument(), before);
    assert.equal((await runtime.commitComponentPlacement({ entityId: 'line', sourceRevision: line.revision, updates, geometryGesture: { ...gesture, phase: 'commit' } })).ok, true);
    assert.equal(geometry().startAttachmentNodeId, 'plant');
    assert.equal(geometry().endAttachmentNodeId, 'other');
    assert.deepEqual(runtime.entities.find(e => e.entityId === 'line')!.components.find(c => c.componentId === 'transform')!.data, originalTransform);
    assert.equal(writes, 2);
    enabled = false;
    assert.equal((await runtime.commitComponentPlacement({ entityId: 'line', sourceRevision: runtime.entities.find(e => e.entityId === 'line')!.revision,
        updates, geometryGesture: { ...gesture, phase: 'commit' } })).ok, true);
    assert.equal(geometry().endAttachmentNodeId, undefined);
    assert.equal(geometry().startAttachmentNodeId, 'plant');
    const saved = runtime.exportDocument();
    assert.equal(runtime.load(saved, catalog).ok, true);
    assert.equal(geometry().startAttachmentNodeId, 'plant');
    assert.equal(geometry().endAttachmentNodeId, undefined);
    connection.dispose();
});

test('pipe curve wheels work during SDK-only placement and emit field-only saved edits', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const owner = manifest.id, contribution = manifest.contributes.experimentalComponents!;
    assert.equal(listNixieSceneV2StateAdapters().length, 0);
    assert.equal(getNixieInternalSceneV2Adapter(owner), undefined);
    const definitions = new Map(contribution.components.map(c => [owner + '\0' + c.id, c]));
    const products = (key: string) => listFoxholeSceneV2Products({ contractVersion: 1, query: key, offset: 0, limit: 100 }).items.find(i => i.product.id === 'asset.' + key)!.product;
    for (const key of ['facilitypipe', 'facilitypipeunderground']) {
        const runtime = new NixieSceneV2EditorRuntimeController();
        let writes = 0;
        runtime.setEditable(true);
        runtime.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
            applyEntityMutations: () => { writes++; return true; } });
        assert.equal(runtime.load({ type: 'scene-v2', contractVersion: 1, entities: [] }, [{ ownerId: owner, name: manifest.name, contribution }]).ok, true);
        runtime.canvas.attach({} as never);
        assert.equal(runtime.beginProductPlacement(products(key), owner, key, () => key, () => true), true);
        const render = () => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(runtime.productPlacement!.entity, { contractVersion: 1, entities: [] }));
        const control = render().experimentalSelectionGeometry!.geometryWheelControl!;
        assert.deepEqual(control, { componentId: 'spline-connector', propertyId: 'curveT', step: 0.05, minimum: 0, maximum: 1 });
        const data = () => runtime.productPlacement!.entity.components.find(c => c.componentId === 'spline-connector')!.data;
        const initial = Number(data().curveT);
        const before = render();
        assert.equal(runtime.adjustProductPlacementWheel(owner, control, -120), true);
        assert.equal(data().curveT, initial + 0.05);
        assert.equal((await runtime.commitProductPlacement({ x: 10, y: 20 })).ok, true);
        runtime.updateProductPlacement({ x: 250, y: 150 });
        assert.equal(data().curveT, initial + 0.05);
        assert.equal(writes, 0);
        assert.notDeepEqual(render().root, before.root);
        assert.equal((await runtime.commitProductPlacement({ x: 250, y: 150 })).ok, true);
        assert.equal(writes, 1);
        const placed = runtime.entities[0]!;
        const withLinks = { ...placed, components: placed.components.map(c => c.componentId === 'spline-connector'
            ? { ...c, data: { ...c.data, startAttachmentNodeId: 'peer', startAttachmentSocketName: 'BackSocket' } } : c) };
        const updates = buildNixieSceneV2GeometryWheelUpdates(withLinks, owner, control, -1, definitions)!;
        assert.deepEqual(Object.keys(updates[0]!.set), ['curveT']);
        assert.equal((await runtime.reshapeComponentGeometryBatch([{ entityId: placed.entityId, sourceRevision: placed.revision, updates }])).ok, true);
        assert.equal(writes, 2);
        const saved = runtime.exportDocument();
        assert.equal(runtime.load(saved, [{ ownerId: owner, name: manifest.name, contribution }]).ok, true);
        assert.equal(runtime.entities[0]!.components.find(c => c.componentId === 'spline-connector')!.data.curveT, Number((initial + 0.1).toPrecision(15)));
    }
    for (const key of ['powerline']) {
        const result = listFoxholeSceneV2Products({ contractVersion: 1, query: key, offset: 0, limit: 100 }).items.find(i => i.product.id === 'asset.' + key);
        assert.ok(result);
        const entity = { entityId: key, revision: 0, components: withNixieSceneV2CoreComponents(result.product, { name: key, x: 0, y: 0 }).components.map(c => ({ ...c, definitionAvailable: true })) };
        assert.equal(parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [] })).experimentalSelectionGeometry?.geometryWheelControl, undefined);
    }
});
