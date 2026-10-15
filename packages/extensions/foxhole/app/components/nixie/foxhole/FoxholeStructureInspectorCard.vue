<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import NixieAssetIncompleteBadge from '#nixie/components/nixie/NixieAssetIncompleteBadge.vue';
import NxMenu from '#nixie/components/NxMenu.vue';
import { checkboxMenuItem, sectionLabelMenuItem, separatorMenuItem } from '#nixie/utils/nx-resolved-menu-builders.ts';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { useNixieInspectorFormSectionTab } from '#nixie/composables/useNixieInspectorFormSectionCollapse.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import NxSegmentedTabs from '#nixie/components/NxSegmentedTabs.vue';
import FoxholeStructureUpgradesInspectorCard from './FoxholeStructureUpgradesInspectorCard.vue';
import FoxholeStructureCargoInspectorCard from './FoxholeStructureCargoInspectorCard.vue';
import FoxholeStructureProductionInspectorCard from './FoxholeStructureProductionInspectorCard.vue';
import { hasFoxholeHoldProfileItemSelection, resolveFoxholeAssetHoldProfile } from '#foxhole/plugins/foxhole/nixie/hold-profile.ts';
import { resolveFoxholeConversionSourceAsset } from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import { resolveFoxholeAssetCompletionMetadata } from '#foxhole/plugins/foxhole/nixie/asset-completion.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import { getFoxholeStructureAsset, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { isFoxholeStructureDestroyed, resolveFoxholeStructureDestroyedMutation } from '#foxhole/plugins/foxhole/nixie/structure-destroyed-actions.ts';
import { canDissolveHitboxPolygons } from '#foxhole/plugins/foxhole/nixie/hitbox-dissolve.ts';
import {
    FOXHOLE_ASSET_NODE_TYPE,
    normalizeFoxholeColorHex,
    normalizeFoxholeFaction,
} from '#foxhole/plugins/foxhole/nixie/types.ts';
import { buildFoxholeWikiPageUrl } from '#foxhole/plugins/foxhole/nixie/wiki.ts';
import { traceHitboxAlphaForHost } from '#nixie/plugins/nixie/contributions/actions/shared/hitbox-commands.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type {
    NixieAssetBrowserContext,
    NixieInspectorContributionNode,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/index.ts';
import { writeClipboardText } from '#nixie/plugins/nixie/clipboard.ts';
import { listHitboxChildren } from '#nixie/plugins/nixie/board/utils/hitbox-host.ts';
import {
    getHitboxHostSizeScale,
    readHitboxHostMetrics,
    scaleHitboxPointsToCurrentHostLocal,
} from '#nixie/plugins/nixie/board/utils/hitbox-texture.ts';
import type { NixieHitboxState } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { canAccessNixieDevFeatures, isNixieAdminUser } from '#nixie/utils/nixie-admin.ts';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
    node: NixieInspectorContributionNode<Record<string, unknown>>;
    canEdit: boolean;
    effectiveLocked: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
}>();

const upgradesCard = ref<InstanceType<typeof FoxholeStructureUpgradesInspectorCard> | null>(null);
const detailTabs = computed(() => {
    const tabs = [];
    const currentAsset = asset.value;
    const currentState = props.node.snapshot.state;
    if (
        [FOXHOLE_ASSET_NODE_TYPE, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE].includes(props.node.snapshot.type)
        && currentState.destroyed !== true && currentState.packaged !== true
        && currentAsset && !currentAsset.intactStructureId
        && (currentAsset.upgradeStructureId || currentAsset.downgradeStructureId
            || currentAsset.upgradeStructureCodeName || currentAsset.downgradeStructureCodeName
            || resolveFoxholeConversionSourceAsset(structureCatalog.value, currentAsset)
            || currentAsset.modificationSlots.some(slot => slot.variants.length > 0))
    ) {
        tabs.push({ id: 'upgrades', label: 'Upgrades' });
    }
    if (props.node.snapshot.type === FOXHOLE_ASSET_NODE_TYPE) {
        const structure = structureCatalog.value.structureByKey[foxholeKey.value];
        if (props.node.targetIds.length === 1 && (structure?.conversionEntries.length || structure?.parentStructureId)) {
            tabs.push({ id: 'production', label: 'Production' });
        }
        if (hasFoxholeHoldProfileItemSelection(resolveFoxholeAssetHoldProfile(structureCatalog.value, foxholeKey.value))) {
            tabs.push({ id: 'storage', label: 'Storage' });
        }
    }
    return tabs;
});
const activeTab = useNixieInspectorFormSectionTab(
    'foxhole.inspector.structure', 'details', 'upgrades',
    computed(() => detailTabs.value.map(tab => tab.id)),
);
const detailNavigationRef = ref<HTMLElement | null>(null);
const useDetailSelect = ref(false);
const detailSelectOptions = computed(() => detailTabs.value.map(tab => ({
    value: tab.id,
    label: tab.label,
})));
let detailNavigationResizeObserver: ResizeObserver | null = null;
let detailNavigationFrame = 0;

function updateDetailNavigationMode(): void {
    const navigation = detailNavigationRef.value;
    if (!navigation) {
        return;
    }

    const options = navigation.querySelectorAll<HTMLElement>('.nx-btn-group__option');
    useDetailSelect.value = Array.from(options).some(option => option.scrollWidth > option.clientWidth + 1);
}

function scheduleDetailNavigationModeUpdate(): void {
    cancelAnimationFrame(detailNavigationFrame);
    detailNavigationFrame = requestAnimationFrame(() => {
        detailNavigationFrame = 0;
        updateDetailNavigationMode();
    });
}

watch(detailNavigationRef, (navigation) => {
    detailNavigationResizeObserver?.disconnect();
    detailNavigationResizeObserver = null;
    if (navigation && typeof ResizeObserver !== 'undefined') {
        detailNavigationResizeObserver = new ResizeObserver(scheduleDetailNavigationModeUpdate);
        detailNavigationResizeObserver.observe(navigation);
    }
    scheduleDetailNavigationModeUpdate();
});

onBeforeUnmount(() => {
    detailNavigationResizeObserver?.disconnect();
    cancelAnimationFrame(detailNavigationFrame);
});

type FoxholeStructureSelectionEntry = {
    id: string;
    state: Partial<FoxholeStructureState>;
    foxholeKey: string;
    asset: ReturnType<typeof getFoxholeStructureAsset>;
};
type FoxholeStructureState = import('#foxhole/plugins/foxhole/nixie/types.ts').FoxholeStructureState;

type FoxholeHitboxInspectorEntry = {
    id: string;
    name: string;
    role: NixieHitboxState['role'];
    points: Array<{ x: number; y: number; }>;
};

const FOXHOLE_BOARD_PIXELS_PER_METER = 32;

const { assetBaseUrl, t } = useFoxholeLocalization();
const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();
const user = useSupabaseUser();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();
const structureCatalog = computed(() => getFoxholeStructureCatalog(assetBaseUrl.value));
const fittingHitboxId = ref<string | null>(null);

