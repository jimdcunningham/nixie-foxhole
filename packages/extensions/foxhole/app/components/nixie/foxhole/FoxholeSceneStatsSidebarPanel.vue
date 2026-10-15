<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, watch } from 'vue';
import FoxholeCostBreakdownList from '#foxhole/components/nixie/foxhole/FoxholeCostBreakdownList.vue';
import type { FoxholeCostBreakdownEntry } from '#foxhole/components/nixie/foxhole/FoxholeCostBreakdownList.vue';
import FoxholeStatsExportDialog from '#foxhole/components/nixie/foxhole/FoxholeStatsExportDialog.vue';
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { useNixieEditorDocumentSessionOptional } from '#nixie/composables/useNixieEditorDocumentSession.ts';
import { projectFoxholeSceneStatistics } from '#foxhole/plugins/foxhole/nixie/scene-statistics-adapter.ts';
import type {
    NixieAssetBrowserContext,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/types.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { useFoxholeStatsSidebarHeaderState } from '#foxhole/composables/foxholeStatsSidebarHeaderState.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import type { FoxholeItemAsset, FoxholeStructureAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    createFoxholeItemHoverEntry,
    createFoxholeStructureHoverEntry,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import {
    getFoxholeSelectedModificationSlotVariants,
    normalizeFoxholeModificationSelectionMap,
} from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import { deduplicateFoxholeBuildSockets } from '#foxhole/plugins/foxhole/nixie/structure-socket-resolution.ts';
import {
    accumulateFoxholeLiquidCapacity,
    createEmptyFoxholeLiquidCapacityBreakdown,
    resolveFoxholeLiquidCapacityKind,
    resolveFoxholeStructureLiquidCapacity,

} from '#foxhole/plugins/foxhole/nixie/liquid-capacity.ts';
import type { FoxholeLiquidCapacityBreakdown } from '#foxhole/plugins/foxhole/nixie/liquid-capacity.ts';
import {
    accumulateFoxholeFacilityPower,
    createEmptyFoxholeFacilityPowerBreakdown,
    resolveFoxholePowerDeltaMw,

} from '#foxhole/plugins/foxhole/nixie/facility-power.ts';
import type { FoxholeFacilityPowerBreakdown } from '#foxhole/plugins/foxhole/nixie/facility-power.ts';
import {
    FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS,
    FOXHOLE_MAINTENANCE_SUPPLIES_RESOURCE_KEY,
    formatFoxholeMaintenanceIntervalLabel,
    resolveFoxholeMaintenanceIntervalSeconds,
    resolveFoxholeMaintenanceSuppliesForInterval,
    resolveFoxholeMaintenanceSupplyDrain,
} from '#foxhole/plugins/foxhole/nixie/maintenance-supplies.ts';
import {
    buildFoxholeBunkerDestructionSummary,

} from '#foxhole/plugins/foxhole/nixie/bunker-destruction.ts';
import type { FoxholeBunkerDestructionSummary } from '#foxhole/plugins/foxhole/nixie/bunker-destruction.ts';
import {
    buildFoxholeBunkerHealthSummary,

} from '#foxhole/plugins/foxhole/nixie/bunker-health.ts';
import type { FoxholeBunkerHealthSummary } from '#foxhole/plugins/foxhole/nixie/bunker-health.ts';
import {
    buildFoxholeSocketNetworkIndex,
    resolveFoxholeSingleIntersectingSocketNetworkUnion,

} from '#foxhole/plugins/foxhole/nixie/structure-socket-networks.ts';
import type { FoxholeSocketNetworkSceneNode } from '#foxhole/plugins/foxhole/nixie/structure-socket-networks.ts';
import type { FoxholeStatsExportBunkerHealth, FoxholeStatsExportDestructionWeapon, FoxholeStatsExportScopePayload } from '#foxhole/plugins/foxhole/nixie/stats-export.ts';
import { FOXHOLE_STATS_SETTING_KEYS } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';
import {
    FOXHOLE_STRUCTURE_NODE_TYPE,
    normalizeFoxholeStructureSocketAttachmentMap,

} from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureSocketAttachmentMap } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeManifestBuildSocket } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import { aggregateFoxholeProduction } from '#foxhole/plugins/foxhole/nixie/production/aggregation.ts';
import type {
    FoxholeProductionAggregateResource,
    FoxholeStructureProductionInput,
} from '#foxhole/plugins/foxhole/nixie/production/aggregation.ts';

type StatsScopeId = 'selection' | 'layer' | 'scene';

type CatalogStructure = ReturnType<typeof getFoxholeStructureCatalog>['structureByKey'][string];
type SelectedModificationVariant = ReturnType<typeof getFoxholeSelectedModificationSlotVariants>[number];

interface FoxholeStatsNode {
    id: string;
    foxholeKey: string;
    structure: CatalogStructure;
    selectedVariants: SelectedModificationVariant[];
    buildSockets: FoxholeManifestBuildSocket[];
    socketAttachments: FoxholeStructureSocketAttachmentMap;
    productionState: FoxholeStructureProductionInput['state'];
}

interface ResourceSummary {
    id: string;
    key: string;
    quantity: number;
    item: FoxholeItemAsset | null;
    structure: FoxholeStructureAsset | null;
    direction: 'gain' | 'loss';
}

interface ScopeSummary {
    id: StatsScopeId;
    label: string;
    kicker: string;
    title: string;
    emptyTitle: string;
    emptyDetail: string;
    detail: string;
    nodeCount: number;
    vehicleCount: number;
    facilityCount: number;
    bunkerCount: number;
    missingCostCount: number;
    repairCost: number;
    inventorySlots: number;
    fuelCapacity: number;
    liquidCapacity: FoxholeLiquidCapacityBreakdown;
    facilityPower: FoxholeFacilityPowerBreakdown;
    maintenanceSuppliesPerHour: number;
    production: ReturnType<typeof aggregateFoxholeProduction>;
    averageStructuralIntegrity: number | null;
    costEntries: ResourceSummary[];
}

