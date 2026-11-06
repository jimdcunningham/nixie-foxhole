import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { hostSourceUrl } from '../host-source-url.mjs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { projectNixieInspectorSubjectV1, validateNixieInspectorResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import { NixieYjsProjectSession } from '../../../../nixie/app/utils/nixie-yjs-session.ts';
import { NixieSceneV2ViewSession } from '../../../../nixie/app/utils/nixie-scene-v2-view-session.ts';
import { configureNixieSceneV2AuthoringIsolation, isNixieSceneV2AuthoringIsolated } from '../../../../nixie/app/utils/nixie-scene-v2-authoring-isolation.ts';
import { registerNixieSceneV2StateAdapter } from '../../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { NixieSceneV2TransformFinalizerAdapter } from '../../../../nixie/app/utils/nixie-scene-v2-transform-finalizer-adapter.ts';
import { NixieSceneV2EditorRuntimeController } from '../../../../nixie/app/utils/nixie-scene-v2-editor-runtime.ts';
import assets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import { inspectFoxholeSceneV2Structure } from '../../../../../extensions/foxhole-planner/src/scene-v2-inspector.ts';
import { finalizeFoxholeSceneV2Transform } from '../../../../../extensions/foxhole-planner/src/scene-v2-transform-finalizer.ts';
import { finalizeFoxholeSurfacePlacement } from '../../../../../extensions/foxhole-planner/src/surface-placement.ts';
import { resolveFoxholeEntityStructureSockets } from '../../../../../extensions/foxhole-planner/src/effective-structure-sockets.ts';

const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(hostSourceUrl('../../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
const catalog = [{ ownerId: manifest.id, contribution: manifest.contributes.experimentalComponents! }];
const ownerId = manifest.id;
const product = (id: string) => listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 }).items
    .find(item => item.product.id === `asset.${id}`)!.product;

