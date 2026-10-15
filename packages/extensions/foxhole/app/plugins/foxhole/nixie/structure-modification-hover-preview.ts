import type { FoxholeStructureAsset, FoxholeStructureModificationSlotAsset, FoxholeStructureModificationSlotVariantAsset } from './catalog.ts';
import type { FoxholeManifestStructure } from './manifest.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';
import { resolveFoxholeModificationSlotVariantId } from './modification-slots.ts';
import { prepareFoxholeModificationSelection } from './structure-mod-availability.ts';
import { resolveFoxholeModificationTextureLayer } from './modification-render-order.ts';
import type { FoxholeModificationTextureLayerOptions } from './modification-render-order.ts';

/** Reveal only interior hover previews; roof and upper-lane mods keep the roof. */
export function shouldHideRoofForModificationHoverPreview(
    hover: { slot: { z?: number | null; componentType?: string; }; variant: { id: string; isUpgrade?: boolean; }; } | null,
    options: FoxholeModificationTextureLayerOptions,
): boolean {
    if (!hover || hover.variant.isUpgrade || options.useStructureRenderLayers !== true) {
        return false;
    }
    const layer = resolveFoxholeModificationTextureLayer(hover.slot, hover.variant, options);
    return layer === 'lower' || layer === 'base';
}

export function resolveModificationTilePreviewSlot(
    availableSlots: readonly FoxholeStructureModificationSlotAsset[],
    selected: FoxholeStructureModificationSelectionMap,
): FoxholeStructureModificationSlotAsset | null {
    return availableSlots.find(slot => resolveFoxholeModificationSlotVariantId(slot, selected) !== null)
        ?? availableSlots[0]
        ?? null;
}

/** Apply placement conflicts to a temporary map; never modify the saved selections. */
export function resolveModificationHoverPreviewSelections(
    asset: Pick<FoxholeStructureAsset, 'modificationSlots' | 'modificationSlotById'>,
    selected: FoxholeStructureModificationSelectionMap,
    hover: { slot: FoxholeStructureModificationSlotAsset; variant: { id: string; }; } | null,
): FoxholeStructureModificationSelectionMap {
    return hover
        ? prepareFoxholeModificationSelection(asset, selected, hover.slot, hover.variant.id)
        : selected;
}

export type FoxholeModificationHoverPreviewMode = 'replacement' | 'overlay';

/** Adapt a conversion tile to the existing facility replacement preview renderer. */
export function createStructureAssetReplacementPreview(
    asset: FoxholeStructureAsset,
    structure: FoxholeManifestStructure,
    textureUrl: string,
): { slot: FoxholeStructureModificationSlotAsset; variant: FoxholeStructureModificationSlotVariantAsset; } {
    const variant: FoxholeStructureModificationSlotVariantAsset = {
        id: asset.foxholeKey, modificationId: null,
        name: asset.name, nameLocalizationId: asset.nameLocalizationId,
        description: asset.description, descriptionLocalizationId: asset.descriptionLocalizationId,
        requiredSocketConnectionMask: null, hiddenBySocketConnectionMask: null,
        textureUrl, iconUrl: asset.iconUrl, previewIconUrl: asset.previewIconUrl,
        previewUrl: asset.previewUrl, previewDirection: asset.previewDirection,
        textureWidth: asset.width, textureHeight: asset.height,
        anchorX: structure.sprite?.anchorX ?? null, anchorY: structure.sprite?.anchorY ?? null,
        offsetX: structure.sprite?.offsetX ?? null, offsetY: structure.sprite?.offsetY ?? null,
        renderLayers: asset.renderLayers, buildSockets: structure.buildSockets ?? [],
        selectionPolygons: [], lineOfSightPolygons: [], cost: asset.cost, totalCost: asset.totalCost,
        isUpgrade: true, upgradeName: asset.name, parentStructureId: null,
        rootStructureId: asset.rootStructureId, appliedModificationId: null,
    };
    return {
        variant,
        slot: { id: 'asset-preview', name: 'asset-preview', componentType: '',
            x: null, y: null, z: null, rotation: null, isLinkedToSocket: false,
            linkedSocketNames: [], blockedByModSlotNames: [], variants: [variant], variantById: { [variant.id]: variant } },
    };
}

