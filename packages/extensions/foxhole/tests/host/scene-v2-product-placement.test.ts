import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { readNixieSceneV2EditableSpline } from '../../../../nixie/desktop-extensions/scene-v2-spline-editing.ts';
import { readNixieSceneV2EditablePolyline } from '../../../../nixie/desktop-extensions/scene-v2-polyline-editing.ts';
import { getNixieSceneV2EditableHandles, buildNixieSceneV2EditableHandleUpdates,
    buildNixieSceneV2PolylineDeleteUpdates, buildNixieSceneV2PolylineInsertUpdates } from '../../../../nixie/app/utils/nixie-scene-v2-editable-handles.ts';
import { applyNixieSceneV2InspectorChoice } from '../../../../nixie/desktop-extensions/scene-v2-schema-editor.ts';
import { inspectFoxholeSceneV2PlanningPath } from '../../../../../extensions/foxhole-planner/src/scene-v2-inspector.ts';
import { inspectDiagramNodeStyle } from '../../../../../extensions/scene-v2-diagram/src/node-styles.ts';
import { hasNixieSceneV2Capability } from '../../../../nixie/desktop-extensions/scene-v2-capabilities.ts';
import { NixieSceneV2TransformFinalizerAdapter } from '../../../../nixie/app/utils/nixie-scene-v2-transform-finalizer-adapter.ts';
import { finalizeDiagramTransform } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';
import foxholeAssets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { bindFoxholeModelLayerNodes } from '../../../../../extensions/foxhole-planner/src/model-layer-nodes.ts';
import { finalizeFoxholeSurfacePlacement } from '../../../../../extensions/foxhole-planner/src/surface-placement.ts';
import { finalizeFoxholeSceneV2Transform } from '../../../../../extensions/foxhole-planner/src/scene-v2-transform-finalizer.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import { NixieSceneV2EditorRuntimeController } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import type { NixieSceneV2PersistencePort } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import type { NixieSceneV2CanvasPort } from '../../../../nixie/app/utils/nixie-scene-v2-canvas-coordinator.ts';
import { NIXIE_SCENE_V2_CORE_OWNER_ID, NIXIE_SCENE_V2_CORE_PRODUCTS } from '../../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { convertNixieSceneV1ToV2 } from '../../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { readNixieSceneV2LocalTransform, readNixieSceneV2ParentId, resolveNixieSceneV2Transforms } from '../../../../nixie/desktop-extensions/scene-v2-transforms.ts';

function canvas(): NixieSceneV2CanvasPort {
    return { capturePng: async () => ({ blob: new Blob(), width: 1, height: 1 }), captureFrame: () => null,
        center: () => {}, fitSelectionOrScene: () => {}, fitScene: () => {}, restoreFrame: () => true,
        resetZoom: () => {}, zoomIn: () => {}, zoomOut: () => {}, selectionBounds: () => [] };
}
function fixture() {
    const runtime = new NixieSceneV2EditorRuntimeController();
    const mutations: unknown[] = [];
    let accept = true;
    let revision = 0;
    let generationCurrent = true;
    const port: NixieSceneV2PersistencePort = { isAttached: () => true, canUndo: false, canRedo: false,
        getContentRevision: () => revision, undo: () => false, redo: () => false,
        applyEntityMutations: entries => {
            if (!accept) {
                return false;
            }
            mutations.push(entries);
            revision += 1;
            return true;
        } };
    runtime.setEditable(true);
    runtime.load({ type: 'scene-v2', contractVersion: 1, entities: [] }, []);
    runtime.attachPersistence(port);
    runtime.attachCanvas(canvas());
    const begin = () => runtime.beginProductPlacement(NIXIE_SCENE_V2_CORE_PRODUCTS[0]!, NIXIE_SCENE_V2_CORE_OWNER_ID,
        'Placed Rectangle', () => 'placed', () => generationCurrent);
    return { runtime, mutations, port, begin, isGenerationCurrent: () => generationCurrent, rejectWrites: () => {
        accept = false;
    },
    retireGeneration: () => {
        generationCurrent = false;
    }, changeRevision: () => {
        revision += 1;
    } };
}

function splineFixture(name: 'scene-v2-diagram' | 'foxhole-planner') {
    const f = fixture();
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(hostSourceUrl(`../../../../../extensions/${name}/nixie.extension.json`, import.meta.url), 'utf8')));
    f.runtime.load({ type: 'scene-v2', contractVersion: 1, entities: [] }, [{ ownerId: manifest.id,
        contribution: manifest.contributes.experimentalComponents! }]);
    const product = manifest.contributes.experimentalProducts!.find(entry => entry.components.some(component =>
        component.componentId === (name === 'scene-v2-diagram' ? 'connection' : 'spline-connector')))!;
    const begin = () => f.runtime.beginProductPlacement(product, manifest.id, 'Drawn Connection', () => 'drawn', f.isGenerationCurrent);
    return { ...f, begin, manifest };
}

function polylineFixture(name: 'scene-v2-diagram' | 'foxhole-planner') {
    const f = splineFixture(name);
    const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.components.some(component =>
        component.componentId === (name === 'scene-v2-diagram' ? 'route' : 'connector')))!;
    return { ...f, begin: () => f.runtime.beginProductPlacement(product, f.manifest.id, 'Point Path', () => 'drawn-path', f.isGenerationCurrent) };
}