function fixture(context: TestContext, snapping = true) {
    configureNixieSceneV2AuthoringIsolation(true, true);
    context.after(() => configureNixieSceneV2AuthoringIsolation(false, false));
    const trap = () => {
        throw new Error('Private topology adapter executed');
    };
    registerNixieSceneV2StateAdapter(ownerId, { project: trap, patch: trap, startPlacement: trap, deletionUpdates: trap, editableHandlePatch: trap });
    const project = new NixieYjsProjectSession({ projectId: context.name });
    project.createSceneV2View({ id: 'scene', content: { type: 'scene-v2', contractVersion: 1, entities: [] } });
    const view = new NixieSceneV2ViewSession();
    let changed = () => {};
    let writes = 0;
    view.open({ readContent: id => project.getSceneV2Content(id),
        openPersistence: id => {
            const port = project.createSceneV2EditorSession(id)!.asPersistencePort();
            return new Proxy(port, { get(target, key) {
                if (key === 'applyEntityMutations') {
                    return (...args: Parameters<typeof port.applyEntityMutations>) => {
                        writes++;
                        return target.applyEntityMutations(...args);
                    };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            } });
        }, subscribe: listener => {
            changed = listener;
            return () => {};
        },
    }, 'scene', catalog, true);
    context.after(() => {
        view.destroy();
        project.destroy();
    });
    const controller = view.controller;
    let finalizersEnabled = true;
    let pending: Promise<void> | undefined;
    let signalStarted: (() => void) | undefined;
    controller.attachCanvas({ capturePng: async () => ({ blob: new Blob(), width: 1, height: 1 }), captureFrame: () => null,
        center: () => {}, fitSelectionOrScene: () => {}, fitScene: () => {}, restoreFrame: () => true,
        resetZoom: () => {}, zoomIn: () => {}, zoomOut: () => {}, selectionBounds: () => [] });
    controller.attachTransformFinalizer(new NixieSceneV2TransformFinalizerAdapter({
        getCatalog: () => finalizersEnabled
            ? [{ ownerId, name: manifest.name, generationHash: 'topology-fixture',
                contribution: manifest.contributes.experimentalComponents!, transformFinalizers: manifest.contributes.experimentalTransformFinalizers! }]
            : [],
        getClient: () => ({ finalizeSceneV2Transform: async (_owner, _generation, system, request) => {
            if (pending) {
                signalStarted?.();
                await pending;
            }
            return system === 'transforms.surface-placement' ? finalizeFoxholeSurfacePlacement(request) : finalizeFoxholeSceneV2Transform(request);
        } }),
        isSettingEnabled: () => snapping,
    }));
    const entity = (id: string) => controller.entities.find(candidate => candidate.entityId === id)!;
    const data = (id: string, componentId: string) => entity(id).components.find(component => component.componentId === componentId)!.data;
    const create = (asset: string, id: string) => {
        const result = controller.instantiateProduct(product(asset), ownerId, id, () => id);
        assert.equal(result.ok, true, result.error);
        changed();
    };
    async function atomic(operation: () => { ok: boolean; error?: string; } | Promise<{ ok: boolean; error?: string; }>) {
        assert.equal(isNixieSceneV2AuthoringIsolated(), true);
        const before = controller.exportDocument();
        const count = writes;
        const result = await operation();
        assert.equal(result.ok, true, result.error);
        changed();
        const after = controller.exportDocument();
        assert.equal(writes, count + 1, 'one persisted transaction includes the complete topology change');
        assert.notDeepEqual(after, before);
        assert.equal(controller.undo(), true);
        changed();
        assert.deepEqual(controller.exportDocument(), before);
        assert.equal(controller.redo(), true);
        changed();
        assert.deepEqual(controller.exportDocument(), after);
        const reloaded = new NixieSceneV2EditorRuntimeController();
        assert.equal(reloaded.load(project.getSceneV2Content('scene'), catalog).ok, true);
        assert.deepEqual(reloaded.exportDocument(), after);
    }
    function inspect(id: string) {
        const provider = manifest.contributes.experimentalInspectorProviders!.find(candidate => candidate.componentIds.includes('asset'))!;
        const request = projectNixieInspectorSubjectV1(entity(id), ownerId, provider);
        const result = inspectFoxholeSceneV2Structure(request);
        validateNixieInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
        return result;
    }
    function pauseFinalizers() {
        let release!: () => void;
        const started = new Promise<void>(resolve => {
            signalStarted = resolve;
        });
        pending = new Promise<void>(resolve => {
            release = resolve;
        });
        return { started, release };
    }
    return { controller, entity, data, create, atomic, inspect, changed, pauseFinalizers,
        setSnapping: (enabled: boolean) => { snapping = enabled; },
        retireFinalizers: () => {
            finalizersEnabled = false;
        }, writes: () => writes };
}

test('isolated power-line creation, dependent movement and deletion commit reciprocal topology with real history', async context => {
    const f = fixture(context);
    f.create('powerbox', 'switch');
    const positioned = f.controller.updateEntityComponent('switch', { ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } });
    assert.equal(positioned.ok, true, positioned.error);
    f.changed();
    assert.equal(f.controller.beginProductPlacement(product('powerline'), ownerId, 'Power Line', () => 'line', () => true), true);
    await f.controller.commitProductPlacement({ x: 38.4, y: 0.0128 });
    await f.atomic(() => f.controller.commitProductPlacement({ x: 600, y: 0.0128 }));
    assert.equal(f.data('line', 'spline-connector').startAttachmentNodeId, 'switch');
    assert.deepEqual(f.data('switch', 'socket-attachments').attachments,
        [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }]);
    const beforeMove = structuredClone(f.data('line', 'spline-connector'));
    await f.atomic(() => f.controller.updateEntityComponentsFinalized([
        { entityId: 'switch', ownerId: 'nixie.core', componentId: 'transform', set: { x: 100, y: 20 } },
    ], { finalizeEntityIds: ['switch'] }));
    const moved = f.data('line', 'spline-connector');
    assert.equal(moved.startAttachmentNodeId, 'switch');
    assert.equal(moved.startX, Number(beforeMove.startX) + 100);
    assert.equal(moved.startY, Number(beforeMove.startY) + 20);
    assert.equal(moved.endX, beforeMove.endX);
    assert.equal(moved.endY, beforeMove.endY);
    await f.atomic(() => f.controller.deleteEntities(['line']));
    assert.deepEqual(f.data('switch', 'socket-attachments').attachments, []);
    assert.equal(f.controller.undo(), true);
    f.changed();
    const beforeDelete = structuredClone(moved);
    await f.atomic(() => f.controller.deleteEntities(['switch']));
    const detached = f.data('line', 'spline-connector');
    assert.equal(detached.startAttachmentNodeId, undefined);
    assert.equal(detached.startAttachmentSocketName, undefined);
    assert.equal(detached.startX, beforeDelete.startX);
    assert.equal(detached.startY, beforeDelete.startY);
});

