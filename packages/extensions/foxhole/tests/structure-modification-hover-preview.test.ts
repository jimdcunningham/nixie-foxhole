import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeStructureCatalog,
    getFoxholeStructureAsset,
} from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import {
    buildModificationHoverPreviewSignature,
    createStructureAssetReplacementPreview,
    isReplacementBaseHoverPreview,
    isStructureReplacementModificationVariant,
    resolveModificationHoverPreviewMode,
    resolveModificationHoverPreviewSelections,
    resolveModificationTilePreviewSlot,
    resolveModificationVariantsForSocketOverlay,
    resolveReplacementHoverPreviewAlpha,
    shouldHideRoofForModificationHoverPreview,
    shouldHideCargoForStructureHoverPreview,
} from '../app/plugins/foxhole/nixie/structure-modification-hover-preview.ts';

test('structure previews hide cargo and production only on the previewed node', () => {
    for (const mode of ['replacement', 'overlay'] as const) {
        const preview = { nodeId: 'bunker', slotId: 'slot', variantId: 'variant', mode };
        assert.equal(shouldHideCargoForStructureHoverPreview(preview, 'bunker'), true);
        assert.equal(shouldHideCargoForStructureHoverPreview(preview, 'other'), false);
    }
    assert.equal(shouldHideCargoForStructureHoverPreview(null, 'bunker'), false);
});

const BASE_ASSETS_URL = '/foxhole/assets/';
const manifest = getFoxholeManifest(BASE_ASSETS_URL);
const catalog = buildFoxholeStructureCatalog(manifest);

test('interior hover previews reveal the bunker while roof mods retain its roof', () => {
    const options = { profileType: 'fort', useStructureRenderLayers: true };
    for (const id of ['bunkbed', 'chalkboard', 'desk', 'lockers', 'module']) {
        const hover = { slot: { componentType: 'BPFortInfraModSlot_C' }, variant: { id } };
        assert.equal(shouldHideRoofForModificationHoverPreview(hover, options), true, id);
        assert.equal(shouldHideRoofForModificationHoverPreview(hover, { ...options, useStructureRenderLayers: false }), false);
        assert.equal(shouldHideRoofForModificationHoverPreview({ ...hover, variant: { id, isUpgrade: true } }, options), false);
    }
    assert.equal(shouldHideRoofForModificationHoverPreview(null, options), false);
    assert.equal(shouldHideRoofForModificationHoverPreview({ slot: {}, variant: { id: 'ladder' } }, options), false);
    assert.equal(shouldHideRoofForModificationHoverPreview({ slot: { componentType: 'BPFortStairsModSlot_C' }, variant: { id: 'stairs' } }, options), false);
    assert.equal(shouldHideRoofForModificationHoverPreview({ slot: { z: 100 }, variant: { id: 'barbedwire' } }, options), false);
});

test('bunker conversions reuse replacement preview dimensions, offsets and render layers', () => {
    const base = catalog.assetByKey.fortt3!;
    for (const key of base.conversionStructureIds) {
        const asset = catalog.assetByKey[key]!;
        const structure = catalog.structureByKey[key]!;
        assert.ok(asset && structure);
        const preview = createStructureAssetReplacementPreview(asset, structure, '/preview.webp');
        assert.equal(resolveModificationHoverPreviewMode(preview.variant), 'replacement');
        assert.equal(isStructureReplacementModificationVariant(preview.variant), true);
        assert.equal(preview.variant.textureWidth, asset.width);
        assert.equal(preview.variant.offsetX, structure.sprite?.offsetX ?? null);
        assert.equal(preview.variant.offsetY, structure.sprite?.offsetY ?? null);
        assert.equal(preview.variant.renderLayers, asset.renderLayers);
        assert.equal(preview.variant.buildSockets, structure.buildSockets);
    }
});

test('conversion target changes invalidate the replacement preview signature', () => {
    const preview = { nodeId: 'n', slotId: 'asset-preview', variantId: 'target', mode: 'replacement' as const };
    assert.notEqual(
        buildModificationHoverPreviewSignature('n', { ...preview, targetAssetKey: 'a' }, 1),
        buildModificationHoverPreviewSignature('n', { ...preview, targetAssetKey: 'b' }, 1),
    );
});

test('tile preview uses the occupied available slot even for a different modification', () => {
    const { asset } = findVariant('fortt3', 'FrontInfraModSlot', 'kitchen');
    const slots = asset.modificationSlots.filter(slot => slot.componentType === 'BPFortInfraModSlot_C');
    const occupied = slots[2]!;
    assert.equal(resolveModificationTilePreviewSlot(slots, { [occupied.id]: 'desk' }), occupied);
    assert.equal(resolveModificationTilePreviewSlot(slots, {}), slots[0]);
    assert.equal(resolveModificationTilePreviewSlot(slots.filter(slot => slot !== occupied), { [occupied.id]: 'desk' }), slots[0]);
    assert.equal(resolveModificationTilePreviewSlot([], {}), null);
});

test('infrastructure preview replaces other walls without changing saved selections', () => {
    const { asset, slot, variant } = findVariant('fortt3', 'LeftInfraModSlot', 'kitchen');
    const front = asset.modificationSlots.find(entry => entry.name === 'FrontInfraModSlot')!;
    const right = asset.modificationSlots.find(entry => entry.name === 'RightInfraModSlot')!;
    const defense = asset.modificationSlots.find(entry => entry.name === 'BackDefenseModSlot')!;
    const saved = { [front.id]: 'desk', [right.id]: 'bunkbed', [defense.id]: defense.variants[0].id };
    const original = { ...saved };
    const preview = resolveModificationHoverPreviewSelections(asset, saved, { slot, variant });
    assert.deepEqual(preview, { [slot.id]: variant.id, [defense.id]: defense.variants[0].id });
    assert.deepEqual(saved, original);
    assert.deepEqual(resolveModificationHoverPreviewSelections(asset, saved, null), original);
});

