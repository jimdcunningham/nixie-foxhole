import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { DEFAULT_NIXIE_HITBOX_STATE } from '../../../../nixie/app/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { DEFAULT_NIXIE_SPLINE_PATH_STATE } from '../../../../nixie/app/plugins/nixie/contributions/assets/shared/spline-path.ts';
import { DEFAULT_NIXIE_ICON_STATE } from '../../../../nixie/app/plugins/nixie/contributions/assets/shared/icon.ts';
import type { BoardNodeSnapshot } from '../../../../nixie/app/plugins/nixie/board/types/node.ts';
import type { BoardNodeRegistration } from '../../../../nixie/app/plugins/nixie/board/types/registration.ts';
import type { NixieCommandContext } from '../../../../nixie/app/plugins/nixie/registry/types.ts';
import type { NixiePaletteSelectionRecord } from '../../../../nixie/app/stores/palette-selection-records.ts';
import type { NixieProjectAssetSummary } from '../../../../nixie/app/utils/nixie-project-assets.ts';
import { serializeClipboardPayload } from '../../../../nixie/app/plugins/nixie/clipboard.ts';
import { inspectPaletteSelection } from '../../../../nixie/app/plugins/nixie/palette-selection-compatibility.ts';
import { createLayerSnapshot } from '../../../../nixie/app/plugins/nixie/board/utils/layer-snapshot.ts';
import { getFoxholeSnapshotDependencies } from '../../app/plugins/foxhole/nixie/snapshot-dependencies.ts';
import { getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { remapFoxholeStructureSnapshotCloneReferences } from '../../app/plugins/foxhole/nixie/snapshot-clone-references.ts';

// Legacy board primitives use extensionless Nuxt aliases. Resolve those for this
// real-project harness only; leave the suite's global loader unchanged.
const hooks = registerHooks({ load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && url.includes('/packages/nixie/')) {
        return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText };
    }
    return next(url, context);
}, resolve(specifier, context, next) {
    {
        const stubs: Record<string, string> = {
            './palette-selection-content.ts': `import {parseClipboardPayload} from '${new URL('../../../../nixie/app/plugins/nixie/clipboard.ts', import.meta.url).href}'; export async function preparePaletteSelection(binding) { return { roots: parseClipboardPayload(binding.payload).items.map(item => item.snapshot), images: [], requiredExtensionIds: [], provenance: {} }; }`,
            './palette-content.ts': `export async function materializePaletteContent(content) { return {roots: content.roots, assets: []}; }`,
            './discovery-extensions.ts': `export async function confirmDiscoveryExtensions() {return true;}`,
            './discovery-insert.ts': `export function captureDiscoveryInsertTarget(context) {return {destination: {isV2: false}, assertCurrent() { if (!context.capabilities.canEdit) throw Error('You cannot edit this destination project.'); }};}`,
        };
        const normalized = './' + specifier.split('/').pop();
        stubs['./discovery-placement.ts'] = 'export async function placeDiscoveryPaletteBinding() {throw Error("Not part of selection placement");}';
        stubs['./palette-discovery.ts'] = 'export async function prepareDiscoveryPaletteBinding() { throw Error("Not part of selection placement"); }';
        stubs['./palette-image.ts'] = 'export async function placePaletteImage() { throw Error("Not part of selection placement"); }';
        if (stubs[normalized]) return { url: 'data:text/javascript,' + encodeURIComponent(stubs[normalized]), shortCircuit: true };
    }
    if (specifier === 'pixi-viewport') {
        return { url: 'data:text/javascript,export class Viewport {} export class Plugin {}', shortCircuit: true };
    }
    try {
        return next(specifier, context);
    } catch (error) {
        if ((specifier.startsWith('#nixie/') || specifier.startsWith('.')) && !/\.[a-z]+$/i.test(specifier)) {
            try {
                return next(`${specifier}.ts`, context);
            } catch {
                return next(`${specifier}/index.ts`, context);
            }
        }
        throw error;
    }
} });
const { placePaletteSelection } = await import('../../../../nixie/app/plugins/nixie/palette-selection.ts');
await import('../../../../nixie/app/plugins/nixie/yjs-project.ts');
const { NixieProject } = await import('../../../../nixie/app/plugins/nixie/project.ts');
const { createBoardNodeRegistry } = await import('../../../../nixie/app/plugins/nixie/board/types/registry.ts');
const { BoardContainerNode } = await import('../../../../nixie/app/plugins/nixie/board/types/primitives/container.ts');
hooks.deregister();