test('isolated SDK tier actions preserve reciprocal connected-trench links through history and reload', async context => {
    const f = fixture(context);
    f.create('trencht1', 'a');
    f.create('trencht1', 'b');
    const sockets = resolveFoxholeEntityStructureSockets(f.entity('a'), assets.trencht1);
    const front = sockets.find(socket => /front/i.test(socket.name))!;
    const back = sockets.find(socket => /back/i.test(socket.name))!;
    assert.ok(front && back);
    const linksA = [{ localSocketName: front.name, targetEntityId: 'b', targetSocketName: back.name }];
    const linksB = [{ localSocketName: back.name, targetEntityId: 'a', targetSocketName: front.name }];
    const seeded = f.controller.updateEntityComponents([
        { entityId: 'a', ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } },
        { entityId: 'b', ownerId: 'nixie.core', componentId: 'transform', set: { x: front.x - back.x, y: front.y - back.y } },
        { entityId: 'a', ownerId, componentId: 'socket-attachments', set: { attachments: linksA }, createIfMissing: true },
        { entityId: 'b', ownerId, componentId: 'socket-attachments', set: { attachments: linksB }, createIfMissing: true },
    ]);
    assert.equal(seeded.ok, true, seeded.error);
    f.changed();
    const choices = f.inspect('a').components.find(component => component.componentId === 'modification')!.fields.find(field => field.path[0] === 'selections')!.choices!;
    const wire = choices.options.find(option => /barbed wire/i.test(option.label));
    assert.ok(wire, 'the real SDK must offer a compatible Barbed Wire placement');
    assert.equal(f.controller.updateEntityComponents([{ entityId: 'a', ownerId, componentId: 'modification', set: { selections: [wire.value] } }]).ok, true);
    f.changed();
    const updates = ['a', 'b'].flatMap(entityId => {
        const action = f.inspect(entityId).layout!.actions!.find(candidate => candidate.label.startsWith('Tier Up'))!;
        assert.ok(action?.patches);
        return action.patches.map(patch => ({ ...patch, ownerId, entityId }));
    });
    await f.atomic(() => f.controller.updateEntityComponentsFinalized(updates, { finalizeEntityIds: ['a', 'b'] }));
    assert.equal(f.data('a', 'asset').assetId, 'trencht2');
    assert.equal(f.data('b', 'asset').assetId, 'trencht2');
    assert.deepEqual(f.data('a', 'modification').selections, [wire.value]);
    assert.deepEqual(f.data('b', 'modification').selections, []);
    assert.deepEqual(f.data('a', 'socket-attachments').attachments, linksA);
    assert.deepEqual(f.data('b', 'socket-attachments').attachments, linksB);
});

test('isolated modification-only pipe ports snap, carry authored endpoints and clean up without native topology', async context => {
    const f = fixture(context);
    f.create('facilityrefinery1', 'factory');
    const choices = f.inspect('factory').components.find(component => component.componentId === 'modification')!.fields.find(field => field.path[0] === 'selections')!.choices!;
    const forge = choices.options.find(option => typeof option.value === 'object' && option.value !== null && option.value.variantId === 'forge');
    assert.ok(forge);
    await f.atomic(() => f.controller.updateEntityComponentsFinalized([
        { entityId: 'factory', ownerId, componentId: 'modification', set: { selections: [forge.value] } },
        { entityId: 'factory', ownerId: 'nixie.core', componentId: 'transform', set: { x: 1000, y: 0 } },
    ], { finalizeEntityIds: ['factory'] }));
    const port = resolveFoxholeEntityStructureSockets(f.entity('factory'), assets.facilityrefinery1).find(socket => socket.name === 'PipeInput0')!;
    assert.ok(port, 'the selected SDK modification supplies this port');
    f.create('facilitypipe', 'pipe');
    await f.atomic(() => f.controller.updateEntityComponentsFinalized([
        { entityId: 'pipe', ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } },
        { entityId: 'pipe', ownerId, componentId: 'spline-connector', set: {
            startX: 1000 + port.x + 5, startY: port.y, endX: 700, endY: port.y, startRotation: 0, endRotation: Math.PI,
        } },
    ], { finalizeEntityIds: ['pipe'] }));
    assert.equal(f.data('pipe', 'spline-connector').startAttachmentNodeId, 'factory');
    assert.equal(f.data('pipe', 'spline-connector').startAttachmentSocketName, port.name);
    const reciprocal = f.data('factory', 'socket-attachments').attachments;
    assert.deepEqual(reciprocal, [{ localSocketName: port.name, targetEntityId: 'pipe', targetSocketName: 'BackSocket' }]);
    const beforeMove = structuredClone(f.data('pipe', 'spline-connector'));
    await f.atomic(() => f.controller.updateEntityComponentsFinalized([
        { entityId: 'factory', ownerId: 'nixie.core', componentId: 'transform', set: { x: 1040, y: 20 } },
    ], { finalizeEntityIds: ['factory'] }));
    assert.ok(Math.abs(Number(f.data('pipe', 'spline-connector').startX) - Number(beforeMove.startX) - 40) < 1e-8);
    assert.ok(Math.abs(Number(f.data('pipe', 'spline-connector').startY) - Number(beforeMove.startY) - 20) < 1e-8);
    assert.equal(f.data('pipe', 'spline-connector').endX, beforeMove.endX);
    assert.equal(f.data('pipe', 'spline-connector').endY, beforeMove.endY);
    await f.atomic(() => f.controller.deleteEntities(['factory']));
    assert.equal(f.data('pipe', 'spline-connector').startAttachmentNodeId, undefined);
});

