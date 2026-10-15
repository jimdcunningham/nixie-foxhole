import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { parseNixieExtensionManifestV1 } from '@nixie/extension-sdk';
import type { BoardNodeSnapshot } from '../../../../nixie/app/plugins/nixie/board/types/node.ts';
import { NixieYjsProjectSession } from '../../../../nixie/app/utils/nixie-yjs-session.ts';
import { NixieSceneV2EditorRuntimeController } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { createNixieSceneV2Snapshots } from '../../../../nixie/app/utils/nixie-scene-v2-create-snapshots.ts';
import { registerNixieSceneV1NodeConverter } from '../../../../nixie/app/utils/nixie-scene-v2-converter-registry.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../../app/plugins/foxhole/nixie/scene-v2-conversion.ts';

const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
const catalog = [{ ownerId: manifest.id, contribution: manifest.contributes.experimentalComponents! }];
registerNixieSceneV1NodeConverter(manifest.id, convertFoxholeSceneV1NodeToV2);
const capabilities = () => ({ move: true, rotate: true, geometryReshape: true });

function facility(): BoardNodeSnapshot[] {
    const node = (id: string, key: string, state: Record<string, unknown> = {}, type = 'foxholeAsset'): BoardNodeSnapshot => ({
        id, type, key: id, state: { foxholeKey: key, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, visible: true, ...state }, children: [],
    });
    return [node('floor', 'foundation012x2t1'),
        node('factory-a', 'facilityfactoryammo', { socketAttachments: { Pipe: { nodeId: 'factory-b', socketName: 'Pipe' } },
            productionOrders: [{ recipeId: 'structure:facilityfactoryammo:recipe:0', parent: true, cycles: null }] }),
        node('factory-b', 'facilityfactoryammo', { x: 300, socketAttachments: { Pipe: { nodeId: 'factory-a', socketName: 'Pipe' } } }),
        node('power', 'powerline', { points: [0, 0, 300, 0], startAttachment: { nodeId: 'factory-a', socketName: 'Power' } }, 'foxholeConnector'),
        node('pipe', 'facilitypipe', { start: { x: 0, y: 0, rotation: 0 }, end: { x: 300, y: 0, rotation: 0 },
            startAttachment: { nodeId: 'factory-a', socketName: 'Pipe' }, endAttachment: { nodeId: 'factory-b', socketName: 'Pipe' } }, 'foxholeSplineConnector'),
        node('rail', 'smallrailtracksplinefoundation', { start: { x: 0, y: 0, rotation: 0 }, end: { x: 320, y: 0, rotation: 0 } }, 'foxholeSplineConnector')];
}

function client(project: NixieYjsProjectSession, id: string) {
    const editor = project.createSceneV2EditorSession(id)!;
    const runtime = new NixieSceneV2EditorRuntimeController();
    const refresh = () => runtime.load(project.getSceneV2Content(id), catalog);
    refresh();
    runtime.setEditable(true);
    runtime.attachPersistence(editor.asPersistencePort());
    return { runtime, editor, refresh };
}
function component(entity: NixieSceneV2EditorRuntimeController['entities'][number], id: string) {
    return entity.components.find(value => value.componentId === id)!.data;
}

test('connected facility insertion is atomic and editable through undo, redo and snapshot reload', () => {
    const project = new NixieYjsProjectSession({ projectId: 'facility-lifecycle' });
    const scene = project.createSceneV2View({ id: 'scene', content: { type: 'scene-v2', contractVersion: 1, entities: [] } });
    const c = client(project, scene.id);
    const source = facility(), original = structuredClone(source);
    const inserted = createNixieSceneV2Snapshots(c.runtime, source, capabilities);
    assert.equal(inserted.ok, true, inserted.error);
    assert.equal(inserted.value!.length, 6);
    const placed = project.getSceneV2Content(scene.id)!;
    assert.equal(placed.entities.length, 7, 'first layer belongs to the same insertion');
    const factoryA = c.runtime.entities.find(entity => component(entity, 'identity').name === 'factory-a')!;
    const factoryB = c.runtime.entities.find(entity => component(entity, 'identity').name === 'factory-b')!;
    assert.deepEqual(component(factoryA, 'socket-attachments').attachments, [{ localSocketName: 'Pipe', targetEntityId: factoryB.entityId, targetSocketName: 'Pipe' }]);
    assert.deepEqual(component(factoryB, 'socket-attachments').attachments, [{ localSocketName: 'Pipe', targetEntityId: factoryA.entityId, targetSocketName: 'Pipe' }]);
    assert.equal(c.editor.undo(), true);
    assert.equal(project.getSceneV2Content(scene.id)!.entities.length, 0);
    assert.equal(c.editor.canUndo.value, false);
    assert.equal(c.editor.redo(), true);
    assert.deepEqual(project.getSceneV2Content(scene.id), placed);
    c.refresh();
    assert.equal(c.runtime.updateEntityComponents([{ entityId: factoryA.entityId, ownerId: 'nixie.core', componentId: 'transform', set: { x: 32 } }]).ok, true);
    const moved = project.getSceneV2Content(scene.id)!;
    assert.equal(c.editor.undo(), true);
    assert.deepEqual(project.getSceneV2Content(scene.id), placed);
    assert.equal(c.editor.redo(), true);
    assert.deepEqual(project.getSceneV2Content(scene.id), moved);
    const restored = new NixieYjsProjectSession({ projectId: 'facility-reload', ...project.document.exportSnapshot() });
    assert.deepEqual(restored.getSceneV2Content(scene.id), moved);
    assert.deepEqual(source, original);
    restored.destroy();
    c.editor.destroy();
    project.destroy();
});