const runtime = useNixieRuntime();
const documentSession = useNixieEditorDocumentSessionOptional();
const ecsScopes = computed(() => {
    void documentSession?.sceneV2Editor.value?.revision;
    if (!documentSession?.isSceneV2Active.value) return null;
    const controller = documentSession.sceneV2Editor.value?.controller;
    return controller ? projectFoxholeSceneStatistics(controller.entities, controller.selection.ids, controller.activeLayerId) : { scene: [], selection: [], layer: [] };
});
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const registry = useNixieRegistry();
// Disabling the extension removes definitions before Vue unmounts the panel.
const readStatsSetting = (id: string) => registry.getSettingDefinition(id) ? settingsStore.getValue(id) : undefined;
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();
const { t } = useFoxholeLocalization();
const { exportDialogOpen, closeExportDialog, setScopeLabel } = useFoxholeStatsSidebarHeaderState();

const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
const structureCatalog = getFoxholeStructureCatalog(assetsBaseUrl);
const itemCatalog = getFoxholeItemCatalog(assetsBaseUrl);

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});
const decimalNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
});

const itemLookup = computed(() => {
    const lookup = new Map<string, FoxholeItemAsset>();
    for (const item of itemCatalog.assets) {
        for (const candidate of [item.foxholeKey, item.resourceKey, item.codeName, item.legacyKey]) {
            const normalizedKey = normalizeLookupKey(candidate);
            if (!normalizedKey || lookup.has(normalizedKey)) {
                continue;
            }

            lookup.set(normalizedKey, item);
        }
    }

    return lookup;
});

const enableSelectionStats = computed(() => (
    readStatsSetting(FOXHOLE_STATS_SETTING_KEYS.enableSelectionStats) !== false
));

const enableLayerStats = computed(() => (
    readStatsSetting(FOXHOLE_STATS_SETTING_KEYS.enableLayerStats) === true
));

const timeIntervalId = computed(() => {
    const value = String(readStatsSetting(FOXHOLE_STATS_SETTING_KEYS.timeInterval) ?? '').trim();
    return value === FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID
        || FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.some(option => option.id === value)
        ? value
        : FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID;
});

const customIntervalSeconds = computed(() => Number(
    readStatsSetting(FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds),
));

const maintenanceIntervalSeconds = computed(() => (
    resolveFoxholeMaintenanceIntervalSeconds(timeIntervalId.value, customIntervalSeconds.value)
));

const selectionNodes = computed<FoxholeStatsNode[]>(() => {
    if (ecsScopes.value) return ecsScopes.value.selection.map(resolveFoxholeStatsSnapshot).filter((node): node is FoxholeStatsNode => node !== null);
    const project = runtime.projectStore.project;
    if (!project) {
        return [];
    }

    void project.scene.revision.value;

    return runtime.selectedNodeSummaries.value
        .map(summary => resolveFoxholeStatsNode(project.scene.getNodeById(summary.id) ?? null))
        .filter((node): node is FoxholeStatsNode => node !== null);
});

const activeLayerNodes = computed<FoxholeStatsNode[]>(() => {
    if (ecsScopes.value) return ecsScopes.value.layer.map(resolveFoxholeStatsSnapshot).filter((node): node is FoxholeStatsNode => node !== null);
    const project = runtime.projectStore.project;
    const activeLayerId = runtime.activeLayerId.value;
    if (!project || !activeLayerId) {
        return [];
    }

    void project.scene.revision.value;

    const layerNode = project.scene.getNodeById(activeLayerId) ?? null;
    if (!layerNode) {
        return [];
    }

    return collectFoxholeStatsNodes((layerNode.boardChildren ?? []).slice());
});

const sceneNodes = computed<FoxholeStatsNode[]>(() => {
    if (ecsScopes.value) return ecsScopes.value.scene.map(resolveFoxholeStatsSnapshot).filter((node): node is FoxholeStatsNode => node !== null);
    const project = runtime.projectStore.project;
    if (!project) {
        return [];
    }

    void project.scene.revision.value;

    return collectFoxholeStatsNodes(project.scene.getRoots().slice());
});

const useSelectionScope = computed(() => (
    enableSelectionStats.value && selectionNodes.value.length > 0
));

const activeScopeId = computed<StatsScopeId>(() => {
    if (useSelectionScope.value) {
        return 'selection';
    }

    return enableLayerStats.value ? 'layer' : 'scene';
});

const selectionScope = computed(() => (
    buildScopeSummary('selection', 'Selection', 'Selected Nodes', selectionNodes.value, {
        emptyTitle: 'Nothing selected',
        emptyDetail: 'Select buildings to see their stats here.',
    })
));

const layerScope = computed(() => (
    buildScopeSummary('layer', 'Layer', 'Active Layer', activeLayerNodes.value, {
        emptyTitle: 'No active layer totals',
        emptyDetail: 'Activate a layer with Foxhole nodes to review aggregated totals for that layer.',
    })
));

const sceneScope = computed(() => (
    buildScopeSummary('scene', 'Scene', 'Scene Total', sceneNodes.value, {
        emptyTitle: 'No Foxhole nodes in scene',
        emptyDetail: enableSelectionStats.value
            ? 'Select buildings to see their stats here.'
            : 'Place buildings to see their stats here.',
    })
));

const activeScope = computed(() => {
    if (activeScopeId.value === 'selection') {
        return selectionScope.value;
    }

    if (activeScopeId.value === 'layer') {
        return layerScope.value;
    }

    return sceneScope.value;
});

watch(() => activeScope.value.label, label => {
    setScopeLabel(label);
}, { immediate: true });

const costBreakdownEntries = computed<FoxholeCostBreakdownEntry[]>(() => (
    activeScope.value.costEntries.map(resource => ({
        id: resource.id,
        name: localizeResourceName(resource),
        quantity: resource.quantity,
        iconUrl: resource.item?.iconUrl
            ?? resource.structure?.iconUrl
            ?? resource.structure?.previewIconUrl
            ?? null,
        item: resource.item,
        structure: resource.structure,
    }))
));

const maintenanceSuppliesAmount = computed(() => (
    resolveFoxholeMaintenanceSuppliesForInterval(
        activeScope.value.maintenanceSuppliesPerHour,
        maintenanceIntervalSeconds.value,
    )
));

const maintenanceBreakdownEntries = computed<FoxholeCostBreakdownEntry[]>(() => {
    if (!(maintenanceSuppliesAmount.value > 0)) {
        return [];
    }

    const item = itemLookup.value.get(FOXHOLE_MAINTENANCE_SUPPLIES_RESOURCE_KEY) ?? null;
    return [{
        id: FOXHOLE_MAINTENANCE_SUPPLIES_RESOURCE_KEY,
        name: item
            ? t(item.nameLocalizationId, item.name)
            : 'Maintenance Supplies',
        quantity: maintenanceSuppliesAmount.value,
        iconUrl: item?.iconUrl ?? null,
        item,
    }];
});