test('tool defaults edit a detached draft without history and apply to successive creations and fresh hosts', async () => {
    const saved = new Map<string, unknown>();
    for (const name of ['foxhole-planner', 'scene-v2-diagram'] as const) {
        const f = splineFixture(name);
        const declaration = f.manifest.contributes.experimentalProductTools!.find(tool => tool.id === (name === 'foxhole-planner' ? 'planning.range' : 'route'))!;
        const product = f.manifest.contributes.experimentalProducts!.find(candidate => candidate.id === declaration.productId)!;
        const tool = { ...declaration, id: `extension:${f.manifest.id}:${declaration.id}`, ownerId: f.manifest.id, generationHash: 'one', product };
        let next = 0;
        const port = { read: (id: string) => saved.get(id), write: (id: string, value: unknown) => {
            saved.set(id, structuredClone(value));
        } };
        f.runtime.attachProductToolOptions(port);
        f.runtime.setProductTools([tool], () => `new-${++next}`);
        assert.equal(f.runtime.activateTool(tool.id), true);
        const inspection = f.runtime.productToolOptionsInspection!;
        const componentId = name === 'foxhole-planner' ? 'range' : 'route';
        const set = name === 'foxhole-planner' ? { sweepAngle: 180 } : { color: 0xFFCC66 };
        assert.equal(f.runtime.updateProductToolOptions(inspection.entity.entityId, { ownerId: f.manifest.id, componentId, set }).ok, true);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.runtime.updateProductToolOptions(inspection.entity.entityId, { ownerId: f.manifest.id, componentId, set: { points: [0, 0, 400, 0] } }).ok, false);
        assert.equal(f.runtime.updateProductToolOptions(inspection.entity.entityId, { ownerId: 'nixie.core', componentId: 'transform', set: { x: 40 } }).ok, false);
        await f.runtime.commitProductPlacement({ x: 100, y: 200 });
        await f.runtime.commitProductPlacement({ x: 420, y: 200 });
        if (name === 'scene-v2-diagram') {
            await f.runtime.commitProductPlacement({ x: 420, y: 200 }, true);
        }
        assert.equal(f.mutations.length, 1);
        const data = f.runtime.entities[0]!.components.find(component => component.componentId === componentId)!.data;
        for (const [id, value] of Object.entries(set)) {
            assert.equal(data[id], value);
        }
        f.runtime.cancelProductPlacement();
        const fresh = splineFixture(name);
        fresh.runtime.attachProductToolOptions(port);
        fresh.runtime.setProductTools([tool], () => 'fresh');
        fresh.runtime.activateTool(tool.id);
        const restored = fresh.runtime.productToolOptionsInspection!.entity.components.find(component => component.componentId === componentId)!.data;
        for (const [id, value] of Object.entries(set)) {
            assert.equal(restored[id], value);
        }
        fresh.runtime.setEditable(false);
        assert.equal(fresh.runtime.updateProductToolOptions('tool-options', { ownerId: f.manifest.id, componentId, set }).ok, false);
        assert.equal(fresh.mutations.length, 0);
    }
});

test('Planner and neutral drawing minimums reject short input and rearm without authored mutations', async () => {
    for (const name of ['foxhole-planner', 'scene-v2-diagram'] as const) {
        const f = splineFixture(name);
        const productId = name === 'foxhole-planner' ? 'planning.range' : 'connection';
        const product = f.manifest.contributes.experimentalProducts!.find(candidate => candidate.id === productId)!;
        let identity = 0;
        const begin = () => f.runtime.beginProductPlacement(product, f.manifest.id, 'Span', () => `span-${++identity}`, f.isGenerationCurrent);
        assert.equal(begin(), true);
        assert.equal(f.runtime.productPlacement!.dragToCreate, true);
        await f.runtime.commitProductPlacement({ x: 10, y: 20 });
        const minimum = product.drawing!.minimumLength!;
        assert.equal((await f.runtime.commitProductPlacement({ x: 10 + minimum - 1, y: 20 })).ok, false);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.productPlacement!.anchor, undefined);
        await f.runtime.commitProductPlacement({ x: 10, y: 20 });
        assert.equal((await f.runtime.commitProductPlacement({ x: 10 + minimum, y: 20 })).ok, true);
        assert.equal(f.runtime.entities.length, 1);
        assert.equal(f.mutations.length, 1);
    }
});

test('obsolete or invalid tool preferences cannot restore geometry, references or out-of-schema defaults', () => {
    const f = splineFixture('foxhole-planner');
    const declaration = f.manifest.contributes.experimentalProductTools!.find(tool => tool.id === 'planning.range')!;
    const product = f.manifest.contributes.experimentalProducts!.find(candidate => candidate.id === declaration.productId)!;
    const tool = { ...declaration, id: 'extension:range', ownerId: f.manifest.id, generationHash: 'one', product };
    f.runtime.attachProductToolOptions({ read: () => ({ contractVersion: 1, components: { range: { sweepAngle: 999, meterPixels: 1,
        points: [0, 0, 400, 0], strokeWidth: 4 } } }), write: () => {} });
    f.runtime.setProductTools([tool], () => 'draft');
    f.runtime.activateTool(tool.id);
    const data = f.runtime.productToolOptionsInspection!.entity.components[0]!.data;
    assert.equal(data.sweepAngle, 360);
    assert.equal(data.meterPixels, 32);
    assert.deepEqual(data.points, [0, 0, 160, 0]);
    assert.equal(data.strokeWidth, 4);
});

test('oversized preferences and failed preference writes retain contributed defaults without authoring', () => {
    const f = splineFixture('foxhole-planner');
    const declaration = f.manifest.contributes.experimentalProductTools!.find(tool => tool.id === 'planning.range')!;
    const product = f.manifest.contributes.experimentalProducts!.find(candidate => candidate.id === declaration.productId)!;
    const tool = { ...declaration, id: 'extension:range', ownerId: f.manifest.id, generationHash: 'one', product };
    f.runtime.attachProductToolOptions({ read: () => ({ contractVersion: 1, components: { range: { sweepAngle: 180 } },
        obsolete: 'x'.repeat(32 * 1024) }), write: () => {
        throw new Error('Preference storage unavailable');
    } });
    f.runtime.setProductTools([tool], () => 'draft');
    f.runtime.activateTool(tool.id);
    assert.equal(f.runtime.productToolOptionsInspection!.entity.components[0]!.data.sweepAngle, 360);
    const before = structuredClone(f.runtime.productPlacement);
    assert.equal(f.runtime.updateProductToolOptions('tool-options', { ownerId: f.manifest.id, componentId: 'range', set: { sweepAngle: 180 } }).ok, false);
    assert.deepEqual(f.runtime.productPlacement, before);
    assert.equal(f.runtime.entities.length, 0);
    assert.equal(f.mutations.length, 0);
});