function canSelectionEntryToggleDestroyed(entry: FoxholeStructureSelectionEntry): boolean {
    return Boolean(entry.asset && (entry.asset.destroyedStructureId || entry.asset.intactStructureId || entry.asset.destroyed));
}

function isSelectionEntryDestroyed(entry: FoxholeStructureSelectionEntry): boolean {
    return isFoxholeStructureDestroyed(entry.asset, entry.state);
}

const selectionEntries = computed(() => {
    const snapshots = props.node.snapshots.length > 0
        ? props.node.snapshots
        : [props.node.snapshot];

    return snapshots.map<FoxholeStructureSelectionEntry>(snapshot => {
        const snapshotState = (snapshot.state ?? {}) as Partial<FoxholeStructureState>;
        const snapshotFoxholeKey = String(snapshotState.foxholeKey ?? '').trim();

        return {
            id: String(snapshot.id ?? ''),
            state: snapshotState,
            foxholeKey: snapshotFoxholeKey,
            asset: snapshotFoxholeKey ? getFoxholeStructureAsset(snapshotFoxholeKey, assetBaseUrl.value) : null,
        };
    });
});
const selectionCount = computed(() => selectionEntries.value.length);
const hasMultiTargetSelection = computed(() => props.node.targetIds.length > 1);
const uniformFoxholeKey = computed(() => {
    const keys = [...new Set(selectionEntries.value
        .map(entry => entry.foxholeKey)
        .filter(Boolean))];

    return keys.length === 1 ? keys[0] ?? '' : '';
});
const foxholeKey = computed(() => uniformFoxholeKey.value || String(props.node.snapshot.state?.foxholeKey ?? '').trim());
const state = computed(() => (props.node.snapshot.state ?? {}) as Partial<FoxholeStructureState>);
const asset = computed(() => foxholeKey.value ? getFoxholeStructureAsset(foxholeKey.value, assetBaseUrl.value) : null);
watch(detailTabs, async () => {
    await nextTick();
    scheduleDetailNavigationModeUpdate();
});
const canEdit = computed(() => props.canEdit && !props.effectiveLocked);
const destroyableEntries = computed(() => selectionEntries.value.filter(canSelectionEntryToggleDestroyed));
const destroyableTargetIds = computed(() => Array.from(new Set(destroyableEntries.value
    .map(entry => entry.id)
    .filter(Boolean))));
const canToggleDestroyed = computed(() => destroyableTargetIds.value.length > 0);
const destroyed = computed(() => canToggleDestroyed.value && destroyableEntries.value.every(isSelectionEntryDestroyed));
const hasAnyDestroyablePackagedState = computed(() => destroyableEntries.value.some(entry => entry.state.packaged === true));
const packageableEntries = computed(() => selectionEntries.value.filter(entry => Boolean(entry.asset?.packaged)));
const packageableTargetIds = computed(() => Array.from(new Set(packageableEntries.value
    .map(entry => entry.id)
    .filter(Boolean))));
const canPackage = computed(() => packageableTargetIds.value.length > 0);
const packaged = computed(() => canPackage.value && packageableEntries.value.every(entry => entry.state.packaged === true));
const hasAnyPackageableDestroyedState = computed(() => packageableEntries.value.some(entry => entry.state.destroyed === true));
const hasAnyPackageableBlueprintState = computed(() => packageableEntries.value.some(entry => entry.state.blueprint === true));
const blueprintableEntries = computed(() => selectionEntries.value.filter(entry => entry.asset?.canBlueprint === true));
const blueprintableTargetIds = computed(() => Array.from(new Set(blueprintableEntries.value
    .map(entry => entry.id)
    .filter(Boolean))));
const canBlueprint = computed(() => blueprintableTargetIds.value.length > 0);
const blueprint = computed(() => canBlueprint.value && blueprintableEntries.value.every(entry => entry.state.blueprint === true));
const hasAnyBlueprintablePackagedState = computed(() => blueprintableEntries.value.some(entry => entry.state.packaged === true));
const productionCapableEntries = computed(() => selectionEntries.value.filter(entry => {
    const structure = structureCatalog.value.structureByKey[entry.foxholeKey] ?? null;
    return Boolean(structure?.conversionEntries.length || structure?.parentStructureId);
}));
const productionCapableTargetIds = computed(() => Array.from(new Set(productionCapableEntries.value
    .map(entry => entry.id)
    .filter(Boolean))));
const canToggleProductionStats = computed(() => productionCapableTargetIds.value.length > 0);
const productionStatsEnabled = computed(() => (
    canToggleProductionStats.value && productionCapableEntries.value.every(entry => entry.state.disableProduction !== true)
));
const colorOptions = computed(() => asset.value?.colors ?? []);
const selectedColorHex = computed(() => {
    const normalizedStateColorHex = normalizeFoxholeColorHex(state.value.colorHex);
    if (normalizedStateColorHex && colorOptions.value.some(color => color.hex === normalizedStateColorHex)) {
        return normalizedStateColorHex;
    }

    return colorOptions.value[0]?.hex ?? null;
});
const selectedColor = computed(() => colorOptions.value.find(color => color.hex === selectedColorHex.value) ?? null);
const hasFactionVariants = computed(() => asset.value?.hasFactionVariants === true);
const selectedFaction = computed(() => normalizeFoxholeFaction(state.value.faction) ?? 'c');
const localizedName = computed(() => asset.value ? t(asset.value.nameLocalizationId, asset.value.name) : '');
const localizedDescription = computed(() => asset.value ? t(asset.value.descriptionLocalizationId, asset.value.description) : '');
const localizedCategory = computed(() => asset.value ? t(asset.value.categoryNameLocalizationId, asset.value.categoryName) : '');
const assetIdentifier = computed(() => foxholeKey.value ? `#${foxholeKey.value}` : '');
const wikiUrl = computed(() => {
    const currentAsset = asset.value;
    if (!currentAsset) {
        return '';
    }

    return buildFoxholeWikiPageUrl(currentAsset.upgradeName ?? currentAsset.name);
});
const selectionTitle = computed(() => selectionCount.value === 1
    ? 'Foxhole Node'
    : `${selectionCount.value} Foxhole Nodes`);