const hasFacilityPower = computed(() => {
    const power = activeScope.value.facilityPower;
    return power.producedMw > 0 || power.consumedMw > 0 || power.netMw !== 0;
});

const productionInputEntries = computed<FoxholeCostBreakdownEntry[]>(() => (
    activeScope.value.production.inputs.map(productionResourceToCostEntry)
));
const productionOutputEntries = computed<FoxholeCostBreakdownEntry[]>(() => (
    activeScope.value.production.outputs.map(productionResourceToCostEntry)
));

const liquidCapacityAssets = computed(() => {
    const silo = structureCatalog.assetByKey.facilitysilooil
        ?? structureCatalog.assetByKey.fuel_silo
        ?? null;
    const pipeline = structureCatalog.assetByKey.facilitypipe
        ?? structureCatalog.assetByKey.pipeline
        ?? null;

    return {
        silo,
        pipeline,
        siloIconUrl: silo?.iconUrl ?? silo?.previewIconUrl ?? null,
        pipelineIconUrl: pipeline?.iconUrl ?? pipeline?.previewIconUrl ?? null,
    };
});

const activeScopeNodes = computed<FoxholeStatsNode[]>(() => {
    if (activeScopeId.value === 'selection') {
        return selectionNodes.value;
    }

    if (activeScopeId.value === 'layer') {
        return activeLayerNodes.value;
    }

    return sceneNodes.value;
});

function toSocketNetworkSceneNode(node: FoxholeStatsNode): FoxholeSocketNetworkSceneNode {
    const structure = node.structure as CatalogStructure & {
        breachable?: boolean | null;
        structuralGarrison?: boolean | null;
    };

    return {
        nodeId: node.id,
        foxholeKey: node.foxholeKey,
        buildSockets: node.buildSockets,
        socketAttachments: node.socketAttachments,
        profileType: structure.profileType ?? null,
        structuralIntegrity: structure.structuralIntegrity ?? null,
        isBunker: structure.isBunker === true,
        isFacility: structure.isFacility === true,
        isDestroyed: structure.isDestroyed === true,
        isBreached: structure.isBreached === true,
        codeName: structure.codeName ?? null,
    };
}

/** Full-scene bunker graph so unions stay correct when scope is a partial selection. */
const sceneBunkerNetworkIndex = computed(() => (
    buildFoxholeSocketNetworkIndex(
        sceneNodes.value.map(toSocketNetworkSceneNode),
        'bunker',
    )
));

function resolveBunkerHealthForScopeNodes(
    scopeNodes: readonly FoxholeStatsNode[],
): FoxholeBunkerHealthSummary | null {
    const union = resolveFoxholeSingleIntersectingSocketNetworkUnion(
        sceneBunkerNetworkIndex.value,
        scopeNodes.map(node => node.id),
    );
    if (!union) {
        return null;
    }

    const nodesById = new Map(sceneNodes.value.map(node => [node.id, node] as const));
    const pieces = union.memberNodeIds.flatMap(nodeId => {
        const node = nodesById.get(nodeId);
        if (!node) {
            return [];
        }

        const structure = node.structure as CatalogStructure & {
            breachable?: boolean | null;
            structuralGarrison?: boolean | null;
        };

        return [{
            nodeId: node.id,
            maxHealth: structure.maxHealth,
            repairCost: structure.repairCost,
            structuralIntegrity: structure.structuralIntegrity,
            breachable: structure.breachable,
            structuralGarrison: structure.structuralGarrison,
            buildSockets: node.buildSockets,
            socketAttachments: node.socketAttachments,
        }];
    });

    return buildFoxholeBunkerHealthSummary(pieces);
}

function resolveBunkerDestructionForHealth(
    health: FoxholeBunkerHealthSummary | null,
): FoxholeBunkerDestructionSummary | null {
    if (!health) {
        return null;
    }

    return buildFoxholeBunkerDestructionSummary({
        maxHealth: health.rawMaxHealth,
        effectiveHealth: health.effectiveHealth,
        weapons: structureCatalog.bunkerDestructionWeapons,
        intervalSeconds: maintenanceIntervalSeconds.value,
    });
}

function resolveDestructionWeaponExportName(
    weapon: NonNullable<FoxholeBunkerDestructionSummary>['weapons'][number],
): string {
    const item = itemLookup.value.get(normalizeLookupKey(weapon.id))
        ?? itemLookup.value.get(normalizeLookupKey(weapon.codeName))
        ?? null;
    const authoredName = String(weapon.name ?? '').trim();
    const localizedName = item ? t(item.nameLocalizationId, item.name) : '';
    const authoredLooksLikeCodeName = !authoredName
        || authoredName.toLowerCase() === weapon.codeName.toLowerCase()
        || authoredName.toLowerCase() === weapon.id.toLowerCase();

    return (!authoredLooksLikeCodeName ? authoredName : null)
        || localizedName
        || authoredName
        || weapon.codeName;
}

function toExportBunkerHealth(
    health: FoxholeBunkerHealthSummary | null,
): FoxholeStatsExportBunkerHealth | null {
    if (!health) {
        return null;
    }

    return {
        totalHealth: health.effectiveHealth,
        repairCost: health.repairCost,
        repairRate: health.repairRate,
        breachableHealth: health.breachableHealth,
        breachableHealthPercent: health.breachableHealthPercent,
        structuralIntegrityPercent: health.structuralIntegrityPercent,
        structuralIntegrityClass: health.structuralIntegrityClass,
    };
}

function toExportBunkerDestruction(
    destruction: FoxholeBunkerDestructionSummary | null,
): { weapons: FoxholeStatsExportDestructionWeapon[]; } | null {
    if (!destruction || destruction.weapons.length === 0) {
        return null;
    }

    return {
        weapons: destruction.weapons.map(weapon => ({
            name: resolveDestructionWeaponExportName(weapon),
            t1: weapon.shots.t1,
            t2: weapon.shots.t2,
            t3: weapon.shots.t3,
            t3wet: weapon.shots.t3wet,
        })),
    };
}