test('complete preset styling commits once without touching geometry, node content or core transforms', () => {
    for (const name of ['foxhole-planner', 'scene-v2-diagram'] as const) {
        const f = splineFixture(name);
        const componentId = name === 'foxhole-planner' ? 'tactical-line' : 'node-style';
        const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === (name === 'foxhole-planner' ? 'planning.tactical-line' : 'styled-node'))!;
        assert.equal(f.runtime.instantiateProduct(product, f.manifest.id, 'Styled', () => 'styled').ok, true);
        const before = f.runtime.entities[0]!;
        const component = before.components.find(entry => entry.componentId === componentId)!;
        const request = { contractVersion: 1 as const, subject: before };
        const result = name === 'foxhole-planner' ? inspectFoxholeSceneV2PlanningPath(request) : inspectDiagramNodeStyle(request);
        const choices = result.components.find(entry => entry.componentId === componentId)!.fields.find(field => field.path.length === 0)!.choices!;
        const definition = f.runtime.definitions.get(`${f.manifest.id}\u0000${componentId}`)!;
        const styled = applyNixieSceneV2InspectorChoice(definition.schema, choices, 1, component.data) as Record<string, unknown>;
        const set = Object.fromEntries(choices.valuePropertyIds!.map(id => [id, styled[id]])) as typeof component.data;
        const count = f.mutations.length;
        assert.equal(f.runtime.updateEntityComponent(before.entityId, { ownerId: f.manifest.id, componentId, set }).ok, true);
        assert.equal(f.mutations.length, count + 1);
        const after = f.runtime.entities[0]!;
        assert.deepEqual(readNixieSceneV2LocalTransform(after), readNixieSceneV2LocalTransform(before));
        if (name === 'foxhole-planner') {
            const data = after.components.find(entry => entry.componentId === componentId)!.data;
            assert.deepEqual(data.points, component.data.points);
            assert.equal(data.presetId, 'advance');
            assert.equal(data.strokeDashLength, 20);
        } else {
            assert.deepEqual(after.components.find(entry => entry.componentId === 'node')?.data,
                before.components.find(entry => entry.componentId === 'node')?.data);
            assert.equal(after.components.find(entry => entry.componentId === componentId)!.data.styleId, 'emphasis');
        }
        f.runtime.setEditable(false);
        assert.equal(f.runtime.updateEntityComponent(after.entityId, { ownerId: f.manifest.id, componentId, set }).ok, false);
        assert.equal(f.mutations.length, count + 1);
    }
});

test('product tools activate owned drawing, repeat after one atomic creation, and cancel back to selection', async () => {
    const f = polylineFixture('scene-v2-diagram');
    const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'route')!;
    const declaration = f.manifest.contributes.experimentalProductTools![0]!;
    const tool = { ...declaration, id: 'extension:example.scene-v2-diagram:route', ownerId: f.manifest.id, generationHash: 'one', product };
    let next = 0;
    f.runtime.setProductTools([tool], () => `route-${++next}`);
    assert.equal(f.runtime.canActivateTool(tool.id), true);
    assert.equal(f.runtime.activateTool(tool.id), true);
    assert.equal(f.runtime.activeTool, tool.id);
    assert.equal(f.runtime.productPlacement?.kind, 'polyline');
    await f.runtime.commitProductPlacement({ x: 0, y: 0 });
    await f.runtime.commitProductPlacement({ x: 80, y: 40 });
    assert.equal((await f.runtime.commitProductPlacement({ x: 80, y: 40 }, true)).ok, true);
    assert.equal(f.mutations.length, 1);
    assert.equal(f.runtime.entities.length, 1);
    assert.equal(f.runtime.activeTool, tool.id);
    assert.equal(f.runtime.productPlacement?.pointCount, 0);
    assert.notEqual(f.runtime.productPlacement?.entity.entityId, f.runtime.entities[0]?.entityId);
    f.runtime.cancelProductPlacement();
    assert.equal(f.runtime.activeTool, 'selection');
    assert.equal(f.runtime.entities.length, 1);
});

test('product tool switching, read-only state and generation replacement retire detached drafts', async () => {
    for (const action of ['selection', 'readonly', 'generation', 'removed'] as const) {
        const f = polylineFixture('scene-v2-diagram');
        const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'route')!;
        const tool = { id: 'extension:example.scene-v2-diagram:route', ownerId: f.manifest.id, generationHash: 'one',
            label: 'Route', icon: 'ph:path', product };
        f.runtime.setProductTools([tool], () => 'draft');
        f.runtime.activateTool(tool.id);
        await f.runtime.commitProductPlacement({ x: 0, y: 0 });
        if (action === 'selection') {
            f.runtime.activateTool('selection');
        }
        if (action === 'readonly') {
            f.runtime.setEditable(false);
        }
        if (action === 'generation') {
            f.runtime.setProductTools([{ ...tool, generationHash: 'two' }], () => 'next-draft');
        }
        if (action === 'removed') {
            f.runtime.setProductTools([], () => 'next-draft');
        }
        assert.equal(f.runtime.productPlacement, null);
        assert.equal(f.runtime.activeTool, 'selection');
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
        if (action === 'readonly' || action === 'removed') {
            assert.equal(f.runtime.canActivateTool(tool.id), false);
        }
    }
});

test('fixed two-point Planner range products complete automatically and keep measurement defaults', async () => {
    const f = polylineFixture('foxhole-planner');
    const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'planning.range')!;
    assert.equal(f.runtime.beginProductPlacement(product, f.manifest.id, 'Range', () => 'range', f.isGenerationCurrent), true);
    await f.runtime.commitProductPlacement({ x: 100, y: 200 });
    assert.equal(f.runtime.entities.length, 0);
    assert.equal((await f.runtime.commitProductPlacement({ x: 420, y: 200 })).ok, true);
    assert.equal(f.mutations.length, 1);
    const data = f.runtime.entities[0]!.components.find(component => component.componentId === 'range')!.data;
    assert.deepEqual(data.points, [0, 0, 320, 0]);
    assert.equal(data.meterPixels, 32);
    assert.equal(data.showRadius, true);
});

