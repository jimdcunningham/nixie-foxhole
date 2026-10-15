<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import NxBadge from '#nixie/components/NxBadge.vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NxNumberInput from '#nixie/components/NxNumberInput.vue';
import NxSelect from '#nixie/components/NxSelect.vue';
import type { NxSelectOption } from '#nixie/components/NxSelect.vue';
import NxSettingsStack from '#nixie/components/NxSettingsStack.vue';
import NxSurfaceSection from '#nixie/components/NxSurfaceSection.vue';
import NxSwitch from '#nixie/components/NxSwitch.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { setFoxholeModificationSlotVariantSelection } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import {
    createFoxholeProductionCommodityKey,
    getFoxholeProductionIndex,
    getFoxholeProductionRecipeBuildTarget,
    parseFoxholeProductionBuildTargetId,
} from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { createFoxholeProductionGraphLayerSnapshot } from '#foxhole/plugins/foxhole/nixie/production/graph-layer.ts';
import { queryFoxholeProductionItinerary } from '#foxhole/plugins/foxhole/nixie/production/itinerary.ts';
import { resolveFoxholeProductionMachineInstances } from '#foxhole/plugins/foxhole/nixie/production/scene-capability.ts';
import { reconcileFoxholeProductionSceneCoverage } from '#foxhole/plugins/foxhole/nixie/production/scene-coverage.ts';
import { collectFoxholeProductionSnapshots } from '#foxhole/plugins/foxhole/nixie/production/scene-snapshots.ts';
import { createFoxholeStructureAssetSnapshot } from '#foxhole/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import type {
    FoxholeProductionItineraryResult,
    FoxholeProductionItineraryRouteOption,
    FoxholeProductionPlanBranchDecision,
    FoxholeProductionMachineInstance,
    FoxholeProductionMachineRequirementCoverage,
    FoxholeProductionPlanNode,
    FoxholeProductionPlanResult,
    FoxholeProductionRecipe,
    FoxholeProductionStructureSnapshotLike,
} from '#foxhole/plugins/foxhole/nixie/production/types.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';

type ParsedCommodity = {
    commodityKey: string;
    channel: 'item' | 'crate' | 'liquid' | 'build';
    resourceId: string;
};

type PlannedRecipeRow = {
    id: string;
    placementRecipeId: string;
    label: string;
    buildingLabel: string;
    outputLabel: string;
    runCount: number;
    machineCoverageLabel: string;
    placeButtonLabel: string;
    canPlace: boolean;
};

type SourceChoiceOption = {
    value: string;
    label: string;
};

type SourceChoiceRow = {
    commodityKey: string;
    label: string;
    requestedQuantity: number;
    depth: number;
    currentSourceLabel: string;
    selectedChoiceValue: string;
    externalSupplyAmountValue: string;
    options: SourceChoiceOption[];
};

type ProductionTargetOption = ParsedCommodity & { label: string; };

const AUTO_SOURCE_CHOICE_VALUE = '__planner__';
const EXTERNAL_SOURCE_CHOICE_VALUE = '__external__';

const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();

const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
const productionIndex = getFoxholeProductionIndex(assetsBaseUrl);
const itemCatalog = getFoxholeItemCatalog(assetsBaseUrl);
const structureCatalog = getFoxholeStructureCatalog(assetsBaseUrl);

const targetCommodityInput = ref('');
const targetQuantityInput = ref('1');
const includeParentBuildCosts = ref(false);
const usePublicLogiAssumptions = ref(true);
const externalSupplyOverrides = ref<Record<string, number | 'unbounded'>>({});
const preferredRecipeOverrides = ref<Record<string, string>>({});
const placingRecipeId = ref('');
const copyingRawPlanJson = ref(false);
const generatingGraphLayer = ref(false);

