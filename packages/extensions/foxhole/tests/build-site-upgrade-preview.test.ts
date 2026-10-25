import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import * as previews from '../app/plugins/foxhole/nixie/structure-modification-hover-preview.ts';
import * as visibility from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import * as floorMasks from '../app/plugins/foxhole/nixie/structure-floor-mask.ts';
import * as connectorPreviews from '../app/plugins/foxhole/nixie/spline-connector-upgrade-layers.ts';
import { canFoxholeSocketConnectionOpenWalls } from '../app/plugins/foxhole/nixie/socket-wall-visibility.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '../app/plugins/foxhole/nixie/structure-debug-settings.ts';
import { isTrenchConnector } from '../app/plugins/foxhole/nixie/trench-connector.ts';

const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
const activeNixieStructureModificationHoverPreview = { value: null as previews.FoxholeModificationHoverPreviewState | null };
let observer: { getter: () => unknown; refresh: () => void; } | null = null;
let queuedNeighborIds: string[] = [];
beforeEach(() => {
    activeNixieStructureModificationHoverPreview.value = null;
    observer = null;
    queuedNeighborIds = [];
});
class Container {
    children: any[] = [];
    visible = true;
    mask: any = null;
    addChild(child: any) { this.children.push(child); }
}
class Graphics extends Container {
    points: number[] = [];
    poly(points: number[]) { this.points = points; return this; }
    fill() { return this; }
}
const scope = { ...previews, ...visibility, ...floorMasks, ...connectorPreviews,
    isTrenchConnector, invalidateFoxholeRoofHoverNetwork: () => {},
    markFoxholeStructureOverlaysDirtyByIds: (ids: string[]) => { queuedNeighborIds.push(...ids); },
    canFoxholeSocketConnectionOpenWalls, FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS,
    activeNixieStructureModificationHoverPreview, FOXHOLE_BOARD_SPRITE_SCALE: 0.5, PIXI: { Graphics },
    watch: (getter: () => unknown, refresh: () => void) => { observer = { getter, refresh }; return () => {}; } };
