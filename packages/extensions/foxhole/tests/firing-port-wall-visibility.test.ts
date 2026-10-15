import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeFiringPortReplacedWallLayerIds } from '../app/plugins/foxhole/nixie/firing-port-wall-visibility.ts';
import { resolveFoxholeLadderReplacedRoofLayerIds } from '../app/plugins/foxhole/nixie/ladder-roof-visibility.ts';
import * as visibility from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import * as selections from '../app/plugins/foxhole/nixie/modification-slots.ts';
import * as hover from '../app/plugins/foxhole/nixie/structure-modification-hover-preview.ts';
import * as order from '../app/plugins/foxhole/nixie/modification-render-order.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '../app/plugins/foxhole/nixie/structure-debug-settings.ts';
import { createFoxholeCornerWallMaskPoints } from '../app/plugins/foxhole/nixie/structure-floor-mask.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const asset = catalog.assetByKey.artilleryait3!;
const wallSlots = asset.modificationSlots.filter(slot => slot.componentType === 'BPFortWallModSlot_C');
const back = wallSlots.find(slot => slot.name === 'BackModSlot')!;
const select = (slot = back) => ({ slot, variant: slot.variantById.firingport! });

// Execute the registered node's actual methods; avoid constructing its unrelated socket/LOS scene.
const source = ts.createSourceFile('foxhole-structure.ts', readFileSync(process.env.FOXHOLE_FIRING_PORT_TEST_SOURCE ?? new URL(
    '../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url,
), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(statement => ts.isClassDeclaration(statement)
    && statement.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
const methodNames = new Set(['isOperationalStructureEnabled', 'getResolvedModificationSelections',
    'getResolvedSelectedModificationVariants', 'getResolvedModificationHoverPreviewSelection',
    'getResolvedModificationHoverPreview', 'shouldHideRoofForModificationPreview', 'getResolvedModificationVisual',
    'getFiringPortReplacedWallLayerIds', 'getModificationReplacedRenderLayerIds', 'getStructureRenderLayerVisibilitySignature', 'syncStructureRenderLayers']);
const methods = declaration.members.filter(member => member.name && methodNames.has(member.name.getText(source)));
const activePreview = { value: null as Record<string, unknown> | null };
const bindings = { ...visibility, ...selections, ...hover, ...order, activeNixieStructureModificationHoverPreview: activePreview,
    resolveFoxholeFiringPortReplacedWallLayerIds, resolveFoxholeLadderReplacedRoofLayerIds, FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS,
    FOXHOLE_BOARD_SPRITE_SCALE: 0.5, createFoxholeCornerWallMaskPoints };
const code = ts.transpileModule(`class Host { ${methods.map(member => member.getText(source)).join('\n')} }\nreturn Host;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Host = new Function(...Object.keys(bindings), code)(...Object.values(bindings));

function createHost(hostAsset = asset) {
    const asset = hostAsset;
    activePreview.value = null;
    const node = new Host();
    const flags = new Map<string, boolean>();
    node.boardId = 'artillery';
    node.boardState = { foxholeKey: asset.foxholeKey, modificationVariantIds: {}, destroyed: false, packaged: false, visible: true };
    node.layered = true;
    node.occupied = new Set();
    node.offLaneRoofSprites = new Set();
    node.settingsStore = { getValue: (id: string) => flags.get(id) ?? false };
    node.isPackagedVisualEnabled = () => node.boardState.packaged;
    node.isUsingStructureRenderLayers = () => node.layered && node.boardState.destroyed !== true && node.boardState.packaged !== true;
    node.getResolvedAsset = () => asset;
    node.getResolvedStructure = node.getResolvedRenderStructure = () => catalog.structureByKey[asset.foxholeKey];
    node.getResolvedRenderLayers = () => asset.renderLayers;
    node.getResolvedBuildSockets = () => catalog.structureByKey[asset.foxholeKey]!.buildSockets;
    node.getLocalAttachmentOccupancyKeys = () => node.occupied;
    node.boardDefinition = { modificationVisualResolver: (_key: string, slotId: string, variantId: string) => {
        const textureUrl = asset.modificationSlotById[slotId]?.variantById[variantId]?.textureUrl;
        return textureUrl ? { kind: 'full-structure', textureUrl } : null;
    } };
    const containers = ['structureFloorTextureOverlay', 'floorDetailTextureOverlay', 'structureDirtTextureOverlay',
        'structureRoofTextureOverlay', 'structureWallTextureOverlay', 'structureCornerTextureOverlay', 'bunkerSpotlightOverlay'];
    for (const name of containers) node[name] = { children: [] as unknown[], visible: true, addChild(child: unknown) { this.children.push(child); } };
    node.hasInitializedStructureOverlays = () => true;
    node.clearOverlay = (container: { children: unknown[]; }) => { container.children.length = 0; };
    node.clearStructureFloorTextureOverlay = () => node.clearOverlay(node.structureFloorTextureOverlay);
    node.createStructureRenderLayerVisual = (layer: { id: string; }) => ({ id: layer.id, visible: true });
    node.applyStructureTextureVisualState = node.syncStructureFloorTextureMask = node.syncPowerPoleLampGlow = node.syncBunkerSpotlightGlow = () => {};
    return { node, flags, render() {
        node.syncStructureRenderLayers();
        return new Map<string, boolean>(containers.flatMap(name => node[name].children.map((sprite: { id: string; visible: boolean; }) => [sprite.id, sprite.visible] as [string, boolean])));
    } };
}

test('registered node replaces each native exterior wall without hiding the other component layers', () => {
    assert.equal(wallSlots.length, 4);
    const before = JSON.stringify(asset);
    for (const slot of wallSlots) {
        const host = createHost();
        const base = host.render();
        const expectedWall = asset.renderLayers.find(layer => layer.componentName === `FortCommonMods:${slot.name}`)!;
        assert(expectedWall);
        host.node.boardState.modificationVariantIds = { [slot.id]: 'firingport' };
        const applied = host.render();
        assert.equal(applied.get(expectedWall.id), false, `${slot.name}: native default wall must not cover its firing port`);
        assert.deepEqual([...applied].filter(([id]) => id !== expectedWall.id), [...base].filter(([id]) => id !== expectedWall.id));
        host.node.boardState.modificationVariantIds = {};
        assert.deepEqual(host.render(), base, 'the original selection map restores every layer, as Undo does');
    }
    assert.equal(JSON.stringify(asset), before, 'catalog geometry, headings, offsets, layers and shared variants stay unchanged');
});

test('wall identity matching is exact, case-insensitive and fails open on missing or ambiguous metadata', () => {
    const wall = asset.renderLayers.find(layer => layer.componentName === 'FortCommonMods:BackModSlot')!;
    assert.deepEqual([...resolveFoxholeFiringPortReplacedWallLayerIds(asset.renderLayers, [select()])], [wall.id]);
    assert.deepEqual([...resolveFoxholeFiringPortReplacedWallLayerIds([{ ...wall, componentName: 'Native:BACKMODSLOT' }], [select()])], [wall.id]);
    for (const layers of [[{ ...wall, componentName: null }], [{ ...wall, componentName: 'Native:BackModSlotExtra' }],
        [wall, { ...wall, id: 'duplicate-native-wall' }], [{ ...wall, id: 'dirtback' }]]) {
        assert.equal(resolveFoxholeFiringPortReplacedWallLayerIds(layers, [select()]).size, 0);
    }
});

test('unrelated, unresolved and upgrade variants never suppress a default wall', () => {
    const original = select();
    for (const selection of [
        { ...original, variant: { ...original.variant, id: 'interiorfiringport' } },
        { ...original, variant: { ...original.variant, id: 'door' } },
        { ...original, variant: { ...original.variant, id: 'unknown' } },
        { ...original, variant: { ...original.variant, textureUrl: '' } },
        { ...original, variant: { ...original.variant, isUpgrade: true } },
        { ...original, slot: { ...back, componentType: 'BPFortInfraModSlot_C' } },
    ]) assert.equal(resolveFoxholeFiringPortReplacedWallLayerIds(asset.renderLayers, [selection]).size, 0);
    const host = createHost();
    const before = host.render();
    for (const slot of asset.modificationSlots) for (const variant of slot.variants) {
        if (variant.id === 'firingport') continue;
        host.node.boardState.modificationVariantIds = { [slot.id]: variant.id };
        assert.deepEqual(host.render(), before, `${slot.name}:${variant.id}`);
    }
    host.node.boardState.modificationVariantIds = { UnknownSlot: 'firingport', [back.id]: 'unknown' };
    assert.deepEqual(host.render(), before);
    host.node.boardState.modificationVariantIds = { [back.id]: 'firingport' };
    host.node.boardDefinition.modificationVisualResolver = () => null;
    assert.deepEqual(host.render(), before, 'no renderable replacement must leave the original wall visible');
});

test('actual node signature and visibility follow local hover and exit without editing saved state', () => {
    const host = createHost();
    const base = host.render();
    const signature = host.node.getStructureRenderLayerVisibilitySignature();
    const saved = JSON.stringify(host.node.boardState);
    activePreview.value = { nodeId: 'other-node', slotId: back.id, variantId: 'firingport', mode: 'overlay' };
    assert.deepEqual(host.render(), base);
    activePreview.value = { nodeId: 'artillery', slotId: back.id, variantId: 'firingport', mode: 'overlay' };
    assert.equal(host.render().get('backwall'), false);
    assert.notEqual(host.node.getStructureRenderLayerVisibilitySignature(), signature);
    activePreview.value = null;
    assert.deepEqual(host.render(), base);
    assert.equal(host.node.getStructureRenderLayerVisibilitySignature(), signature);
    assert.equal(JSON.stringify(host.node.boardState), saved);

});

test('published native stair conflicts temporarily restore the default wall and preserve the saved port', () => {
    const fort = catalog.assetByKey.fortt3!;
    const host = createHost(fort);
    const back = fort.modificationSlots.find(slot => slot.name === 'BackModSlot')!;
    host.node.boardState.modificationVariantIds = { [back.id]: 'firingport' };
    const portSignature = host.node.getStructureRenderLayerVisibilitySignature();
    const stairs = fort.modificationSlots.find(slot => slot.name === 'BackFortStairsModSlot')!;
    const variant = stairs.variants.find(variant => !variant.isUpgrade)!;
    activePreview.value = { nodeId: 'artillery', slotId: stairs.id, variantId: variant.id, mode: 'overlay' };
    assert.equal(host.render().get('backwall'), true, 'temporary placement conflict removes the old port from effective selections');
    assert.notEqual(host.node.getStructureRenderLayerVisibilitySignature(), portSignature);
    activePreview.value = null;
    assert.equal(host.render().get('backwall'), false);
    assert.equal(host.node.boardState.modificationVariantIds[back.id], 'firingport');
});

test('socket occupancy and hidden node state remain authoritative', () => {
    const host = createHost();
    host.node.occupied = new Set(['artillery:FortCommon:FrontFortSocket']);
    const occupied = host.render();
    assert.equal(occupied.get('frontwall'), false);
    host.node.boardState.modificationVariantIds = { [back.id]: 'firingport' };
    const replaced = host.render();
    assert.equal(replaced.get('backwall'), false);
    for (const [id, visible] of occupied) if (!visible) assert.equal(replaced.get(id), false);
    host.node.boardState.visible = false;
    host.render();
    assert.equal(host.node.structureWallTextureOverlay.visible, false);
    assert.equal(host.node.structureRoofTextureOverlay.visible, false);
    assert.equal(host.node.structureFloorTextureOverlay.visible, false);
});

test('debug visibility remains false-dominant and operational/static/replacement paths keep their existing guards', () => {
    const host = createHost();
    host.node.boardState.modificationVariantIds = { [back.id]: 'firingport' };
    for (const flag of ['hideRoofs', 'hideFloors', 'hideWalls', 'hideDirt', 'hideCorners'] as const) {
        host.flags.set(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS[flag], true);
        const applied = host.render();
        host.node.boardState.modificationVariantIds = {};
        const original = host.render();
        for (const [id, visible] of original) if (!visible) assert.equal(applied.get(id), false, `${flag}:${id}`);
        host.node.boardState.modificationVariantIds = { [back.id]: 'firingport' };
        host.flags.clear();
    }
    for (const stateKey of ['destroyed', 'packaged']) {
        host.node.boardState[stateKey] = true;
        assert.equal(host.node.getStructureRenderLayerVisibilitySignature(), '');
        assert.equal(host.node.getModificationReplacedRenderLayerIds().size, 0);
        host.node.boardState[stateKey] = false;
    }
    host.node.layered = false;
    assert.equal(host.node.getStructureRenderLayerVisibilitySignature(), '');
    host.node.layered = true;
    activePreview.value = { nodeId: 'artillery', slotId: 'asset-preview', variantId: 'fortt3', mode: 'replacement', targetAssetKey: 'fortt3' };
    assert.equal(host.node.getModificationReplacedRenderLayerIds().size, 0, 'conversion preview cannot suppress a target asset wall by old slot identity');
    activePreview.value = null;
});

test('native Ladder alternatives replace only their matching published Default roof and restore on clear', () => {
    for (const key of ['fortt2', 'fortt3']) {
        const roofAsset = catalog.assetByKey[key]!;
        const slot = roofAsset.modificationSlots.find(slot => slot.componentType === 'BPFortRoofModSlot_C')!;
        assert(slot.variantById.ladder?.textureUrl);
        const roof = roofAsset.renderLayers.find(layer => layer.componentName === `FortCommonT2T3Mods:${slot.name}`)!;
        assert(roof);
        const immutable = JSON.stringify(roofAsset);
        const host = createHost(roofAsset);
        const before = host.render();
        const signature = host.node.getStructureRenderLayerVisibilitySignature();
        host.node.boardState.modificationVariantIds = { [slot.id]: 'ladder' };
        const applied = host.render();
        assert.equal(applied.get(roof.id), false, `${key}: old opaque Default roof must not fill the native Ladder hatch`);
        for (const [id, visible] of before) if (id !== roof.id) assert.equal(applied.get(id), visible, `${key}:${id}`);
        assert.notEqual(host.node.getStructureRenderLayerVisibilitySignature(), signature);
        host.node.boardState.modificationVariantIds = {};
        assert.deepEqual(host.render(), before);
        assert.equal(host.node.getStructureRenderLayerVisibilitySignature(), signature);
        assert.equal(JSON.stringify(roofAsset), immutable);
    }
});

test('Ladder roof matching rejects missing, unknown, ambiguous and non-native metadata', () => {
    const roofAsset = catalog.assetByKey.fortt2!;
    const slot = roofAsset.modificationSlotById.FortRoofModSlot!;
    const variant = slot.variantById.ladder!;
    const roof = roofAsset.renderLayers.find(layer => layer.id === 'roof')!;
    const selection = { slot, variant };
    const resolve = (layers = [roof], selected = [selection]) => resolveFoxholeLadderReplacedRoofLayerIds(layers, selected, roofAsset.codeName);
    assert.deepEqual([...resolve()], ['roof']);
    assert.deepEqual([...resolve([{ ...roof, componentName: 'NATIVE:FORTROOFMODSLOT' }])], ['roof']);
    for (const layer of [{ ...roof, componentName: null }, { ...roof, componentName: 'DifferentRoof' },
        { ...roof, id: '' }, { ...roof, id: 'wall', componentTags: [] }]) assert.equal(resolve([layer]).size, 0);
    assert.equal(resolve([roof, { ...roof, id: 'other-roof', componentTags: ['Roof'] }]).size, 0);
    for (const selected of [
        { slot: { ...slot, name: '' }, variant },
        { slot: { ...slot, componentType: 'UnknownRoofSlot_C' }, variant },
        { slot, variant: { ...variant, id: 'unknown' } },
        { slot, variant: { ...variant, textureUrl: '' } },
        { slot, variant: { ...variant, isUpgrade: true } },
    ]) assert.equal(resolve([roof], [selected]).size, 0);
    const host = createHost(roofAsset);
    const before = host.render();
    host.node.boardState.modificationVariantIds = { [slot.id]: 'ladder' };
    host.node.boardDefinition.modificationVisualResolver = () => null;
    assert.deepEqual(host.render(), before, 'a missing resolved replacement must retain Default');
    host.node.boardDefinition.modificationVisualResolver = () => ({ kind: 'full-structure', textureUrl: '' });
    assert.deepEqual(host.render(), before, 'a resolved visual without an actual URL must retain Default');
});

test('Ladder preview is node-scoped, clears without persistence and preserves roof hiding and Blueprint state', () => {
    const roofAsset = catalog.assetByKey.fortt2!;
    const host = createHost(roofAsset);
    const before = host.render();
    const saved = JSON.stringify(host.node.boardState);
    activePreview.value = { nodeId: 'different-node', slotId: 'FortRoofModSlot', variantId: 'ladder', mode: 'overlay' };
    assert.deepEqual(host.render(), before);
    activePreview.value = { nodeId: 'artillery', slotId: 'FortRoofModSlot', variantId: 'ladder', mode: 'overlay' };
    assert.equal(host.render().get('roof'), false);
    activePreview.value = null;
    assert.deepEqual(host.render(), before);
    assert.equal(JSON.stringify(host.node.boardState), saved);
    host.node.boardState.modificationVariantIds = { FortRoofModSlot: 'ladder' };
    for (const blueprint of [false, true]) {
        host.node.boardState.blueprint = blueprint;
        assert.equal(host.render().get('roof'), false, 'Blueprint presentation must not revive the alternative Default roof');
    }
    host.flags.set(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs, true);
    assert.equal(host.render().get('roof'), false);
    host.node.boardState.modificationVariantIds = {};
    assert.equal(host.render().get('roof'), false, 'clearing Ladder must respect Hide Roofs');
    host.flags.clear();
    assert.deepEqual(host.render(), before);
    host.node.boardState.modificationVariantIds = { BackInfraModSlot: 'bunkbed' };
    assert.equal(host.render().get('roof'), true, 'saved interior furniture does not replace a Default roof');
    host.node.boardState.modificationVariantIds = { FortRoofModSlot: 'ladder' };
    for (const flag of ['hideRoofs', 'hideFloors', 'hideWalls', 'hideDirt', 'hideCorners'] as const) {
        host.flags.set(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS[flag], true);
        const applied = host.render();
        host.node.boardState.modificationVariantIds = {};
        const original = host.render();
        for (const [id, visible] of original) if (!visible) assert.equal(applied.get(id), false, `${flag}:${id}`);
        host.node.boardState.modificationVariantIds = { FortRoofModSlot: 'ladder' };
        host.flags.clear();
    }
    for (const state of ['destroyed', 'packaged']) {
        host.node.boardState[state] = true;
        assert.equal(host.node.getModificationReplacedRenderLayerIds().size, 0);
        host.node.boardState[state] = false;
    }
    activePreview.value = { nodeId: 'artillery', slotId: 'asset-preview', variantId: 'fortt3', mode: 'replacement', targetAssetKey: 'fortt3' };
    assert.equal(host.node.getModificationReplacedRenderLayerIds().size, 0);
    activePreview.value = null;
});