const selectionFoxholeKeys = computed(() => {
    const keys: string[] = [];
    const seen = new Set<string>();

    for (const entry of selectionEntries.value) {
        const key = entry.foxholeKey;
        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        keys.push(key);
    }

    return keys;
});
const selectionKeysClipboardValue = computed(() => selectionFoxholeKeys.value.join(','));
const hasFallbackSelectionBody = computed(() => !asset.value && hasMultiTargetSelection.value && (canToggleDestroyed.value || canPackage.value || canBlueprint.value || canToggleProductionStats.value));
const currentPreviewUrl = computed(() => {
    if (destroyed.value && asset.value?.destroyed?.previewUrl) {
        return asset.value.destroyed.previewUrl;
    }

    return selectedColor.value?.previewUrl ?? asset.value?.previewUrl ?? '';
});
const currentPreviewIconUrl = computed(() => {
    if (destroyed.value) {
        return asset.value?.destroyed?.previewIconUrl
            ?? asset.value?.destroyed?.iconUrl
            ?? asset.value?.previewIconUrl
            ?? asset.value?.iconUrl
            ?? '';
    }

    return selectedColor.value?.previewIconUrl
        ?? asset.value?.previewIconUrl
        ?? asset.value?.iconUrl
        ?? '';
});
const isAdminUser = computed(() => isNixieAdminUser(user.value));
const hitboxOverlayEnabled = computed(() => settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hitboxes, false) === true);
const canEditHitboxes = computed(() => canAccessNixieDevFeatures(isAdminUser.value) && hitboxOverlayEnabled.value && canEdit.value && Boolean(asset.value) && !hasMultiTargetSelection.value);
const canViewHitboxes = computed(() => canAccessNixieDevFeatures(isAdminUser.value) && hitboxOverlayEnabled.value && Boolean(asset.value) && !hasMultiTargetSelection.value);
const canExportHitboxHandoff = computed(() => canAccessNixieDevFeatures(isAdminUser.value)
    && hitboxOverlayEnabled.value
    && hasMultiTargetSelection.value
    && selectionEntries.value.some(entry => Boolean(entry.asset)));