for (const sameEntity of [false, true]) {
    test(`two facility peers retain topology and owned history (same entity=${sameEntity})`, () => {
        const first = new NixieYjsProjectSession({ projectId: 'facility-peers' });
        const scene = first.createSceneV2View({ id: 'scene', content: { type: 'scene-v2', contractVersion: 1, entities: [] } });
        const a = client(first, scene.id);
        assert.equal(createNixieSceneV2Snapshots(a.runtime, facility(), capabilities).ok, true);
        a.editor.destroy();
        const peerDoc = new Y.Doc();
        Y.applyUpdate(peerDoc, first.document.encodeStateAsUpdate());
        const second = new NixieYjsProjectSession({ projectId: first.projectId, doc: peerDoc });
        const local = client(first, scene.id), remote = client(second, scene.id);
        const factoryA = local.runtime.entities.find(entity => component(entity, 'identity').name === 'factory-a')!;
        const factoryB = local.runtime.entities.find(entity => component(entity, 'identity').name === 'factory-b')!;
        assert.equal(local.runtime.updateEntityComponents([{ entityId: factoryA.entityId, ownerId: 'nixie.core', componentId: 'transform', set: { x: 64 } }]).ok, true);
        const productionEntityId = sameEntity ? factoryA.entityId : factoryB.entityId;
        assert.equal(remote.runtime.updateEntityComponents([{ entityId: productionEntityId, ownerId: manifest.id, componentId: 'production-order',
            set: { orders: [{ id: 'remote-order', recipeId: 'structure:facilityfactoryammo:recipe:0', cycles: 4 }] } }]).ok, true);
        const sync = () => {
            const fromFirst = first.document.encodeStateAsUpdate(second.document.encodeStateVector());
            const fromSecond = second.document.encodeStateAsUpdate(first.document.encodeStateVector());
            first.document.applyEncodedUpdate(fromSecond, 'remote-peer');
            second.document.applyEncodedUpdate(fromFirst, 'remote-peer');
            assert.deepEqual(first.getSceneV2Content(scene.id), second.getSceneV2Content(scene.id));
            local.refresh();
            remote.refresh();
        };
        sync();
        const merged = first.getSceneV2Content(scene.id)!;
        const expectedLinks = merged.entities.map(entity => entity.components.filter(value => value.componentId === 'socket-attachments'));
        assert.equal(local.editor.undo(), true);
        sync();
        assert.equal(component(local.runtime.entities.find(entity => entity.entityId === factoryA.entityId)!, 'transform').x, 0);
        assert.equal((component(local.runtime.entities.find(entity => entity.entityId === productionEntityId)!, 'production-order').orders as { cycles: number; }[])[0]!.cycles, 4);
        assert.equal(local.editor.canUndo.value, false, 'remote work is never an owned Undo step');
        assert.equal(local.editor.redo(), true);
        sync();
        assert.deepEqual(first.getSceneV2Content(scene.id), merged);
        assert.deepEqual(first.getSceneV2Content(scene.id)!.entities.map(entity => entity.components.filter(value => value.componentId === 'socket-attachments')), expectedLinks);
        const restored = new NixieYjsProjectSession({ projectId: 'facility-peer-reload', ...second.document.exportSnapshot() });
        assert.deepEqual(restored.getSceneV2Content(scene.id), merged);
        remote.runtime.setEditable(false);
        assert.equal(remote.runtime.updateEntityComponents([{ entityId: factoryA.entityId, ownerId: 'nixie.core', componentId: 'transform', set: { x: 999 } }]).ok, false);
        assert.deepEqual(second.getSceneV2Content(scene.id), merged);
        restored.destroy();
        local.editor.destroy();
        remote.editor.destroy();
        first.destroy();
        second.destroy();
    });
}