test('retiring SDK finalizers during a pending isolated move cannot publish partial content', async context => {
    const f = fixture(context);
    f.create('powerbox', 'switch');
    const before = f.controller.exportDocument();
    const count = f.writes();
    const pending = f.pauseFinalizers();
    const edit = f.controller.updateEntityComponentsFinalized([
        { entityId: 'switch', ownerId: 'nixie.core', componentId: 'transform', set: { x: 100, y: 20 } },
    ], { finalizeEntityIds: ['switch'] });
    await pending.started;
    assert.deepEqual(f.controller.exportDocument(), before);
    f.retireFinalizers();
    pending.release();
    assert.equal((await edit).ok, false);
    assert.equal(f.writes(), count);
    assert.deepEqual(f.controller.exportDocument(), before);
});

test('isolated SDK product exchange retains compatible sockets and detaches removed sockets atomically', async context => {
    for (const replacement of ['powerbox', 'trencht1']) {
        const f = fixture(context);
        f.create('powerbox', 'switch');
        assert.equal(f.controller.updateEntityComponent('switch', { ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } }).ok, true);
        f.changed();
        assert.equal(f.controller.beginProductPlacement(product('powerline'), ownerId, 'Power Line', () => 'line', () => true), true);
        await f.controller.commitProductPlacement({ x: 38.4, y: 0.0128 });
        await f.atomic(() => f.controller.commitProductPlacement({ x: 600, y: 0.0128 }));
        const endpoint = structuredClone(f.data('line', 'spline-connector'));
        assert.equal(endpoint.startAttachmentNodeId, 'switch');
        f.setSnapping(replacement === 'powerbox');
        await f.atomic(() => f.controller.exchangeProduct(product(replacement), ownerId, replacement,
            [{ entityId: 'switch', expectedRevision: f.entity('switch').revision }]));
        assert.equal(f.data('switch', 'asset').assetId, replacement);
        const after = f.data('line', 'spline-connector');
        if (replacement === 'powerbox') {
            assert.equal(after.startAttachmentNodeId, 'switch');
            assert.equal(after.startAttachmentSocketName, 'PowerSocket');
            assert.deepEqual(f.data('switch', 'socket-attachments').attachments,
                [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }]);
        } else {
            assert.equal(after.startAttachmentNodeId, undefined, 'the replacement has no compatible power socket');
            assert.equal(after.startAttachmentSocketName, undefined);
            assert.deepEqual(f.data('switch', 'socket-attachments').attachments, []);
            assert.equal(after.startX, endpoint.startX);
            assert.equal(after.startY, endpoint.startY);
        }
        assert.equal(after.endX, endpoint.endX);
        assert.equal(after.endY, endpoint.endY);
    }
});

