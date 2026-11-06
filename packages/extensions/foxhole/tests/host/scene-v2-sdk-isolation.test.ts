import { applyNixieSceneV2InspectorChoice } from '../../../../nixie/desktop-extensions/scene-v2-schema-editor.ts';
import { NixieYjsProjectSession } from '../../../../nixie/app/utils/nixie-yjs-session.ts';
import { NixieSceneV2ViewSession } from '../../../../nixie/app/utils/nixie-scene-v2-view-session.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hostSourceUrl } from '../host-source-url.mjs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { projectNixieExperimentalInspectorSubjectV1, validateNixieExperimentalInspectorResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import { NixieSceneV2EditorRuntimeController } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import { configureNixieSceneV2AuthoringIsolation } from '../../../../nixie/app/utils/nixie-scene-v2-authoring-isolation.ts';
import { registerNixieSceneV2StateAdapter } from '../../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { buildNixieSceneV2ExtensionInspection } from '../../../../nixie/app/utils/nixie-scene-v2-inspector.ts';
import { registerNixieSceneV2RenderPresentationAdapter, prepareNixieSceneV2RenderPresentation } from '../../../../nixie/app/plugins/nixie/scene-v2/render-presentation.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import { inspectFoxholeSceneV2Structure } from '../../../../../extensions/foxhole-planner/src/scene-v2-inspector.ts';
import { renderFoxholeSceneV2Entity } from '../../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';

const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(hostSourceUrl('../../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
const catalog = [{ ownerId: manifest.id, contribution: manifest.contributes.experimentalComponents! }];

test('real Planner structures expose SDK inspection, edit, render and reload with private authoring poisoned', context => {
    configureNixieSceneV2AuthoringIsolation(true, true);
    context.after(() => configureNixieSceneV2AuthoringIsolation(false, false));
    const trap = () => { throw new Error('Private Planner authoring was called'); };
    registerNixieSceneV2StateAdapter(manifest.id, { project: trap, patch: trap, selectionLocalBounds: trap, deletionUpdates: trap });
    registerNixieSceneV2RenderPresentationAdapter(manifest.id, trap);
    const controller = new NixieSceneV2EditorRuntimeController();
    const products = ['facilityfactoryammo', 'maintenancetunnel'].map(asset => {
        const page = listFoxholeSceneV2Products({ contractVersion: 1, query: asset, offset: 0, limit: 50 });
        const product = page.items.find(item => item.product.id === `asset.${asset}`)?.product;
        assert.ok(product, asset);
        return { entityId: asset, revision: 0, components: structuredClone(product.components) };
    });
    const loaded = controller.load({ type: 'scene-v2', contractVersion: 1, entities: products }, catalog);
    assert.equal(loaded.ok, true, loaded.error);
    let writes = 0;
    controller.attachPersistence({ isAttached: () => true, canUndo: false, canRedo: false,
        applyEntityMutations: () => { writes++; return true; }, undo: () => false, redo: () => false });
    controller.setEditable(true);
    const entity = controller.entities.find(candidate => candidate.entityId === 'facilityfactoryammo')!;
    const inspection = buildNixieSceneV2ExtensionInspection(controller, entity.entityId)!;
    assert.ok(inspection.components.some(component => component.instance.componentId === 'appearance'));
    const provider = manifest.contributes.experimentalInspectorProviders!.find(candidate => candidate.componentIds.includes('asset'))!;
    const request = projectNixieExperimentalInspectorSubjectV1(entity, manifest.id, provider);
    const result = inspectFoxholeSceneV2Structure(request);
    validateNixieExperimentalInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
    const choice = result.components.find(component => component.componentId === 'appearance')!.fields.find(field => field.path.length === 0)!.choices!.options.find(option => typeof option.value === 'object' && option.value !== null && option.value.blueprint === true)!;
    assert.ok(choice, 'the SDK must supply the Blueprint workflow');
    const edited = controller.updateEntityComponents([{ entityId: entity.entityId, ownerId: manifest.id, componentId: 'appearance', set: choice.value as Record<string, boolean> }]);
    assert.equal(edited.ok, true, edited.error);
    assert.equal(writes, 1);
    const current = controller.entities.find(candidate => candidate.entityId === entity.entityId)!;
    assert.equal(current.components.find(component => component.componentId === 'appearance')!.data.blueprint, true);
    const plan = renderFoxholeSceneV2Entity(current, { contractVersion: 1, entities: controller.entities });
    assert.ok(plan.root.children.length);
    assert.equal(prepareNixieSceneV2RenderPresentation(manifest.id, current, plan, 1), null);
    const exported = controller.exportDocument()!;
    const reloaded = new NixieSceneV2EditorRuntimeController();
    assert.equal(reloaded.load(exported, catalog).ok, true);
    assert.deepEqual(reloaded.exportDocument(), exported);
    controller.setEditable(false);
    assert.equal(controller.updateEntityComponents([{ entityId: entity.entityId, ownerId: manifest.id, componentId: 'appearance', set: { blueprint: false } }]).ok, false);
    assert.equal(writes, 1);
    assert.deepEqual(controller.exportDocument(), exported);
});
test('isolated Planner appearance, supply, cargo and production edits persist through real Yjs undo/redo', context => {
    configureNixieSceneV2AuthoringIsolation(true, true);
    context.after(() => configureNixieSceneV2AuthoringIsolation(false, false));
    const project = new NixieYjsProjectSession({ projectId: 'isolated-planner-history' });
    const entities = ['facilityfactoryammo', 'maintenancetunnel', 'largeshipresourceship'].map(asset => {
        const product = listFoxholeSceneV2Products({ contractVersion: 1, query: asset, offset: 0, limit: 50 }).items
            .find(item => item.product.id === `asset.${asset}`)!.product;
        return { entityId: asset, revision: 0, components: structuredClone(product.components) };
    });
    project.createSceneV2View({ id: 'scene', content: { type: 'scene-v2', contractVersion: 1, entities } });
    const view = new NixieSceneV2ViewSession();
    let changed = () => {};
    view.open({ readContent: id => project.getSceneV2Content(id),
        openPersistence: id => project.createSceneV2EditorSession(id)?.asPersistencePort() ?? null,
        subscribe: listener => { changed = listener; return () => {}; },
    }, 'scene', catalog, true);
    context.after(() => { view.destroy(); project.destroy(); });
    const controller = view.controller;
    const provider = manifest.contributes.experimentalInspectorProviders!.find(candidate => candidate.componentIds.includes('asset'))!;
    const inspect = (id: string) => {
        const entity = controller.entities.find(candidate => candidate.entityId === id)!;
        const request = projectNixieExperimentalInspectorSubjectV1(entity, manifest.id, provider);
        const result = inspectFoxholeSceneV2Structure(request);
        validateNixieExperimentalInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
        return result;
    };
    function edit(id: string, componentId: string, set: Record<string, unknown>, createIfMissing = false) {
        const before = controller.exportDocument();
        const result = controller.updateEntityComponents([{ entityId: id, ownerId: manifest.id, componentId, set, createIfMissing }]);
        assert.equal(result.ok, true, result.error);
        changed();
        const after = controller.exportDocument();
        assert.notDeepEqual(after, before);
        assert.equal(controller.undo(), true);
        changed();
        assert.deepEqual(controller.exportDocument(), before, `${componentId}: one undo restores the entire graph`);
        assert.equal(controller.redo(), true);
        changed();
        assert.deepEqual(controller.exportDocument(), after, `${componentId}: redo restores the authored graph`);
        const persisted = new NixieSceneV2EditorRuntimeController();
        assert.equal(persisted.load(project.getSceneV2Content('scene'), catalog).ok, true);
        assert.deepEqual(persisted.exportDocument(), after);
    }
    const appearance = inspect('facilityfactoryammo').components.find(component => component.componentId === 'appearance')!;
    const blueprint = appearance.fields.find(field => field.path.length === 0)!.choices!.options
        .find(option => option.value && typeof option.value === 'object' && option.value.blueprint === true)!;
    edit('facilityfactoryammo', 'appearance', blueprint.value as Record<string, unknown>);
    const supply = inspect('maintenancetunnel').components.find(component => component.componentId === 'maintenance-supply')!;
    edit('maintenancetunnel', 'maintenance-supply', { ...supply.initialData, range: 82 }, true);
    const cargo = inspect('largeshipresourceship').components.find(component => component.componentId === 'cargo')!;
    const stored = cargo.fields.find(field => field.path[0] === 'stockpileItems')!.choices!.options[0]!.value;
    edit('largeshipresourceship', 'cargo', { stockpileItems: [stored] });
    const orders = inspect('facilityfactoryammo').components.find(component => component.componentId === 'production-order')!;
    const recipe = orders.fields.find(field => field.path[0] === 'orders')!.choices!.options.find(option => !option.actionId)!;
    assert.ok(recipe);
    const schema = manifest.contributes.experimentalComponents!.components.find(component => component.id === 'production-order')!.schema.properties.orders!;
    assert.equal(schema.type, 'array');
    if (schema.type !== 'array') throw new Error('Expected order array');
    const choices = orders.fields.find(field => field.path[0] === 'orders')!.choices!;
    const row = applyNixieSceneV2InspectorChoice(schema.items, choices, choices.options.indexOf(recipe));
    edit('facilityfactoryammo', 'production-order', { orders: [{ ...(row as object), cycles: 3 }] });
    const reloaded = new NixieSceneV2EditorRuntimeController();
    assert.equal(reloaded.load(project.getSceneV2Content('scene'), catalog).ok, true);
    assert.deepEqual(reloaded.exportDocument(), controller.exportDocument());
});