const selectedStructureNode = computed(() => {
    if (!canViewHitboxes.value) {
        return null;
    }
    const project = runtime.project;
    if (!project) {
        return null;
    }
    void project.scene.revision.value;
    const nodeId = props.node.targetIds[0] ?? props.node.snapshot.id;
    return nodeId === undefined || nodeId === null ? null : project.scene.getNodeById(String(nodeId));
});
const hitboxEntries = computed<FoxholeHitboxInspectorEntry[]>(() => {
    // Child hitboxes change without replacing the selected host node, so track
    // scene mutations directly to keep the tables and their actions current.
    void runtime.project?.scene.revision.value;
    const structure = selectedStructureNode.value;
    if (!structure) {
        return [];
    }
    const metrics = readHitboxHostMetrics(structure);
    return listHitboxChildren(structure).map(hitbox => {
        const state = hitbox.boardState as NixieHitboxState;
        const localPoints = scaleHitboxPointsToCurrentHostLocal(
            state.points,
            Number(state.basisWidth) || metrics.width,
            Number(state.basisHeight) || metrics.height,
            metrics,
        );
        const points: Array<{ x: number; y: number; }> = [];
        for (let index = 0; index + 1 < localPoints.length; index += 2) {
            points.push({
                x: localPoints[index]! / FOXHOLE_BOARD_PIXELS_PER_METER,
                y: localPoints[index + 1]! / FOXHOLE_BOARD_PIXELS_PER_METER,
            });
        }
        return {
            id: String(hitbox.boardId),
            name: state.name || 'Hitbox',
            role: state.role,
            points,
        };
    });
});
const hasDissolvableHitboxTriangles = computed(() => {
    const polygonsByRole = new Map<NixieHitboxState['role'], number[][]>();
    for (const hitbox of hitboxEntries.value) {
        const polygons = polygonsByRole.get(hitbox.role) ?? [];
        polygons.push(hitbox.points.flatMap(point => [point.x, point.y]));
        polygonsByRole.set(hitbox.role, polygons);
    }
    return [...polygonsByRole.values()].some(polygons => canDissolveHitboxPolygons(polygons));
});
const copyStatus = ref<'idle' | 'copied' | 'error'>('idle');
const copyActionLabel = computed(() => {
    if (copyStatus.value === 'copied') {
        return `${assetIdentifier.value || 'Asset ID'} copied`;
    }
    if (copyStatus.value === 'error') {
        return 'Copy asset ID failed';
    }
    return `Copy ${assetIdentifier.value || 'asset ID'}`;
});
const copySelectionKeysActionLabel = computed(() => {
    const keyCount = selectionFoxholeKeys.value.length;
    const keyCountLabel = keyCount === 1 ? '1 asset key' : `${keyCount} asset keys`;

    if (copyStatus.value === 'copied') {
        return `${keyCountLabel} copied`;
    }
    if (copyStatus.value === 'error') {
        return 'Copy asset keys failed';
    }

    return `Copy ${keyCountLabel}`;
});
const assetBrowserContext = computed<NixieAssetBrowserContext>(() => {
    const projectSettings = runtime.projectStore.project?.settings.value ?? runtime.projectStore.settings;

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        searchQuery: null,
        appBaseUrl: runtimeConfig.app.baseURL,
        canEdit: props.canEdit,
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
const hoverAssetEntry = computed<NixieResolvedAssetEntry | null>(() => {
    const currentAsset = asset.value;
    if (!currentAsset) {
        return null;
    }

    const previewDirection = destroyed.value
        ? (currentAsset.destroyed?.previewDirection ?? currentAsset.previewDirection)
        : currentAsset.previewDirection;
    const displayName = localizedName.value || currentAsset.name;
    const description = localizedDescription.value || currentAsset.description || '';
    const categoryName = localizedCategory.value || currentAsset.categoryName;
    const previewUrl = currentPreviewUrl.value || '';
    const iconUrl = currentPreviewIconUrl.value || '';
    const usesDestroyedAppearance = destroyed.value && !currentAsset.intactStructureId;
    const assetId = packaged.value
        ? `${currentAsset.foxholeKey}:packaged`
        : usesDestroyedAppearance
            ? `${currentAsset.foxholeKey}:destroyed`
            : currentAsset.foxholeKey;

    return {
        sourceId: FOXHOLE_ASSET_SOURCE_ID,
        sourceName: 'Foxhole Assets',
        sourceDescription: 'Structures and item icons contributed by the Foxhole Planner addon.',
        asset: {
            id: assetId,
            type: props.node.type,
            name: displayName,
            description: description || undefined,
            previewUrl: previewUrl || undefined,
            category: categoryName,
            order: currentAsset.buildOrder,
            keywords: [
                currentAsset.foxholeKey,
                currentAsset.codeName,
                currentAsset.buildingKey,
                currentAsset.categoryKey,
                currentAsset.faction,
            ].filter(Boolean),
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
                previewDirection,
                categoryIcon: currentAsset.categoryIconUrl,
                categoryOrder: currentAsset.categoryOrder,
                categoryLocalizationId: currentAsset.categoryNameLocalizationId,
                nameLocalizationId: currentAsset.nameLocalizationId,
                descriptionLocalizationId: currentAsset.descriptionLocalizationId,
                itemIconUrl: iconUrl,
                previewIconUrl: iconUrl,
                assetIdentifier: `#${currentAsset.foxholeKey}`,
                assetClipboardValue: currentAsset.foxholeKey,
                defaultDestroyedState: usesDestroyedAppearance,
                defaultPackagedState: packaged.value,
                ...resolveFoxholeAssetCompletionMetadata(currentAsset.foxholeKey, currentAsset.categoryKey),
            },
            createSnapshot: async () => null,
        },
        displayName,
        description,
        previewUrl,
        icon: 'ph:factory',
        iconUrl,
        categoryName,
        categoryOrder: currentAsset.categoryOrder,
        searchText: currentAsset.searchText,
    };
});

let copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

function clearCopyStatusTimer(): void {
    if (copyStatusTimer !== null) {
        clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
    }
}

function setCopyStatus(status: 'copied' | 'error'): void {
    clearCopyStatusTimer();
    copyStatus.value = status;
    copyStatusTimer = setTimeout(() => {
        copyStatus.value = 'idle';
        copyStatusTimer = null;
    }, 1600);
}

async function copyAssetId(): Promise<void> {
    if (!foxholeKey.value) {
        return;
    }

    try {
        await writeClipboardText(foxholeKey.value);
        setCopyStatus('copied');
    } catch {
        setCopyStatus('error');
    }
}

function addHitbox(): void {
    void runtime.commands.execute('foxhole.lineOfSight.addHitbox');
}

function copyHitboxes(): void {
    void runtime.commands.execute('foxhole.lineOfSight.copyHitboxes');
}

function pasteHitboxes(): void {
    void runtime.commands.execute('foxhole.lineOfSight.pasteHitboxes');
}

function exportHitboxes(): void {
    void runtime.commands.execute('foxhole.lineOfSight.exportOverride');
}

function copyHitboxAgentPrompt(): void {
    void runtime.commands.execute('foxhole.lineOfSight.copyAgentPrompt');
}

function dissolveHitboxTriangles(): void {
    void runtime.commands.execute('foxhole.lineOfSight.dissolveTriangles');
}

function exportHitboxHandoff(): void {
    void runtime.commands.execute('foxhole.lineOfSight.exportHandoff');
}

watch(
    [canViewHitboxes, () => String(props.node.targetIds[0] ?? props.node.snapshot.id ?? '')],
    ([canView, nodeId]) => {
        if (canView && nodeId) {
            // Debug Hitboxes is the authoring mode: materialize only authored
            // source polygons, never a fallback rectangle, for direct editing.
            void runtime.commands.execute('foxhole.lineOfSight.ensureHitboxes');
        }
    },
    { immediate: true },
);

function formatHitboxCoordinate(value: number): string {
    return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

async function updateHitboxPoint(hitboxId: string, pointIndex: number, axis: 'x' | 'y', event: Event): Promise<void> {
    if (!canEditHitboxes.value) {
        return;
    }
    const value = Number((event.target as HTMLInputElement).value);
    const structure = selectedStructureNode.value;
    const hitbox = runtime.project?.scene.getNodeById(hitboxId);
    if (!structure || !hitbox || !Number.isFinite(value)) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const state = hitbox.boardState as NixieHitboxState;
    const points = state.points.slice();
    const { scaleX, scaleY } = getHitboxHostSizeScale(
        Number(state.basisWidth) || metrics.width,
        Number(state.basisHeight) || metrics.height,
        metrics,
    );
    const offset = (pointIndex * 2) + (axis === 'x' ? 0 : 1);
    points[offset] = (value * FOXHOLE_BOARD_PIXELS_PER_METER) / (axis === 'x' ? scaleX : scaleY);
    await runtime.project?.patchNode(hitboxId, { points }, 'inspector:foxhole-hitbox-point');
}

async function deleteHitboxPoint(hitboxId: string, pointIndex: number): Promise<void> {
    if (!canEditHitboxes.value) {
        return;
    }
    const hitbox = runtime.project?.scene.getNodeById(hitboxId);
    const state = hitbox?.boardState as NixieHitboxState | undefined;
    if (!state || state.points.length <= 6) {
        return;
    }
    const points = state.points.slice();
    points.splice(pointIndex * 2, 2);
    await runtime.project?.patchNode(hitboxId, { points }, 'inspector:foxhole-hitbox-delete-point');
}

async function deleteHitbox(hitboxId: string): Promise<void> {
    if (!canEditHitboxes.value) {
        return;
    }
    await runtime.project?.deleteNode(hitboxId, 'inspector:foxhole-hitbox-delete');
}

async function fitHitboxToTextureAlpha(hitboxId: string): Promise<void> {
    if (!canEditHitboxes.value || fittingHitboxId.value) {
        return;
    }
    const structure = selectedStructureNode.value;
    const hitbox = runtime.project?.scene.getNodeById(hitboxId);
    if (!structure || !hitbox) {
        return;
    }

    fittingHitboxId.value = hitboxId;
    try {
        const traced = await traceHitboxAlphaForHost(structure);
        if (!traced) {
            return;
        }
        await runtime.project?.patchNode(hitboxId, {
            points: traced.points,
            basisWidth: traced.basisWidth,
            basisHeight: traced.basisHeight,
        }, 'inspector:foxhole-hitbox-fit-alpha');
    } finally {
        fittingHitboxId.value = null;
    }
}

async function copySelectionKeys(): Promise<void> {
    const value = selectionKeysClipboardValue.value;
    if (!value) {
        return;
    }

    try {
        await writeClipboardText(value);
        setCopyStatus('copied');
    } catch {
        setCopyStatus('error');
    }
}

function showAssetHoverCard(): void {
    const entry = hoverAssetEntry.value;
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideAssetHoverCard(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}

async function patchEligibleSelectionTargets(
    targetIds: readonly string[],
    patch: Record<string, unknown>,
    reason: string,
): Promise<void> {
    const uniqueTargetIds = Array.from(new Set(targetIds.map(id => String(id ?? '').trim()).filter(Boolean)));
    if (!uniqueTargetIds.length) {
        return;
    }

    if (uniqueTargetIds.length === props.node.targetIds.length) {
        await props.patchNode(patch, reason);
        return;
    }

    if (uniqueTargetIds.length === 1) {
        await runtime.patchNode(uniqueTargetIds[0]!, patch, reason);
        return;
    }

    const project = runtime.project;
    if (!project) {
        return;
    }

    await runtime.patchNodes(uniqueTargetIds, patch, reason);
}

async function patchDestroyedSelectionEntry(
    entry: FoxholeStructureSelectionEntry,
    nextDestroyed: boolean,
    reason: string,
): Promise<void> {
    if (!entry.asset || !entry.id) {
        return;
    }

    const patch = resolveFoxholeStructureDestroyedMutation(structureCatalog.value, entry.state, nextDestroyed);
    if (patch) {
        await runtime.patchNode(entry.id, patch as Record<string, unknown>, reason);
    }
}

async function setDestroyedValue(nextValue: boolean): Promise<void> {
    if (!canToggleDestroyed.value || !canEdit.value) {
        return;
    }

    if (nextValue === destroyed.value) {
        return;
    }

    const reason = 'inspector:foxhole-structure-destroyed-toggle';
    const embeddedEntries = destroyableEntries.value.filter(entry => !entry.asset?.destroyedStructureId && !entry.asset?.intactStructureId);
    if (embeddedEntries.length > 0) {
        const patch: Partial<FoxholeStructureState> = { destroyed: nextValue };
        if (nextValue && hasAnyDestroyablePackagedState.value) {
            patch.packaged = false;
        }
        await patchEligibleSelectionTargets(embeddedEntries.map(entry => entry.id), patch as Record<string, unknown>, reason);
    }
    const pairedEntries = destroyableEntries.value.filter(entry => entry.asset?.destroyedStructureId || entry.asset?.intactStructureId);
    for (const entry of pairedEntries) {
        await patchDestroyedSelectionEntry(entry, nextValue, reason);
    }
}

async function setPackagedValue(nextValue: boolean): Promise<void> {
    if (!canPackage.value || !canEdit.value) {
        return;
    }

    if (nextValue === packaged.value) {
        return;
    }

    const patch: Partial<FoxholeStructureState> = {
        packaged: nextValue,
    };
    if (nextValue) {
        if (hasAnyPackageableDestroyedState.value) {
            patch.destroyed = false;
        }
        if (hasAnyPackageableBlueprintState.value) {
            patch.blueprint = false;
        }
    }

    await patchEligibleSelectionTargets(packageableTargetIds.value, patch as Record<string, unknown>, 'inspector:foxhole-structure-packaged-toggle');
}

async function setBlueprintValue(nextValue: boolean): Promise<void> {
    if (!canBlueprint.value || !canEdit.value) {
        return;
    }

    if (nextValue === blueprint.value) {
        return;
    }

    const patch: Partial<FoxholeStructureState> = {
        blueprint: nextValue,
    };
    if (nextValue && hasAnyBlueprintablePackagedState.value) {
        patch.packaged = false;
    }

    await patchEligibleSelectionTargets(blueprintableTargetIds.value, patch as Record<string, unknown>, 'inspector:foxhole-structure-blueprint-toggle');
}

const destroyedValue = computed({
    get: () => destroyed.value,
    set: value => {
        void setDestroyedValue(value);
    },
});

const packagedValue = computed({
    get: () => packaged.value,
    set: value => {
        void setPackagedValue(value);
    },
});

const blueprintValue = computed({
    get: () => blueprint.value,
    set: value => {
        void setBlueprintValue(value);
    },
});

const productionStatsValue = computed({
    get: () => productionStatsEnabled.value,
    set: value => {
        if (!canToggleProductionStats.value || !canEdit.value || value === productionStatsEnabled.value) {
            return;
        }
        void patchEligibleSelectionTargets(
            productionCapableTargetIds.value,
            { disableProduction: !value },
            'inspector:foxhole-structure-production-stats-toggle',
        );
    },
});

async function selectColorHex(colorHex: string): Promise<void> {
    if (!canEdit.value) {
        return;
    }

    const normalizedColorHex = normalizeFoxholeColorHex(colorHex);
    if (!normalizedColorHex || normalizedColorHex === selectedColorHex.value) {
        return;
    }

    await props.patchNode({
        colorHex: normalizedColorHex,
    }, 'inspector:foxhole-structure-color-select');
}

async function selectFaction(faction: 'c' | 'w'): Promise<void> {
    if (!canEdit.value || !hasFactionVariants.value || faction === selectedFaction.value) {
        return;
    }

    await props.patchNode({ faction }, 'inspector:foxhole-structure-faction-select');
}

onBeforeUnmount(() => {
    clearCopyStatusTimer();
    sidebarAssetHoverCard?.hideAsset();
});
const variantMenuPosition = ref<{ x: number; y: number; anchorTop: number; } | null>(null);
const variantMenuId = `foxhole-variants-${useId()}`;
function toggleVariantMenu(event: MouseEvent): void {
    if (variantMenuPosition.value) {
        variantMenuPosition.value = null;
        return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    variantMenuPosition.value = { x: bounds.right, y: bounds.bottom, anchorTop: bounds.top };
}
const namedColors = [
    ['Black', '000000'], ['White', 'ffffff'], ['Gray', '808080'], ['Silver', 'c0c0c0'],
    ['Red', 'b04040'], ['Orange', 'd08040'], ['Tan', 'c2a878'], ['Brown', '705030'],
    ['Green', '408040'], ['Olive', '808040'], ['Blue', '4080c0'], ['Navy', '203060'],
    ['Teal', '408080'], ['Purple', '804080'], ['Pink', 'd080a0'], ['Ivory', 'eee8c8'],
] as const;
function colorLabel(hex: string): string {
    const channels = (value: string) => [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
    const rgb = channels(hex);
    if (Math.max(...rgb) - Math.min(...rgb) < 20) {
        const brightness = rgb.reduce((sum, channel) => sum + channel, 0) / 3;
        return brightness < 32 ? 'Black' : brightness > 224 ? 'White' : brightness > 160 ? 'Silver' : 'Gray';
    }
    return namedColors.reduce((best, candidate) => {
        const distance = (value: string) => channels(value).reduce((sum, channel, index) => sum + (channel - rgb[index]!) ** 2, 0);
        return distance(candidate[1]) < distance(best[1]) ? candidate : best;
    })[0];
}
const variantMenuItems = computed<ResolvedMenuItem[]>(() => {
    const items: ResolvedMenuItem[] = [];
    const options = { disabled: !canEdit.value, closeOnClick: false };
    const variants: ResolvedMenuItem[] = [];
    if (canToggleDestroyed.value) {
        variants.push(checkboxMenuItem('Demolished', destroyedValue.value, () => {
            destroyedValue.value = !destroyedValue.value;
        }, { ...options, icon: 'ph:bomb' }));
    }
    if (canBlueprint.value) {
        variants.push(checkboxMenuItem('Blueprint', blueprintValue.value, () => {
            blueprintValue.value = !blueprintValue.value;
        }, { ...options, icon: 'ph:blueprint' }));
    }
    if (canPackage.value) {
        variants.push(checkboxMenuItem('Packaged', packagedValue.value, () => {
            packagedValue.value = !packagedValue.value;
        }, { ...options, icon: 'ph:package' }));
    }
    if (canToggleProductionStats.value) {
        variants.push(checkboxMenuItem('Production Stats', productionStatsValue.value, () => {
            productionStatsValue.value = !productionStatsValue.value;
        }, { ...options, icon: 'ph:chart-bar-horizontal' }));
    }
    if (variants.length) {
        items.push(sectionLabelMenuItem('Variants'), ...variants);
    }
    if (asset.value && hasFactionVariants.value) {
        if (items.length) {
            items.push(separatorMenuItem());
        }
        items.push(sectionLabelMenuItem('Faction'),
            checkboxMenuItem('Colonial', selectedFaction.value === 'c', () => selectFaction('c'), options),
            checkboxMenuItem('Warden', selectedFaction.value === 'w', () => selectFaction('w'), options));
    }
    if (asset.value && colorOptions.value.length) {
        if (items.length) {
            items.push(separatorMenuItem());
        }
        items.push(sectionLabelMenuItem('Color'));
        for (const color of colorOptions.value) {
            const item = checkboxMenuItem(colorLabel(color.hex), selectedColorHex.value === color.hex, () => selectColorHex(color.hex), { ...options, icon: 'ph:square-fill' });
            if (item.type === 'checkbox') {
                item.iconColor = `#${color.hex}`;
                item.badge = `#${color.hex.toUpperCase()}`;
            }
            items.push(item);
        }
    }
    return items;
});
watch(() => props.node.snapshot.id, () => {
    variantMenuPosition.value = null;
});
</script>

<template>
    <NixieSidebarFormSection
        class="foxhole-structure-card"
        title="Foxhole"
        sectionKey="foxhole.inspector.structure"
        collapsible
    >
        <template #actions>
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:arrow-down"
                :label="upgradesCard?.tierDownActionLabel ?? 'Tier Down'"
                :tooltip="upgradesCard?.tierDownActionLabel ?? 'Tier Down'"
                preserveLabelCase
                variant="bare"
                size="sm"
                :disabled="!upgradesCard?.tierDownMutation || !canEdit || upgradesCard?.pendingSelectionKey != null"
                @click="upgradesCard?.selectTierDown()"
                @mouseenter="upgradesCard?.showTierMutationHover(upgradesCard.tierDownMutation)"
                @focus="upgradesCard?.showTierMutationHover(upgradesCard.tierDownMutation)"
                @mouseleave="upgradesCard?.scheduleHideHoverEntry()"
                @blur="upgradesCard?.scheduleHideHoverEntry()"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:arrow-up"
                :label="upgradesCard?.tierUpActionLabel ?? 'Tier Up'"
                :tooltip="upgradesCard?.tierUpActionLabel ?? 'Tier Up'"
                preserveLabelCase
                variant="bare"
                size="sm"
                :disabled="!upgradesCard?.tierUpMutation || !canEdit || upgradesCard?.pendingSelectionKey != null"
                @click="upgradesCard?.selectTierUp()"
                @mouseenter="upgradesCard?.showTierMutationHover(upgradesCard.tierUpMutation)"
                @focus="upgradesCard?.showTierMutationHover(upgradesCard.tierUpMutation)"
                @mouseleave="upgradesCard?.scheduleHideHoverEntry()"
                @blur="upgradesCard?.scheduleHideHoverEntry()"
            />
            <span
                v-if="variantMenuItems.length"
                :data-nx-menu-trigger="variantMenuId"
                class="foxhole-structure-card__menu-trigger"
            >
                <NxIconButton
                    class="nixie-sidebar-row__action"
                    icon="ph:gear-six"
                    label="Variants"
                    tooltip="Variants"
                    :active="variantMenuPosition !== null"
                    variant="bare"
                    size="sm"
                    @click="toggleVariantMenu"
                />
            </span>
            <NxIconButton
                v-if="canExportHitboxHandoff"
                class="nixie-sidebar-row__action"
                icon="ph:export"
                label="Export Hitbox Handoff"
                tooltip="Export Hitbox Handoff"
                variant="bare"
                size="sm"
                @click="exportHitboxHandoff"
            />
        </template>
        <template v-if="asset || hasFallbackSelectionBody">
            <div
                class="foxhole-structure-card__summary"
                :class="{ 'foxhole-structure-card__summary--no-preview': !asset }"
            >
                <div
                    v-if="asset"
                    class="foxhole-structure-card__preview nixie-asset-icon-tile"
                    :class="{ 'is-hoverable': Boolean(hoverAssetEntry) }"
                    @mouseenter="showAssetHoverCard"
                    @mouseleave="scheduleHideAssetHoverCard"
                >
                    <img v-if="currentPreviewUrl" :src="currentPreviewUrl" :alt="localizedName">
                    <Icon v-else-if="asset.iconUrl" name="ph:factory" />
                    <NixieAssetIncompleteBadge v-if="hoverAssetEntry" :entry="hoverAssetEntry" />
                </div>
                <template v-if="asset">
                    <div class="foxhole-structure-card__details">
                        <div class="foxhole-structure-card__name">{{ localizedName }}</div>
                        <button
                            v-if="assetIdentifier"
                            type="button"
                            class="foxhole-structure-card__identifier-button"
                            :title="copyActionLabel"
                            :aria-label="copyActionLabel"
                            @click="copyAssetId"
                        >
                            <span>{{ assetIdentifier }}</span>
                            <Icon
                                :name="copyStatus === 'copied' ? 'ph:check' : copyStatus === 'error' ? 'ph:warning-circle' : 'ph:copy'"
                                class="foxhole-structure-card__inline-icon"
                            />
                        </button>
                        <a
                            v-if="wikiUrl"
                            class="foxhole-structure-card__wiki"
                            :href="wikiUrl"
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            wiki.gg
                            <Icon name="ph:arrow-square-out" class="foxhole-structure-card__inline-icon" />
                        </a>
                    </div>
                </template>
                <div v-else class="foxhole-structure-card__meta">
                    <div class="foxhole-structure-card__name">{{ selectionTitle }}</div>
                    <button
                        v-if="selectionKeysClipboardValue"
                        type="button"
                        class="foxhole-structure-card__identifier-button"
                        :title="copySelectionKeysActionLabel"
                        :aria-label="copySelectionKeysActionLabel"
                        @click="copySelectionKeys"
                    >
                        <span>{{ selectionKeysClipboardValue }}</span>
                        <Icon
                            :name="copyStatus === 'copied' ? 'ph:check' : copyStatus === 'error' ? 'ph:warning-circle' : 'ph:copy'"
                            class="foxhole-structure-card__inline-icon"
                        />
                    </button>
                    <div v-if="hasMultiTargetSelection" class="nixie-inspector-hint">
                        Batch edit the selected Foxhole nodes.
                    </div>
                </div>
            </div>

        </template>
        <p v-else class="nixie-inspector-hint">
            Foxhole structure metadata is unavailable for this node.
        </p>
        <div v-if="detailTabs.length" class="foxhole-structure-card__tabs">
            <div
                v-if="detailTabs.length > 1"
                ref="detailNavigationRef"
                class="foxhole-structure-card__detail-navigation"
            >
                <NxSegmentedTabs
                    v-model="activeTab"
                    class="foxhole-structure-card__detail-tabs"
                    :class="{ 'is-measuring': useDetailSelect }"
                    :items="detailTabs"
                    :aria-hidden="useDetailSelect ? 'true' : undefined"
                    :inert="useDetailSelect"
                    ariaLabel="Foxhole Details"
                    animated
                />
                <NxSelect
                    v-if="useDetailSelect"
                    v-model="activeTab"
                    class="foxhole-structure-card__detail-select"
                    :options="detailSelectOptions"
                    ariaLabel="Foxhole Details"
                    bare
                    compact
                />
            </div>
            <div v-else class="foxhole-structure-card__single-section-label">
                {{ detailTabs[0]?.label }}
            </div>
            <div
                v-if="detailTabs.some(tab => tab.id === 'upgrades')"
                v-show="activeTab === 'upgrades'"
                role="region"
                aria-label="Upgrades"
            >
                <FoxholeStructureUpgradesInspectorCard ref="upgradesCard" v-bind="props" bare />
            </div>
            <div
                v-if="detailTabs.some(tab => tab.id === 'production')"
                v-show="activeTab === 'production'"
                role="region"
                aria-label="Production"
            >
                <FoxholeStructureProductionInspectorCard v-bind="props" bare />
            </div>
            <div
                v-if="detailTabs.some(tab => tab.id === 'storage')"
                v-show="activeTab === 'storage'"
                role="region"
                aria-label="Storage"
            >
                <FoxholeStructureCargoInspectorCard v-bind="props" bare />
            </div>
        </div>
    </NixieSidebarFormSection>
    <NxMenu
        v-if="variantMenuPosition"
        :position="variantMenuPosition"
        :items="variantMenuItems"
        :sourceMenuId="variantMenuId"
        horizontalAlign="end"
        ariaLabel="Foxhole Variants"
        @close="variantMenuPosition = null"
    />

    <NixieSidebarFormSection
        v-if="canViewHitboxes"
        title="Hitboxes"
        sectionKey="foxhole.inspector.hitboxes"
        collapsible
    >
        <template #actions>
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:robot"
                label="Copy Agent Prompt"
                tooltip="Copy Agent Prompt"
                variant="bare"
                size="sm"
                :disabled="hitboxEntries.length === 0"
                @click="copyHitboxAgentPrompt"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:magic-wand"
                label="Dissolve Triangles"
                tooltip="Dissolve Triangles"
                variant="bare"
                size="sm"
                :disabled="!canEditHitboxes || !hasDissolvableHitboxTriangles"
                @click="dissolveHitboxTriangles"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:export"
                label="Export Hitboxes"
                tooltip="Export Hitboxes"
                variant="bare"
                size="sm"
                :disabled="hitboxEntries.length === 0"
                @click="exportHitboxes"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:copy"
                label="Copy Hitboxes"
                tooltip="Copy Hitboxes"
                variant="bare"
                size="sm"
                :disabled="hitboxEntries.length === 0"
                @click="copyHitboxes"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:clipboard"
                label="Paste Hitboxes"
                tooltip="Paste Hitboxes"
                variant="bare"
                size="sm"
                :disabled="!canEditHitboxes"
                @click="pasteHitboxes"
            />
            <NxIconButton
                class="nixie-sidebar-row__action"
                icon="ph:plus-circle"
                label="Add Hitbox"
                tooltip="Add Hitbox"
                variant="bare"
                size="sm"
                :disabled="!canEditHitboxes"
                @click="addHitbox"
            />
        </template>

        <p v-if="hitboxEntries.length === 0" class="nixie-inspector-hint">
            Add a hitbox to begin editing its points.
        </p>
        <section v-for="(hitbox, hitboxIndex) in hitboxEntries" :key="hitbox.id" class="foxhole-hitbox-table">
            <header class="foxhole-hitbox-table__header">
                <span>Hitbox {{ hitboxIndex + 1 }} · {{ hitbox.name }}</span>
                <div class="foxhole-hitbox-table__actions">
                    <button
                        type="button"
                        class="foxhole-hitbox-table__fit"
                        :disabled="!canEditHitboxes || fittingHitboxId !== null"
                        @click="fitHitboxToTextureAlpha(hitbox.id)"
                    >
                        {{ fittingHitboxId === hitbox.id ? 'Fitting…' : 'Fit Hitbox' }}
                    </button>
                    <button
                        type="button"
                        class="foxhole-hitbox-table__delete"
                        :disabled="!canEditHitboxes || fittingHitboxId !== null"
                        @click="deleteHitbox(hitbox.id)"
                    >
                        Delete Hitbox
                    </button>
                </div>
            </header>
            <div class="foxhole-hitbox-table__labels">
                <span>Point</span><span>X (m)</span><span>Y (m)</span><span />
            </div>
            <div v-for="(point, pointIndex) in hitbox.points" :key="pointIndex" class="foxhole-hitbox-table__row">
                <span>{{ pointIndex + 1 }}</span>
                <input
                    type="number"
                    step="0.001"
                    :value="formatHitboxCoordinate(point.x)"
                    :disabled="!canEditHitboxes"
                    :aria-label="`Hitbox ${hitboxIndex + 1}, point ${pointIndex + 1}, X in meters`"
                    @change="updateHitboxPoint(hitbox.id, pointIndex, 'x', $event)"
                >
                <input
                    type="number"
                    step="0.001"
                    :value="formatHitboxCoordinate(point.y)"
                    :disabled="!canEditHitboxes"
                    :aria-label="`Hitbox ${hitboxIndex + 1}, point ${pointIndex + 1}, Y in meters`"
                    @change="updateHitboxPoint(hitbox.id, pointIndex, 'y', $event)"
                >
                <button
                    type="button"
                    :disabled="!canEditHitboxes || hitbox.points.length <= 3"
                    :aria-label="`Delete point ${pointIndex + 1}`"
                    @click="deleteHitboxPoint(hitbox.id, pointIndex)"
                >
                    <Icon name="ph:trash" />
                </button>
            </div>
        </section>
    </NixieSidebarFormSection>
</template>

<style scoped>
.foxhole-structure-card__menu-trigger {
    display: inline-flex;
    align-items: center;
}

.foxhole-structure-card__tabs {
    display: grid;
    gap: var(--nx-space-2);
    padding-top: 0;
}

.foxhole-structure-card__detail-navigation {
    position: relative;
    flex-shrink: 0;
    min-width: 0;
}

.foxhole-structure-card__detail-tabs.is-measuring {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
}

.foxhole-structure-card__detail-select,
.foxhole-structure-card__detail-select :deep(.nx-select__trigger) {
    width: 100%;
}

.foxhole-structure-card__single-section-label {
    flex-shrink: 0;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    font-weight: 600;
}

.foxhole-structure-card__tabs > [role="region"] {
    padding-block: 2px;
}
.foxhole-structure-card__tabs :deep(.nx-segmented-tabs) {
    --nx-segmented-tabs-selected-background: var(--nx-accent-muted);
}

.foxhole-structure-card__tabs :deep(.nx-segmented-tabs .nx-btn-group) {
    gap: var(--nx-space-1);
    padding: 3px;
    border: 1px solid var(--nixie-sidebar-row-border);
    border-radius: var(--nx-radius-md);
    background: var(--nx-control-bg);
}

.foxhole-structure-card__tabs :deep(.nx-segmented-tabs .nx-btn-group__option) {
    min-height: var(--nx-control-height-sm);
    margin: 0;
    border: 0;
    border-radius: var(--nx-radius-sm);
    background: transparent;
    color: var(--nx-text-muted);
}

.foxhole-structure-card__tabs :deep(.nx-segmented-tabs .nx-btn-group__option.is-active) {
    color: var(--nx-accent-text);
    font-weight: 600;
}

.foxhole-structure-card__tabs :deep(.nx-segmented-tabs .nx-btn-group__option:hover:not(.is-active):not(:disabled)) {
    background: var(--nx-hover-surface);
    color: var(--nx-text);
}

.foxhole-structure-card__tabs :deep(.nx-segmented-tabs .nx-btn-group__option::before) {
    display: none;
}

.foxhole-structure-card__summary {
    display: flex;
    align-items: center;
    gap: var(--nx-space-2);
    min-width: 0;
}

.foxhole-structure-card__summary--no-preview {
    display: block;
}

.foxhole-structure-card__preview {
    position: relative;
    display: grid;
    flex: 0 0 56px;
    place-items: center;
    width: 56px;
    height: 56px;
    overflow: hidden;
    box-shadow: none;
    transition: box-shadow 120ms ease, transform 120ms ease;
}

.foxhole-structure-card__preview.is-hoverable {
    cursor: help;
}

.foxhole-structure-card__preview.is-hoverable:hover {
    transform: translateY(-1px);
    box-shadow:
        inset 0 0 0 1px var(--nx-border-focus),
        0 0 0 1px color-mix(in srgb, var(--nx-accent) 12%, transparent);
}

.foxhole-structure-card__preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.foxhole-structure-card__meta,
.foxhole-structure-card__details {
    display: grid;
    gap: 2px;
    align-content: center;
    flex: 1;
    min-width: 0;
}

.foxhole-structure-card__name {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--nx-text-md);
    font-weight: var(--nx-font-weight);
    line-height: 1.2;
    color: var(--nx-text);
}

.foxhole-structure-card__toggles {
    display: grid;
    gap: var(--nx-space-2);
    padding-top: var(--nx-space-2);
    border-top: 1px solid color-mix(in srgb, var(--nx-panel-border) 75%, transparent);
}

.foxhole-structure-card__toggles :deep(.nx-field--inline) {
    width: 100%;
}

.foxhole-structure-card__colors {
    display: grid;
    gap: var(--nx-space-2);
    width: 100%;
    padding-top: var(--nx-space-2);
    border-top: 1px solid color-mix(in srgb, var(--nx-panel-border) 75%, transparent);
}

.foxhole-structure-card__colors-label {
    font-size: var(--nx-text-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--nx-text-muted);
}

.foxhole-structure-card__color-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--nx-space-1);
}

.foxhole-structure-card__color-swatch {
    width: 22px;
    height: 22px;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    cursor: pointer;
    transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}

.foxhole-structure-card__color-swatch:hover {
    border-color: var(--nx-border-strong);
}

.foxhole-structure-card__color-swatch.is-active {
    border-color: var(--nx-accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--nx-accent) 24%, transparent);
}

.foxhole-structure-card__color-swatch:disabled {
    cursor: default;
    opacity: 0.7;
}

.foxhole-structure-card__faction {
    display: grid;
    gap: var(--nx-space-2);
    width: 100%;
    padding-top: var(--nx-space-2);
    border-top: 1px solid color-mix(in srgb, var(--nx-panel-border) 75%, transparent);
}

.foxhole-structure-card__faction-label {
    font-size: var(--nx-text-xs);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--nx-text-muted);
}