function hostClass(file: string, className: string, names: string[]) {
    const source = ts.createSourceFile(file, readFileSync(new URL('../app/plugins/nixie/board/types/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ts.ClassDeclaration;
    const methods = declaration.members.filter(member => ts.isMethodDeclaration(member) && names.includes(member.name.getText(source))).map(member => member.getText(source)).join('\n');
    const code = ts.transpileModule(`class Host { ${methods} } return Host;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(scope), code)(...Object.values(scope));
}
const Structure = hostClass('foxhole-structure.ts', 'FoxholeStructureNode', [
    'getResolvedAsset', 'getResolvedStructure', 'getResolvedRenderStructure', 'getResolvedRenderLayers',
    'getResolvedUpgradeReplacementHoverPreview', 'getEffectiveStructureReplacementSelection',
    'isUsingStructureRenderLayers', 'getLocalAttachmentOccupancyKeys', 'getWallVisibilityNeighborKey', 'syncStructureRenderLayers',
    'syncStructureFloorTextureMask', 'getScaledStructureSpriteOffset',
]);
function setup(sourceKey: string) {
    const node = new Structure();
    node.boardId = 'site';
    node.boardState = { foxholeKey: sourceKey, socketAttachments: { BackSocket: { nodeId: 'neighbor', socketName: 'FrontSocket' } } };
    node.boardDefinition = {
        assetResolver: (key: string) => catalog.assetByKey[key],
        structureResolver: (key: string) => catalog.structureByKey[key],
    };
    node.settingsStore = { getValueOr: (_key: string) => false };
    node.isOperationalStructureEnabled = () => true;
    node.getResolvedTextureUrl = () => '/target.webp';
    node.isPreviewingUpgradeReplacementBase = () => false;
    node.getResolvedModificationHoverPreviewSelection = () => null;
    node.getResolvedStructureReplacementSelection = () => null;
    node.getResolvedPackagedVisual = node.getResolvedDestroyedVisual = () => null;
    node.hasInitializedStructureOverlays = () => true;
    node.offLaneRoofSprites = new Set();
    node.getNormalizedSocketAttachments = () => node.boardState.socketAttachments;
    node.getWallVisibilityNeighborKey = () => 'trencht2';
    node.getResolvedBuildSockets = (structure: any) => structure.buildSockets;
    node.shouldHideRoofForModificationPreview = () => false;
    node.createStructureRenderLayerVisual = (layer: any) => ({ layer, visible: true });
    // These cases exercise base layers; modification replacement and lamp glows have separate coverage.
    node.applyStructureTextureVisualState = node.syncPowerPoleLampGlow = node.syncBunkerSpotlightGlow = () => {};
    node.getModificationReplacedRenderLayerIds = () => new Set();
    for (const name of ['structureFloorTextureOverlay', 'floorDetailTextureOverlay', 'structureDirtTextureOverlay',
        'structureRoofTextureOverlay', 'structureWallTextureOverlay', 'structureCornerTextureOverlay', 'bunkerSpotlightOverlay']) node[name] = new Container();
    node.clearOverlay = (overlay: Container) => { overlay.children = []; };
    node.clearStructureFloorTextureOverlay = () => { node.structureFloorTextureOverlay.children = []; node.structureFloorTextureOverlay.mask = null; };
    const mask = node.syncStructureFloorTextureMask.bind(node);
    node.syncStructureFloorTextureMask = (structure: any, ...args: any[]) => { node.renderedStructure = structure; return mask(structure, ...args); };
    return node;
}

for (const sourceKey of ['fortbuildsite', 'fortcornerbuildsite', 'trenchbuildsite', 'trenchempbuildsite', 'trenchintbuildsite']) {
    test(`${sourceKey} tier preview renders using target metadata without changing the saved site`, () => {
        const source = catalog.assetByKey[sourceKey]!;
        const target = catalog.assetByKey[source.upgradeStructureId!]!;
        const node = setup(sourceKey);
        const before = JSON.stringify(node.boardState);
        activeNixieStructureModificationHoverPreview.value = { nodeId: 'site', slotId: 'asset-preview', variantId: target.foxholeKey,
            targetAssetKey: target.foxholeKey, mode: 'replacement' };
        assert.equal(node.isUsingStructureRenderLayers(), true);
        node.syncStructureRenderLayers();
        assert.equal(node.renderedStructure?.codeName, target.codeName);
        assert.equal(node.getResolvedStructure().id, sourceKey, 'interaction metadata remains canonical');
        assert.equal(JSON.stringify(node.boardState), before);
        if (sourceKey === 'trenchintbuildsite') {
            assert.ok(node.structureFloorTextureOverlay.mask instanceof Graphics);
            assert.equal(Math.min(...node.structureFloorTextureOverlay.mask.points.filter((_v: number, i: number) => i % 2 === 0)), -80);
            assert.equal(node.structureWallTextureOverlay.children.find((sprite: any) => sprite.layer.id === 'backwall').visible, false);
        }
        activeNixieStructureModificationHoverPreview.value = null;
        node.syncStructureRenderLayers();
        assert.equal(node.isUsingStructureRenderLayers(), false);
        assert.equal(node.structureFloorTextureOverlay.visible, false);
        assert.equal(JSON.stringify(node.boardState), before);
    });
}

const Connector = hostClass('foxhole-spline-connector.ts', 'FoxholeSplineConnectorNode', [
    'getResolvedAsset', 'getResolvedStructure', 'getResolvedRenderAsset', 'getResolvedRenderKey',
    'getResolvedRenderLayers', 'getResolvedUpgradeHoverPreviewAlpha',
    'bindModificationHoverPreviewWatcher', 'refreshAttachedStructureOverlays', 'onBoardStateChanged',
]);
test('trench connector build-site preview resolves the finished component layers and ghost alpha', () => {
    const node = new Connector();
    node.boardId = 'connector';
    node.boardState = { foxholeKey: 'trenchconnectorbuildsite', modificationVariantIds: {} };
    node.boardDefinition = { assetResolver: (key: string) => catalog.assetByKey[key], structureResolver: (key: string) => catalog.structureByKey[key] };
    activeNixieStructureModificationHoverPreview.value = { nodeId: 'connector', slotId: 'asset-preview', variantId: 'trenchconnectort1',
        targetAssetKey: 'trenchconnectort1', mode: 'replacement' };
    assert.deepEqual(node.getResolvedRenderLayers(), catalog.assetByKey.trenchconnectort1!.renderLayers);
    assert.equal(node.getResolvedUpgradeHoverPreviewAlpha(), previews.FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA);
    assert.equal(node.boardState.foxholeKey, 'trenchconnectorbuildsite');
    activeNixieStructureModificationHoverPreview.value = null;
    assert.equal(node.getResolvedRenderLayers().length, 0);
    assert.equal(node.getResolvedUpgradeHoverPreviewAlpha(), 1);
});

test('bunker conversion previews use each target profile and restore the source on cancellation', () => {
    const node = setup('fortt3');
    const before = JSON.stringify(node.boardState);
    for (const targetKey of catalog.assetByKey.fortt3!.conversionStructureIds) {
        const target = catalog.assetByKey[targetKey]!;
        activeNixieStructureModificationHoverPreview.value = { nodeId: 'site', slotId: 'asset-preview', variantId: targetKey,
            targetAssetKey: targetKey, mode: 'replacement' };
        node.syncStructureRenderLayers();
        assert.equal(node.renderedStructure.codeName, target.codeName);
        assert.equal(node.getResolvedStructure().id, 'fortt3');
        assert.equal(JSON.stringify(node.boardState), before);
    }
    activeNixieStructureModificationHoverPreview.value = null;
    node.syncStructureRenderLayers();
    assert.equal(node.renderedStructure.id, 'fortt3');
    assert.equal(JSON.stringify(node.boardState), before);
});

test('neighbors open walls only during a valid completed-site preview and restore construction walls afterward', () => {
    const node = setup('trencht2');
    node.boardId = 'neighbor';
    node.boardState.socketAttachments = { FrontSocket: { nodeId: 'site', socketName: 'BackSocket' } };
    delete node.getWallVisibilityNeighborKey;
    const candidate = { boardId: 'site', boardState: { foxholeKey: 'trenchintbuildsite' }, children: [] };
    node.getTopBoardContainer = () => ({ children: [candidate] });
    const before = JSON.stringify(node.boardState);
    assert.equal(node.getLocalAttachmentOccupancyKeys(true).size, 0);
    activeNixieStructureModificationHoverPreview.value = { nodeId: 'site', slotId: 'asset-preview', variantId: 'trenchintt1',
        targetAssetKey: 'trenchintt1', mode: 'replacement' };
    assert.deepEqual([...node.getLocalAttachmentOccupancyKeys(true)], ['neighbor:FrontSocket']);
    activeNixieStructureModificationHoverPreview.value = null;
    assert.equal(node.getLocalAttachmentOccupancyKeys(true).size, 0);
    assert.equal(JSON.stringify(node.boardState), before);
    assert.equal(candidate.boardState.foxholeKey, 'trenchintbuildsite');
});

test('unresolved targets, other nodes, and overlay hovers retain the canonical rendering metadata', () => {
    const node = setup('trencht2');
    for (const preview of [
        { nodeId: 'site', slotId: 'asset-preview', variantId: 'missing', targetAssetKey: 'missing', mode: 'replacement' as const },
        { nodeId: 'other', slotId: 'asset-preview', variantId: 'trenchintt1', targetAssetKey: 'trenchintt1', mode: 'replacement' as const },
        { nodeId: 'site', slotId: 'asset-preview', variantId: 'trenchintt1', targetAssetKey: 'trenchintt1', mode: 'overlay' as const },
    ]) {
        activeNixieStructureModificationHoverPreview.value = preview;
        node.syncStructureRenderLayers();
        assert.equal(node.renderedStructure.id, 'trencht2');
    }
    activeNixieStructureModificationHoverPreview.value = null;
    node.settingsStore.getValueOr = (key: string) => key === FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.useStaticRender;
    node.syncStructureRenderLayers();
    assert.equal(node.isUsingStructureRenderLayers(), false);
    assert.equal(node.structureFloorTextureOverlay.visible, false);
});

test('a linked connector redraws when a finished-site preview starts and ends without reacting to unrelated hovers', () => {
    const node = new Connector();
    node.boardId = 'connector';
    node.boardState = { foxholeKey: 'trenchconnectort2' };
    node.getEndpointOccupancyAttachments = () => ({ BackSocket: { nodeId: 'site', socketName: 'FrontSocket' } });
    let refreshes = 0;
    node.syncFromState = () => { refreshes++; };
    node.bindModificationHoverPreviewWatcher();
    assert.ok(observer);
    const watcher = observer as { getter: () => unknown; refresh: () => void; };
    let previous = watcher.getter();
    const tick = () => { const next = watcher.getter(); if (previous !== next) { previous = next; watcher.refresh(); } };
    activeNixieStructureModificationHoverPreview.value = { nodeId: 'site', slotId: 'asset-preview', variantId: 'trenchintt1',
        targetAssetKey: 'trenchintt1', mode: 'replacement' };
    tick();
    assert.equal(refreshes, 1);
    activeNixieStructureModificationHoverPreview.value = null;
    tick();
    assert.equal(refreshes, 2);
    activeNixieStructureModificationHoverPreview.value = { nodeId: 'unrelated', slotId: 'asset-preview', variantId: 'trenchintt1',
        targetAssetKey: 'trenchintt1', mode: 'replacement' };
    tick();
    assert.equal(refreshes, 2);
    activeNixieStructureModificationHoverPreview.value = null;
    assert.equal(node.boardState.foxholeKey, 'trenchconnectort2');
});

test('connector tier changes and previews queue attached wall overlays without waiting for a reload', () => {
    const node = new Connector();
    node.boardId = 'connector';
    node.boardState = { foxholeKey: 'trenchconnectort1' };
    node.overlaySyncFoxholeKey = 'trenchconnectort1';
    node.getEndpointOccupancyAttachments = () => ({ BackSocket: { nodeId: 'trench', socketName: 'FrontSocket' },
        FrontSocket: { nodeId: 'intersection', socketName: 'BackSocket' } });
    node.syncFromState = () => {};
    queuedNeighborIds = [];
    node.boardState.foxholeKey = 'trenchconnectorbuildsite';
    node.onBoardStateChanged('patch', 'local');
    assert.deepEqual(queuedNeighborIds, ['trench', 'intersection']);
    queuedNeighborIds = [];
    node.onBoardStateChanged('move', 'local');
    assert.deepEqual(queuedNeighborIds, [], 'ordinary transforms do not queue tier refreshes');
    node.bindModificationHoverPreviewWatcher();
    activeNixieStructureModificationHoverPreview.value = { nodeId: 'connector', slotId: 'asset-preview', variantId: 'trenchconnectort1',
        targetAssetKey: 'trenchconnectort1', mode: 'replacement' };
    observer!.refresh();
    assert.deepEqual(queuedNeighborIds, ['trench', 'intersection']);
    queuedNeighborIds = [];
    activeNixieStructureModificationHoverPreview.value = null;
    observer!.refresh();
    assert.deepEqual(queuedNeighborIds, ['trench', 'intersection'], 'cancelling the preview restores construction walls');
    queuedNeighborIds = [];
    node.boardState.foxholeKey = 'trenchconnectort1';
    node.onBoardStateChanged('patch', 'remote');
    assert.deepEqual(queuedNeighborIds, ['trench', 'intersection']);
});