const itemLookup = computed(() => {
    const lookup = new Map<string, typeof itemCatalog.assets[number]>();
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

const outputOptions = computed<ProductionTargetOption[]>(() => {
    return Object.keys(productionIndex.recipeIdsByOutput)
        .map(parseCommodityKey)
        .filter((entry): entry is ParsedCommodity => entry !== null)
        .map(entry => ({
            ...entry,
            label: formatCommodityLabel(entry.commodityKey),
        }))
        .sort((left, right) => formatCommodityLabel(left.commodityKey)
            .localeCompare(formatCommodityLabel(right.commodityKey), undefined, { sensitivity: 'base' }));
});

const outputSelectOptions = computed<NxSelectOption[]>(() => outputOptions.value.map(option => ({
    value: option.commodityKey,
    label: option.label,
})));

const targetQuantityNumber = computed({
    get: () => {
        const normalized = Number(targetQuantityInput.value ?? 0);
        return Number.isFinite(normalized) ? normalized : 0;
    },
    set: (value: number) => {
        const next = Number.isFinite(value) ? Math.max(0, value) : 0;
        targetQuantityInput.value = String(next);
    },
});

watchEffect(() => {
    if (targetCommodityInput.value) {
        return;
    }

    targetCommodityInput.value = outputOptions.value[0]?.commodityKey ?? '';
});

const parsedTargetCommodity = computed(() => parseCommodityKey(targetCommodityInput.value));
const targetQuantity = computed(() => {
    const normalized = Number(targetQuantityInput.value ?? 0);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
});

const externalSupplyByCommodityKey = computed(() => {
    return { ...externalSupplyOverrides.value };
});

const preferredRecipeMap = computed(() => {
    return { ...preferredRecipeOverrides.value };
});

const sceneSnapshots = computed<FoxholeProductionStructureSnapshotLike[]>(() => {
    const project = runtime.projectStore.project;
    if (!project) {
        return [];
    }

    void project.scene.revision.value;

    return collectFoxholeProductionSnapshots(project.scene.getRoots().slice());
});

const machineInstances = computed<FoxholeProductionMachineInstance[]>(() => {
    return resolveFoxholeProductionMachineInstances(productionIndex, sceneSnapshots.value);
});

const itineraryResult = computed<FoxholeProductionItineraryResult | null>(() => {
    if (!parsedTargetCommodity.value || targetQuantity.value <= 0) {
        return null;
    }

    return queryFoxholeProductionItinerary({
        index: productionIndex,
        itemCatalog,
        structureCatalog,
        demand: {
            channel: parsedTargetCommodity.value.channel,
            resourceId: parsedTargetCommodity.value.resourceId,
            quantity: targetQuantity.value,
        },
        assumptions: usePublicLogiAssumptions.value ? 'public_logi' : 'full',
        includeParentBuildCosts: includeParentBuildCosts.value,
        externalSupplyByCommodityKey: externalSupplyByCommodityKey.value,
        preferredRecipeIdByOutput: preferredRecipeMap.value,
        sceneSnapshots: sceneSnapshots.value,
    });
});

const planResult = computed<FoxholeProductionPlanResult | null>(() => itineraryResult.value?.plan ?? null);

const sceneCoverage = computed(() => {
    if (!planResult.value) {
        return null;
    }

    return reconcileFoxholeProductionSceneCoverage(productionIndex, planResult.value, machineInstances.value);
});

const plannedRecipeRows = computed<PlannedRecipeRow[]>(() => {
    if (!sceneCoverage.value) {
        return [];
    }

    return sceneCoverage.value.executionRows
        .map(requirement => {
            const placementRecipeId = requirement.placementRecipeId;
            if (!placementRecipeId) {
                return null;
            }

            const recipe = productionIndex.recipeById[placementRecipeId] ?? null;
            if (!recipe) {
                return null;
            }

            return {
                id: requirement.id,
                placementRecipeId,
                label: formatRecipePlacementLabel(recipe),
                buildingLabel: formatMachineRequirementRecipeSummary(requirement),
                outputLabel: formatMachineRequirementOutputSummary(requirement),
                runCount: requirement.requiredRunCount,
                machineCoverageLabel: formatMachineRequirementCoverageLabel(requirement),
                placeButtonLabel: getRecipePlacementActionLabel(recipe),
                canPlace: canPlaceRecipeSource(recipe),
            };
        })
        .filter((entry): entry is PlannedRecipeRow => entry !== null)
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
});

const dependencyTreeText = computed(() => {
    if (!planResult.value) {
        return 'Enter a commodity key and quantity to run the planner.';
    }

    const lines = planResult.value.demandNodes.flatMap(node => formatPlanNodeLines(node));
    return lines.length > 0 ? lines.join('\n') : 'No dependency tree generated.';
});

const sourceChoiceRows = computed<SourceChoiceRow[]>(() => {
    const result = planResult.value;
    if (!result) {
        return [];
    }

    return result.branchDecisions.map(decision => ({
        commodityKey: decision.commodityKey,
        label: formatCommodityLabel(decision.commodityKey),
        requestedQuantity: decision.requestedQuantity,
        depth: decision.depth,
        currentSourceLabel: formatBranchDecisionSourceLabel(decision),
        selectedChoiceValue: decision.selectionKind === 'external'
            ? EXTERNAL_SOURCE_CHOICE_VALUE
            : decision.selectionKind === 'recipe' && decision.selectedRecipeId
                ? decision.selectedRecipeId
                : AUTO_SOURCE_CHOICE_VALUE,
        externalSupplyAmountValue: typeof decision.externalSupplyAmount === 'number'
            && Number.isFinite(decision.externalSupplyAmount)
            && decision.externalSupplyAmount > 0
            ? String(decision.externalSupplyAmount)
            : '',
        options: createSourceChoiceOptions(decision.commodityKey, decision.availableRecipeIds, decision.allowExternal),
    }));
});

const targetRecipeBatchNotice = computed(() => {
    const rootStep = planResult.value?.targetSteps[0] ?? null;
    if (!rootStep || rootStep.source !== 'recipe') {
        return '';
    }

    if (rootStep.producedQuantity <= rootStep.requestedQuantity + 1e-9 || rootStep.surplusQuantity <= 1e-9) {
        return '';
    }

    const runCount = rootStep.recipeRunCount ?? 0;
    const runLabel = `${formatNumber(runCount)} ${runCount === 1 ? 'run' : 'runs'}`;
    return `${formatRecipeLabel(rootStep.recipeId ?? '')}: ${runLabel}, makes ${formatNumber(rootStep.producedQuantity)}, leaves ${formatNumber(rootStep.surplusQuantity)} surplus.`;
});

const buildTargetRollupNotice = computed(() => {
    const result = planResult.value;
    if (!result) {
        return '';
    }

    const buildTargetSteps = result.targetSteps.filter(step => step.buildTarget !== null);
    const rootStep = buildTargetSteps[0] ?? null;
    if (!rootStep?.buildTarget) {
        return '';
    }

    if (buildTargetSteps.length <= 1) {
        return `Showing direct build cost only for ${formatBuildTargetLabel(rootStep.buildTarget.id)}.`;
    }

    const rollupLabels = buildTargetSteps
        .slice(1)
        .map(step => step.buildTarget)
        .filter((buildTarget): buildTarget is NonNullable<typeof buildTarget> => buildTarget !== null)
        .sort((left, right) => {
            const leftDepth = buildTargetSteps.find(step => step.buildTarget?.id === left.id)?.buildRollupDepth ?? 0;
            const rightDepth = buildTargetSteps.find(step => step.buildTarget?.id === right.id)?.buildRollupDepth ?? 0;
            return leftDepth - rightDepth;
        })
        .map(buildTarget => formatBuildTargetLabel(buildTarget.id));

    return `Rolled-up total includes parent build costs: ${rollupLabels.join(' -> ')}.`;
});

const buildCostLedgerLines = computed(() => {
    const ledger = planResult.value?.buildCostLedgers[0] ?? null;
    if (!ledger) {
        return [];
    }

    const lines = ledger.contributions.flatMap(contribution => {
        if (contribution.costEntries.length === 0) {
            return [];
        }

        const costLabel = contribution.costEntries
            .map(entry => `${formatCommodityLabel(entry.commodityKey)} x${formatNumber(entry.quantity)}`)
            .join(', ');
        const prefix = contribution.depth === 0
            ? formatBuildTargetLabel(contribution.buildTarget.id)
            : `${formatBuildTargetLabel(contribution.buildTarget.id)} parent cost`;
        return [`${prefix}: ${costLabel}`];
    });

    if (ledger.totalCostEntries.length > 0) {
        lines.push(`Total build cost: ${ledger.totalCostEntries
            .map(entry => `${formatCommodityLabel(entry.commodityKey)} x${formatNumber(entry.quantity)}`)
            .join(', ')}`);
    }

    return lines;
});

const issueSummaryLines = computed(() => {
    const result = planResult.value;
    if (!result) {
        return [];
    }

    return result.blockers.map(blocker => {
        switch (blocker.kind) {
            case 'ambiguous':
                return `${formatCommodityLabel(blocker.commodityKey)} has ${blocker.candidateRecipeIds.length} recipe options.`;
            case 'cycle':
                return `A recipe loop was detected while resolving ${formatCommodityLabel(blocker.commodityKey)}.`;
            case 'missing':
                return `Still missing ${formatNumber(blocker.unresolvedQuantity)} of ${formatCommodityLabel(blocker.commodityKey)}.`;
        }
    });
});

const rawPlanJson = computed(() => {
    return planResult.value
        ? JSON.stringify(planResult.value, null, 2)
        : '';
});

async function copyRawPlannerJson(): Promise<void> {
    const text = rawPlanJson.value.trim();
    if (!text || copyingRawPlanJson.value) {
        return;
    }

    if (!import.meta.client || !navigator?.clipboard?.writeText) {
        showNxToast({
            kind: 'warning',
            message: 'Clipboard copy is not available in this browser context.',
        });
        return;
    }

    copyingRawPlanJson.value = true;
    try {
        await navigator.clipboard.writeText(text);
        showNxToast({
            kind: 'success',
            message: 'Copied planner JSON to the clipboard.',
        });
    } catch (error) {
        console.error('[foxhole:production-dev] failed to copy planner json', error);
        showNxToast({
            kind: 'error',
            message: 'Could not copy planner JSON to the clipboard.',
        });
    } finally {
        copyingRawPlanJson.value = false;
    }
}

async function createNodeGraphLayer(): Promise<void> {
    const project = runtime.projectStore.project;
    const plan = planResult.value;
    if (!project || !plan || generatingGraphLayer.value) {
        return;
    }

    if (!runtime.canEdit.value) {
        showNxToast({
            kind: 'warning',
            message: 'This project is read-only, so the production graph layer could not be created.',
        });
        return;
    }

    if (plan.demandNodes.length === 0) {
        showNxToast({
            kind: 'warning',
            message: 'Run the planner first so there is graph data to render.',
        });
        return;
    }

    const layerName = `${formatCommodityLabel(targetCommodityInput.value || '')} Graph`;
    const graphLayer = createFoxholeProductionGraphLayerSnapshot({
        plan,
        index: productionIndex,
        sceneCoverage: sceneCoverage.value,
        itemCatalog,
        structureCatalog,
        layerName,
    });

    generatingGraphLayer.value = true;
    try {
        const created = await project.executeBatch(
            [{
                type: 'create',
                node: graphLayer.layerSnapshot,
                index: project.getLayerNodes().length,
            }],
            [{
                type: 'delete',
                nodeId: String(graphLayer.layerSnapshot.id),
            }],
            'foxhole-production-dev:create-node-graph-layer',
            'Create Production Graph Layer',
        );

        if (!created) {
            showNxToast({
                kind: 'error',
                message: 'Could not create the production graph layer.',
            });
            return;
        }

        project.activeLayerId.value = String(graphLayer.layerSnapshot.id);
        focusGraphLayerBounds(graphLayer.bounds);
        showNxToast({
            kind: 'success',
            message: `Created graph layer with ${formatNumber(graphLayer.nodeCount)} nodes and ${formatNumber(graphLayer.edgeCount)} links.`,
        });
    } catch (error) {
        console.error('[foxhole:production-dev] failed to create graph layer', error);
        showNxToast({
            kind: 'error',
            message: 'Could not create the production graph layer.',
        });
    } finally {
        generatingGraphLayer.value = false;
    }
}

function focusGraphLayerBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number; }): void {
    const viewport = runtime.session.viewportRef.value;
    if (!viewport) {
        return;
    }

    const paddingPx = 96;
    const availableWidth = Math.max(1, (viewport.screenWidth ?? 0) - (paddingPx * 2));
    const availableHeight = Math.max(1, (viewport.screenHeight ?? 0) - (paddingPx * 2));
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);

    runtime.session.cameraTo({
        time: 220,
        position: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
        },
        scale,
    });
}

function normalizeLookupKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function parseCommodityKey(value: string | null | undefined): ParsedCommodity | null {
    const normalized = normalizeKey(value);
    if (!normalized) {
        return null;
    }

    const explicitMatch = normalized.match(/^(item|crate|liquid|build):(.*)$/i);
    if (explicitMatch) {
        const channel = explicitMatch[1]!.toLowerCase() as ParsedCommodity['channel'];
        const resourceId = normalizeKey(explicitMatch[2]);
        if (!resourceId) {
            return null;
        }

        return {
            channel,
            resourceId,
            commodityKey: createFoxholeProductionCommodityKey(channel, resourceId),
        };
    }

    return {
        channel: 'item',
        resourceId: normalized,
        commodityKey: createFoxholeProductionCommodityKey('item', normalized),
    };
}

function resolveStructureCatalogAssetById(structureId: string) {
    const normalizedStructureId = normalizeKey(structureId);
    const candidates = [normalizedStructureId, normalizedStructureId.toLowerCase()];

    for (const candidate of candidates) {
        const asset = structureCatalog.assetByKey[candidate];
        if (asset) {
            return asset;
        }
    }

    return null;
}

function formatBuildTargetLabel(buildTargetId: string): string {
    const parsed = parseFoxholeProductionBuildTargetId(buildTargetId);
    if (!parsed) {
        return `${formatFallbackLabel(buildTargetId)} (build)`;
    }

    const structureAsset = resolveStructureCatalogAssetById(parsed.structureId);
    const structureLabel = structureAsset?.name ?? formatFallbackLabel(parsed.structureId);
    if (parsed.kind === 'structure' || parsed.kind === 'vehicle') {
        return `${structureLabel} (${parsed.kind})`;
    }

    const slot = parsed.slotId
        ? (structureAsset?.modificationSlotById[parsed.slotId] ?? null)
        : null;
    const variant = parsed.variantId
        ? (slot?.variantById[parsed.variantId] ?? null)
        : null;
    const variantLabel = variant?.name ?? formatFallbackLabel(parsed.variantId ?? '');
    return `${structureLabel} -> ${variantLabel} (${parsed.kind})`;
}

function formatFallbackLabel(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
}