test('named triangulation and waypoint arrays draw and edit without creating a points field', async () => {
    for (const name of ['foxhole-planner', 'scene-v2-diagram'] as const) {
        const f = splineFixture(name);
        const componentId = name === 'foxhole-planner' ? 'triangulation' : 'waypoint-route';
        const propertyId = name === 'foxhole-planner' ? 'edgePoints' : 'waypoints';
        const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.components.some(component => component.componentId === componentId))!;
        assert.equal(f.runtime.beginProductPlacement(product, f.manifest.id, 'Named Path', () => 'named-path', f.isGenerationCurrent), true);
        await f.runtime.commitProductPlacement({ x: 100, y: 200 });
        await f.runtime.commitProductPlacement({ x: 200, y: 220 });
        assert.equal((await f.runtime.commitProductPlacement({ x: 200, y: 220 }, true)).ok, false);
        assert.equal(f.mutations.length, 0);
        await f.runtime.commitProductPlacement({ x: 160, y: 300 });
        assert.equal((await f.runtime.commitProductPlacement({ x: 160, y: 300 }, true)).ok, true);
        assert.equal(f.mutations.length, 1);
        const entity = f.runtime.entities[0]!;
        const source = readNixieSceneV2EditablePolyline(entity, f.runtime.definitions)!;
        assert.equal(source.propertyId, propertyId);
        assert.deepEqual(source.points, [0, 0, 100, 20, 60, 100]);
        assert.equal(getNixieSceneV2EditableHandles(entity, f.runtime.definitions).length, 3);
        assert.equal(buildNixieSceneV2PolylineDeleteUpdates(entity, 'polyline-vertex-1', f.runtime.definitions), null);
        const updates = buildNixieSceneV2EditableHandleUpdates(entity, 'polyline-vertex-1', { x: 120, y: 40 }, true, f.runtime.definitions)!;
        assert.deepEqual(Object.keys(updates[0]!.set!), [propertyId]);
        assert.equal((await f.runtime.commitComponentPlacement({ entityId: entity.entityId, sourceRevision: entity.revision, updates })).ok, true);
        const data = f.runtime.entities[0]!.components.find(component => component.componentId === componentId)!.data;
        assert.deepEqual(data[propertyId], [0, 0, 120, 40, 60, 100]);
        assert.equal(Object.hasOwn(data, 'points'), false);
        const malformed = { ...f.runtime.entities[0]!, components: f.runtime.entities[0]!.components.map(component => component.componentId === componentId
            ? { ...component, data: { ...component.data, [propertyId]: [0, 0, 20, 20, 50] } }
            : component) };
        assert.equal(readNixieSceneV2EditablePolyline(malformed, f.runtime.definitions), null);
    }
});

test('declared point paths draft several clicks and persist only accepted vertices in one host mutation', async () => {
    for (const name of ['scene-v2-diagram', 'foxhole-planner'] as const) {
        const f = polylineFixture(name);
        assert.equal(f.begin(), true);
        assert.equal(f.runtime.productPlacement?.kind, 'polyline');
        await f.runtime.commitProductPlacement({ x: 100, y: 200 });
        assert.equal(f.runtime.updateProductPlacement({ x: 190, y: 230 }), true);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal((await f.runtime.commitProductPlacement({ x: 0, y: 0 }, true)).ok, false);
        await f.runtime.commitProductPlacement({ x: 180, y: 220 });
        await f.runtime.commitProductPlacement({ x: 180, y: 220 }); // Double-click must not add a duplicate.
        await f.runtime.commitProductPlacement({ x: 210, y: 270 });
        f.runtime.updateProductPlacement({ x: 400, y: 500 }); // Unaccepted hover is excluded on Enter.
        assert.equal(f.mutations.length, 0);
        assert.equal((await f.runtime.commitProductPlacement({ x: 400, y: 500 }, true)).ok, true);
        assert.equal(f.mutations.length, 1);
        const entity = f.runtime.entities[0]!;
        assert.deepEqual(readNixieSceneV2EditablePolyline(entity, f.runtime.definitions)?.points, [0, 0, 80, 20, 110, 70]);
        assert.deepEqual(readNixieSceneV2LocalTransform(entity), { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 });
        assert.equal(hasNixieSceneV2Capability(entity, 'geometry-reshape'), true);
        assert.equal(hasNixieSceneV2Capability(entity, 'scale'), false);
    }
});

test('point drawing cancellation, stale generations, lost authority and rejected persistence leave the document untouched', async () => {
    for (const action of ['cancel', 'generation', 'revision', 'readonly', 'reject'] as const) {
        const f = polylineFixture('scene-v2-diagram');
        f.begin();
        await f.runtime.commitProductPlacement({ x: 0, y: 0 });
        await f.runtime.commitProductPlacement({ x: 50, y: 10 });
        if (action === 'cancel') {
            f.runtime.cancelProductPlacement();
        }
        if (action === 'generation') {
            f.retireGeneration();
        }
        if (action === 'revision') {
            f.changeRevision();
        }
        if (action === 'readonly') {
            f.runtime.setEditable(false);
        }
        if (action === 'reject') {
            f.rejectWrites();
        }
        assert.equal((await f.runtime.commitProductPlacement({ x: 50, y: 10 }, true)).ok, false);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
    }
});

