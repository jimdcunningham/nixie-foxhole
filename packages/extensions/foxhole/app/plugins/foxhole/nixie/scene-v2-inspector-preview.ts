import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk';
import type { NixieSceneV2RenderPreview, NixieSceneV2StateAdapter } from '#nixie/utils/nixie-scene-v2-state-adapter-registry.ts';
import { previewNixieSceneV2EditableHandleUpdates } from '#nixie/utils/nixie-scene-v2-editable-handles.ts';
import { activeNixieStructureModificationHoverPreview } from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { getFoxholeStructureCatalog } from './catalog.ts';
import { normalizeFoxholeModificationSelectionMap, getFoxholeSelectedModificationSlotVariants } from './modification-slots.ts';
import { isStructureModificationHoverPreviewTarget, resolveModificationHoverPreviewSelections, shouldHideRoofForModificationHoverPreview,
    isStructureReplacementModificationVariant, resolveModificationHoverPreviewMode, resolveReplacementHoverPreviewAlpha,
    FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA } from './structure-modification-hover-preview.ts';
import type { FoxholeModificationHoverPreviewState } from './structure-modification-hover-preview.ts';
import type { FoxholeSceneV2AssetMetadata } from '../../../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import { readFoxholePreviewAsset } from '../../../utils/scene-v2-preview-assets.ts';

const OWNER = 'nixie.foxhole-planner';
export function buildFoxholeSceneV2RenderPreview(entity: NixieComponentEntitySnapshotV1,
    hover: FoxholeModificationHoverPreviewState | null, settings: Readonly<Record<string, boolean>>,
    metadata: FoxholeSceneV2AssetMetadata | undefined, adapter: Pick<NixieSceneV2StateAdapter, 'project' | 'patch'>): NixieSceneV2RenderPreview | null {
    if (!hover || !metadata || !isStructureModificationHoverPreviewTarget(hover, entity.entityId)) {
        return null;
    }
    const projected = adapter.project(entity);
    if (!projected || !['foxholeAsset', 'foxholeSplineConnector'].includes(projected.type)
        || projected.state.destroyed === true || projected.state.packaged === true) {
        return null;
    }
    const asset = getFoxholeStructureCatalog('/foxhole/assets/').assetByKey[String(projected.state.foxholeKey)];
    if (!asset) {
        return null;
    }
    const selected = normalizeFoxholeModificationSelectionMap(projected.state.modificationVariantIds);
    const patch: Record<string, unknown> = {};
    const preview: Omit<NixieSceneV2RenderPreview, 'entity'> = {};
    if (hover.mode === 'replacement' && hover.targetAssetKey) {
        if (!getFoxholeStructureCatalog('/foxhole/assets/').assetByKey[hover.targetAssetKey]) {
            return null;
        }
        patch.foxholeKey = hover.targetAssetKey;
        preview.opacity = hover.targetAssetKey === asset.foxholeKey ? 1 : FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA;
    } else if (hover.mode === 'replacement' && !hover.variantId) {
        patch.modificationVariantIds = Object.fromEntries(Object.entries(selected).filter(([slotId, variantId]) =>
            !asset.modificationSlotById[slotId]?.variantById[variantId]?.isUpgrade));
        preview.opacity = getFoxholeSelectedModificationSlotVariants(asset.modificationSlots, selected).some(entry => entry.variant.isUpgrade)
            ? FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA
            : 1;
    } else {
        const slot = asset.modificationSlotById[hover.slotId];
        const variant = slot?.variantById[hover.variantId];
        if (!slot || !variant) {
            return null;
        }
        patch.modificationVariantIds = resolveModificationHoverPreviewSelections(asset, selected, { slot, variant });
        if (resolveModificationHoverPreviewMode(variant, hover.mode) === 'replacement') {
            preview.opacity = resolveReplacementHoverPreviewAlpha({ hoverVariantId: variant.id, appliedVariantId: selected[slot.id] ?? null,
                previewingBase: false, previewAlpha: FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA });
        } else {
            const mod = metadata.modifications[slot.name]?.variants[variant.id];
            if (mod) {
                const opacity = variant.textureUrl ? FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA : 0.62;
                const shadow = metadata.contactShadows?.[mod.resourceId];
                preview.resourceOpacity = { [mod.resourceId]: opacity, ...(shadow ? { [shadow.resourceId]: opacity } : {}) };
            }
            preview.modelNodeOpacity = Object.fromEntries((metadata.model?.structuralProfile?.modifications ?? [])
                .filter(part => part.slotId === slot.name && part.variantId === variant.id)
                .flatMap(part => part.nodeNames.map(name => [name, FOXHOLE_MODIFICATION_HOVER_PREVIEW_TEXTURE_ALPHA])));
            const replacing = getFoxholeSelectedModificationSlotVariants(asset.modificationSlots, selected)
                .some(entry => isStructureReplacementModificationVariant(entry.variant));
            if (shouldHideRoofForModificationHoverPreview({ slot, variant }, { profileType: metadata.profileType,
                useStructureRenderLayers: settings['foxhole.structure.useStaticRender'] !== true && asset.renderLayers.length > 0 && !replacing })) {
                preview.settings = { 'foxhole.structure.hideRoofs': true };
            }
        }
    }
    const updates = adapter.patch(entity, patch).updates;
    const changed = previewNixieSceneV2EditableHandleUpdates(entity, updates);
    return { ...preview, entity: { ...changed, revision: entity.revision + 1,
        components: changed.components.filter(component => component.ownerId !== OWNER || !['cargo', 'production-order'].includes(component.componentId)) } };
}

let lastHover: FoxholeModificationHoverPreviewState | null = null;
let lastSettings: Readonly<Record<string, boolean>> | undefined;
let cache = new WeakMap<NixieComponentEntitySnapshotV1, { metadata: unknown; preview: NixieSceneV2RenderPreview | null; }>();
export function resolveFoxholeSceneV2RenderPreview(entity: NixieComponentEntitySnapshotV1,
    settings: Readonly<Record<string, boolean>>, adapter: Pick<NixieSceneV2StateAdapter, 'project' | 'patch'>): NixieSceneV2RenderPreview | null {
    const hover = activeNixieStructureModificationHoverPreview.value;
    if (!isStructureModificationHoverPreviewTarget(hover, entity.entityId)) {
        return null;
    }
    if (lastHover !== hover || lastSettings !== settings) {
        cache = new WeakMap();
        lastHover = hover;
        lastSettings = settings;
    }
    const asset = entity.components.find(component => component.ownerId === OWNER && component.componentId === 'asset')?.data.assetId
        ?? entity.components.find(component => component.ownerId === OWNER && component.componentId === 'spline-connector')?.data.foxholeKey;
    const metadata = readFoxholePreviewAsset(String(asset ?? ''));
    const cached = cache.get(entity);
    if (cached && cached.metadata === metadata) {
        return cached.preview;
    }
    const preview = buildFoxholeSceneV2RenderPreview(entity, hover, settings, metadata, adapter);
    cache.set(entity, { metadata, preview });
    if (preview) {
        cache.set(preview.entity, { metadata, preview });
    }
    return preview;
}