function toExportScopePayload(scope: ScopeSummary): FoxholeStatsExportScopePayload {
    return {
        id: scope.id,
        label: scope.label,
        detail: scope.detail,
        nodeCount: scope.nodeCount,
        costEntries: scope.costEntries.map(entry => ({
            name: localizeResourceName(entry),
            category: localizeResourceMeta(entry),
            quantity: entry.quantity,
            direction: entry.direction,
        })),
        liquidCapacity: {
            total: scope.liquidCapacity.total,
            silo: scope.liquidCapacity.silo,
            pipeline: scope.liquidCapacity.pipeline,
        },
        facilityPower: {
            producedMw: scope.facilityPower.producedMw,
            consumedMw: scope.facilityPower.consumedMw,
            netMw: scope.facilityPower.netMw,
        },
        maintenanceSupplies: resolveFoxholeMaintenanceSuppliesForInterval(
            scope.maintenanceSuppliesPerHour,
            maintenanceIntervalSeconds.value,
        ),
        production: {
            activeOrderCount: scope.production.activeOrderCount,
            powerMw: scope.production.powerMw,
            inputs: scope.production.inputs.map(resource => ({
                name: productionResourceToCostEntry(resource).name,
                category: resource.channel,
                quantity: resource.quantity,
                direction: 'loss',
            })),
            outputs: scope.production.outputs.map(resource => ({
                name: productionResourceToCostEntry(resource).name,
                category: resource.channel,
                quantity: resource.quantity,
                direction: 'gain',
            })),
        },
        bunkerHealth: toExportBunkerHealth(scopedBunkerHealth.value),
        bunkerDestruction: toExportBunkerDestruction(singleBunkerDestruction.value),
    };
}

const scopedBunkerHealth = computed<FoxholeBunkerHealthSummary | null>(() => (
    resolveBunkerHealthForScopeNodes(activeScopeNodes.value)
));

const singleBunkerDestruction = computed<FoxholeBunkerDestructionSummary | null>(() => (
    resolveBunkerDestructionForHealth(scopedBunkerHealth.value)
));

const exportScopePayload = computed<FoxholeStatsExportScopePayload>(() => (
    toExportScopePayload(activeScope.value)
));

const bunkerDestructionShowsWetTier = computed(() => (
    (singleBunkerDestruction.value?.weapons ?? []).some(weapon => weapon.shots.t3wet != null)
));

const bunkerStructuralIntegrityClass = computed(() => {
    const integrityClass = scopedBunkerHealth.value?.structuralIntegrityClass;
    return integrityClass ? `is-si-${integrityClass}` : null;
});

const bunkerDestructionWeaponRows = computed(() => (
    (singleBunkerDestruction.value?.weapons ?? []).map(weapon => {
        const item = itemLookup.value.get(normalizeLookupKey(weapon.id))
            ?? itemLookup.value.get(normalizeLookupKey(weapon.codeName))
            ?? null;
        const authoredName = String(weapon.name ?? '').trim();
        const localizedName = item ? t(item.nameLocalizationId, item.name) : '';
        const authoredLooksLikeCodeName = !authoredName
            || authoredName.toLowerCase() === weapon.codeName.toLowerCase()
            || authoredName.toLowerCase() === weapon.id.toLowerCase();

        return {
            ...weapon,
            item,
            label: (!authoredLooksLikeCodeName ? authoredName : null)
                || localizedName
                || authoredName
                || weapon.codeName,
            iconUrl: item?.iconUrl ?? item?.previewIconUrl ?? null,
        };
    })
));

const timeIntervalLabel = computed(() => (
    formatFoxholeMaintenanceIntervalLabel(timeIntervalId.value, customIntervalSeconds.value)
));

onBeforeUnmount(() => {
    closeExportDialog();
    sidebarAssetHoverCard?.hideAsset();
});
onDeactivated(closeExportDialog);

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

function normalizeLookupKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function resolveFoxholeStatsNode(node: BoardNodeBase<any, any> | null | undefined): FoxholeStatsNode | null {
    const snapshot = node?.toBoardSnapshot?.();
    return snapshot ? resolveFoxholeStatsSnapshot(snapshot) : null;
}

function resolveFoxholeStatsSnapshot(snapshot: BoardNodeSnapshot): FoxholeStatsNode | null {
    if (!snapshot || snapshot.type !== FOXHOLE_STRUCTURE_NODE_TYPE) {
        return null;
    }

    const foxholeKey = String(snapshot.state?.foxholeKey ?? '').trim();
    if (!foxholeKey) {
        return null;
    }

    const structure = structureCatalog.structureByKey[foxholeKey] ?? null;
    const asset = structureCatalog.assetByKey[foxholeKey] ?? null;
    if (!structure || !asset) {
        return null;
    }

    const selectedVariants = getFoxholeSelectedModificationSlotVariants(
        asset.modificationSlots,
        normalizeFoxholeModificationSelectionMap(snapshot.state?.modificationVariantIds),
    );

    return {
        id: String(snapshot.id ?? ''),
        foxholeKey,
        structure,
        selectedVariants,
        buildSockets: deduplicateFoxholeBuildSockets(structure.buildSockets),
        socketAttachments: normalizeFoxholeStructureSocketAttachmentMap(snapshot.state?.socketAttachments),
        productionState: snapshot.state,
    };
}

function collectFoxholeStatsNodes(nodes: readonly BoardNodeBase<any, any>[]): FoxholeStatsNode[] {
    const entries: FoxholeStatsNode[] = [];
    const visit = (node: BoardNodeBase<any, any> | null | undefined): void => {
        if (!node) {
            return;
        }

        const entry = resolveFoxholeStatsNode(node);
        if (entry) {
            entries.push(entry);
        }

        for (const child of node.boardChildren ?? []) {
            visit(child);
        }
    };

    for (const node of nodes) {
        visit(node);
    }

    return entries;
}