const registry = { getAllTextureResolvers: () => [] };
const transform = { x: 10, y: 20, rotation: 0, visible: true, alpha: 1, scaleX: 1, scaleY: 1 };
function node(id: string, type = 'container', state: Record<string, unknown> = {}): BoardNodeSnapshot {
    return { id, type, state: { ...transform, ...state }, children: [] };
}
function record(snapshots: BoardNodeSnapshot[], projectId = 'A'): NixiePaletteSelectionRecord {
    return { projectId, label: 'Saved Selection', nodeTypes: ['irrelevant.cached.type'], image: 'data:image/png;base64,AA==',
        payload: serializeClipboardPayload({ version: 2, items: snapshots.map(snapshot => ({ snapshot, parentId: 'source-layer' })) }),
    };
}
function destination(registrations: BoardNodeRegistration[] = []) {
    setActivePinia(createPinia());
    // Project construction normally receives this narrow registry auto-import from Nuxt.
    const originalRegistry = Object.getOwnPropertyDescriptor(globalThis, 'useNixieRegistry');
    Object.defineProperty(globalThis, 'useNixieRegistry', { configurable: true, value: () => ({
        getDefaultProjectSettings: () => ({ name: 'Untitled Project' }), getSettingDefinitions: () => [],
    }) });
    let project: InstanceType<typeof NixieProject>;
    try {
        project = new NixieProject({ id: 'B', session: { role: 'owner' }, boardRegistry: createBoardNodeRegistry(registrations),
            enableLocalDraftPersistence: false, enableLocalDraftAutosave: false, localOnly: true,
        });
    } finally {
        if (originalRegistry) {
            Object.defineProperty(globalThis, 'useNixieRegistry', originalRegistry);
        } else {
            Reflect.deleteProperty(globalThis, 'useNixieRegistry');
        }
    }
    let sceneId = 'scene-B';
    Object.assign(project, { getActiveSceneId: () => sceneId });
    const selected: string[][] = [];
    let placements = 0;
    const context = { project, capabilities: { canEdit: true }, finalizeSelectionPlacement: async () => {},
        activateTool: async () => true, setSelectedNodeIds: (ids: string[]) => selected.push(ids),
        beginSelectionPlacement: async () => {
            placements += 1;
        },
    } as unknown as NixieCommandContext;
    return { context, project, selected, get placements() {
        return placements;
    }, navigate: () => {
        sceneId = 'another-scene';
    } };
}
function custom(type: string, extra: Partial<BoardNodeRegistration> = {}): BoardNodeRegistration {
    return { type, create: snapshot => new BoardContainerNode({ ...snapshot }), ...extra };
}

test('A to B places self-contained snapshots with fresh IDs, destination parents and atomic undo/redo', async () => {
    const { context, project, selected } = destination();
    const snapshots = [node('source-1', 'container', { projectId: 'irrelevant-source-id' }), node('source-2')];
    snapshots[0]!.children.push(node('source-child'));
    const saved = record(snapshots);
    const original = JSON.stringify(saved);
    assert.equal(inspectPaletteSelection(context, saved, 'B', registry).status, 'available');
    assert.equal(await placePaletteSelection(context, saved, 'B', { x: 100, y: 200 }, { registry }), true);
    const ids = selected[0]!;
    assert.equal(ids.length, 2);
    assert.ok(ids.every(id => !['source-1', 'source-2'].includes(id)));
    const layer = project.scene.getRoots()[0]!;
    assert.equal(layer.boardType, 'layer');
    assert.equal(layer.boardChildren.length, 2);
    assert.equal(project.scene.getNodeById(ids[0]!)?.boardState.x, 100);
    assert.equal(JSON.stringify(saved), original);
    assert.equal(await project.undo(), true);
    assert.equal(project.scene.getRoots().length, 0, 'first layer and all objects undo together');
    assert.equal(await project.redo(), true);
    assert.equal(project.scene.getNodeById(ids[0]!)?.parent, project.scene.getRoots()[0]);
});

test('reports actual nested missing types, invalid state, malformed payloads and duplicate IDs', () => {
    const { context } = destination();
    const nested = node('outer');
    nested.children.push(node('missing', 'uninstalledType'));
    assert.match(inspectPaletteSelection(context, record([nested]), 'B', registry).reason, /Missing object type: uninstalledType/);
    assert.match(inspectPaletteSelection(context, record([node('one', 'text', { x: 'invalid' })]), 'B', registry).reason, /Invalid saved state/);
    assert.equal(inspectPaletteSelection(context, { ...record([]), payload: 'invalid' }, 'B', registry).status, 'unavailable');
    assert.match(inspectPaletteSelection(context, record([node('one'), node('one')]), 'B', registry).reason, /duplicate/);
    assert.equal(inspectPaletteSelection(context, { ...record([]), payload: undefined }, 'B', registry).status, 'pending');
});

