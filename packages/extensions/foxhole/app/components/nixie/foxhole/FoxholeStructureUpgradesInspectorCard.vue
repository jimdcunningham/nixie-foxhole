<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { reconcileFoxholeAssetCargoPatch } from '#foxhole/plugins/foxhole/nixie/hold-profile.ts';
import NxMenu from '#nixie/components/NxMenu.vue';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import NixieAssetIncompleteBadge from '#nixie/components/nixie/NixieAssetIncompleteBadge.vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { resolveFoxholeAssetCompletionMetadata } from '#foxhole/plugins/foxhole/nixie/asset-completion.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import {
    getFoxholeStructureAsset,
    getFoxholeStructureCatalog,

} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import type { FoxholeStructureAsset, FoxholeStructureModificationSlotAsset, FoxholeStructureModificationSlotVariantAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    normalizeFoxholeModificationSelectionMap,
    reconcileFoxholeTierModificationSelections,
    resolveFoxholeModificationSlotVariantId,
    setFoxholeModificationSlotVariantSelection,
} from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import {
    buildFoxholeStructureModAvailabilityContext,
    collectFoxholeStructureModAvailabilitySceneNodes,
    filterAvailableModificationVariants,
    isFoxholeModificationVariantAvailable,
    prepareFoxholeModificationSelection,
} from '#foxhole/plugins/foxhole/nixie/structure-mod-availability.ts';
import {
    resolveFoxholeConversionSourceAsset,
    resolveFoxholeRelationshipAsset,
    resolveFoxholeRelationshipSelectionAsset,
    resolveFoxholeRelationshipUpgradeSourceAsset,
    resolveFoxholeStructureTierMutation,

} from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import type { FoxholeStructureTierMutation } from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FOXHOLE_STRUCTURE_NODE_TYPE, normalizeFoxholeStructureSocketAttachmentMap } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { resolveModificationTilePreviewSlot } from '#foxhole/plugins/foxhole/nixie/structure-modification-hover-preview.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type {
    NixieAssetBrowserContext,
    NixieInspectorContributionNode,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/index.ts';
import { setActiveNixieStructureModificationHoverPreview } from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

const props = defineProps<{
    bare?: boolean;
    node: NixieInspectorContributionNode;
    canEdit: boolean;
    effectiveLocked: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
}>();

const { assetBaseUrl, t } = useFoxholeLocalization();
const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();

const state = computed(() => (props.node.snapshot.state ?? {}) as Partial<FoxholeStructureState>);
const foxholeKey = computed(() => String(state.value.foxholeKey ?? '').trim());
const catalog = computed(() => getFoxholeStructureCatalog(assetBaseUrl.value));
const asset = computed(() => foxholeKey.value ? getFoxholeStructureAsset(foxholeKey.value, assetBaseUrl.value) : null);
const structure = computed(() => foxholeKey.value ? catalog.value.structureByKey[foxholeKey.value] : null);
const modAvailabilityContext = computed(() => {
    const currentAsset = asset.value;
    const currentStructure = structure.value;
    if (!currentAsset || !currentStructure) {
        return null;
    }

    const scene = runtime.projectStore.scene;
    const sceneNodes = scene
        ? [
            ...collectFoxholeStructureModAvailabilitySceneNodes(
                scene.getRoots(),
                catalog.value.structureByKey,
                FOXHOLE_STRUCTURE_NODE_TYPE,
            ),
            ...collectFoxholeStructureModAvailabilitySceneNodes(
                scene.getRoots(),
                catalog.value.structureByKey,
                FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
            ),
        ]
        : [];

    return buildFoxholeStructureModAvailabilityContext({
        nodeId: String(props.node.id),
        asset: currentAsset,
        buildSockets: currentStructure.buildSockets ?? [],
        socketAttachments: normalizeFoxholeStructureSocketAttachmentMap(state.value.socketAttachments),
        modificationVariantIds: selectionMap.value,
        sceneNodes,
    });
});
const canEdit = computed(() => props.canEdit && !props.effectiveLocked);
const selectionMap = computed(() => normalizeFoxholeModificationSelectionMap(state.value.modificationVariantIds));
const pendingSelectionKey = ref<string | null>(null);
const assetBrowserContext = computed<NixieAssetBrowserContext>(() => {
    const projectSettings = runtime.projectStore.project?.settings.value ?? runtime.projectStore.settings;

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        searchQuery: null,
        appBaseUrl: runtimeConfig.app.baseURL,
        canEdit: runtime.canEdit.value,
        projectSettings,
        getSetting: id => {
            try {
                return settingsStore.getValue(id);
            } catch {
                return undefined;
            }
        },
    };
});

function buildIconStyle(iconUrl: string): { backgroundImage: string; } {
    return {
        backgroundImage: `url(${iconUrl})`,
    };
}

function localizeAssetName(entry: FoxholeStructureAsset): string {
    return t(entry.nameLocalizationId, entry.name);
}

function localizeAssetDescription(entry: FoxholeStructureAsset): string {
    return t(entry.descriptionLocalizationId, entry.description);
}

function localizeAssetCategory(entry: FoxholeStructureAsset): string {
    return t(entry.categoryNameLocalizationId, entry.categoryName);
}

interface FoxholeStructureRelationshipTarget {
    key: string;
    codeName: string;
    asset: FoxholeStructureAsset | null;
}

interface FoxholeStructureExperimentalModificationEntry {
    slot: FoxholeStructureModificationSlotAsset;
    variant: FoxholeStructureModificationSlotVariantAsset;
}