function buildScopeSummary(
    id: StatsScopeId,
    label: string,
    kicker: string,
    nodes: readonly FoxholeStatsNode[],
    emptyState: {
        emptyTitle: string;
        emptyDetail: string;
    },
): ScopeSummary {
    const aggregatedCost = new Map<string, ResourceSummary>();
    let vehicleCount = 0;
    let facilityCount = 0;
    let bunkerCount = 0;
    let missingCostCount = 0;
    let repairCost = 0;
    let inventorySlots = 0;
    let fuelCapacity = 0;
    let structuralIntegrityTotal = 0;
    let structuralIntegrityCount = 0;
    const liquidCapacity = createEmptyFoxholeLiquidCapacityBreakdown();
    const facilityPower = createEmptyFoxholeFacilityPowerBreakdown();
    let maintenanceSuppliesPerHour = 0;
    const production = aggregateFoxholeProduction({
        nodes: nodes.map(node => ({ nodeId: node.id, state: node.productionState })),
        structureByKey: structureCatalog.structureByKey,
        baseAssetsUrl: assetsBaseUrl,
        intervalSeconds: maintenanceIntervalSeconds.value,
    });

    for (const node of nodes) {
        const structure = node.structure;
        if (structure.isVehicle === true) {
            vehicleCount += 1;
        }
        if (structure.isFacility === true) {
            facilityCount += 1;
        }
        if (structure.isBunker === true) {
            bunkerCount += 1;
        }

        let hasPublishedCost = false;
        const costSources = [
            structure.totalCost ?? structure.cost ?? {},
            ...node.selectedVariants.map(entry => entry.variant.cost ?? {}),
        ];

        for (const costSource of costSources) {
            for (const [resourceKey, resource] of Object.entries(costSource)) {
                const quantity = Number(resource?.quantity ?? 0);
                if (!Number.isFinite(quantity) || quantity <= 0) {
                    continue;
                }

                hasPublishedCost = true;
                const normalizedResourceKey = normalizeLookupKey(resourceKey);
                const existing = aggregatedCost.get(normalizedResourceKey);
                if (existing) {
                    existing.quantity += quantity;
                    continue;
                }

                const item = itemLookup.value.get(normalizedResourceKey) ?? null;
                const resourceStructure = item
                    ? null
                    : (structureCatalog.assetByKey[normalizedResourceKey] ?? null);

                aggregatedCost.set(normalizedResourceKey, {
                    id: normalizedResourceKey,
                    key: resourceKey,
                    quantity,
                    item,
                    structure: resourceStructure,
                    direction: 'loss',
                });
            }
        }

        if (!hasPublishedCost) {
            missingCostCount += 1;
        }

        repairCost += coerceMetricValue(structure.repairCost);
        inventorySlots += coerceMetricValue(structure.inventorySlots);
        fuelCapacity += (structure.fuelTanks ?? []).reduce((sum, tank) => sum + coerceMetricValue(tank.capacity), 0);

        const nodeLiquidCapacity = resolveFoxholeStructureLiquidCapacity({
            foxholeKey: node.foxholeKey,
            codeName: structure.codeName,
            legacyKey: structure.legacyKey,
            liquidCapacity: structure.liquidCapacity,
        });
        accumulateFoxholeLiquidCapacity(
            liquidCapacity,
            nodeLiquidCapacity,
            resolveFoxholeLiquidCapacityKind(node.foxholeKey, structure.codeName, structure.legacyKey),
        );

        accumulateFoxholeFacilityPower(
            facilityPower,
            production.powerMwByNodeId[node.id] ?? resolveFoxholePowerDeltaMw(structure.powerGridInfo?.powerDelta),
        );

        maintenanceSuppliesPerHour += resolveFoxholeMaintenanceSupplyDrain({
            decays: structure.decays,
            decaySupplyDrain: structure.decaySupplyDrain,
        });

        const structuralIntegrity = Number(structure.structuralIntegrity ?? NaN);
        if (Number.isFinite(structuralIntegrity) && structuralIntegrity > 0) {
            structuralIntegrityTotal += structuralIntegrity;
            structuralIntegrityCount += 1;
        }
    }

    const costEntries = Array.from(aggregatedCost.values())
        .sort((left, right) => {
            const nameComparison = localizeResourceName(left)
                .localeCompare(localizeResourceName(right), undefined, { sensitivity: 'base' });
            if (nameComparison !== 0) {
                return nameComparison;
            }

            return left.key.localeCompare(right.key, undefined, { sensitivity: 'base' });
        });

    return {
        id,
        label,
        kicker,
        title: `${kicker} Totals`,
        emptyTitle: emptyState.emptyTitle,
        emptyDetail: emptyState.emptyDetail,
        detail: buildScopeDetail(nodes.length, vehicleCount, facilityCount, bunkerCount),
        nodeCount: nodes.length,
        vehicleCount,
        facilityCount,
        bunkerCount,
        missingCostCount,
        repairCost,
        inventorySlots,
        fuelCapacity,
        liquidCapacity,
        facilityPower,
        maintenanceSuppliesPerHour,
        production,
        averageStructuralIntegrity: structuralIntegrityCount > 0
            ? structuralIntegrityTotal / structuralIntegrityCount
            : null,
        costEntries,
    };
}

function productionResourceToCostEntry(resource: FoxholeProductionAggregateResource): FoxholeCostBreakdownEntry {
    const item = itemLookup.value.get(normalizeLookupKey(resource.resourceId)) ?? null;
    return {
        id: `${resource.channel}:${resource.resourceId}`,
        name: item ? t(item.nameLocalizationId, item.name) : resource.resourceId,
        quantity: resource.quantity,
        iconUrl: item?.iconUrl ?? item?.previewIconUrl ?? null,
        item,
    };
}

function coerceMetricValue(value: number | null | undefined): number {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) ? normalized : 0;
}

function buildScopeDetail(nodeCount: number, vehicleCount: number, facilityCount: number, bunkerCount: number): string {
    const parts = [`${formatCount(nodeCount, 'node')}`];
    if (vehicleCount > 0) {
        parts.push(`${formatCount(vehicleCount, 'vehicle')}`);
    }
    if (facilityCount > 0) {
        parts.push(`${formatCount(facilityCount, 'facility', 'facilities')}`);
    }
    if (bunkerCount > 0) {
        parts.push(`${formatCount(bunkerCount, 'bunker')}`);
    }

    return parts.join(' • ');
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
    return `${wholeNumberFormatter.format(value)} ${value === 1 ? singular : plural}`;
}