test('checks authoritative Foxhole catalog keys and modifications, retaining remapped internal relationships', async () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const asset = Object.values(catalog.assetByKey).find(candidate => candidate.modificationSlots.length > 0)!;
    assert.ok(asset, 'the published catalog supplies a real modifiable structure');
    const key = asset.foxholeKey;
    const slot = asset.modificationSlots[0]!;
    const registration = custom('foxholeAsset', {
        getSnapshotDependencies: snapshot => getFoxholeSnapshotDependencies(snapshot, catalog),
        remapCloneReferences: (snapshot, { idMap }) => remapFoxholeStructureSnapshotCloneReferences(snapshot, idMap),
    });
    const { context, project, selected } = destination([registration]);
    assert.match(inspectPaletteSelection(context, record([node('one', 'foxholeAsset', { foxholeKey: 'missing-key' })]), 'B', registry).reason, /Missing Foxhole catalog asset/);
    assert.match(inspectPaletteSelection(context, record([node('one', 'foxholeAsset', { foxholeKey: key, modificationVariantIds: { [slot.id]: 'missing-gun' } })]), 'B', registry).reason, /Missing Foxhole modification/);
    const saved = record([node('one', 'foxholeAsset', { foxholeKey: key, socketAttachments: {
        inside: { nodeId: 'two', socketName: 'in' }, outside: { nodeId: 'outside-selection', socketName: 'in' },
    } }), node('two', 'foxholeAsset', { foxholeKey: key })]);
    const original = saved.payload;
    assert.equal(await placePaletteSelection(context, saved, 'B', undefined, { registry }), true);
    const state = project.scene.getNodeById(selected[0]![0]!)!.boardState;
    assert.deepEqual(state.socketAttachments, { inside: { nodeId: selected[0]![1], socketName: 'in' } });
    assert.equal(saved.payload, original);
});

test('declared required references and texture definitions fail with specific reasons', () => {
    const { context } = destination([custom('linked', {
        getSnapshotDependencies: snapshot => [{ kind: 'node', nodeId: String(snapshot.state.target) }],
        remapCloneReferences: (snapshot, { idMap }) => {
            snapshot.state.target = idMap.get(String(snapshot.state.target)) ?? snapshot.state.target;
        },
    })]);
    assert.match(inspectPaletteSelection(context, record([node('one', 'linked', { target: 'missing-target' })]), 'B', registry).reason, /Missing selection reference: missing-target/);
    assert.equal(inspectPaletteSelection(context, record([node('one', 'linked', { target: 'two' }), node('two')]), 'B', registry).status, 'available');
    const broken = destination([custom('linked', { getSnapshotDependencies: snapshot => [{ kind: 'node', nodeId: String(snapshot.state.target) }] })]);
    assert.match(inspectPaletteSelection(broken.context, record([node('one', 'linked', { target: 'two' }), node('two')]), 'B', registry).reason, /Missing selection reference: two/);
    const sprite = node('sprite', 'sprite', { textureKey: 'missing-texture', anchorX: 0.5, anchorY: 0.5 });
    assert.match(inspectPaletteSelection(context, record([sprite]), 'B', registry).reason, /Missing texture definition/);
    const textures = { getAllTextureResolvers: () => [{ id: 'test', resolveTextureUrl: (key: string) => key === 'missing-texture' ? '/packaged/image.png' : undefined }] };
    assert.equal(inspectPaletteSelection(context, record([sprite]), 'B', textures).status, 'available');
    const urlSprite = node('sprite', 'sprite', { textureKey: '/existing/image.png' });
    assert.equal(inspectPaletteSelection(context, record([urlSprite], 'B'), 'B', registry).status, 'available');
    assert.equal(inspectPaletteSelection(context, record([urlSprite]), 'B', registry).status, 'available');
});

test('built-in graphics and legacy numeric IDs are portable without extension metadata', async () => {
    const { context, project, selected } = destination();
    const shape = node('shape', 'graphics', { commands: [{ kind: 'rect', x: 0, y: 0, width: 20, height: 10, fill: { color: 0xff0000 } }] });
    shape.id = 0;
    assert.equal(inspectPaletteSelection(context, record([shape]), 'B', registry).status, 'available');
    assert.equal(await placePaletteSelection(context, record([shape]), 'B', undefined, { registry }), true);
    assert.equal(project.scene.getNodeById(selected[0]![0]!)?.boardType, 'graphics');
});

test('host hitboxes, spline paths and resource-free icons are portable with their actual type IDs', () => {
    const { context } = destination([custom('hitbox'), custom('splinePath')]);
    const snapshots = [node('hitbox', 'hitbox', { ...DEFAULT_NIXIE_HITBOX_STATE }),
        node('spline', 'splinePath', { ...DEFAULT_NIXIE_SPLINE_PATH_STATE }),
        node('icon', 'nixieIcon', { ...DEFAULT_NIXIE_ICON_STATE })];
    assert.equal(inspectPaletteSelection(context, record(snapshots), 'B', registry).status, 'available');
    snapshots[2]!.state.textureUrl = '/api/nixie/projects/A/assets/absent/object';
    Object.assign(context.project, { yjsSession: { assets: ref([]) } });
    assert.match(inspectPaletteSelection(context, record(snapshots), 'B', registry).reason, /Missing destination image: absent/);
});

