import type {
    FoxholeStructureAsset,
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
    FoxholeStructureRenderLayerAsset,
} from './catalog.ts';
import {
    getFoxholeSelectedModificationSlotVariants,
    normalizeFoxholeModificationSelectionMap,

} from './modification-slots.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';
import {
    isReplacementBaseHoverPreview,
    resolveModificationHoverPreviewMode,
    resolveReplacementHoverPreviewAlpha,
    resolveStructureAssetHoverTargetKey,
    FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,

} from './structure-modification-hover-preview.ts';
import type { FoxholeModificationHoverPreviewState } from './structure-modification-hover-preview.ts';

export function isSplineConnectorLayerReplacementVariant(
    variant: Pick<FoxholeStructureModificationSlotVariantAsset, 'isUpgrade' | 'renderLayers'>,
): boolean {
    return variant.isUpgrade === true && variant.renderLayers.length > 0;
}

export function remapFoxholeRenderLayersWithUpgrade(
    baseLayers: readonly FoxholeStructureRenderLayerAsset[],
    upgradeLayers: readonly FoxholeStructureRenderLayerAsset[],
): FoxholeStructureRenderLayerAsset[] {
    if (upgradeLayers.length === 0) {
        return [...baseLayers];
    }

    const upgradeById = new Map(
        upgradeLayers.map(layer => [String(layer.id ?? '').trim().toLowerCase(), layer]),
    );

    return baseLayers.map(layer => {
        const replacement = upgradeById.get(String(layer.id ?? '').trim().toLowerCase());
        if (!replacement) {
            return layer;
        }

        return {
            ...layer,
            textureUrl: replacement.textureUrl,
            width: replacement.width ?? layer.width,
            height: replacement.height ?? layer.height,
            anchorX: replacement.anchorX ?? layer.anchorX,
            anchorY: replacement.anchorY ?? layer.anchorY,
            offsetX: replacement.offsetX ?? layer.offsetX,
            offsetY: replacement.offsetY ?? layer.offsetY,
        };
    });
}

function resolveAppliedLayerReplacementSelection(
    asset: FoxholeStructureAsset,
    modificationVariantIds: FoxholeStructureModificationSelectionMap | null | undefined,
): {
    slot: FoxholeStructureModificationSlotAsset;
    variant: FoxholeStructureModificationSlotVariantAsset;
} | null {
    return getFoxholeSelectedModificationSlotVariants(
        asset.modificationSlots,
        normalizeFoxholeModificationSelectionMap(modificationVariantIds),
    ).find(selection => isSplineConnectorLayerReplacementVariant(selection.variant)) ?? null;
}

function resolveHoverLayerReplacementSelection(
    asset: FoxholeStructureAsset,
    preview: FoxholeModificationHoverPreviewState | null | undefined,
    nodeId: string,
): {
    slot: FoxholeStructureModificationSlotAsset;
    variant: FoxholeStructureModificationSlotVariantAsset;
} | null {
    if (!preview || preview.nodeId !== String(nodeId)) {
        return null;
    }

    if (isReplacementBaseHoverPreview(preview, nodeId)) {
        return null;
    }

    const slot = asset.modificationSlotById[String(preview.slotId ?? '').trim()];
    if (!slot) {
        return null;
    }

    const variant = slot.variantById[String(preview.variantId ?? '').trim()];
    if (!variant || !isSplineConnectorLayerReplacementVariant(variant)) {
        return null;
    }

    if (resolveModificationHoverPreviewMode(variant, preview.mode) !== 'replacement') {
        return null;
    }

    return { slot, variant };
}

export function resolveFoxholeSplineConnectorRenderLayers(options: {
    asset: FoxholeStructureAsset | null | undefined;
    targetAsset?: FoxholeStructureAsset | null;
    modificationVariantIds?: FoxholeStructureModificationSelectionMap | null;
    hoverPreview?: FoxholeModificationHoverPreviewState | null;
    nodeId?: string;
}): FoxholeStructureRenderLayerAsset[] {
    const targetKey = resolveStructureAssetHoverTargetKey(options.hoverPreview, String(options.nodeId ?? ''));
    if (targetKey && options.targetAsset?.foxholeKey === targetKey) return [...options.targetAsset.renderLayers];
    const asset = options.asset;
    const baseLayers = asset?.renderLayers ?? [];
    if (!asset || baseLayers.length === 0) {
        return [...baseLayers];
    }

    const nodeId = String(options.nodeId ?? '');
    if (isReplacementBaseHoverPreview(options.hoverPreview, nodeId)) {
        return [...baseLayers];
    }

    const effectiveSelection = resolveHoverLayerReplacementSelection(asset, options.hoverPreview, nodeId)
        ?? resolveAppliedLayerReplacementSelection(asset, options.modificationVariantIds);

    if (!effectiveSelection) {
        return [...baseLayers];
    }

    return remapFoxholeRenderLayersWithUpgrade(baseLayers, effectiveSelection.variant.renderLayers);
}

export function resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha(options: {
    asset: FoxholeStructureAsset | null | undefined;
    targetAsset?: FoxholeStructureAsset | null;
    modificationVariantIds?: FoxholeStructureModificationSelectionMap | null;
    hoverPreview?: FoxholeModificationHoverPreviewState | null;
    nodeId?: string;
    previewAlpha?: number;
}): number {
    const targetKey = resolveStructureAssetHoverTargetKey(options.hoverPreview, String(options.nodeId ?? ''));
    if (targetKey && options.targetAsset?.foxholeKey === targetKey && targetKey !== options.asset?.foxholeKey) {
        return options.previewAlpha ?? FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA;
    }
    const asset = options.asset;
    const nodeId = String(options.nodeId ?? '');
    if (!asset) {
        return 1;
    }

    const hover = resolveHoverLayerReplacementSelection(asset, options.hoverPreview, nodeId);
    const applied = resolveAppliedLayerReplacementSelection(asset, options.modificationVariantIds);
    return resolveReplacementHoverPreviewAlpha({
        hoverVariantId: hover?.variant.id ?? null,
        appliedVariantId: applied?.variant.id ?? null,
        previewingBase: isReplacementBaseHoverPreview(options.hoverPreview, nodeId),
        previewAlpha: options.previewAlpha ?? FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA,
    });
}