test('declared vertex edits retain unrelated data, enforce counts and reject malformed or inactive geometry', async () => {
    const f = polylineFixture('scene-v2-diagram');
    f.begin();
    for (const point of [{ x: 0, y: 0 }, { x: 60, y: 30 }, { x: 120, y: 0 }]) {
        await f.runtime.commitProductPlacement(point);
    }
    await f.runtime.commitProductPlacement({ x: 0, y: 0 }, true);
    const entity = f.runtime.entities[0]!;
    const definitions = f.runtime.definitions;
    assert.equal(getNixieSceneV2EditableHandles(entity, definitions).length, 3);
    const updates = buildNixieSceneV2EditableHandleUpdates(entity, 'polyline-vertex-1', { x: 70, y: 40 }, true, definitions)!;
    assert.equal((await f.runtime.commitComponentPlacement({ entityId: entity.entityId, sourceRevision: entity.revision, updates })).ok, true);
    const edited = f.runtime.entities[0]!;
    assert.deepEqual(readNixieSceneV2EditablePolyline(edited, definitions)?.points, [0, 0, 70, 40, 120, 0]);
    assert.equal(edited.components.find(component => component.componentId === 'route')!.data.color, 8045548);
    assert.equal((await f.runtime.commitComponentPlacement({ entityId: entity.entityId, sourceRevision: entity.revision, updates })).ok, false);
    assert.deepEqual(buildNixieSceneV2PolylineDeleteUpdates(edited, 'polyline-vertex-1', definitions)?.[0]?.set.points, [0, 0, 120, 0]);
    const world = [{ x: 0, y: 0 }, { x: 70, y: 40 }, { x: 120, y: 0 }];
    assert.equal(buildNixieSceneV2PolylineInsertUpdates(edited, world, { x: 30, y: 15 }, { x: 30, y: 15 }, definitions)?.[0]?.set.points.length, 8);
    assert.equal(readNixieSceneV2EditablePolyline(edited, new Map()), null);
    const malformed = { ...edited, components: edited.components.map(component => component.componentId === 'route'
        ? { ...component, data: { ...component.data, points: [0, 0, 10, 20, 30] } }
        : component) };
    assert.equal(readNixieSceneV2EditablePolyline(malformed, definitions), null);
    assert.equal(buildNixieSceneV2EditableHandleUpdates(edited, 'polyline-vertex-1', { x: Infinity, y: 40 }, true, definitions), null);
    const minimum = { ...edited, components: edited.components.map(component => component.componentId === 'route'
        ? { ...component, data: { ...component.data, points: [0, 0, 120, 0] } }
        : component) };
    assert.equal(buildNixieSceneV2PolylineDeleteUpdates(minimum, 'polyline-vertex-1', definitions), null);
    const maximumPoints = Array.from({ length: 64 }, (_, index) => index);
    const maximum = { ...edited, components: edited.components.map(component => component.componentId === 'route'
        ? { ...component, data: { ...component.data, points: maximumPoints } }
        : component) };
    const maximumWorld = Array.from({ length: 32 }, (_, index) => ({ x: index * 2, y: index * 2 + 1 }));
    assert.equal(buildNixieSceneV2PolylineInsertUpdates(maximum, maximumWorld, { x: 10, y: 11 }, { x: 10, y: 11 }, definitions), null);
});

test('multiple declared geometries and unpaired points cannot begin SDK drawing', () => {
    const f = polylineFixture('scene-v2-diagram');
    const products = f.manifest.contributes.experimentalProducts!;
    const route = products.find(entry => entry.id === 'route')!;
    const connection = products.find(entry => entry.id === 'connection')!;
    const begin = (product: typeof route) => f.runtime.beginProductPlacement(product, f.manifest.id, 'Invalid', () => 'invalid', f.isGenerationCurrent);
    assert.equal(begin({ ...route, components: [...route.components, ...connection.components] }), false);
    assert.equal(begin({ ...route, components: route.components.map(component => ({ ...component,
        data: { ...component.data, points: [0, 0, 10, 20, 30] } })) }), false);
    assert.equal(f.runtime.entities.length, 0);
    assert.equal(f.runtime.productPlacement, null);
});

function attachRealFinalizer(f: ReturnType<typeof splineFixture>, finalize: typeof finalizeDiagramTransform) {
    f.runtime.attachTransformFinalizer(new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => [{ ownerId: f.manifest.id, name: f.manifest.name, generationHash: 'fixture-generation',
            contribution: f.manifest.contributes.experimentalComponents!, transformFinalizers: f.manifest.contributes.experimentalTransformFinalizers! }],
        getClient: () => ({ finalizeSceneV2Transform: async (_ownerId, _generation, _system, request) => finalize(request) }),
        isSettingEnabled: () => true,
    }));
}

test('ordinary Diagram placement finalizes the detached new subject and persists core snap plus owner data once', async () => {
    const f = splineFixture('scene-v2-diagram');
    attachRealFinalizer(f, finalizeDiagramTransform);
    const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'process-node')!;
    assert.equal(f.runtime.beginProductPlacement(product, f.manifest.id, 'Process', () => 'new-process', f.isGenerationCurrent), true);
    const result = await f.runtime.commitProductPlacement({ x: 37, y: 50 });
    assert.equal(result.ok, true);
    assert.equal(f.mutations.length, 1);
    assert.deepEqual(readNixieSceneV2LocalTransform(f.runtime.entities[0]!), { x: 48, y: 48, rotation: 0, scaleX: 1, scaleY: 1 });
    const data = f.runtime.entities[0]!.components.find(component => component.componentId === 'node')!.data;
    assert.deepEqual([data.lastSnapX, data.lastSnapY], [48, 48]);
});