test('isolated SDK connector exchange keeps authored geometry and reciprocal endpoint references', async context => {
    const f = fixture(context);
    f.create('powerbox', 'switch');
    assert.equal(f.controller.updateEntityComponent('switch', { ownerId: 'nixie.core', componentId: 'transform', set: { x: 0, y: 0 } }).ok, true);
    f.changed();
    assert.equal(f.controller.beginProductPlacement(product('powerline'), ownerId, 'Power Line', () => 'line', () => true), true);
    await f.controller.commitProductPlacement({ x: 38.4, y: 0.0128 });
    await f.atomic(() => f.controller.commitProductPlacement({ x: 600, y: 0.0128 }));
    const before = structuredClone(f.data('line', 'spline-connector'));
    await f.atomic(() => f.controller.exchangeProduct(product('powerline'), ownerId, 'Replacement Power Line',
        [{ entityId: 'line', expectedRevision: f.entity('line').revision }]));
    assert.deepEqual(f.data('line', 'spline-connector'), before);
    assert.equal(f.data('line', 'spline-connector').startAttachmentNodeId, 'switch');
    assert.deepEqual(f.data('switch', 'socket-attachments').attachments,
        [{ localSocketName: 'PowerSocket', targetEntityId: 'line', targetSocketName: 'BackSocket' }]);
});

test('isolated Planner catalog grids and core icons use SDK products with atomic history and no native factories', async context => {
    const f = fixture(context);
    const { replaceNixieSceneV2ExtensionCatalog } = await import('../../../../nixie/desktop-extensions/scene-v2-extension-catalog.ts');
    const { registerNixieInternalSceneV2Adapter } = await import('../../../../nixie/desktop-extensions/internal-scene-v2-adapters.ts');
    const { placeNixieSceneV2CatalogGrid } = await import('../../../../nixie/app/utils/nixie-scene-v2-catalog-grid.ts');
    const { createNixieSceneV2CatalogIconProduct } = await import('../../../../nixie/app/utils/nixie-scene-v2-catalog-icon.ts');
    const provider = manifest.contributes.experimentalProductProviders![0]!;
    const entry = { ownerId, name: manifest.name, generationHash: 'catalog-fixture', revision: 'catalog-fixture',
        contribution: manifest.contributes.experimentalComponents!, products: [], productProviders: [provider],
        renderers: [], resources: [], resourceTemplates: [], transformFinalizers: [] };
    replaceNixieSceneV2ExtensionCatalog([entry]);
    context.after(() => replaceNixieSceneV2ExtensionCatalog([]));
    const trap = () => { throw new Error('Private catalog authoring was called'); };
    const stopAdapter = registerNixieInternalSceneV2Adapter({ ownerId, productCapabilities: trap,
        catalog: { providerId: provider.id, legacySourceIds: ['legacy-planner'], lookup: trap, createSnapshot: trap } });
    context.after(stopAdapter);
    const assets = ['facilityfactoryammo', 'powerline', 'maintenancetunnel'].map(id => {
        const item = listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 }).items.find(candidate => candidate.product.id === `asset.${id}`)!;
        assert.ok(item);
        return { ownerId, generationHash: entry.generationHash, sourceId: `sdk.${ownerId}__${provider.id}`, item };
    });
    await f.atomic(async () => {
        const ids = await placeNixieSceneV2CatalogGrid({ target: { isV2: true, controller: f.controller, assertCurrent() {} },
            items: assets.map((asset, index) => ({ asset, position: { x: index * 500, y: 0 } })), activateSelection: async () => true });
        return { ok: Array.isArray(ids) && ids.length === 3 };
    });
    assert.deepEqual(f.controller.entities.flatMap(entity => entity.components.filter(component => component.ownerId === ownerId
        && component.componentId === 'asset').map(component => component.data.assetId)).sort(), ['facilityfactoryammo', 'maintenancetunnel', 'powerline']);
    const icon = createNixieSceneV2CatalogIconProduct(assets[0]!)!;
    assert.ok(icon);
    assert.equal(f.controller.beginProductPlacement(icon, 'nixie.core', 'Factory Icon', () => 'catalog-icon', () => true, { repeat: false }), true);
    await f.atomic(() => f.controller.commitProductPlacement({ x: 200, y: 300 }));
    assert.ok(f.entity('catalog-icon').components.every(component => component.ownerId === 'nixie.core'));
    assert.equal(f.data('catalog-icon', 'icon').catalogAssetId, 'asset.facilityfactoryammo');
    assert.equal(f.data('catalog-icon', 'icon').catalogSourceId, assets[0]!.sourceId);
});