interface FoxholeStructureExperimentalModificationGroup {
    key: string;
    variant: FoxholeStructureModificationSlotVariantAsset;
    slots: FoxholeStructureExperimentalModificationEntry[];
}

function createRelationshipTarget(
    codeName: string | null | undefined,
    assetId?: string | null,
): FoxholeStructureRelationshipTarget | null {
    const normalizedCodeName = String(codeName ?? '').trim();
    const normalizedAssetId = String(assetId ?? '').trim();
    if (!normalizedCodeName && !normalizedAssetId) {
        return null;
    }

    const resolvedAsset = resolveFoxholeRelationshipAsset(catalog.value, normalizedAssetId, normalizedCodeName);
    return {
        key: (resolvedAsset?.foxholeKey ?? normalizedAssetId) || normalizedCodeName,
        codeName: (resolvedAsset?.codeName ?? normalizedCodeName) || normalizedAssetId,
        asset: resolvedAsset,
    };
}

function normalizeRelationshipLookupValue(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

const upgradeSlots = computed(() => (
    asset.value?.modificationSlots.filter(slot => slot.variants.some(variant => variant.isUpgrade))
    ?? []
));

const experimentalModificationGroups = computed<FoxholeStructureExperimentalModificationGroup[]>(() => {
    const currentAsset = asset.value;
    const availabilityContext = modAvailabilityContext.value;
    if (!currentAsset || !availabilityContext) {
        return [];
    }

    const groups = new Map<string, FoxholeStructureExperimentalModificationGroup>();
    for (const slot of currentAsset.modificationSlots.filter(entry => !entry.variants.some(variant => variant.isUpgrade))) {
        for (const variant of filterAvailableModificationVariants(slot, availabilityContext)) {
            const key = [
                String(variant.modificationId ?? '').trim(),
                String(variant.id ?? '').trim(),
                localizeVariantName(variant),
            ].filter(Boolean).join(':') || `${slot.id}:${variant.id}`;
            const existingGroup = groups.get(key);
            if (existingGroup) {
                existingGroup.slots.push({ slot, variant });
                continue;
            }

            groups.set(key, {
                key,
                variant,
                slots: [{ slot, variant }],
            });
        }
    }

    return [...groups.values()];
});

const singleExperimentalModificationGroups = computed(() => (
    experimentalModificationGroups.value.filter(group => group.slots.length === 1)
));

const multiExperimentalModificationGroups = computed(() => (
    experimentalModificationGroups.value.filter(group => group.slots.length > 1)
));

const activeExperimentalModificationGroupKey = ref<string | null>(null);
const placementMenuPosition = ref<{ x: number; y: number; } | null>(null);
const activeExperimentalModificationGroup = computed(() => (
    multiExperimentalModificationGroups.value.find(group => group.key === activeExperimentalModificationGroupKey.value)
    ?? null
));
const placementMenuItems = computed<ResolvedMenuItem[]>(() => {
    const group = activeExperimentalModificationGroup.value;
    if (!group) return [];
    return [
        ...group.slots.map(entry => ({
            type: 'checkbox' as const,
            label: formatSlotName(entry.slot),
            checked: isSelectedUpgradeVariant(entry.slot, entry.variant),
            disabled: !canEdit.value || pendingSelectionKey.value !== null,
            visible: true, adminOnly: false,
            closeOnClick: false,
            onClick: () => toggleExperimentalSlotVariant(entry.slot, entry.variant),
        })),
        { type: 'separator', visible: true, adminOnly: false },
        {
            type: 'item', label: 'Clear Selection', color: 'red',
            disabled: !canEdit.value || pendingSelectionKey.value !== null
                || !group.slots.some(entry => isSelectedUpgradeVariant(entry.slot, entry.variant)),
            visible: true, adminOnly: false, closeOnClick: false,
            onClick: clearPlacementSelection,
        },
    ];
});

async function clearPlacementSelection(): Promise<void> {
    const group = activeExperimentalModificationGroup.value;
    if (!group || !canEdit.value || pendingSelectionKey.value !== null) return;
    const selected = group.slots.filter(entry => isSelectedUpgradeVariant(entry.slot, entry.variant));
    if (!selected.length) return;
    let nextSelections = selectionMap.value;
    for (const entry of selected) {
        nextSelections = setFoxholeModificationSlotVariantSelection(nextSelections, entry.slot, '');
    }
    setActiveNixieStructureModificationHoverPreview(null);
    pendingSelectionKey.value = `${group.key}:clear`;
    try {
        await props.patchNode({
            foxholeKey: getNormalizedModificationPatchFoxholeKey(), modificationVariantIds: nextSelections,
        }, 'inspector:foxhole-structure-clear-placement-selection');
    } finally {
        pendingSelectionKey.value = null;
    }
}

function closePlacementMenu(): void {
    placementMenuPosition.value = null;
    activeExperimentalModificationGroupKey.value = null;
    scheduleHideHoverEntry();
}

function previewPlacementMenuItem(item: ResolvedMenuItem | null): void {
    const entry = item
        ? activeExperimentalModificationGroup.value?.slots[placementMenuItems.value.indexOf(item)]
        : undefined;
    if (entry) showExperimentalSlotPreview(entry.slot, entry.variant);
    else setActiveNixieStructureModificationHoverPreview(null);
}

watch(() => props.node.id, closePlacementMenu);
watch(foxholeKey, closePlacementMenu);

const conversionSourceAsset = computed(() => {
    const currentAsset = asset.value;
    return currentAsset ? resolveFoxholeConversionSourceAsset(catalog.value, currentAsset) : null;
});

const tierUpMutation = computed(() => resolveFoxholeStructureTierMutation(catalog.value, state.value, 'up'));
const tierDownMutation = computed(() => resolveFoxholeStructureTierMutation(catalog.value, state.value, 'down'));

const relationshipTargets = computed(() => {
    const currentAsset = asset.value;
    const sourceAsset = conversionSourceAsset.value
        ?? (currentAsset ? resolveFoxholeRelationshipUpgradeSourceAsset(catalog.value, currentAsset) : null);
    if (!currentAsset) {
        return [] as FoxholeStructureRelationshipTarget[];
    }

    const tierUpTarget = tierUpMutation.value?.mode === 'tier-change'
        ? createRelationshipTarget(
            tierUpMutation.value.targetAsset.codeName,
            tierUpMutation.value.targetAsset.foxholeKey,
        )
        : null;
    const inheritedSourceUpgradeTarget = createRelationshipTarget(
        sourceAsset?.upgradeStructureCodeName,
        sourceAsset?.upgradeStructureId,
    );
    const seenTargets = new Set<string>();
    return [
        tierUpTarget,
        inheritedSourceUpgradeTarget,
        ...(sourceAsset?.conversionCodeNames.map(codeName => createRelationshipTarget(codeName)) ?? []),
    ]
        .filter((target): target is FoxholeStructureRelationshipTarget => Boolean(target))
        .filter(target => {
            const targetKey = normalizeRelationshipLookupValue(target.asset?.foxholeKey ?? target.codeName);
            if (seenTargets.has(targetKey)) {
                return false;
            }

            seenTargets.add(targetKey);
            return true;
        });
});

const hasUpgradeControls = computed(() => (
    relationshipTargets.value.length > 0
    || upgradeSlots.value.length > 0
    || experimentalModificationGroups.value.length > 0
));

const tierUpActionLabel = computed(() => tierUpMutation.value
    ? `Tier Up to ${localizeAssetName(tierUpMutation.value.targetAsset)}`
    : 'No higher tier available');

const tierDownActionLabel = computed(() => tierDownMutation.value
    ? `Tier Down to ${localizeAssetName(tierDownMutation.value.targetAsset)}`
    : 'No lower tier available');

function getNormalizedModificationPatchFoxholeKey(): string {
    const currentAsset = asset.value;
    if (currentAsset?.isUpgrade) {
        const parentKey = String(currentAsset.parentStructureId ?? '').trim();
        if (parentKey) {
            return parentKey;
        }
    }

    return foxholeKey.value;
}

function localizeVariantName(variant: FoxholeStructureModificationSlotVariantAsset): string {
    const localizedName = variant.nameLocalizationId ? t(variant.nameLocalizationId, variant.upgradeName ?? variant.name) : '';
    return localizedName || variant.upgradeName || variant.name;
}

function localizeVariantDescription(variant: FoxholeStructureModificationSlotVariantAsset): string {
    const localizedDescription = variant.descriptionLocalizationId
        ? t(variant.descriptionLocalizationId, variant.description)
        : '';
    return localizedDescription || variant.description;
}

function buildLocalizedUpgradeDisplayName(
    baseAsset: FoxholeStructureAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): string {
    const parentName = localizeAssetName(baseAsset);
    const upgradeName = localizeVariantName(variant);
    return `${parentName} (${upgradeName})`;
}

function formatSlotName(slot: FoxholeStructureModificationSlotAsset): string {
    const normalizedName = String(slot.name ?? '')
        .trim()
        .replace(/modslot$/i, '')
        .replace(/slot$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

    return normalizedName || 'Upgrade';
}

function getExperimentalRepresentativeSlot(group: FoxholeStructureExperimentalModificationGroup): FoxholeStructureModificationSlotAsset {
    return group.slots[0]!.slot;
}

function isExperimentalGroupButtonSelected(group: FoxholeStructureExperimentalModificationGroup): boolean {
    if (group.slots.length === 1) {
        return isSelectedUpgradeVariant(getExperimentalRepresentativeSlot(group), group.variant);
    }

    return activeExperimentalModificationGroupKey.value === group.key
        || group.slots.some(entry => isSelectedUpgradeVariant(entry.slot, entry.variant));
}

function getTierSelectionKey(nextAsset: FoxholeStructureAsset): string {
    return `tier:${nextAsset.foxholeKey}`;
}

function getTierMutationSelectionKey(mutation: FoxholeStructureTierMutation): string {
    return mutation.mode === 'clear-upgrade'
        ? `tier:clear-upgrade:${mutation.targetAsset.foxholeKey}`
        : getTierSelectionKey(mutation.targetAsset);
}

function getTierIconUrl(nextAsset: FoxholeStructureAsset): string {
    return nextAsset.iconUrl ?? asset.value?.iconUrl ?? '';
}

function isSelectedTierAsset(nextAsset: FoxholeStructureAsset): boolean {
    return nextAsset.foxholeKey === foxholeKey.value;
}

function getUpgradeVariants(slot: FoxholeStructureModificationSlotAsset): FoxholeStructureModificationSlotVariantAsset[] {
    const availabilityContext = modAvailabilityContext.value;
    if (!availabilityContext) {
        return slot.variants.filter(variant => variant.isUpgrade);
    }

    return filterAvailableModificationVariants(slot, availabilityContext).filter(variant => variant.isUpgrade);
}

function getUpgradeIconUrl(variant: FoxholeStructureModificationSlotVariantAsset | null): string {
    const currentAsset = asset.value;
    return variant
        ? (variant.iconUrl ?? currentAsset?.iconUrl ?? '')
        : (currentAsset?.iconUrl ?? '');
}

function getTierPreviewIconUrl(nextAsset: FoxholeStructureAsset): string {
    return nextAsset.previewIconUrl ?? nextAsset.iconUrl ?? '';
}

function getRelationshipDisplayName(target: FoxholeStructureRelationshipTarget): string {
    return target.asset
        ? localizeAssetName(target.asset)
        : target.codeName;
}

function getRelationshipMetaLabel(target: FoxholeStructureRelationshipTarget): string {
    if (!target.asset) {
        return 'Manifest only';
    }

    const parts = [target.asset.codeName];
    if (Number.isFinite(target.asset.tier)) {
        parts.push(`T${target.asset.tier}`);
    }

    return parts.join(' · ');
}

function getRelationshipTooltipLabel(target: FoxholeStructureRelationshipTarget): string {
    return getRelationshipDisplayName(target);
}

function getRelationshipIconUrl(target: FoxholeStructureRelationshipTarget): string {
    return target.asset ? getTierIconUrl(target.asset) : '';
}

function isSelectedRelationshipTarget(target: FoxholeStructureRelationshipTarget): boolean {
    return Boolean(target.asset && isSelectedTierAsset(target.asset));
}

function showRelationshipHoverCard(target: FoxholeStructureRelationshipTarget): void {
    if (target.asset && asset.value) {
        if (isSelectedRelationshipTarget(target)) {
            setActiveNixieStructureModificationHoverPreview(null);
            showHoverEntry(createTierHoverEntry(target.asset));
        } else {
            showTierAssetHoverCard(target.asset);
        }
    }
}

function getRelationshipHoverEntry(target: FoxholeStructureRelationshipTarget): NixieResolvedAssetEntry | null {
    return target.asset ? createTierHoverEntry(target.asset) : null;
}

function getExperimentalGroupHoverEntry(
    group: FoxholeStructureExperimentalModificationGroup,
): NixieResolvedAssetEntry | null {
    return createExperimentalHoverEntry(getExperimentalRepresentativeSlot(group), group.variant);
}

async function selectRelationshipTarget(target: FoxholeStructureRelationshipTarget): Promise<void> {
    if (target.asset && asset.value) {
        await selectTierAsset(resolveFoxholeRelationshipSelectionAsset(catalog.value, asset.value, target.asset));
    }
}

async function applyTierMutation(
    mutation: FoxholeStructureTierMutation | null | undefined,
    reason: string,
): Promise<void> {
    if (!mutation || !canEdit.value) {
        return;
    }

    pendingSelectionKey.value = getTierMutationSelectionKey(mutation);
    setActiveNixieStructureModificationHoverPreview(null);
    try {
        await props.patchNode(
            mutation.patch as Record<string, unknown>,
            reason,
        );
    } finally {
        pendingSelectionKey.value = null;
        setActiveNixieStructureModificationHoverPreview(null);
    }
}

async function selectTierUp(): Promise<void> {
    await applyTierMutation(tierUpMutation.value, 'inspector:foxhole-structure-tier-up');
}

async function selectTierDown(): Promise<void> {
    await applyTierMutation(tierDownMutation.value, 'inspector:foxhole-structure-tier-down');
}

function getUpgradePreviewIconUrl(variant: FoxholeStructureModificationSlotVariantAsset | null): string {
    const currentAsset = asset.value;
    return variant
        ? (variant.previewIconUrl ?? variant.iconUrl ?? currentAsset?.previewIconUrl ?? currentAsset?.iconUrl ?? '')
        : (currentAsset?.previewIconUrl ?? currentAsset?.iconUrl ?? '');
}

function createResolvedFoxholeHoverEntry(options: {
    id: string;
    assetIdentifier: string;
    displayName: string;
    description: string;
    categoryName: string;
    previewUrl?: string | null;
    iconUrl?: string | null;
    previewDirection?: string | null;
    order?: number | null;
    keywords?: Array<string | null | undefined>;
    metadata?: Record<string, unknown>;
    fallbackIcon: string;
}): NixieResolvedAssetEntry {
    const previewUrl = String(options.previewUrl ?? '').trim();
    const iconUrl = String(options.iconUrl ?? '').trim();

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        sourceName: 'Foxhole Assets',
        sourceDescription: 'Structures and item icons contributed by the Foxhole Planner addon.',
        asset: {
            id: options.id,
            name: options.displayName,
            description: options.description || undefined,
            previewUrl: previewUrl || undefined,
            category: options.categoryName,
            order: Number(options.order ?? 0),
            keywords: (options.keywords ?? []).filter((keyword): keyword is string => Boolean(String(keyword ?? '').trim())),
            metadata: {
                previewDirection: String(options.previewDirection ?? '').trim() || undefined,
                itemIconUrl: iconUrl || undefined,
                previewIconUrl: iconUrl || undefined,
                assetIdentifier: options.assetIdentifier,
                assetClipboardValue: options.assetIdentifier.replace(/^#/, ''),
                ...(options.metadata ?? {}),
            },
            createSnapshot: async () => null,
        },
        displayName: options.displayName,
        description: options.description,
        previewUrl,
        icon: options.fallbackIcon,
        iconUrl,
        categoryName: options.categoryName,
        categoryOrder: 0,
        searchText: [
            options.displayName,
            options.description,
            options.categoryName,
            ...(options.keywords ?? []),
        ].filter(Boolean).join(' ').toLowerCase(),
    };
}

function createTierHoverEntry(nextAsset: FoxholeStructureAsset): NixieResolvedAssetEntry {
    return createResolvedFoxholeHoverEntry({
        id: nextAsset.foxholeKey,
        assetIdentifier: `#${nextAsset.foxholeKey}`,
        displayName: localizeAssetName(nextAsset),
        description: localizeAssetDescription(nextAsset),
        categoryName: localizeAssetCategory(nextAsset),
        previewUrl: nextAsset.previewUrl,
        iconUrl: getTierPreviewIconUrl(nextAsset),
        previewDirection: nextAsset.previewDirection,
        order: nextAsset.buildOrder,
        keywords: [
            nextAsset.foxholeKey,
            nextAsset.codeName,
            nextAsset.buildingKey,
            nextAsset.categoryKey,
            nextAsset.faction,
            Number.isFinite(nextAsset.tier) ? `tier-${nextAsset.tier}` : null,
        ],
        metadata: {
            foxholeKey: nextAsset.foxholeKey,
            codeName: nextAsset.codeName,
            faction: nextAsset.faction,
            tier: nextAsset.tier,
            isVehicle: nextAsset.isVehicle,
            isBunker: nextAsset.isBunker,
            isFacility: nextAsset.isFacility,
            isWorldStructure: nextAsset.isWorldStructure,
            isDestroyed: nextAsset.isDestroyed,
            isBreached: nextAsset.isBreached,
            categoryIcon: nextAsset.categoryIconUrl,
            categoryOrder: nextAsset.categoryOrder,
            categoryLocalizationId: nextAsset.categoryNameLocalizationId,
            nameLocalizationId: nextAsset.nameLocalizationId,
            descriptionLocalizationId: nextAsset.descriptionLocalizationId,
            ...resolveFoxholeAssetCompletionMetadata(nextAsset.foxholeKey, nextAsset.categoryKey),
        },
        fallbackIcon: 'ph:buildings',
    });
}

function createUpgradeHoverEntry(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset | null,
): NixieResolvedAssetEntry | null {
    const currentAsset = asset.value;
    if (!currentAsset) {
        return null;
    }

    if (!variant) {
        return createTierHoverEntry(currentAsset);
    }

    return createResolvedFoxholeHoverEntry({
        id: `${currentAsset.foxholeKey}:${slot.id}:${variant.id}`,
        assetIdentifier: `#${currentAsset.foxholeKey}`,
        displayName: buildLocalizedUpgradeDisplayName(currentAsset, variant),
        description: localizeVariantDescription(variant),
        categoryName: localizeAssetCategory(currentAsset),
        previewUrl: variant.previewUrl ?? currentAsset.previewUrl,
        iconUrl: getUpgradePreviewIconUrl(variant),
        previewDirection: variant.previewDirection ?? currentAsset.previewDirection,
        order: currentAsset.buildOrder,
        keywords: [
            currentAsset.foxholeKey,
            currentAsset.codeName,
            currentAsset.buildingKey,
            currentAsset.categoryKey,
            currentAsset.faction,
            slot.id,
            variant.id,
            variant.upgradeName,
            variant.name,
        ],
        metadata: {
            foxholeKey: currentAsset.foxholeKey,
            codeName: currentAsset.codeName,
            faction: currentAsset.faction,
            tier: currentAsset.tier,
            isVehicle: currentAsset.isVehicle,
            isBunker: currentAsset.isBunker,
            isFacility: currentAsset.isFacility,
            isWorldStructure: currentAsset.isWorldStructure,
            isDestroyed: currentAsset.isDestroyed,
            isBreached: currentAsset.isBreached,
            isUpgrade: true,
            upgradeName: variant.upgradeName,
            slotId: slot.id,
            modificationVariantId: variant.id,
            parentStructureId: currentAsset.foxholeKey,
            rootStructureId: currentAsset.rootStructureId ?? currentAsset.foxholeKey,
            appliedModificationId: variant.appliedModificationId,
            categoryIcon: currentAsset.categoryIconUrl,
            categoryOrder: currentAsset.categoryOrder,
            categoryLocalizationId: currentAsset.categoryNameLocalizationId,
            ...resolveFoxholeAssetCompletionMetadata(currentAsset.foxholeKey, currentAsset.categoryKey),
        },
        fallbackIcon: 'ph:shapes',
    });
}

function createExperimentalHoverEntry(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): NixieResolvedAssetEntry | null {
    const currentAsset = asset.value;
    if (!currentAsset) {
        return null;
    }

    return createResolvedFoxholeHoverEntry({
        id: `${currentAsset.foxholeKey}:${slot.id}:${variant.id}`,
        assetIdentifier: `#${currentAsset.foxholeKey}`,
        displayName: localizeVariantName(variant),
        description: localizeVariantDescription(variant),
        categoryName: 'Modification',
        previewUrl: variant.previewUrl ?? currentAsset.previewUrl,
        iconUrl: getUpgradePreviewIconUrl(variant),
        previewDirection: variant.previewDirection ?? currentAsset.previewDirection,
        order: currentAsset.buildOrder,
        keywords: [
            currentAsset.foxholeKey,
            currentAsset.codeName,
            currentAsset.buildingKey,
            currentAsset.categoryKey,
            currentAsset.faction,
            slot.id,
            variant.id,
            variant.modificationId,
            variant.name,
        ],
        metadata: {
            foxholeKey: currentAsset.foxholeKey,
            codeName: currentAsset.codeName,
            faction: currentAsset.faction,
            tier: currentAsset.tier,
            isVehicle: currentAsset.isVehicle,
            isBunker: currentAsset.isBunker,
            isFacility: currentAsset.isFacility,
            isWorldStructure: currentAsset.isWorldStructure,
            isDestroyed: currentAsset.isDestroyed,
            isBreached: currentAsset.isBreached,
            isUpgrade: false,
            slotId: slot.id,
            slotName: formatSlotName(slot),
            modificationVariantId: variant.id,
            modificationId: variant.modificationId,
            parentStructureId: currentAsset.foxholeKey,
            rootStructureId: currentAsset.rootStructureId ?? currentAsset.foxholeKey,
            appliedModificationId: variant.appliedModificationId,
            categoryIcon: currentAsset.categoryIconUrl,
            categoryOrder: currentAsset.categoryOrder,
            categoryLocalizationId: currentAsset.categoryNameLocalizationId,
            ...resolveFoxholeAssetCompletionMetadata(currentAsset.foxholeKey, currentAsset.categoryKey),
        },
        fallbackIcon: 'ph:shapes',
    });
}

function showHoverEntry(entry: NixieResolvedAssetEntry | null): void {
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideHoverEntry(reason = 'unknown'): void {
    // Disabling the tile during pending selection blurs the button; ignore that
    // spurious blur so the hover card can stay up across toggle clicks.
    if (reason === 'blur' && pendingSelectionKey.value !== null) {
        return;
    }

    sidebarAssetHoverCard?.scheduleHideAsset();
    setActiveNixieStructureModificationHoverPreview(null);
}

function showTierAssetHoverCard(nextAsset: FoxholeStructureAsset): void {
    setActiveNixieStructureModificationHoverPreview({
        nodeId: props.node.id, slotId: 'asset-preview', variantId: nextAsset.foxholeKey,
        targetAssetKey: nextAsset.foxholeKey, mode: 'replacement',
    });
    showHoverEntry(createTierHoverEntry(nextAsset));
}

function showTierMutationHover(mutation: FoxholeStructureTierMutation | null): void {
    if (mutation) showTierAssetHoverCard(mutation.targetAsset);
}

function showUpgradeHoverCard(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset | null,
): void {
    // Selected tiles show information without previewing their removal.
    if (variant && isSelectedUpgradeVariant(slot, variant)) {
        setActiveNixieStructureModificationHoverPreview(null);
    } else {
        setActiveNixieStructureModificationHoverPreview({
            nodeId: props.node.id,
            slotId: slot.id,
            variantId: variant?.id ?? '',
            mode: 'replacement',
        });
    }
    showHoverEntry(createUpgradeHoverEntry(slot, variant));
}

function showExperimentalVariantHoverCard(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): void {
    setActiveNixieStructureModificationHoverPreview(null);
    showHoverEntry(createExperimentalHoverEntry(slot, variant));
}

function showExperimentalSingleSlotHover(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): void {
    setActiveNixieStructureModificationHoverPreview({
        nodeId: props.node.id,
        slotId: slot.id,
        variantId: variant.id,
    });
    showHoverEntry(createExperimentalHoverEntry(slot, variant));
}

function showExperimentalSlotPreview(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): void {
    setActiveNixieStructureModificationHoverPreview({
        nodeId: props.node.id,
        slotId: slot.id,
        variantId: variant.id,
    });
}

function getSelectedUpgradeVariantId(slot: FoxholeStructureModificationSlotAsset): string {
    return resolveFoxholeModificationSlotVariantId(slot, selectionMap.value) ?? '';
}

function isSelectedUpgradeVariant(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset | null,
): boolean {
    const selectedVariantId = getSelectedUpgradeVariantId(slot);
    return variant == null
        ? selectedVariantId === ''
        : selectedVariantId === variant.id;
}

function getUpgradeSelectionKey(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset | null,
): string {
    return variant == null
        ? `${slot.id}:default`
        : `${slot.id}:${variant.id}`;
}

async function selectTierAsset(nextAsset: FoxholeStructureAsset | null): Promise<void> {
    if (!nextAsset || !canEdit.value || nextAsset.foxholeKey === foxholeKey.value) {
        return;
    }

    activeExperimentalModificationGroupKey.value = null;
    pendingSelectionKey.value = getTierSelectionKey(nextAsset);
    setActiveNixieStructureModificationHoverPreview(null);
    try {
        await props.patchNode(
            reconcileFoxholeAssetCargoPatch(catalog.value, state.value, {
                foxholeKey: nextAsset.foxholeKey,
                modificationVariantIds: reconcileFoxholeTierModificationSelections(nextAsset.modificationSlots, selectionMap.value),
            }),
            'inspector:foxhole-structure-select-tier',
        );
    } finally {
        pendingSelectionKey.value = null;
        setActiveNixieStructureModificationHoverPreview(null);
    }
}

async function selectUpgradeVariant(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): Promise<void> {
    const availabilityContext = modAvailabilityContext.value;
    if (availabilityContext && !isFoxholeModificationVariantAvailable(variant, availabilityContext, slot)) {
        return;
    }

    if (!canEdit.value) {
        return;
    }

    activeExperimentalModificationGroupKey.value = null;
    const currentAsset = asset.value;
    if (!currentAsset) {
        return;
    }

    const alreadySelected = isSelectedUpgradeVariant(slot, variant);
    const reason = alreadySelected
        ? 'inspector:foxhole-structure-clear-upgrade'
        : 'inspector:foxhole-structure-select-upgrade';
    const nextSelections = alreadySelected
        ? setFoxholeModificationSlotVariantSelection(selectionMap.value, slot, '')
        : prepareFoxholeModificationSelection(currentAsset, selectionMap.value, slot, variant.id);
    const selectionKey = getUpgradeSelectionKey(slot, alreadySelected ? null : variant);
    pendingSelectionKey.value = selectionKey;
    setActiveNixieStructureModificationHoverPreview(null);
    try {
        await props.patchNode(
            {
                foxholeKey: getNormalizedModificationPatchFoxholeKey(),
                modificationVariantIds: nextSelections,
            },
            reason,
        );
    } finally {
        pendingSelectionKey.value = null;
        // Keep the info card, but never leave a preview over the committed result.
        setActiveNixieStructureModificationHoverPreview(null);
        showHoverEntry(createUpgradeHoverEntry(slot, variant));
    }
}

function showExperimentalGroupButtonHover(group: FoxholeStructureExperimentalModificationGroup): void {
    const previewSlot = resolveModificationTilePreviewSlot(group.slots.map(entry => entry.slot), selectionMap.value);
    if (!previewSlot) return;
    const previewVariant = group.slots.find(entry => entry.slot.id === previewSlot.id)!.variant;
    showExperimentalSingleSlotHover(previewSlot, previewVariant);
}

function activateExperimentalModificationGroup(group: FoxholeStructureExperimentalModificationGroup, event: MouseEvent): void {
    activeExperimentalModificationGroupKey.value = group.key;
    placementMenuPosition.value = { x: event.clientX, y: event.clientY };
    sidebarAssetHoverCard?.hideAsset();
    setActiveNixieStructureModificationHoverPreview(null);
}

async function selectExperimentalGroupButton(group: FoxholeStructureExperimentalModificationGroup, event: MouseEvent): Promise<void> {
    if (group.slots.length === 1) {
        activeExperimentalModificationGroupKey.value = null;
        await toggleExperimentalSlotVariant(getExperimentalRepresentativeSlot(group), group.variant);
        return;
    }

    activateExperimentalModificationGroup(group, event);
}

async function toggleExperimentalSlotVariant(
    slot: FoxholeStructureModificationSlotAsset,
    variant: FoxholeStructureModificationSlotVariantAsset,
): Promise<void> {
    const availabilityContext = modAvailabilityContext.value;
    if (!canEdit.value || (availabilityContext && !isFoxholeModificationVariantAvailable(variant, availabilityContext, slot))) {
        return;
    }

    const alreadySelected = isSelectedUpgradeVariant(slot, variant);
    const reason = alreadySelected
        ? 'inspector:foxhole-structure-clear-slot-modification'
        : 'inspector:foxhole-structure-select-slot-modification';
    const currentAsset = asset.value;
    if (!currentAsset) {
        return;
    }

    const nextSelections = alreadySelected
        ? setFoxholeModificationSlotVariantSelection(selectionMap.value, slot, '')
        : prepareFoxholeModificationSelection(currentAsset, selectionMap.value, slot, variant.id);
    const selectionKey = getUpgradeSelectionKey(slot, variant);
    pendingSelectionKey.value = selectionKey;
    try {
        await props.patchNode(
            {
                foxholeKey: getNormalizedModificationPatchFoxholeKey(),
                modificationVariantIds: nextSelections,
            },
            reason,
        );
    } finally {
        pendingSelectionKey.value = null;
    }
}

onBeforeUnmount(() => {
    sidebarAssetHoverCard?.hideAsset();
    setActiveNixieStructureModificationHoverPreview(null);
});
defineExpose({
    tierDownActionLabel, tierUpActionLabel, tierDownMutation, tierUpMutation,
    pendingSelectionKey, selectTierDown, selectTierUp,
    showTierMutationHover, scheduleHideHoverEntry,
});
</script>

<template>
    <NixieSidebarFormSection
        :bare="bare"
        title="Upgrades"
        sectionKey="foxhole.inspector.upgrades"
        collapsible
    >
        <template #actions>
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:arrow-down"
                :label="tierDownActionLabel"
                :tooltip="tierDownActionLabel"
                preserveLabelCase
                variant="bare"
                size="sm"
                :disabled="!tierDownMutation || !canEdit || pendingSelectionKey !== null"
                @click="selectTierDown"
                @mouseenter="showTierMutationHover(tierDownMutation)"
                @focus="showTierMutationHover(tierDownMutation)"
                @mouseleave="scheduleHideHoverEntry"
                @blur="scheduleHideHoverEntry"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:arrow-up"
                :label="tierUpActionLabel"
                :tooltip="tierUpActionLabel"
                preserveLabelCase
                variant="bare"
                size="sm"
                :disabled="!tierUpMutation || !canEdit || pendingSelectionKey !== null"
                @click="selectTierUp"
                @mouseenter="showTierMutationHover(tierUpMutation)"
                @focus="showTierMutationHover(tierUpMutation)"
                @mouseleave="scheduleHideHoverEntry"
                @blur="scheduleHideHoverEntry"
            />
        </template>

        <div v-if="hasUpgradeControls" class="foxhole-structure-upgrades">
            <div
                v-if="relationshipTargets.length > 0 || experimentalModificationGroups.length > 0"
                class="foxhole-structure-upgrades__grid"
            >
                <div
                    v-for="target in relationshipTargets"
                    :key="target.key"
                    class="nixie-build-icon-shell"
                >
                    <button
                        type="button"
                        class="nixie-build-icon"
                        :class="{ 'is-selected': isSelectedRelationshipTarget(target) }"
                        :disabled="!target.asset || !canEdit || pendingSelectionKey !== null"
                        :aria-pressed="isSelectedRelationshipTarget(target)"
                        :aria-label="getRelationshipTooltipLabel(target)"
                        :title="getRelationshipTooltipLabel(target)"
                        :data-tooltip="getRelationshipTooltipLabel(target)"
                        data-tooltip-position="top"
                        @mouseenter="showRelationshipHoverCard(target)"
                        @focus="showRelationshipHoverCard(target)"
                        @mouseleave="scheduleHideHoverEntry"
                        @blur="scheduleHideHoverEntry"
                        @click="selectRelationshipTarget(target)"
                    >
                        <div
                            v-if="getRelationshipIconUrl(target)"
                            class="build-icon-img"
                            :style="buildIconStyle(getRelationshipIconUrl(target))"
                        />
                        <div v-else class="build-icon-extension">
                            <Icon name="ph:arrows-left-right" />
                        </div>
                        <NixieAssetIncompleteBadge
                            v-if="getRelationshipHoverEntry(target)"
                            :entry="getRelationshipHoverEntry(target)!"
                        />
                    </button>
                </div>

                <div
                    v-for="group in experimentalModificationGroups"
                    :key="group.key"
                    class="nixie-build-icon-shell"
                >
                    <button
                        type="button"
                        class="nixie-build-icon"
                        :class="{ 'is-selected': isExperimentalGroupButtonSelected(group) }"
                        :disabled="!canEdit || pendingSelectionKey !== null"
                        :aria-pressed="isExperimentalGroupButtonSelected(group)"
                        :aria-label="localizeVariantName(group.variant)"
                        :title="localizeVariantName(group.variant)"
                        :data-tooltip="localizeVariantName(group.variant)"
                        data-tooltip-position="top"
                        @mouseenter="showExperimentalGroupButtonHover(group)"
                        @focus="showExperimentalGroupButtonHover(group)"
                        @mouseleave="scheduleHideHoverEntry"
                        @blur="scheduleHideHoverEntry"
                        @click="selectExperimentalGroupButton(group, $event)"
                    >
                        <div
                            v-if="getUpgradeIconUrl(group.variant)"
                            class="build-icon-img"
                            :style="buildIconStyle(getUpgradeIconUrl(group.variant))"
                        />
                        <div v-else class="build-icon-extension">
                            <Icon name="ph:shapes" />
                        </div>
                        <NixieAssetIncompleteBadge
                            v-if="getExperimentalGroupHoverEntry(group)"
                            :entry="getExperimentalGroupHoverEntry(group)!"
                        />
                    </button>
                </div>
            </div>

            <NxMenu
                v-if="placementMenuPosition && activeExperimentalModificationGroup"
                :items="placementMenuItems"
                :position="placementMenuPosition"
                :aria-label="`${localizeVariantName(activeExperimentalModificationGroup.variant)} Placement`"
                @item-hover="previewPlacementMenuItem"
                @close="closePlacementMenu"
            />

            <section
                v-for="slot in upgradeSlots"
                :key="slot.id"
                class="foxhole-structure-upgrades__slot"
            >
                <div v-if="upgradeSlots.length > 1" class="foxhole-structure-upgrades__slot-label">
                    {{ formatSlotName(slot) }}
                </div>
                <div class="foxhole-structure-upgrades__grid">
                    <div
                        v-for="variant in getUpgradeVariants(slot)"
                        :key="getUpgradeSelectionKey(slot, variant)"
                        class="nixie-build-icon-shell"
                    >
                        <button
                            type="button"
                            class="nixie-build-icon"
                            :class="{ 'is-selected': isSelectedUpgradeVariant(slot, variant) }"
                            :disabled="!canEdit || pendingSelectionKey !== null"
                            :aria-pressed="isSelectedUpgradeVariant(slot, variant)"
                            :aria-label="localizeVariantName(variant)"
                            :title="localizeVariantName(variant)"
                            :data-tooltip="localizeVariantName(variant)"
                            data-tooltip-position="top"
                            @mouseenter="showUpgradeHoverCard(slot, variant)"
                            @focus="showUpgradeHoverCard(slot, variant)"
                            @mouseleave="scheduleHideHoverEntry('mouseleave')"
                            @blur="scheduleHideHoverEntry('blur')"
                            @click="selectUpgradeVariant(slot, variant)"
                        >
                            <div
                                v-if="getUpgradeIconUrl(variant)"
                                class="build-icon-img"
                                :style="buildIconStyle(getUpgradeIconUrl(variant))"
                            />
                            <div v-else class="build-icon-extension">
                                <Icon name="ph:shapes" />
                            </div>
                            <NixieAssetIncompleteBadge
                                v-if="createUpgradeHoverEntry(slot, variant)"
                                :entry="createUpgradeHoverEntry(slot, variant)!"
                            />
                        </button>
                    </div>
                </div>
            </section>
        </div>
        <p v-else-if="!tierDownMutation && !tierUpMutation" class="nixie-inspector-hint">
            No manifest-backed upgrade, conversion, or modification data is available for this structure yet.
        </p>
    </NixieSidebarFormSection>
</template>

<style scoped>
.foxhole-structure-upgrades {
    display: grid;
    gap: var(--nx-space-2);
}

.foxhole-structure-upgrades__slot {
    display: grid;
    gap: var(--nx-space-2);
}

.foxhole-structure-upgrades__slot-label {
    font-size: var(--nx-text-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--nx-text-muted);
}

.foxhole-structure-upgrades__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: var(--nx-space-2);
}

</style>