function titleCaseIntegrityClass(value: string): string {
    if (!value) {
        return '';
    }

    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatLiquidVolume(value: number): string {
    return `${wholeNumberFormatter.format(value)} L`;
}

function formatPowerMw(value: number): string {
    const formattedValue = Number.isInteger(value)
        ? wholeNumberFormatter.format(value)
        : decimalNumberFormatter.format(value);

    return `${formattedValue} MW`;
}

function formatShotCount(value: number | null | undefined): string {
    if (value == null || !(value > 0)) {
        return '—';
    }

    return wholeNumberFormatter.format(value);
}

function formatFallbackLabel(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
}

function localizeResourceName(resource: ResourceSummary): string {
    if (resource.item) {
        return t(resource.item.nameLocalizationId, resource.item.name);
    }

    if (resource.structure) {
        return t(resource.structure.nameLocalizationId, resource.structure.name);
    }

    return formatFallbackLabel(resource.key);
}

function localizeResourceMeta(resource: ResourceSummary): string {
    if (resource.item) {
        return t(resource.item.categoryNameLocalizationId, resource.item.categoryName);
    }

    if (resource.structure) {
        return t(resource.structure.categoryNameLocalizationId, resource.structure.categoryName);
    }

    return resource.key;
}

function resolveDestructionItemLabel(item: FoxholeItemAsset | null, codename: string): string {
    return item ? t(item.nameLocalizationId, item.name) : codename;
}

function resolveDestructionItemDescription(item: FoxholeItemAsset | null): string {
    return item ? t(item.descriptionLocalizationId, item.description) : '';
}

function resolveDestructionItemCategory(item: FoxholeItemAsset | null): string {
    return item ? t(item.categoryNameLocalizationId, item.categoryName) : '';
}

function createDestructionHoverEntry(
    weapon: (typeof bunkerDestructionWeaponRows.value)[number],
): NixieResolvedAssetEntry | null {
    if (!weapon.item) {
        return null;
    }

    const codename = String(weapon.item.codeName ?? weapon.item.foxholeKey ?? weapon.id).trim();
    if (!codename) {
        return null;
    }

    return createFoxholeItemHoverEntry(
        weapon.item,
        codename,
        resolveDestructionItemLabel,
        resolveDestructionItemDescription,
        resolveDestructionItemCategory,
    );
}

function resolveStructureHoverLabel(structure: FoxholeStructureAsset): string {
    return t(structure.nameLocalizationId, structure.name);
}

function resolveStructureHoverDescription(structure: FoxholeStructureAsset): string {
    return t(structure.descriptionLocalizationId, structure.description);
}

function resolveStructureHoverCategory(structure: FoxholeStructureAsset): string {
    return t(structure.categoryNameLocalizationId, structure.categoryName);
}

function createLiquidCapacityHoverEntry(
    structure: FoxholeStructureAsset | null,
): NixieResolvedAssetEntry | null {
    if (!structure) {
        return null;
    }

    return createFoxholeStructureHoverEntry(
        structure,
        resolveStructureHoverLabel,
        resolveStructureHoverDescription,
        resolveStructureHoverCategory,
    );
}

function showLiquidCapacityHover(structure: FoxholeStructureAsset | null): void {
    const entry = createLiquidCapacityHoverEntry(structure);
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideLiquidCapacityHover(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}

function showDestructionWeaponHover(
    weapon: (typeof bunkerDestructionWeaponRows.value)[number],
): void {
    const entry = createDestructionHoverEntry(weapon);
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideDestructionWeaponHover(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}
</script>

<template>
    <div class="scene-stats-panel">
        <FoxholeStatsExportDialog
            :open="exportDialogOpen"
            :scope="exportScopePayload"
            :intervalLabel="timeIntervalLabel"
            @close="closeExportDialog"
        />

        <div class="scene-stats-panel__body nx-panel-body">
            <NxEmptyState
                v-if="activeScope.nodeCount === 0"
                :message="activeScope.emptyDetail"
            />

            <div
                v-else
                class="nixie-sidebar-form"
            >
                <NixieSidebarFormSection
                    title="Construction Cost"
                    sectionKey="foxhole.scene-stats.construction-cost"
                    collapsible
                >
                    <FoxholeCostBreakdownList
                        v-if="costBreakdownEntries.length > 0"
                        :entries="costBreakdownEntries"
                        flush
                    />

                    <NxEmptyState
                        v-else
                        message="No published construction costs are available for this scope yet."
                    />
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="activeScope.liquidCapacity.total > 0"
                    title="Liquid Capacity"
                    sectionKey="foxhole.scene-stats.liquid-capacity"
                    collapsible
                >
                    <ul class="scene-stats-panel__metric-list scene-stats-panel__metric-list--flush">
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:drop-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Total Capacity</span>
                            <span class="scene-stats-panel__metric-value is-total">
                                {{ formatLiquidVolume(activeScope.liquidCapacity.total) }}
                            </span>
                        </li>
                        <li
                            v-if="activeScope.liquidCapacity.silo > 0"
                            class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon"
                            @mouseenter="showLiquidCapacityHover(liquidCapacityAssets.silo)"
                            @mouseleave="scheduleHideLiquidCapacityHover"
                        >
                            <span class="scene-stats-panel__metric-icon is-silo" aria-hidden="true">
                                <NxEntityIcon
                                    v-if="liquidCapacityAssets.siloIconUrl"
                                    :src="liquidCapacityAssets.siloIconUrl"
                                    label="Liquid Silos"
                                />
                                <NxIcon
                                    v-else
                                    name="ph:oil"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Liquid Silos</span>
                            <span class="scene-stats-panel__metric-value is-silo">
                                {{ formatLiquidVolume(activeScope.liquidCapacity.silo) }}
                            </span>
                        </li>
                        <li
                            v-if="activeScope.liquidCapacity.pipeline > 0"
                            class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon"
                            @mouseenter="showLiquidCapacityHover(liquidCapacityAssets.pipeline)"
                            @mouseleave="scheduleHideLiquidCapacityHover"
                        >
                            <span class="scene-stats-panel__metric-icon is-pipeline" aria-hidden="true">
                                <NxEntityIcon
                                    v-if="liquidCapacityAssets.pipelineIconUrl"
                                    :src="liquidCapacityAssets.pipelineIconUrl"
                                    label="Pipelines"
                                />
                                <NxIcon
                                    v-else
                                    name="ph:pipe"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Pipelines</span>
                            <span class="scene-stats-panel__metric-value is-pipeline">
                                {{ formatLiquidVolume(activeScope.liquidCapacity.pipeline) }}
                            </span>
                        </li>
                    </ul>
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="hasFacilityPower"
                    title="Facility Power"
                    sectionKey="foxhole.scene-stats.facility-power"
                    collapsible
                >
                    <ul class="scene-stats-panel__metric-list scene-stats-panel__metric-list--flush">
                        <li
                            v-if="activeScope.facilityPower.producedMw > 0"
                            class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon"
                        >
                            <span class="scene-stats-panel__metric-icon is-power" aria-hidden="true">
                                <NxIcon
                                    name="nx:lightning"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Produced</span>
                            <span class="scene-stats-panel__metric-value is-power-produced">
                                {{ formatPowerMw(activeScope.facilityPower.producedMw) }}
                            </span>
                        </li>
                        <li
                            v-if="activeScope.facilityPower.consumedMw > 0"
                            class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon"
                        >
                            <span class="scene-stats-panel__metric-icon is-power" aria-hidden="true">
                                <NxIcon
                                    name="nx:lightning"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Consumed</span>
                            <span class="scene-stats-panel__metric-value is-power-consumed">
                                {{ formatPowerMw(activeScope.facilityPower.consumedMw) }}
                            </span>
                        </li>
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-power" aria-hidden="true">
                                <NxIcon
                                    name="nx:lightning"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Net Total</span>
                            <span
                                class="scene-stats-panel__metric-value"
                                :class="activeScope.facilityPower.netMw >= 0 ? 'is-power-produced' : 'is-power-consumed'"
                            >
                                {{ formatPowerMw(activeScope.facilityPower.netMw) }}
                            </span>
                        </li>
                    </ul>
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="activeScope.maintenanceSuppliesPerHour > 0"
                    title="Building Maintenance"
                    sectionKey="foxhole.scene-stats.building-maintenance"
                    collapsible
                >
                    <FoxholeCostBreakdownList
                        v-if="maintenanceBreakdownEntries.length > 0"
                        :entries="maintenanceBreakdownEntries"
                        flush
                    />
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="productionInputEntries.length > 0"
                    title="Production Input"
                    sectionKey="foxhole.scene-stats.production-input"
                    collapsible
                >
                    <FoxholeCostBreakdownList
                        :entries="productionInputEntries"
                        flush
                    />
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="productionOutputEntries.length > 0"
                    title="Production Output"
                    sectionKey="foxhole.scene-stats.production-output"
                    collapsible
                >
                    <FoxholeCostBreakdownList
                        :entries="productionOutputEntries"
                        quantityTone="gain"
                        flush
                    />
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="scopedBunkerHealth"
                    title="Bunker Health"
                    sectionKey="foxhole.scene-stats.bunker-health"
                    collapsible
                >
                    <ul class="scene-stats-panel__metric-list scene-stats-panel__metric-list--flush">
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:shield-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Total Health</span>
                            <span class="scene-stats-panel__metric-value is-bunker-health-total">
                                {{ wholeNumberFormatter.format(scopedBunkerHealth.effectiveHealth) }}
                            </span>
                        </li>
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:shield-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Repair Cost</span>
                            <span class="scene-stats-panel__metric-value is-bunker-repair-cost">
                                {{ wholeNumberFormatter.format(scopedBunkerHealth.repairCost) }}
                            </span>
                        </li>
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:shield-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Repair Rate</span>
                            <span class="scene-stats-panel__metric-value is-bunker-repair-rate">
                                {{ wholeNumberFormatter.format(Math.floor(scopedBunkerHealth.repairRate)) }}/swing
                            </span>
                        </li>
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:shield-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Breachable Health</span>
                            <span
                                class="scene-stats-panel__metric-value"
                                :class="bunkerStructuralIntegrityClass"
                            >
                                {{ wholeNumberFormatter.format(scopedBunkerHealth.breachableHealth) }}
                                ({{ wholeNumberFormatter.format(scopedBunkerHealth.breachableHealthPercent) }}%)
                            </span>
                        </li>
                        <li class="scene-stats-panel__metric-row scene-stats-panel__metric-row--icon">
                            <span class="scene-stats-panel__metric-icon is-total" aria-hidden="true">
                                <NxIcon
                                    name="ph:shield-fill"
                                    size="sm"
                                />
                            </span>
                            <span class="scene-stats-panel__metric-label">Structural Integrity</span>
                            <span
                                class="scene-stats-panel__metric-value"
                                :class="bunkerStructuralIntegrityClass"
                            >
                                {{ wholeNumberFormatter.format(scopedBunkerHealth.structuralIntegrityPercent) }}%
                                ({{ titleCaseIntegrityClass(scopedBunkerHealth.structuralIntegrityClass) }})
                            </span>
                        </li>
                    </ul>
                </NixieSidebarFormSection>

                <NixieSidebarFormSection
                    v-if="singleBunkerDestruction"
                    title="Bunker Destruction"
                    sectionKey="foxhole.scene-stats.bunker-destruction"
                    collapsible
                >
                    <div class="scene-stats-panel__destruction scene-stats-panel__destruction--flush">
                        <table
                            class="scene-stats-panel__destruction-table"
                            :class="{ 'has-wet-tier': bunkerDestructionShowsWetTier }"
                        >
                            <thead>
                                <tr>
                                    <th scope="col">Weapon</th>
                                    <th scope="col">T1</th>
                                    <th scope="col">T2</th>
                                    <th
                                        v-if="bunkerDestructionShowsWetTier"
                                        scope="col"
                                    >T3 Wet</th>
                                    <th scope="col">
                                        {{ bunkerDestructionShowsWetTier ? 'T3 Dry' : 'T3' }}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="weapon in bunkerDestructionWeaponRows"
                                    :key="weapon.id"
                                    @mouseenter="showDestructionWeaponHover(weapon)"
                                    @mouseleave="scheduleHideDestructionWeaponHover"
                                >
                                    <th scope="row">
                                        <span class="scene-stats-panel__destruction-weapon">
                                            <span class="scene-stats-panel__destruction-icon">
                                                <NxEntityIcon
                                                    :src="weapon.iconUrl"
                                                    :label="weapon.label"
                                                />
                                            </span>
                                            <span class="scene-stats-panel__destruction-name">
                                                {{ weapon.label }}
                                            </span>
                                        </span>
                                    </th>
                                    <td>{{ formatShotCount(weapon.shots.t1) }}</td>
                                    <td>{{ formatShotCount(weapon.shots.t2) }}</td>
                                    <td v-if="bunkerDestructionShowsWetTier">
                                        {{ formatShotCount(weapon.shots.t3wet) }}
                                    </td>
                                    <td>{{ formatShotCount(weapon.shots.t3) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </NixieSidebarFormSection>
            </div>
        </div>
    </div>
</template>

<style scoped>
.scene-stats-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    overflow: visible;
}

.scene-stats-panel__body {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-height: 0;
    overflow: visible;
}

.scene-stats-panel__body > .nixie-sidebar-form {
    flex: 0 0 auto;
    min-height: auto;
    align-content: start;
}

.scene-stats-panel__metric-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
    width: 100%;
    min-width: 0;
}

.scene-stats-panel__metric-list--flush {
    width: auto;
    margin: calc(var(--nx-space-2) * -1) calc(var(--nx-space-3) * -1) calc(var(--nx-space-3) * -1);
}

.scene-stats-panel__metric-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--nx-space-1);
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: var(--nx-space-1) var(--nx-space-3);
    min-height: 28px;
}

.scene-stats-panel__metric-row--icon {
    grid-template-columns: auto minmax(0, 1fr) auto;
}

.scene-stats-panel__metric-row + .scene-stats-panel__metric-row {
    border-top: 1px solid var(--nx-border);
}

.scene-stats-panel__metric-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    color: var(--nx-text-muted);
}