.foxhole-structure-card__faction-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--nx-space-1);
}

.foxhole-structure-card__faction-option {
    min-width: 0;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-input-bg);
    padding: 4px var(--nx-space-2);
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    cursor: pointer;
}

.foxhole-structure-card__faction-option:hover:not(:disabled) {
    border-color: var(--nx-border-strong);
    color: var(--nx-text);
}

.foxhole-structure-card__faction-option.is-active {
    border-color: var(--nx-accent);
    background: var(--nx-accent-muted);
    color: var(--nx-accent-muted-text);
}

.foxhole-structure-card__faction-option:disabled {
    cursor: default;
    opacity: 0.7;
}

.foxhole-structure-card__identifier-button,
.foxhole-structure-card__wiki {
    display: flex;
    justify-self: start;
    align-self: start;
    width: fit-content;
    align-items: center;
    gap: var(--nx-space-1);
    min-width: 0;
    max-width: 100%;
    border: none;
    background: none;
    padding: 0;
    color: var(--nx-text-muted) !important;
    transition: color 120ms ease, opacity 120ms ease;
}

.foxhole-structure-card__identifier-button {
    font-family: var(--nx-font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: var(--nx-text-xs);
    line-height: 1.2;
    text-align: left;
    cursor: pointer;
}

.foxhole-structure-card__identifier-button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.foxhole-structure-card__identifier-button:hover,
.foxhole-structure-card__wiki:hover,
.foxhole-structure-card__identifier-button:focus-visible,
.foxhole-structure-card__wiki:focus-visible {
    outline: none;
    color: var(--nx-text) !important;
}

.foxhole-structure-card__wiki {
    font-size: var(--nx-text-xs);
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
}

.foxhole-structure-card__inline-icon {
    flex: 0 0 auto;
    font-size: 10px;
}

.foxhole-structure-card__builder-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--nx-accent-muted);
    color: var(--nx-accent-muted-text);
    font-family: var(--nx-font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: var(--nx-text-xs);
    font-weight: 700;
    line-height: 1;
}