test('creating a real Foxhole power line commits both its endpoint attachment and target occupancy in one batch', async () => {
    const f = splineFixture('foxhole-planner');
    const product = (id: string) => listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 })
        .items.find(entry => entry.product.id === `asset.${id}`)!.product;
    assert.equal(f.runtime.instantiateProduct(product('powerbox'), f.manifest.id, 'Switch', () => 'switch').ok, true);
    assert.equal(f.runtime.updateEntityComponent('switch', { ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } }).ok, true);
    f.mutations.length = 0;
    attachRealFinalizer(f, finalizeFoxholeSceneV2Transform);
    assert.equal(f.runtime.beginProductPlacement(product('powerline'), f.manifest.id, 'Power Line', () => 'new-line', f.isGenerationCurrent), true);
    await f.runtime.commitProductPlacement({ x: 38.4, y: 0.0128 });
    assert.equal((await f.runtime.commitProductPlacement({ x: 600, y: 0.0128 })).ok, true);
    assert.equal(f.mutations.length, 1);
    const line = f.runtime.entities.find(entity => entity.entityId === 'new-line')!;
    const geometry = line.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.equal(geometry.startAttachmentNodeId, 'switch');
    assert.equal(geometry.startAttachmentSocketName, 'PowerSocket');
    const target = f.runtime.entities.find(entity => entity.entityId === 'switch')!;
    assert.deepEqual(target.components.find(component => component.componentId === 'socket-attachments')!.data.attachments,
        [{ localSocketName: 'PowerSocket', targetEntityId: 'new-line', targetSocketName: 'BackSocket' }]);
    assert.deepEqual((f.mutations[0] as Array<{ entityId: string; }>).map(mutation => mutation.entityId).sort(), ['new-line', 'switch']);
});

test('pending creation finalizers remain detached, reject duplicate confirmation and retire safely after cancellation or replacement', async () => {
    for (const expire of [(f: ReturnType<typeof splineFixture>) => f.runtime.cancelProductPlacement(),
        (f: ReturnType<typeof splineFixture>) => f.retireGeneration(),
        (f: ReturnType<typeof splineFixture>) => f.runtime.setEditable(false),
        (f: ReturnType<typeof splineFixture>) => f.runtime.attachCanvas(canvas()),
        (f: ReturnType<typeof splineFixture>) => f.runtime.attachPersistence(null)]) {
        const f = splineFixture('scene-v2-diagram');
        let complete!: (value: { transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; }; transactions: []; warnings: []; }) => void;
        f.runtime.attachTransformFinalizer({ replaceEntities: () => {}, finalize: async () => new Promise(resolve => {
            complete = resolve;
        }) });
        assert.equal(f.begin(), true);
        await f.runtime.commitProductPlacement({ x: 0, y: 0 });
        const pending = f.runtime.commitProductPlacement({ x: 120, y: 0 });
        assert.equal(f.runtime.productPlacement?.finalizing, true);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
        assert.equal((await f.runtime.commitProductPlacement({ x: 120, y: 0 })).ok, false);
        expire(f);
        complete({ transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, transactions: [], warnings: [] });
        assert.equal((await pending).ok, false);
        assert.equal(f.runtime.productPlacement, null);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.actionError, '');
    }
});

test('invalid creation proposals and rejected persistence cannot publish partial finalizer writes', async () => {
    for (const rejectedWrite of [false, true]) {
        const f = splineFixture('scene-v2-diagram');
        const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'process-node')!;
        f.runtime.attachTransformFinalizer({ replaceEntities: () => {}, finalize: async (_id, transform) => ({
            transform, warnings: [], transactions: [{ ownerId: f.manifest.id, transaction: { contractVersion: 1,
                transactionId: 'creation-proposal', operations: [{ op: 'patch', entityId: 'new-process', componentId: 'node',
                    set: { lastSnapX: rejectedWrite ? 48 : 'invalid-number' } }] } }],
        }) });
        if (rejectedWrite) {
            f.rejectWrites();
        }
        assert.equal(f.runtime.beginProductPlacement(product, f.manifest.id, 'Process', () => 'new-process', f.isGenerationCurrent), true);
        assert.equal((await f.runtime.commitProductPlacement({ x: 37, y: 50 })).ok, false);
        assert.equal(f.runtime.productPlacement, null);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
    }
});

test('Foxhole and neutral owned splines draw with two host clicks, detached previews and one authored mutation', async () => {
    for (const name of ['scene-v2-diagram', 'foxhole-planner'] as const) {
        const f = splineFixture(name);
        assert.equal(f.begin(), true);
        assert.equal(f.runtime.productPlacement?.kind, 'spline');
        assert.equal((await f.runtime.commitProductPlacement({ x: 100, y: 60 })).ok, true);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.updateProductPlacement({ x: 220, y: 180 }), true);
        const draft = readNixieSceneV2EditableSpline(f.runtime.productPlacement!.entity, f.runtime.definitions)!;
        assert.deepEqual([draft.data.startX, draft.data.startY, draft.data.endX, draft.data.endY], [0, 0, 120, 120]);
        assert.ok(Math.abs(draft.data.startRotation - Math.PI / 4) < 1e-8);
        assert.equal(f.mutations.length, 0);
        assert.equal((await f.runtime.commitProductPlacement({ x: 220, y: 180 })).ok, true);
        assert.equal(f.mutations.length, 1);
        const authored = f.runtime.entities[0]!;
        assert.equal(hasNixieSceneV2Capability(authored, 'geometry-reshape'), true);
        assert.equal(hasNixieSceneV2Capability(authored, 'move'), true);
        assert.deepEqual(readNixieSceneV2LocalTransform(authored), { x: 100, y: 60, rotation: 0, scaleX: 1, scaleY: 1 });
        assert.deepEqual(readNixieSceneV2EditableSpline(authored, f.runtime.definitions)!.data, draft.data);
    }
});

test('anchored spline drafts reject identical endpoints, clamp catalog length, and cancel without authoring', async () => {
    for (const cancel of [false, true]) {
        const f = splineFixture('scene-v2-diagram');
        assert.equal(f.begin(), true);
        await f.runtime.commitProductPlacement({ x: 0, y: 0 });
        assert.equal((await f.runtime.commitProductPlacement({ x: 0, y: 0 })).ok, false);
        assert.equal(f.runtime.updateProductPlacement({ x: 100000, y: 0 }), true);
        assert.equal(readNixieSceneV2EditableSpline(f.runtime.productPlacement!.entity, f.runtime.definitions)!.data.endX, 1000);
        assert.equal(f.mutations.length, 0);
        if (cancel) {
            f.runtime.cancelProductPlacement();
        } else {
            f.runtime.setEditable(false);
        }
        assert.equal((await f.runtime.commitProductPlacement({ x: 100000, y: 0 })).ok, false);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.entities.length, 0);
    }
});