function formatChannelLabel(channel: ParsedCommodity['channel']): string {
    switch (channel) {
        case 'crate':
            return 'crate';
        case 'liquid':
            return 'liquid';
        case 'build':
            return 'build';
        default:
            return 'item';
    }
}

function formatCommodityLabel(commodityKey: string): string {
    const parsed = parseCommodityKey(commodityKey);
    if (!parsed) {
        return 'Unknown commodity';
    }

    if (parsed.channel === 'build') {
        return formatBuildTargetLabel(parsed.resourceId);
    }

    const item = itemLookup.value.get(normalizeLookupKey(parsed.resourceId)) ?? null;
    const baseLabel = item?.name ?? formatFallbackLabel(parsed.resourceId);
    return `${baseLabel} (${formatChannelLabel(parsed.channel)})`;
}

function formatRecipeLabel(recipeId: string): string {
    const recipe = productionIndex.recipeById[recipeId] ?? null;
    if (!recipe) {
        return recipeId;
    }

    const variantLabel = recipe.sourceVariantName ?? recipe.sourceVariantId ?? recipe.sourceModificationId;
    return variantLabel
        ? `${recipe.sourceStructureName} -> ${variantLabel}`
        : recipe.sourceStructureName;
}

function formatRecipePlacementLabel(recipe: FoxholeProductionRecipe): string {
    const buildTarget = getFoxholeProductionRecipeBuildTarget(recipe);
    const variantLabel = recipe.sourceVariantName ?? recipe.sourceModificationId ?? '';

    switch (buildTarget?.kind) {
        case 'vehicle':
            return `${recipe.sourceStructureName} (vehicle)`;
        case 'structure':
            return `${recipe.sourceStructureName} (structure)`;
        case 'upgrade':
            return variantLabel
                ? `${recipe.sourceStructureName} with ${variantLabel} (upgrade)`
                : `${recipe.sourceStructureName} (upgrade)`;
        case 'modification':
            return variantLabel
                ? `${recipe.sourceStructureName} with ${variantLabel} (modification)`
                : `${recipe.sourceStructureName} (modification)`;
        default:
            break;
    }

    return variantLabel
        ? `${recipe.sourceStructureName} with ${variantLabel}`
        : recipe.sourceStructureName;
}

function getRecipePlacementActionLabel(recipe: FoxholeProductionRecipe): string {
    switch (getFoxholeProductionRecipeBuildTarget(recipe)?.kind) {
        case 'vehicle':
            return 'Add vehicle';
        case 'structure':
            return 'Add structure';
        case 'upgrade':
            return 'Add structure + upgrade';
        case 'modification':
            return 'Add structure + modification';
        default:
            return recipe.sourceType === 'modification'
                ? 'Add building + upgrade'
                : 'Add building';
    }
}

function formatRecipeOutputSummary(recipe: FoxholeProductionRecipe): string {
    const outputLabels = [
        ...Object.entries(recipe.itemOutput).map(([resourceId, resource]) => formatRecipeOutputLabel('item', resourceId, resource.quantity)),
        ...Object.entries(recipe.crateOutput).map(([resourceId, resource]) => formatRecipeOutputLabel('crate', resourceId, resource.quantity)),
        ...Object.entries(recipe.liquidOutput).map(([resourceId, resource]) => formatRecipeOutputLabel('liquid', resourceId, resource.quantity)),
        ...Object.entries(recipe.buildOutput).map(([resourceId, resource]) => formatRecipeOutputLabel('build', resourceId, resource.quantity)),
    ];

    return outputLabels.length > 0
        ? `Outputs: ${outputLabels.join(', ')}`
        : 'No output metadata.';
}

function formatRecipeInputSummary(recipe: FoxholeProductionRecipe): string {
    const inputLabels = [
        ...Object.entries(recipe.itemInput).map(([resourceId, resource]) => formatRecipeOutputLabel('item', resourceId, resource.quantity)),
        ...Object.entries(recipe.crateInput).map(([resourceId, resource]) => formatRecipeOutputLabel('crate', resourceId, resource.quantity)),
        ...Object.entries(recipe.liquidInput).map(([resourceId, resource]) => formatRecipeOutputLabel('liquid', resourceId, resource.quantity)),
    ];

    return inputLabels.length > 0
        ? `Uses: ${inputLabels.join(', ')}`
        : '';
}

function formatRecipeOutputLabel(
    channel: ParsedCommodity['channel'],
    resourceId: string,
    quantity: number,
): string {
    return `${formatCommodityLabel(createFoxholeProductionCommodityKey(channel, resourceId))} x${formatNumber(quantity)}`;
}