.foxhole-hitbox-table {
    display: grid;
    gap: var(--nx-space-1);
    padding: var(--nx-space-2);
    border: 1px solid var(--nx-panel-border);
    border-radius: var(--nx-radius-sm);
}

.foxhole-hitbox-table + .foxhole-hitbox-table {
    margin-top: var(--nx-space-2);
}

.foxhole-hitbox-table__header,
.foxhole-hitbox-table__labels,
.foxhole-hitbox-table__row {
    display: grid;
    grid-template-columns: minmax(42px, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr) auto;
    gap: var(--nx-space-1);
    align-items: center;
}

.foxhole-hitbox-table__header {
    grid-template-columns: minmax(0, 1fr) auto;
    font-size: var(--nx-text-xs);
    font-weight: 700;
    color: var(--nx-text);
}

.foxhole-hitbox-table__labels {
    color: var(--nx-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

.foxhole-hitbox-table__row {
    font-family: var(--nx-font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: var(--nx-text-xs);
}

.foxhole-hitbox-table input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-input-bg);
    padding: 3px 5px;
    color: var(--nx-text);
    font: inherit;
}

.foxhole-hitbox-table button {
    border: 0;
    border-radius: var(--nx-radius-sm);
    background: transparent;
    padding: 3px;
    color: var(--nx-text-muted);
    cursor: pointer;
}

.foxhole-hitbox-table button:not(.foxhole-hitbox-table__fit):hover:not(:disabled) {
    color: var(--nx-danger, #ef4444);
}

.foxhole-hitbox-table button:disabled,
.foxhole-hitbox-table input:disabled {
    cursor: default;
    opacity: 0.55;
}

.foxhole-hitbox-table__delete {
    font-size: var(--nx-text-xs);
}

.foxhole-hitbox-table__fit:hover:not(:disabled) {
    color: var(--nx-accent, #14b8a6);
}

.foxhole-hitbox-table__actions {
    display: flex;
    align-items: center;
    gap: var(--nx-space-2);
}
</style>