.scene-stats-panel__metric-icon.is-total,
.scene-stats-panel__metric-icon.is-power {
    color: #fff;
}

.scene-stats-panel__metric-icon.is-silo {
    color: var(--nx-success);
}

.scene-stats-panel__metric-icon.is-pipeline {
    color: var(--nx-warning);
}

.scene-stats-panel__metric-row:hover,
.scene-stats-panel__destruction-table tbody tr:hover {
    background: var(--nx-surface-raised);
}

.scene-stats-panel__metric-icon :deep(.nx-entity-icon) {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.scene-stats-panel__metric-icon :deep(.nx-entity-icon img) {
    object-fit: contain;
}

.scene-stats-panel__metric-icon :deep(.nx-entity-icon span) {
    font-size: 8px;
}

.scene-stats-panel__metric-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-tight);
    color: var(--nx-text);
}

.scene-stats-panel__metric-value {
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-font-weight);
    font-variant-numeric: tabular-nums;
    line-height: var(--nx-leading-tight);
}

.scene-stats-panel__metric-value.is-total {
    color: var(--nx-info);
}

.scene-stats-panel__metric-value.is-silo {
    color: var(--nx-success);
}

.scene-stats-panel__metric-value.is-pipeline {
    color: var(--nx-warning);
}

.scene-stats-panel__metric-value.is-power-produced {
    color: var(--nx-success);
}