test('anchored spline generations and rejected writes cannot leave a partially authored entity', async () => {
    for (const reject of [(f: ReturnType<typeof splineFixture>) => f.retireGeneration(),
        (f: ReturnType<typeof splineFixture>) => f.rejectWrites(),
        (f: ReturnType<typeof splineFixture>) => f.runtime.attachCanvas(canvas())]) {
        const f = splineFixture('scene-v2-diagram');
        assert.equal(f.begin(), true);
        await f.runtime.commitProductPlacement({ x: 0, y: 0 });
        f.runtime.updateProductPlacement({ x: 160, y: 40 });
        reject(f);
        assert.equal((await f.runtime.commitProductPlacement({ x: 160, y: 40 })).ok, false);
        assert.equal(f.runtime.entities.length, 0);
        assert.equal(f.runtime.productPlacement, null);
        assert.equal(f.mutations.length, 0);
    }
});

test('two-point spline drawing preserves both world endpoints beneath a transformed active layer', async () => {
    const f = splineFixture('scene-v2-diagram');
    const content = convertNixieSceneV1ToV2([{ id: 'layer', type: 'layer', key: 'Layer',
        state: { x: 100, y: 40, rotation: Math.PI / 4, scaleX: 2, scaleY: 2 }, children: [] }]).content;
    f.runtime.load(content, [{ ownerId: f.manifest.id, contribution: f.manifest.contributes.experimentalComponents! }]);
    f.runtime.setActiveLayer(content.entities[0]!.entityId);
    assert.equal(f.begin(), true);
    await f.runtime.commitProductPlacement({ x: 100, y: 60 });
    assert.equal((await f.runtime.commitProductPlacement({ x: 220, y: 180 })).ok, true);
    const entity = f.runtime.entities.find(entry => entry.entityId === 'drawn')!;
    const data = readNixieSceneV2EditableSpline(entity, f.runtime.definitions)!.data;
    const world = resolveNixieSceneV2Transforms(f.runtime.entities).get(entity.entityId)!.world;
    assert.ok(Math.abs(world.tx - 100) < 1e-8 && Math.abs(world.ty - 60) < 1e-8);
    assert.ok(Math.abs(world.a * data.endX + world.c * data.endY + world.tx - 220) < 1e-8);
    assert.ok(Math.abs(world.b * data.endX + world.d * data.endY + world.ty - 180) < 1e-8);
    assert.equal(f.mutations.length, 1);
});

test('a schema-valid but semantically invalid declared spline cannot fall back to ordinary point placement', async () => {
    const f = splineFixture('scene-v2-diagram');
    const product = structuredClone(f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'connection')!);
    product.components[0]!.data.minLength = 100;
    product.components[0]!.data.maxLength = 50;
    assert.equal(f.runtime.beginProductPlacement(product, f.manifest.id, 'Invalid Connection', () => 'invalid', () => true), false);
    assert.equal(f.runtime.productPlacement, null);
    assert.equal(f.runtime.entities.length, 0);
    assert.equal(f.mutations.length, 0);
    assert.match(f.runtime.actionError, /invalid or ambiguous declared geometry/);
});

test('product placement previews never persist and a click creates exactly one authored mutation', async () => {
    const { runtime, begin, mutations } = fixture();
    assert.equal(begin(), true);
    assert.ok(runtime.productPlacement);
    assert.equal(runtime.entities.length, 0);
    assert.equal(mutations.length, 0);
    const result = await runtime.commitProductPlacement({ x: 320, y: -96 });
    assert.equal(result.ok, true);
    assert.equal(runtime.productPlacement, null);
    assert.equal(mutations.length, 1);
    assert.deepEqual(runtime.selection.ids, ['placed']);
    assert.deepEqual(readNixieSceneV2LocalTransform(runtime.entities[0]!), { x: 320, y: -96, rotation: 0, scaleX: 1, scaleY: 1 });
});

test('Escape cancellation and stale permission, document, canvas and generation boundaries leave content unchanged', async () => {
    for (const expire of [
        (f: ReturnType<typeof fixture>) => f.runtime.cancelProductPlacement(),
        (f: ReturnType<typeof fixture>) => f.runtime.setEditable(false),
        (f: ReturnType<typeof fixture>) => f.runtime.attachCanvas(canvas()),
        (f: ReturnType<typeof fixture>) => f.runtime.attachPersistence(null),
        (f: ReturnType<typeof fixture>) => f.runtime.clear(),
        (f: ReturnType<typeof fixture>) => f.retireGeneration(),
        (f: ReturnType<typeof fixture>) => f.changeRevision(),
    ]) {
        const f = fixture();
        assert.equal(f.begin(), true);
        expire(f);
        assert.equal((await f.runtime.commitProductPlacement({ x: 1, y: 2 })).ok, false);
        assert.equal(f.mutations.length, 0);
        assert.equal(f.runtime.entities.length, 0);
    }
});

test('a rejected placement write rolls back creation without retaining a draft', async () => {
    const f = fixture();
    assert.equal(f.begin(), true);
    f.rejectWrites();
    assert.equal((await f.runtime.commitProductPlacement({ x: 1, y: 2 })).ok, false);
    assert.equal(f.runtime.entities.length, 0);
    assert.equal(f.runtime.productPlacement, null);
    assert.equal(f.mutations.length, 0);
});

test('unavailable definitions and read-only sessions cannot begin placement, and changing tools cancels the draft', async () => {
    const f = fixture();
    f.runtime.setEditable(false);
    assert.equal(f.begin(), false);
    f.runtime.setEditable(true);
    assert.equal(f.runtime.beginProductPlacement({ contractVersion: 1, id: 'unavailable',
        components: [{ ownerId: 'missing.extension', componentId: 'asset', version: 1, data: {} }] },
    'missing.extension', 'Missing', () => 'missing', () => true), false);
    assert.equal(f.begin(), true);
    f.runtime.setAuthoringTools(['rectangle']);
    f.runtime.activateTool('rectangle');
    assert.equal(f.runtime.productPlacement, null);
    assert.equal(f.mutations.length, 0);
});