function getRecipeCommodityOutputQuantity(recipe: FoxholeProductionRecipe, commodityKey: string): number {
    const parsed = parseCommodityKey(commodityKey);
    if (!parsed) {
        return 0;
    }

    const outputMap = parsed.channel === 'crate'
        ? recipe.crateOutput
        : parsed.channel === 'liquid'
            ? recipe.liquidOutput
            : parsed.channel === 'build'
                ? recipe.buildOutput
                : recipe.itemOutput;

    const quantity = Number(outputMap[parsed.resourceId]?.quantity ?? 0);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function formatDurationSeconds(value: number | null): string {
    const totalSeconds = Math.max(0, Math.round(Number(value ?? 0)));
    if (totalSeconds <= 0) {
        return '';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (seconds > 0 || parts.length === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ');
}

function formatRouteOptionHint(option: FoxholeProductionItineraryRouteOption): string {
    const parts: string[] = [];
    if (option.isWorldStructure) {
        parts.push('World');
    }
    const duration = formatDurationSeconds(option.durationSeconds);
    if (duration) {
        parts.push(duration);
    }
    if (option.inputSummary.length) {
        parts.push(`${option.inputSummary.length} input${option.inputSummary.length === 1 ? '' : 's'}`);
    }
    if (option.rankHints.includes('fewerInputs')) {
        parts.push('Fewer Inputs');
    }
    if (option.rankHints.includes('faster')) {
        parts.push('Faster');
    }
    return parts.join(' · ');
}

function selectItineraryRouteOption(commodityKey: string, recipeId: string): void {
    setPreferredRecipeOverride(commodityKey, recipeId);
}

function formatRecipeSelectionLabel(recipeId: string, commodityKey: string): string {
    const recipe = productionIndex.recipeById[recipeId] ?? null;
    if (!recipe) {
        return recipeId;
    }

    const inputLabel = formatRecipeInputSummary(recipe);
    const outputQuantity = getRecipeCommodityOutputQuantity(recipe, commodityKey);
    const outputLabel = outputQuantity > 0
        ? `${formatCommodityLabel(commodityKey)} x${formatNumber(outputQuantity)}`
        : formatRecipeOutputSummary(recipe).replace(/^Outputs:\s*/, '');
    const durationLabel = formatDurationSeconds(recipe.durationSeconds);

    return [formatRecipeLabel(recipeId), inputLabel, outputLabel, durationLabel]
        .filter(Boolean)
        .join(' • ');
}

function createSourceChoiceOptions(
    commodityKey: string,
    recipeIds: readonly string[],
    allowExternal: boolean,
): SourceChoiceOption[] {
    const options: SourceChoiceOption[] = [{
        value: AUTO_SOURCE_CHOICE_VALUE,
        label: 'Planner choice',
    }];

    if (allowExternal) {
        options.push({
            value: EXTERNAL_SOURCE_CHOICE_VALUE,
            label: 'External supply',
        });
    }

    return [
        ...options,
        ...recipeIds.map(recipeId => ({
            value: recipeId,
            label: formatRecipeSelectionLabel(recipeId, commodityKey),
        })),
    ];
}

function hasExternalSupplyOverride(commodityKey: string): boolean {
    const normalizedCommodityKey = normalizeKey(commodityKey);
    return normalizedCommodityKey
        ? Object.prototype.hasOwnProperty.call(externalSupplyOverrides.value, normalizedCommodityKey)
        : false;
}

function formatBranchDecisionSourceLabel(decision: FoxholeProductionPlanBranchDecision): string {
    const currentSource = decision.currentSources.length === 1
        ? decision.currentSources[0] ?? null
        : null;
    if (!currentSource) {
        const uniqueLabels = Array.from(new Set(decision.currentSources.map(source => {
            switch (source) {
                case 'recipe':
                    return decision.currentRecipeIds.length === 1
                        ? formatRecipeLabel(decision.currentRecipeIds[0] ?? '')
                        : 'Recipe';
                case 'external':
                    return 'External supply';
                case 'stock':
                    return 'Stock';
                case 'ambiguous':
                    return `${decision.availableRecipeIds.length} recipe options`;
                case 'missing':
                    return 'No recipe';
                case 'cycle':
                    return 'Cycle detected';
            }
        })));
        return uniqueLabels.length > 0
            ? `Mixed: ${uniqueLabels.join(', ')}`
            : '';
    }

    switch (currentSource) {
        case 'recipe': {
            const parts = [decision.currentRecipeIds.length === 1
                ? formatRecipeLabel(decision.currentRecipeIds[0] ?? '')
                : `${formatNumber(decision.currentRecipeIds.length)} recipes`];
            if (decision.consumedFromExternal > 0) {
                parts.push(`${formatNumber(decision.consumedFromExternal)} on hand`);
            }
            if (decision.consumedFromStock > 0) {
                parts.push(`${formatNumber(decision.consumedFromStock)} surplus`);
            }
            return parts.join(' + ');
        }
        case 'external':
            return decision.consumedFromExternal > 0
                ? `External supply x${formatNumber(decision.consumedFromExternal)}`
                : 'External supply';
        case 'stock':
            return decision.consumedFromStock > 0
                ? `Stock x${formatNumber(decision.consumedFromStock)}`
                : 'Stock';
        case 'ambiguous':
            return `${decision.availableRecipeIds.length} recipe options`;
        case 'missing':
            return 'No recipe';
        case 'cycle':
            return 'Cycle detected';
    }
}

function formatNumber(value: number): string {
    return Number.isInteger(value)
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
        : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatMachineRequirementCoverageLabel(requirement: FoxholeProductionMachineRequirementCoverage): string {
    switch (requirement.status) {
        case 'covered':
            return `${formatNumber(requirement.matchedMachineCount)} ready in scene`;
        case 'upgradeable':
            return `${formatNumber(requirement.upgradeableMachineCount)} upgradeable in scene`;
        case 'uncovered':
            return 'Needs placement';
    }
}

function formatMachineRequirementRecipeSummary(requirement: FoxholeProductionMachineRequirementCoverage): string {
    return requirement.recipeRuns.length === 1
        ? 'Handles 1 planned recipe'
        : `Handles ${formatNumber(requirement.recipeRuns.length)} planned recipes`;
}

function accumulateMachineRequirementOutputs(
    outputTotals: Map<string, number>,
    channel: ParsedCommodity['channel'],
    resources: Record<string, { quantity: number; }>,
    runCount: number,
): void {
    if (!Number.isFinite(runCount) || runCount <= 0) {
        return;
    }

    for (const [resourceId, resource] of Object.entries(resources)) {
        const quantity = Number(resource.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            continue;
        }

        const commodityKey = createFoxholeProductionCommodityKey(channel, resourceId);
        if (!commodityKey) {
            continue;
        }

        outputTotals.set(commodityKey, (outputTotals.get(commodityKey) ?? 0) + (quantity * runCount));
    }
}

function formatMachineRequirementOutputSummary(requirement: FoxholeProductionMachineRequirementCoverage): string {
    const outputTotals = new Map<string, number>();

    for (const recipeRun of requirement.recipeRuns) {
        const recipe = productionIndex.recipeById[recipeRun.recipeId] ?? null;
        if (!recipe) {
            continue;
        }

        accumulateMachineRequirementOutputs(outputTotals, 'item', recipe.itemOutput, recipeRun.runCount);
        accumulateMachineRequirementOutputs(outputTotals, 'crate', recipe.crateOutput, recipeRun.runCount);
        accumulateMachineRequirementOutputs(outputTotals, 'liquid', recipe.liquidOutput, recipeRun.runCount);
        accumulateMachineRequirementOutputs(outputTotals, 'build', recipe.buildOutput, recipeRun.runCount);
    }

    const outputLabels = Array.from(outputTotals.entries())
        .sort(([leftCommodityKey], [rightCommodityKey]) => formatCommodityLabel(leftCommodityKey)
            .localeCompare(formatCommodityLabel(rightCommodityKey), undefined, { sensitivity: 'base' }))
        .map(([commodityKey, quantity]) => `${formatCommodityLabel(commodityKey)} x${formatNumber(quantity)}`);

    return outputLabels.length > 0
        ? `Planned outputs: ${outputLabels.join(', ')}`
        : 'No output metadata.';
}

function formatPlanNodeLines(node: FoxholeProductionPlanNode, depth = 0): string[] {
    const indent = '  '.repeat(depth);
    const header = `${indent}- ${formatCommodityLabel(node.commodityKey)} requested x${formatNumber(node.requestedQuantity)}`;

    let detail = '';
    switch (node.source) {
        case 'recipe':
            detail = ` via ${formatRecipeLabel(node.recipeId ?? '')} (${formatNumber(node.recipeRunCount ?? 0)} runs`;
            if (node.producedQuantity > 0) {
                detail += `, makes ${formatNumber(node.producedQuantity)}`;
            }
            if (node.surplusQuantity > 0) {
                detail += `, leaves ${formatNumber(node.surplusQuantity)} surplus`;
            }
            detail += ')';
            break;
        case 'external':
            detail = ` via external supply (${formatNumber(node.consumedFromExternal)})`;
            break;
        case 'stock':
            detail = ` via prior surplus (${formatNumber(node.consumedFromStock)})`;
            break;
        case 'ambiguous':
            detail = ` ambiguous between ${node.candidateRecipeIds.length} recipes`;
            break;
        case 'missing':
            detail = ' missing recipe';
            break;
        case 'cycle':
            detail = ' cycle detected';
            break;
    }

    return [
        `${header}${detail}`,
        ...node.children.flatMap(child => formatPlanNodeLines(child, depth + 1)),
    ];
}

function resolveRecipeStructureAsset(recipe: FoxholeProductionRecipe) {
    return resolveStructureCatalogAssetById(recipe.sourceStructureKey)
        ?? resolveStructureCatalogAssetById(recipe.sourceStructureId);
}

function resolveRecipePlacementSelections(recipe: FoxholeProductionRecipe): Record<string, string> | null {
    if (recipe.sourceType !== 'modification' || !recipe.sourceSlotId || !recipe.sourceVariantId) {
        return {};
    }

    const structureAsset = resolveRecipeStructureAsset(recipe);
    const slot = structureAsset?.modificationSlotById[String(recipe.sourceSlotId).trim()] ?? null;
    const variant = slot?.variantById[String(recipe.sourceVariantId).trim()] ?? null;
    if (!slot || !variant) {
        return null;
    }

    return setFoxholeModificationSlotVariantSelection({}, slot, variant.id);
}

function canPlaceRecipeSource(recipe: FoxholeProductionRecipe): boolean {
    if (!resolveRecipeStructureAsset(recipe)) {
        return false;
    }

    const selections = resolveRecipePlacementSelections(recipe);
    return selections !== null;
}

async function placeRecipeSource(recipeId: string): Promise<void> {
    if (placingRecipeId.value) {
        return;
    }

    const recipe = productionIndex.recipeById[recipeId] ?? null;
    if (!recipe) {
        return;
    }

    if (!runtime.canEdit.value) {
        showNxToast({
            kind: 'warning',
            message: 'This project is read-only, so the asset could not be placed.',
        });
        return;
    }

    const asset = resolveRecipeStructureAsset(recipe);
    const structure = structureCatalog.structureByKey[String(recipe.sourceStructureId ?? '').trim()] ?? null;
    const modificationVariantIds = resolveRecipePlacementSelections(recipe);
    if (!asset || modificationVariantIds === null) {
        showNxToast({
            kind: 'error',
            message: `Could not resolve a placeable asset for ${formatRecipeLabel(recipeId)}.`,
        });
        return;
    }

    const viewport = runtime.session.viewportRef.value;
    const worldPosition = viewport
        ? viewport.toWorld((viewport.screenWidth ?? 0) / 2, (viewport.screenHeight ?? 0) / 2)
        : { x: 0, y: 0 };

    const snapshot = createFoxholeStructureAssetSnapshot({
        asset,
        structure,
        parentAsset: asset.parentStructureId
            ? (structureCatalog.assetByKey[String(asset.parentStructureId).trim()] ?? null)
            : null,
        label: formatRecipePlacementLabel(recipe),
        modificationVariantIds: Object.keys(modificationVariantIds).length > 0 ? modificationVariantIds : undefined,
        x: worldPosition.x,
        y: worldPosition.y,
        z: 0,
    });

    placingRecipeId.value = recipeId;
    try {
        const created = await runtime.projectStore.createNode(snapshot, undefined, undefined, 'foxhole-production-dev:place-recipe-source');
        if (!created) {
            showNxToast({
                kind: 'error',
                message: `Could not place ${formatRecipePlacementLabel(recipe)} in the scene.`,
            });
            return;
        }

        showNxToast({
            kind: 'success',
            message: `${formatRecipePlacementLabel(recipe)} was added to the center of the scene.`,
        });
    } finally {
        placingRecipeId.value = '';
    }
}

function setExternalSupplyOverride(commodityKey: string, externallySupplied: boolean): void {
    const normalizedCommodityKey = normalizeKey(commodityKey);
    if (!normalizedCommodityKey) {
        return;
    }

    const currentValue = externalSupplyOverrides.value[normalizedCommodityKey];

    if (externallySupplied) {
        externalSupplyOverrides.value = {
            ...externalSupplyOverrides.value,
            [normalizedCommodityKey]: 'unbounded',
        };
        return;
    }

    if (currentValue !== 'unbounded') {
        return;
    }

    externalSupplyOverrides.value = Object.fromEntries(
        Object.entries(externalSupplyOverrides.value)
            .filter(([entryCommodityKey]) => entryCommodityKey !== normalizedCommodityKey),
    );
}

function setExternalSupplyAmountOverride(commodityKey: string, quantityValue: string): void {
    const normalizedCommodityKey = normalizeKey(commodityKey);
    if (!normalizedCommodityKey) {
        return;
    }

    const parsedQuantity = Number(quantityValue);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
        if (!hasExternalSupplyOverride(normalizedCommodityKey)
            || externalSupplyOverrides.value[normalizedCommodityKey] === 'unbounded') {
            return;
        }

        externalSupplyOverrides.value = Object.fromEntries(
            Object.entries(externalSupplyOverrides.value)
                .filter(([entryCommodityKey]) => entryCommodityKey !== normalizedCommodityKey),
        );
        return;
    }

    externalSupplyOverrides.value = {
        ...externalSupplyOverrides.value,
        [normalizedCommodityKey]: parsedQuantity,
    };
}

function setPreferredRecipeOverride(commodityKey: string, recipeIdValue: string): void {
    const normalizedCommodityKey = normalizeKey(commodityKey);
    if (!normalizedCommodityKey) {
        return;
    }

    const normalizedRecipeId = normalizeKey(recipeIdValue);
    const nextOverrides = normalizedRecipeId
        ? {
            ...preferredRecipeOverrides.value,
            [normalizedCommodityKey]: normalizedRecipeId,
        }
        : Object.fromEntries(
            Object.entries(preferredRecipeOverrides.value)
                .filter(([entryCommodityKey]) => entryCommodityKey !== normalizedCommodityKey),
        );

    preferredRecipeOverrides.value = nextOverrides;
}

function setSourceChoice(commodityKey: string, value: string): void {
    if (value === EXTERNAL_SOURCE_CHOICE_VALUE) {
        setPreferredRecipeOverride(commodityKey, '');
        setExternalSupplyOverride(commodityKey, true);
        return;
    }

    setExternalSupplyOverride(commodityKey, false);
    setPreferredRecipeOverride(commodityKey, value === AUTO_SOURCE_CHOICE_VALUE ? '' : value);
}
</script>

<template>
    <div class="production-dev-panel">
        <div class="production-dev-panel__body nx-panel-body">
            <NxSettingsStack>
                <NxSurfaceSection
                    kicker="Output"
                    title="Choose Product / Amount"
                    compact
                >
                    <div class="production-dev-panel__section-meta">
                        <NxBadge>{{ planResult?.status ?? 'idle' }}</NxBadge>
                    </div>

                    <div class="production-dev-panel__inputs">
                        <NxSelect
                            v-model="targetCommodityInput"
                            label="Product"
                            :options="outputSelectOptions"
                        />
                        <NxNumberInput
                            v-model="targetQuantityNumber"
                            label="Amount"
                            :min="0"
                            :step="1"
                        />
                    </div>

                    <NxSwitch
                        v-model="includeParentBuildCosts"
                        label="Include Parent Build Costs For Upgrades"
                    />
                </NxSurfaceSection>

                <NxSurfaceSection
                    kicker="Sources"
                    title="Choose Production Recipes / Sources"
                    compact
                >
                    <NxSettingsStack v-if="sourceChoiceRows.length > 0">
                        <div
                            v-for="row in sourceChoiceRows"
                            :key="row.commodityKey"
                            class="production-dev-panel__choice"
                            :style="{ marginLeft: `${Math.min(row.depth, 5) * 14}px` }"
                        >
                            <div class="production-dev-panel__choice-copy">
                                <span class="production-dev-panel__choice-label">{{ row.label }}</span>
                                <span class="production-dev-panel__choice-meta">
                                    {{ row.requestedQuantity > 0 ? `Need x${formatNumber(row.requestedQuantity)}` : 'Saved choice' }}
                                    <template v-if="row.currentSourceLabel"> · {{ row.currentSourceLabel }}</template>
                                </span>
                            </div>
                            <div class="production-dev-panel__choice-controls">
                                <NxSelect
                                    :modelValue="row.selectedChoiceValue"
                                    :options="row.options"
                                    aria-label="Source"
                                    @update:model-value="setSourceChoice(row.commodityKey, $event)"
                                />
                                <NxNumberInput
                                    :modelValue="Number(row.externalSupplyAmountValue || 0)"
                                    label="On Hand"
                                    :min="0"
                                    :step="1"
                                    :disabled="row.selectedChoiceValue === EXTERNAL_SOURCE_CHOICE_VALUE"
                                    @update:model-value="setExternalSupplyAmountOverride(row.commodityKey, String($event))"
                                />
                            </div>
                        </div>
                    </NxSettingsStack>
                    <NxEmptyState
                        v-else
                        message="No source choices yet."
                    />
                </NxSurfaceSection>

                <NxSurfaceSection
                    kicker="Production Layout"
                    title="Place Required Production Assets"
                    compact
                >
                    <NxSettingsStack v-if="plannedRecipeRows.length > 0">
                        <div
                            v-for="row in plannedRecipeRows"
                            :key="row.id"
                            class="production-dev-panel__recipe-row"
                        >
                            <div class="production-dev-panel__recipe-copy">
                                <span class="production-dev-panel__recipe-title">{{ row.label }}</span>
                                <span class="production-dev-panel__recipe-meta">{{ row.buildingLabel }}</span>
                                <span class="production-dev-panel__recipe-meta">{{ row.outputLabel }}</span>
                            </div>
                            <div class="production-dev-panel__recipe-actions">
                                <span class="production-dev-panel__recipe-metric">{{ formatNumber(row.runCount) }} runs</span>
                                <span class="production-dev-panel__recipe-metric">{{ row.machineCoverageLabel }}</span>
                                <NxButton
                                    variant="secondary"
                                    size="sm"
                                    :disabled="!row.canPlace || placingRecipeId === row.placementRecipeId"
                                    :label="placingRecipeId === row.placementRecipeId ? 'Adding…' : row.placeButtonLabel"
                                    @click="placeRecipeSource(row.placementRecipeId)"
                                />
                            </div>
                        </div>
                    </NxSettingsStack>
                    <NxEmptyState
                        v-else
                        message="No production assets are required in the current plan."
                    />
                </NxSurfaceSection>

                <NxSurfaceSection
                    kicker="Itinerary"
                    title="How To Get This Output"
                    compact
                >
                    <NxSwitch
                        v-model="usePublicLogiAssumptions"
                        label="Public Logi"
                    />
                    <template v-if="itineraryResult">
                        <div class="production-dev-panel__section-meta">
                            <NxBadge>{{ itineraryResult.status }}</NxBadge>
                            <NxBadge>{{ itineraryResult.assumptions === 'public_logi' ? 'Public Logi' : 'Full' }}</NxBadge>
                            <span class="production-dev-panel__recipe-meta">
                                {{ itineraryResult.goal.label }} × {{ formatNumber(itineraryResult.goal.quantity) }}
                            </span>
                            <span
                                v-if="itineraryResult.board"
                                class="production-dev-panel__recipe-meta"
                            >
                                Board {{ itineraryResult.board.coveredRequirementCount }} covered /
                                {{ itineraryResult.board.upgradeableRequirementCount }} upgradeable /
                                {{ itineraryResult.board.uncoveredRequirementCount }} missing
                            </span>
                        </div>

                        <p
                            v-if="itineraryResult.leafRequirements.length"
                            class="production-dev-panel__recipe-meta"
                        >
                            Leaf Requirements
                        </p>
                        <ul
                            v-if="itineraryResult.leafRequirements.length"
                            class="production-dev-panel__issue-list"
                        >
                            <li
                                v-for="leaf in itineraryResult.leafRequirements"
                                :key="leaf.commodityKey"
                            >
                                {{ formatNumber(leaf.quantity) }}× {{ leaf.label }}
                                <span class="production-dev-panel__recipe-meta">({{ leaf.source }})</span>
                            </li>
                        </ul>

                        <ol class="production-dev-panel__itinerary-steps">
                            <li
                                v-for="step in itineraryResult.steps"
                                :key="step.id"
                                class="production-dev-panel__itinerary-step"
                            >
                                <span class="production-dev-panel__recipe-title">{{ step.title }}</span>
                                <span class="production-dev-panel__recipe-meta">{{ step.summary }}</span>
                                <div
                                    v-if="step.kind === 'choose' && step.options.length"
                                    class="production-dev-panel__route-options"
                                >
                                    <button
                                        v-for="option in step.options"
                                        :key="option.recipeId"
                                        type="button"
                                        class="production-dev-panel__route-option"
                                        :class="{
                                            'production-dev-panel__route-option--selected':
                                                preferredRecipeOverrides[step.commodityKey ?? ''] === option.recipeId,
                                        }"
                                        @click="selectItineraryRouteOption(step.commodityKey ?? '', option.recipeId)"
                                    >
                                        <span class="production-dev-panel__recipe-title">{{ option.label }}</span>
                                        <span class="production-dev-panel__recipe-meta">
                                            {{ formatRouteOptionHint(option) }}
                                        </span>
                                    </button>
                                </div>
                            </li>
                        </ol>
                    </template>
                    <NxEmptyState
                        v-else
                        message="Choose a product and quantity to build an itinerary."
                    />
                </NxSurfaceSection>

                <NxSurfaceSection
                    kicker="Breakdown"
                    title="Output Summary"
                    compact
                >
                    <div class="production-dev-panel__section-actions">
                        <NxButton
                            variant="secondary"
                            size="sm"
                            :disabled="generatingGraphLayer || !planResult"
                            :label="generatingGraphLayer ? 'Building Graph…' : 'Create Graph Layer'"
                            @click="createNodeGraphLayer()"
                        />
                        <NxButton
                            variant="secondary"
                            size="sm"
                            :disabled="copyingRawPlanJson || !rawPlanJson"
                            @click="copyRawPlannerJson()"
                        >
                            {{ copyingRawPlanJson ? 'Copying…' : 'Copy JSON' }}
                        </NxButton>
                    </div>

                    <ul
                        v-if="buildTargetRollupNotice || buildCostLedgerLines.length > 0 || targetRecipeBatchNotice || issueSummaryLines.length > 0"
                        class="production-dev-panel__issue-list"
                    >
                        <li v-if="buildTargetRollupNotice">{{ buildTargetRollupNotice }}</li>
                        <li v-for="line in buildCostLedgerLines" :key="line">{{ line }}</li>
                        <li v-if="targetRecipeBatchNotice">{{ targetRecipeBatchNotice }}</li>
                        <li v-for="line in issueSummaryLines" :key="line">{{ line }}</li>
                    </ul>

                    <pre class="production-dev-panel__debug-block">{{ dependencyTreeText }}</pre>
                </NxSurfaceSection>
            </NxSettingsStack>
        </div>
    </div>
</template>

<style scoped>
.production-dev-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
}

.production-dev-panel__section-meta,
.production-dev-panel__section-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--nx-space-2);
    margin-bottom: var(--nx-space-3);
}