.scene-stats-panel__metric-value.is-power-consumed {
    color: var(--nx-danger);
}

.scene-stats-panel__metric-value.is-bunker-health-total {
    color: var(--nx-success);
}

.scene-stats-panel__metric-value.is-bunker-repair-cost {
    color: var(--nx-warning);
}

.scene-stats-panel__metric-value.is-bunker-repair-rate {
    color: var(--nx-warning);
}

.scene-stats-panel__metric-value.is-si-high {
    color: var(--nx-success);
}

.scene-stats-panel__metric-value.is-si-medium {
    color: var(--nx-warning);
}

.scene-stats-panel__metric-value.is-si-low {
    color: color-mix(in srgb, var(--nx-warning) 55%, var(--nx-danger) 45%);
}

.scene-stats-panel__metric-value.is-si-critical {
    color: var(--nx-danger);
}

.scene-stats-panel__destruction--flush {
    width: auto;
    margin: calc(var(--nx-space-2) * -1) calc(var(--nx-space-3) * -1) calc(var(--nx-space-3) * -1);
}

.scene-stats-panel__destruction {
    container-type: inline-size;
    container-name: foxhole-scene-stats-destruction;
}

.scene-stats-panel__destruction-table {
    width: 100%;
    min-width: 0;
    border-collapse: collapse;
    table-layout: fixed;
}

.scene-stats-panel__destruction-table th,
.scene-stats-panel__destruction-table td {
    box-sizing: border-box;
    padding: var(--nx-space-1) var(--nx-space-2);
    min-height: 28px;
    vertical-align: middle;
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-font-weight);
    line-height: var(--nx-leading-tight);
    color: var(--nx-text);
}

.scene-stats-panel__destruction-table thead th {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--nx-border);
}

.scene-stats-panel__destruction-table th:first-child,
.scene-stats-panel__destruction-table td:first-child {
    width: auto;
    padding-left: var(--nx-space-3);
    text-align: left;
}

.scene-stats-panel__destruction-table th:not(:first-child),
.scene-stats-panel__destruction-table td:not(:first-child) {
    width: 2.65rem;
    padding-left: var(--nx-space-2);
    padding-right: var(--nx-space-2);
    text-align: center;
    font-variant-numeric: tabular-nums;
    border-left: 1px solid var(--nx-border);
}

.scene-stats-panel__destruction-table tbody th {
    font-weight: var(--nx-font-weight);
    text-align: left;
}

.scene-stats-panel__destruction-table tbody tr + tr th,
.scene-stats-panel__destruction-table tbody tr + tr td {
    border-top: 1px solid var(--nx-border);
}

.scene-stats-panel__destruction-weapon {
    display: inline-flex;
    align-items: center;
    gap: var(--nx-space-1);
    min-width: 0;
    max-width: 100%;
}

.scene-stats-panel__destruction-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}

.scene-stats-panel__destruction-icon :deep(.nx-entity-icon) {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.scene-stats-panel__destruction-icon :deep(.nx-entity-icon img) {
    object-fit: contain;
}

.scene-stats-panel__destruction-icon :deep(.nx-entity-icon span) {
    font-size: 8px;
}

.scene-stats-panel__destruction-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@container foxhole-scene-stats-destruction (max-width: 220px) {
    .scene-stats-panel__destruction-icon {
        display: none;
    }
}

@container foxhole-scene-stats-destruction (max-width: 260px) {
    .scene-stats-panel__destruction-table.has-wet-tier .scene-stats-panel__destruction-icon {
        display: none;
    }
}

.scene-stats-panel :deep(.foxhole-cost-breakdown__quantity) {
    font-weight: var(--nx-font-weight);
}
</style>

<style src="../../../../../../nixie/app/components/nixie/nixie-sidebar-form.css"></style>