/** Ghost alpha for structure/connector textures while a replacement upgrade is hovered. */
export const FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA = 0.52;

export interface FoxholeModificationHoverPreviewVariant {
    isUpgrade?: boolean;
    textureUrl?: string | null;
}

export interface FoxholeModificationHoverPreviewState {
    nodeId: string;
    slotId: string;
    variantId: string;
    mode?: FoxholeModificationHoverPreviewMode;
    targetAssetKey?: string;
}

export function shouldHideCargoForStructureHoverPreview(
    preview: FoxholeModificationHoverPreviewState | null | undefined,
    nodeId: string,
): boolean {
    return Boolean(preview && preview.nodeId === String(nodeId));
}

export function resolveStructureAssetHoverTargetKey(
    preview: FoxholeModificationHoverPreviewState | null | undefined,
    nodeId: string,
): string | null {
    if (preview?.nodeId !== String(nodeId) || preview.mode !== 'replacement') return null;
    return String(preview.targetAssetKey ?? '').trim() || null;
}

export function resolveModificationHoverPreviewMode(
    variant: FoxholeModificationHoverPreviewVariant,
    explicitMode?: FoxholeModificationHoverPreviewMode | null,
): FoxholeModificationHoverPreviewMode {
    if (explicitMode === 'replacement' || explicitMode === 'overlay') {
        return explicitMode;
    }

    return variant.isUpgrade === true ? 'replacement' : 'overlay';
}

export function isStructureReplacementModificationVariant(
    variant: FoxholeModificationHoverPreviewVariant,
): boolean {
    return variant.isUpgrade === true && Boolean(String(variant.textureUrl ?? '').trim());
}

/** Empty variantId with replacement mode means "preview the base / default upgrade". */
export function isReplacementBaseHoverPreview(
    preview: FoxholeModificationHoverPreviewState | null | undefined,
    nodeId: string,
): boolean {
    if (!preview || preview.nodeId !== String(nodeId)) {
        return false;
    }

    if (preview.mode !== 'replacement') {
        return false;
    }

    return String(preview.variantId ?? '').trim() === '';
}

export function resolveReplacementHoverPreviewAlpha(options: {
    hoverVariantId: string | null;
    appliedVariantId: string | null;
    previewingBase: boolean;
    previewAlpha: number;
}): number {
    if (options.previewingBase && options.appliedVariantId) {
        return options.previewAlpha;
    }

    if (options.hoverVariantId && options.hoverVariantId !== options.appliedVariantId) {
        return options.previewAlpha;
    }

    return 1;
}

export function resolveModificationVariantsForSocketOverlay<T extends {
    slot: { id: string; };
    variant: { id: string; isUpgrade?: boolean; };
}>(options: {
    selected: readonly T[];
    hoverReplacement: T | null;
    previewingBase: boolean;
}): T[] {
    if (options.previewingBase) {
        return options.selected.filter(selection => selection.variant.isUpgrade !== true);
    }

    if (options.hoverReplacement) {
        const hoverSlotId = options.hoverReplacement.slot.id;
        return [
            ...options.selected.filter(selection => (
                selection.slot.id !== hoverSlotId
                || selection.variant.isUpgrade !== true
            )),
            options.hoverReplacement,
        ];
    }

    return [...options.selected];
}

export function buildModificationHoverPreviewSignature(
    nodeId: string,
    preview: FoxholeModificationHoverPreviewState | null | undefined,
    boardRevision: string | number,
): string {
    if (!preview || preview.nodeId !== String(nodeId)) {
        return `${String(nodeId)}::${boardRevision}`;
    }

    return [
        preview.nodeId,
        preview.slotId,
        preview.variantId,
        preview.mode ?? 'overlay',
        preview.targetAssetKey ?? '',
        boardRevision,
    ].join(':');
}
