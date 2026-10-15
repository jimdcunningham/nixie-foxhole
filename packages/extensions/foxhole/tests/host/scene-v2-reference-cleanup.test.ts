import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseNixieExtensionManifestV1 } from '@nixie/extension-sdk';
import { NixieSceneV2EditorRuntimeController } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { collectNixieSceneV2ReferenceCleanup } from '../../../../nixie/desktop-extensions/scene-v2-reference-cleanup.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';

function fixture(name: 'foxhole-planner' | 'scene-v2-diagram') {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(hostSourceUrl(`../../../../../extensions/${name}/nixie.extension.json`, import.meta.url), 'utf8')));
    const controller = new NixieSceneV2EditorRuntimeController();
    const batches: unknown[] = [];
    let accept = true;
    controller.setEditable(true);
    controller.load({ type: 'scene-v2', contractVersion: 1, entities: [] }, [{ ownerId: manifest.id, contribution: manifest.contributes.experimentalComponents! }]);
    controller.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false, undo: () => false, redo: () => false,
        applyEntityMutations: entries => {
            if (!accept) {
                return false;
            }
            batches.push(entries);
            return true;
        } });
    return { controller, manifest, batches, reject: () => {
        accept = false;
    } };
}

function powerFixture() {
    const f = fixture('foxhole-planner');
    for (const [assetId, entityId] of [['powerbox', 'switch'], ['powerline', 'line']] as const) {
        const product = listFoxholeSceneV2Products({ contractVersion: 1, query: assetId, offset: 0, limit: 100 })
            .items.find(item => item.product.id === `asset.${assetId}`)!.product;
        assert.equal(f.controller.instantiateProduct(product, f.manifest.id, entityId, () => entityId).ok, true);
    }
    assert.equal(f.controller.updateEntityComponent('switch', { ownerId: f.manifest.id, componentId: 'socket-attachments',
        set: { attachments: [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }] } }).ok, true);
    assert.equal(f.controller.updateEntityComponent('line', { ownerId: f.manifest.id, componentId: 'spline-connector',
        set: { startAttachmentNodeId: 'switch', startAttachmentSocketName: 'PowerSocket' } }).ok, true);
    f.batches.length = 0;
    return f;
}

test('SDK-only connector deletion clears reciprocal occupancy in the same two-entity batch', () => {
    const f = powerFixture();
    assert.equal(f.controller.deleteEntities(['line']).ok, true);
    assert.equal(f.batches.length, 1);
    assert.deepEqual((f.batches[0] as Array<{ entityId: string; }>).map(entry => entry.entityId).sort(), ['line', 'switch']);
    assert.deepEqual(f.controller.entities[0]!.components.find(component => component.componentId === 'socket-attachments')!.data.attachments, []);
});

test('SDK-only target deletion unsets paired endpoint references while preserving geometry and appearance', () => {
    const f = powerFixture();
    const before = structuredClone(f.controller.entities.find(entity => entity.entityId === 'line')!.components
        .find(component => component.componentId === 'spline-connector')!.data);
    assert.equal(f.controller.deleteEntities(['switch']).ok, true);
    const after = f.controller.entities[0]!.components.find(component => component.componentId === 'spline-connector')!.data;
    delete before.startAttachmentNodeId;
    delete before.startAttachmentSocketName;
    assert.deepEqual(after, before);
    assert.equal(f.batches.length, 1);
});

test('optional point connector attachment records are removed without changing their points', () => {
    const f = powerFixture();
    const data = { foxholeKey: 'facilitypipe', points: [0, 0, 160, 20],
        startAttachment: { nodeId: 'switch', socketName: 'PowerSocket' }, endAttachment: { nodeId: 'unresolved', socketName: 'Keep' } };
    assert.equal(f.controller.instantiateProduct({ contractVersion: 1, id: 'point-connector',
        components: [{ ownerId: f.manifest.id, componentId: 'connector', version: 1, data }] }, f.manifest.id, 'Point Connector', () => 'points').ok, true);
    assert.equal(f.controller.deleteEntities(['switch']).ok, true);
    const after = f.controller.entities.find(entity => entity.entityId === 'points')!.components.find(component => component.componentId === 'connector')!.data;
    assert.deepEqual(after, { foxholeKey: 'facilitypipe', points: data.points, endAttachment: data.endAttachment });
});

test('neutral dependency cleanup removes only matching records and preserves unresolved references and notes', () => {
    const f = fixture('scene-v2-diagram');
    const product = f.manifest.contributes.experimentalProducts!.find(entry => entry.id === 'process-node')!;
    for (const id of ['source', 'dependent']) {
        assert.equal(f.controller.instantiateProduct(product, f.manifest.id, id, () => id).ok, true);
    }
    assert.equal(f.controller.updateEntityComponent('dependent', { ownerId: f.manifest.id, componentId: 'node',
        set: { dependencies: [{ nodeId: 'source', note: 'Prerequisite' }, { nodeId: 'unresolved', note: 'Keep this' }] } }).ok, true);
    f.batches.length = 0;
    assert.equal(f.controller.deleteEntities(['source']).ok, true);
    assert.deepEqual(f.controller.entities[0]!.components.find(component => component.componentId === 'node')!.data.dependencies,
        [{ nodeId: 'unresolved', note: 'Keep this' }]);
    assert.equal(f.batches.length, 1);
});

test('rejected or locked deletion leaves the complete socket graph unchanged', () => {
    for (const mode of ['rejected', 'locked'] as const) {
        const f = powerFixture();
        if (mode === 'locked') {
            f.controller.selection.set(['switch']);
            assert.equal(f.controller.toggleSelectionLock().ok, true);
        } else {
            f.reject();
        }
        const before = structuredClone(f.controller.entities);
        assert.equal(f.controller.deleteEntities(['switch']).ok, false);
        assert.deepEqual(f.controller.entities, before);
    }
});

test('unavailable or mismatched component definitions retain opaque references without invoking cleanup', () => {
    const f = powerFixture();
    const entities = structuredClone(f.controller.entities);
    const before = structuredClone(entities);
    for (const entity of entities) {
        for (const component of entity.components) {
            component.definitionAvailable = false;
        }
    }
    assert.equal(collectNixieSceneV2ReferenceCleanup(entities, f.controller.definitions, new Set(['switch'])).patches.length, 0);
    assert.deepEqual(entities.map(entity => entity.components.map(component => component.data)), before.map(entity => entity.components.map(component => component.data)));
    assert.equal(collectNixieSceneV2ReferenceCleanup(before, new Map(), new Set(['switch'])).patches.length, 0);
    const mismatched = new Map([...f.controller.definitions].map(([key, definition]) => [key, { ...definition, version: definition.version + 1 }]));
    assert.equal(collectNixieSceneV2ReferenceCleanup(before, mismatched, new Set(['switch'])).patches.length, 0);
});