.production-dev-panel__inputs {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 108px;
    gap: var(--nx-space-2);
    margin-bottom: var(--nx-space-3);
}

.production-dev-panel__choice {
    display: grid;
    gap: var(--nx-space-2);
}

.production-dev-panel__choice-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.production-dev-panel__choice-label {
    color: var(--nx-text);
    font-size: var(--nx-text-sm);
    font-weight: 600;
}

.production-dev-panel__choice-meta {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
}

.production-dev-panel__choice-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px;
    gap: var(--nx-space-2);
}

.production-dev-panel__recipe-row {
    display: grid;
    gap: var(--nx-space-2);
    padding-bottom: var(--nx-space-2);
    border-bottom: 1px solid var(--nx-border);
}

.production-dev-panel__recipe-row:last-child {
    padding-bottom: 0;
    border-bottom: 0;
}

.production-dev-panel__recipe-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.production-dev-panel__recipe-title {
    color: var(--nx-text);
    font-size: var(--nx-text-sm);
    font-weight: 600;
}

.production-dev-panel__recipe-meta,
.production-dev-panel__recipe-metric {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
}

.production-dev-panel__recipe-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--nx-space-2);
}

.production-dev-panel__issue-list {
    margin: 0 0 var(--nx-space-3);
    padding-left: 1.1rem;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-normal);
}

.production-dev-panel__itinerary-steps {
    display: grid;
    gap: var(--nx-space-2);
    margin: var(--nx-space-3) 0 0;
    padding-left: 1.25rem;
}

.production-dev-panel__itinerary-step {
    display: grid;
    gap: 2px;
}

.production-dev-panel__route-options {
    display: grid;
    gap: var(--nx-space-1);
    margin-top: var(--nx-space-1);
}

.production-dev-panel__route-option {
    display: grid;
    gap: 2px;
    padding: var(--nx-space-2);
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    background: var(--nx-hover-surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.production-dev-panel__route-option:hover {
    border-color: var(--nx-border-strong, var(--nx-border));
}

.production-dev-panel__route-option--selected {
    border-color: var(--nx-accent, var(--nx-border));
}

.production-dev-panel__debug-block {
    margin: 0;
    padding: var(--nx-space-3);
    overflow: auto;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    background: var(--nx-hover-surface);
    color: var(--nx-text-muted);
    font-family: var(--nx-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: var(--nx-text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
}
</style>