test('preview clears mutually blocked trench mods but preserves unrelated selections', () => {
    const { asset, slot, variant } = findVariant('trencht2', 'BridgeModSlot', 'bridge');
    const defense = asset.modificationSlots.find(entry => entry.name === 'LeftMiddleDefenseModSlot')!;
    const saved = { [defense.id]: 'barbedwire' };
    assert.deepEqual(resolveModificationHoverPreviewSelections(asset, saved, { slot, variant }), { [slot.id]: variant.id });
    assert.deepEqual(saved, { [defense.id]: 'barbedwire' });
});

function findVariant(foxholeKey: string, slotName: string, variantId: string) {
    const asset = getFoxholeStructureAsset(foxholeKey, BASE_ASSETS_URL);
    assert.ok(asset);
    const slot = asset.modificationSlots.find(entry => entry.name === slotName);
    assert.ok(slot, `missing slot ${slotName}`);
    const variant = slot.variantById[variantId];
    assert.ok(variant, `missing variant ${variantId}`);
    return { asset, slot, variant };
}

test('facility oil mine upgrades classify as structure replacements', () => {
    const { variant: electric } = findVariant('facilitymineoil', 'UpgradeSlotComponent', 'electric');
    const { variant: fracker } = findVariant('facilitymineoil', 'UpgradeSlotComponent', 'fracker');

    assert.equal(electric.isUpgrade, true);
    assert.equal(fracker.isUpgrade, true);
    assert.equal(isStructureReplacementModificationVariant(electric), true);
    assert.equal(isStructureReplacementModificationVariant(fracker), true);
});

test('trench defense mods stay overlay previews', () => {
    const { variant: sandbags } = findVariant('trencht2', 'LeftMiddleDefenseModSlot', 'sandbags');

    assert.equal(sandbags.isUpgrade, false);
    assert.equal(resolveModificationHoverPreviewMode(sandbags), 'overlay');
    assert.equal(isStructureReplacementModificationVariant(sandbags), false);
});

test('buildModificationHoverPreviewSignature clears when preview is removed', () => {
    const nodeId = 'node-1';
    const revision = 'rev-1';
    const activeSignature = buildModificationHoverPreviewSignature(nodeId, {
        nodeId,
        slotId: 'ModificationSlotComponent',
        variantId: 'electric',
        mode: 'replacement',
    }, revision);
    const clearedSignature = buildModificationHoverPreviewSignature(nodeId, null, revision);

    assert.notEqual(activeSignature, clearedSignature);
    assert.equal(clearedSignature, 'node-1::rev-1');
});

test('resolveModificationHoverPreviewMode honors explicit replacement mode', () => {
    const { variant: sandbags } = findVariant('trencht2', 'LeftMiddleDefenseModSlot', 'sandbags');

    assert.equal(resolveModificationHoverPreviewMode(sandbags, 'replacement'), 'replacement');
    assert.equal(resolveModificationHoverPreviewMode(sandbags, 'overlay'), 'overlay');
});

test('resolveModificationVariantsForSocketOverlay follows upgrade hover and base restore', () => {
    const selected = [
        { slot: { id: 'UpgradeSlotComponent' }, variant: { id: 'fracker', isUpgrade: true } },
        { slot: { id: 'OtherModSlot' }, variant: { id: 'sandbags', isUpgrade: false } },
    ];

    assert.deepEqual(
        resolveModificationVariantsForSocketOverlay({
            selected,
            hoverReplacement: { slot: { id: 'UpgradeSlotComponent' }, variant: { id: 'electric', isUpgrade: true } },
            previewingBase: false,
        }).map(entry => entry.variant.id),
        ['sandbags', 'electric'],
    );

    assert.deepEqual(
        resolveModificationVariantsForSocketOverlay({
            selected,
            hoverReplacement: null,
            previewingBase: true,
        }).map(entry => entry.variant.id),
        ['sandbags'],
    );
});

test('resolveReplacementHoverPreviewAlpha previews swaps and base restore', () => {
    assert.equal(resolveReplacementHoverPreviewAlpha({
        hoverVariantId: 'electric',
        appliedVariantId: null,
        previewingBase: false,
        previewAlpha: 0.52,
    }), 0.52);

    assert.equal(resolveReplacementHoverPreviewAlpha({
        hoverVariantId: 'electric',
        appliedVariantId: 'fracker',
        previewingBase: false,
        previewAlpha: 0.52,
    }), 0.52);

    assert.equal(resolveReplacementHoverPreviewAlpha({
        hoverVariantId: 'fracker',
        appliedVariantId: 'fracker',
        previewingBase: false,
        previewAlpha: 0.52,
    }), 1);

    assert.equal(resolveReplacementHoverPreviewAlpha({
        hoverVariantId: null,
        appliedVariantId: 'fracker',
        previewingBase: true,
        previewAlpha: 0.52,
    }), 0.52);

    assert.equal(isReplacementBaseHoverPreview({
        nodeId: 'node-1',
        slotId: 'UpgradeSlotComponent',
        variantId: '',
        mode: 'replacement',
    }, 'node-1'), true);
});
