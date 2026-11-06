import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { resolveNixieSceneV2Transforms } from '../../../nixie/desktop-extensions/scene-v2-transforms.ts';
import { NixieSceneV2EditorRuntimeController } from '../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { previewNixieSceneV2EditableHandleUpdates } from '../../../nixie/app/utils/nixie-scene-v2-editable-handles.ts';
import { NixieSceneV2TransformFinalizerAdapter } from '../../../nixie/app/utils/nixie-scene-v2-transform-finalizer-adapter.ts';
import { NixieYjsProjectSession } from '../../../nixie/app/utils/nixie-yjs-session.ts';
import { finalizeFoxholeSceneV2Transform } from '../../../../extensions/foxhole-planner/src/scene-v2-transform-finalizer.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { foxholeSceneV2StateAdapter } from '../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts';

const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));

test('detached legacy pipe commits both socket links in one undoable transaction', async () => {
    const converted = convertNixieSceneV1ToV2([
        { id: 'source', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 0, y: 160 }, children: [] },
        { id: 'sink', type: 'foxholeAsset', state: { foxholeKey: 'facilitypowerdiesel', x: 209.8336, y: -160, rotation: Math.PI }, children: [] },
        { id: 'pipe', type: 'foxholeSplineConnector', state: { foxholeKey: 'facilitypipe',
            start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
            startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 96, maxLength: 640 }, children: [] },
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] }).content;
    const initial = { ...converted, entities: converted.entities.slice(0, 2) };
    const project = new NixieYjsProjectSession({ projectId: 'local-detached-legacy-pipe' });
    const view = project.createSceneV2View({ id: 'scene', content: initial });
    const editor = project.createSceneV2EditorSession(view.id)!;
    const runtime = new NixieSceneV2EditorRuntimeController();
    runtime.setEditable(true);
    assert.equal(runtime.load(initial, [{ ownerId: manifest.id, name: manifest.name,
        contribution: manifest.contributes.components }]).ok, true);
    const port = editor.asPersistencePort();
    let writes = 0;
    runtime.attachPersistence({ ...port, applyEntityMutations: (mutations, options) => {
        writes += 1;
        return port.applyEntityMutations(mutations, options);
    } });
    runtime.attachTransformFinalizer(new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => [{ ownerId: manifest.id, name: manifest.name, generationHash: 'test',
            contribution: manifest.contributes.components,
            transformFinalizers: manifest.contributes.transformFinalizers }],
        isSettingEnabled: () => true,
        getClient: () => ({ finalizeSceneV2Transform: async (_owner, _generation, _system, request) =>
            finalizeFoxholeSceneV2Transform(request) }),
    }));
    const [pipe] = runtime.resolvePreparedSceneEntities({ ...converted, entities: [converted.entities[2]!] });
    assert.ok(pipe);
    const canonical = runtime.entities;
    const matrices = new Map([...resolveNixieSceneV2Transforms([...canonical, pipe])]
        .map(([id, resolved]) => [id, resolved.world]));
    const context = (worldPoint: { x: number; y: number; }) => ({ entities: canonical, worldPoint,
        worldTransforms: matrices, hoveredEntityIds: [], isSettingEnabled: () => true });
    const session = foxholeSceneV2StateAdapter.startPlacement!(pipe)!;
    const before = project.getSceneV2Content(view.id);
    const start = { x: 114.5, y: 104 };
    const end = { x: 112.5, y: -95 };
    assert.equal(session.confirm(start, context(start)).complete, false);
    assert.deepEqual(project.getSceneV2Content(view.id), before);
    assert.equal(writes, 0);
    const second = session.confirm(end, context(end));
    assert.equal(second.complete, true);
    const preview = previewNixieSceneV2EditableHandleUpdates(pipe, second.updates);
    const spline = preview.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.equal(spline.startAttachmentNodeId, canonical[0]!.entityId);
    assert.equal(spline.endAttachmentNodeId, canonical[1]!.entityId);
    assert.deepEqual(project.getSceneV2Content(view.id), before);
    const staged = await runtime.resolvePreparedScenePlacement({ ...converted, entities: [{
        entityId: preview.entityId, revision: preview.revision,
        components: preview.components.map(({ definitionAvailable, ...component }) => component),
    }] }, [pipe.entityId], () => 'detached-pipe-layer', {}, undefined, 'flat');
    assert.ok(staged);
    assert.equal(writes, 0);
    assert.equal(staged.commit().ok, true);
    assert.equal(writes, 1);
    const after = project.getSceneV2Content(view.id)!;
    const placed = after.entities.find(entity => entity.entityId === pipe.entityId)!;
    const placedSpline = placed.components.find(component => component.componentId === 'spline-connector')!.data;
    assert.equal(placedSpline.startAttachmentNodeId, canonical[0]!.entityId);
    assert.equal(placedSpline.endAttachmentNodeId, canonical[1]!.entityId);
    for (const target of canonical) {
        const entity = after.entities.find(candidate => candidate.entityId === target.entityId)!;
        const links = entity.components.find(component => component.componentId === 'socket-attachments')?.data.attachments;
        assert.ok(Array.isArray(links) && links.some(link => link && typeof link === 'object'
            && !Array.isArray(link) && link.targetEntityId === pipe.entityId), 'target has reciprocal pipe attachment');
    }
    assert.equal(editor.undo(), true);
    assert.deepEqual(project.getSceneV2Content(view.id), before);
    assert.equal(editor.redo(), true);
    assert.deepEqual(project.getSceneV2Content(view.id), after);
    const reloaded = new NixieYjsProjectSession({ projectId: project.projectId });
    reloaded.document.applyEncodedUpdate(project.document.encodeStateAsUpdate(), 'reload');
    assert.deepEqual(reloaded.getSceneV2Content(view.id), after);
    reloaded.destroy();
    editor.destroy();
    project.destroy();
});