test('images resolve only by a ready destination asset ID, with destination URLs and no source mutation', () => {
    const { context, project } = destination([custom('nixieUrlSprite')]);
    const assets = ref<NixieProjectAssetSummary[]>([]);
    Object.assign(project, { yjsSession: { assets } });
    const image = node('image', 'nixieUrlSprite', { anchorX: 0.5, anchorY: 0.5, projectAssetId: 'image-id', textureUrl: '/api/nixie/projects/A/assets/image-id/object' });
    const saved = record([image]);
    const original = saved.payload;
    assert.match(inspectPaletteSelection(context, saved, 'B', registry).reason, /Missing destination image: image-id/);
    assets.value = [{ id: 'image-id', assetType: 'image', status: 'pending_upload', moderationStatus: 'skipped', displayName: 'Map', updatedAt: 'version' } as NixieProjectAssetSummary];
    assert.equal(inspectPaletteSelection(context, saved, 'B', registry).status, 'pending');
    assets.value[0]!.status = 'ready';
    const result = inspectPaletteSelection(context, saved, 'B', registry);
    assert.equal(result.status, 'available');
    assert.equal(result.snapshots[0]!.state.textureUrl, '/api/nixie/projects/B/assets/image-id/object?v=version');
    assert.equal(saved.payload, original);
    assets.value[0]!.deletedAt = 'deleted';
    assert.equal(inspectPaletteSelection(context, saved, 'B', registry).status, 'unavailable');
    assert.equal(inspectPaletteSelection(context, record([node('blob', 'nixieUrlSprite', { anchorX: 0, anchorY: 0, textureUrl: 'blob:source' })]), 'B', registry).status, 'available');
});

test('registered extensions can place compatible state across projects', () => {
    const { context } = destination([custom('opaque')]);
    assert.equal(inspectPaletteSelection(context, record([node('one', 'opaque')], 'B'), 'B', registry).status, 'available');
    assert.equal(inspectPaletteSelection(context, record([node('one', 'opaque')]), 'B', registry).status, 'available');
});

test('permission and navigation changes reject without partial creation; locked layers get a new destination', async () => {
    for (const change of ['permission', 'navigation', 'dependency'] as const) {
        const state = destination();
        const saved = record([node('one')]);
        state.context.activateTool = async () => {
            if (change === 'permission') {
                state.context.capabilities.canEdit = false;
            }
            if (change === 'navigation') {
                state.navigate();
            }
            if (change === 'dependency') {
                state.project.scene.setBoardNodeRegistry(createBoardNodeRegistry([]));
            }
            return true;
        };
        if (change === 'dependency') {
            saved.payload = record([node('one', 'supported')]).payload;
            state.project.scene.setBoardNodeRegistry(createBoardNodeRegistry([custom('supported', { getSnapshotDependencies: () => [] })]));
        }
        await assert.rejects(placePaletteSelection(state.context, saved, 'B', undefined, { registry }), /cannot edit|destination changed|Missing object type/i);
        assert.equal(state.project.scene.getRoots().length, 0);
    }
    const { context, project } = destination();
    await project.executeBatch([{ type: 'create', node: createLayerSnapshot({ id: 'locked', locked: true }) }], [{ type: 'delete', nodeId: 'locked' }]);
    assert.equal(await placePaletteSelection(context, record([node('one')]), 'B', undefined, { registry }), true);
    assert.equal(project.scene.getRoots().length, 2);
    assert.equal(project.scene.getRoots()[0]!.toBoardSnapshot().state.locked, true);
});

test('overlapping placements execute once, recover after completion and respect explicit cancellation', async () => {
    const { context, project } = destination();
    let finish!: () => void;
    context.finalizeSelectionPlacement = () => new Promise<void>(resolve => {
        finish = resolve;
    });
    const saved = record([node('one')]);
    const first = placePaletteSelection(context, saved, 'B', undefined, { registry });
    assert.equal(await placePaletteSelection(context, saved, 'B', undefined, { registry }), false);
    for (let tick = 0; !finish && tick < 10; tick++) await Promise.resolve();
    finish();
    assert.equal(await first, true);
    context.finalizeSelectionPlacement = async () => {};
    assert.equal(await placePaletteSelection(context, saved, 'B', undefined, { registry }), true);
    await assert.rejects(placePaletteSelection(context, saved, 'B', undefined, { registry, isCurrent: () => false }), /destination changed/i);
    assert.equal(project.scene.getRoots()[0]!.boardChildren.length, 2);
});