test('placed world coordinates are preserved beneath a transformed active layer and locked layers reject authoring', async () => {
    const f = fixture();
    const content = convertNixieSceneV1ToV2([{ id: 'layer', type: 'layer', key: 'Layer',
        state: { x: 100, y: 40, rotation: Math.PI / 4, scaleX: 2, scaleY: 2 }, children: [] }]).content;
    f.runtime.load(content, []);
    assert.equal(f.begin(), true);
    assert.equal((await f.runtime.commitProductPlacement({ x: 320, y: 160 })).ok, true);
    const entity = f.runtime.entities.find(item => item.entityId === 'placed')!;
    assert.ok(readNixieSceneV2ParentId(entity));
    const world = resolveNixieSceneV2Transforms(f.runtime.entities).get('placed')!.world;
    assert.ok(Math.abs(world.tx - 320) < 1e-8 && Math.abs(world.ty - 160) < 1e-8);
    const locked = fixture();
    const lockedContent = convertNixieSceneV1ToV2([{ id: 'layer', type: 'layer', state: { locked: true }, children: [] }]).content;
    locked.runtime.load(lockedContent, []);
    locked.runtime.setActiveLayer(lockedContent.entities[0]!.entityId);
    assert.equal(locked.begin(), false);
    assert.equal(locked.mutations.length, 0);
});

for (const reject of [false, true]) test(`placement previews surface elevation without history and commits atomically (reject=${reject})`, async () => {
    const f = fixture();
    const intents: unknown[] = [];
    f.runtime.attachTransformFinalizer({ replaceEntities: () => {}, finalize: async (_id, transform, _staged, _entities, interaction) => {
        intents.push(interaction);
        return { transform, elevation: 12.8, transactions: [], warnings: [] };
    } });
    assert.equal(f.begin(), true);
    const preview = await f.runtime.previewProductPlacement({ x: 100, y: 200 });
    assert.equal(preview?.components.find(c => c.componentId === 'spatial-transform')?.data.elevation, 12.8);
    assert.equal(f.runtime.entities.length, 0);
    assert.equal(f.mutations.length, 0);
    if (reject) f.rejectWrites();
    assert.equal((await f.runtime.commitProductPlacement({ x: 100, y: 200 })).ok, !reject);
    assert.deepEqual(intents, ['placement', 'placement']);
    assert.equal(f.mutations.length, reject ? 0 : 1);
    assert.equal(f.runtime.entities.length, reject ? 0 : 1);
    if (!reject) assert.equal(f.runtime.entities[0]!.components.find(c => c.componentId === 'spatial-transform')?.data.elevation, 12.8);
});

test('real Planner surface finalizer grounds placement and live moves even with socket snapping disabled', async () => {
    const f = splineFixture('foxhole-planner');
    bindFoxholeModelLayerNodes(foxholeAssets.foundation012x2t1!, readFileSync(hostSourceUrl('../../public/foxhole/assets/models/foundation012x2t1.glb', import.meta.url)));
    const product = (id: string) => listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 })
        .items.find(entry => entry.product.id === `asset.${id}`)!.product;
    assert.equal(f.runtime.instantiateProduct(product('foundation012x2t1'), f.manifest.id, 'Floor', () => 'floor').ok, true);
    f.runtime.updateEntityComponents([{ entityId: 'floor', ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } },
        { entityId: 'floor', ownerId: 'nixie.core', componentId: 'spatial-transform', createIfMissing: true, set: { elevation: 64 } }]);
    f.runtime.attachTransformFinalizer(new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => [{ ownerId: f.manifest.id, name: f.manifest.name, generationHash: 'fixture',
            contribution: f.manifest.contributes.experimentalComponents!, transformFinalizers: f.manifest.contributes.experimentalTransformFinalizers! }],
        getClient: () => ({ finalizeSceneV2Transform: async (_owner, _generation, system, request) => {
            assert.equal(system, 'transforms.surface-placement');
            return finalizeFoxholeSurfacePlacement(request);
        } }), isSettingEnabled: () => false,
    }));
    f.mutations.length = 0;
    assert.equal(f.runtime.beginProductPlacement(product('facilitypowerdiesel'), f.manifest.id, 'Plant', () => 'plant', f.isGenerationCurrent), true);
    const height = (entities: readonly { entityId: string; components: readonly { componentId: string; data: Record<string, unknown>; }[] }[], id = 'plant') =>
        entities.find(e => e.entityId === id)?.components.find(c => c.componentId === 'spatial-transform')?.data.elevation;
    const preview = await f.runtime.previewProductPlacement({ x: 0, y: 0 });
    assert.equal(height([preview!]), 76.801);
    assert.equal(f.mutations.length, 0);
    assert.equal((await f.runtime.commitProductPlacement({ x: 0, y: 0 })).ok, true);
    assert.equal(height(f.runtime.entities), 76.801);
    assert.equal(f.mutations.length, 1);
    const offFloor = [{ entityId: 'plant', ownerId: 'nixie.core', componentId: 'transform', set: { x: 1000, y: 0 } }];
    assert.equal(height((await f.runtime.previewEntityComponentsFinalized(offFloor, 'plant'))!), 0);
    assert.equal(height(f.runtime.entities), 76.801);
    assert.equal((await f.runtime.moveEntities({ entityId: 'plant', positions: [{ entityId: 'plant', x: 1000, y: 0 }] })).ok, true);
    assert.equal(height(f.runtime.entities), 0);
    assert.equal((await f.runtime.updateEntityComponentsFinalized([{ entityId: 'plant', ownerId: 'nixie.core',
        componentId: 'spatial-transform', createIfMissing: true, set: { elevation: 200 } }])).ok, true);
    assert.equal(height(f.runtime.entities), 200);
});
