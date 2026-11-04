<script setup lang="ts">
import { computed, useId } from 'vue';
import FoxholeCostBreakdownList from './FoxholeCostBreakdownList.vue';
import type { FoxholeCostBreakdownEntry } from './FoxholeCostBreakdownList.vue';
import NxNumberInput from '#nixie/components/NxNumberInput.vue';
import NxToggleGrid from '#nixie/components/NxToggleGrid.vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieEditorDocumentSessionOptional } from '#nixie/composables/useNixieEditorDocumentSession.ts';
import type { NixieInspectorContributionNode } from '#nixie/plugins/nixie/registry/index.ts';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { FOXHOLE_MAINTENANCE_CATEGORIES, normalizeFoxholeMaintenanceFilters, resolveFoxholeMaintenanceCoverage } from '#foxhole/plugins/foxhole/nixie/maintenance-supply.ts';
import { projectFoxholeMaintenanceSceneV1, projectFoxholeMaintenanceSceneV2 } from '#foxhole/plugins/foxhole/nixie/maintenance-supply-scene.ts';

const props = defineProps<{
    bare?: boolean;
    node: NixieInspectorContributionNode<Record<string, unknown>>;
    canEdit: boolean;
    effectiveLocked: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
    patchEntities?: (edits: readonly { id: string; patch: Record<string, unknown>; }[]) => void | Promise<void>;
}>();
const rangeInputId = `foxhole-maintenance-range-${useId()}`;
const runtime = useNixieRuntime();
const session = useNixieEditorDocumentSessionOptional();
const { assetBaseUrl, t } = useFoxholeLocalization();
const catalog = computed(() => getFoxholeStructureCatalog(assetBaseUrl.value));
const supplyItem = computed(() => getFoxholeItemCatalog(assetBaseUrl.value).assetByKey.maintenancesupplies);
const batch = computed(() => props.patchEntities && props.node.targetIds.length > 1 ? props.patchEntities : undefined);
const filters = computed(() => normalizeFoxholeMaintenanceFilters(
    (batch.value ? props.node.snapshots[0] ?? props.node.snapshot : props.node.snapshot).state.maintenanceFilters,
));
const supplyAvailable = computed(() => {
    void session?.sceneV2Editor.value?.revision;
    return !session?.isSceneV2Active.value
        || session.sceneV2Editor.value?.controller.definitions.has('nixie.foxhole-planner\0maintenance-supply') === true;
});
const disabled = computed(() => !props.canEdit || props.effectiveLocked || !supplyAvailable.value);
const categories = computed(() => FOXHOLE_MAINTENANCE_CATEGORIES.map(key => {
    const category = catalog.value.categories.find(entry => entry.key === key);
    return { id: key, label: category ? t(category.nameLocalizationId, category.name) : key,
        imageUrl: category?.iconUrl ?? undefined };
}));
const included = computed(() => FOXHOLE_MAINTENANCE_CATEGORIES.filter(key => !filters.value.exclusions.includes(key)));
const mixedRange = computed(() => props.node.snapshots.some(snapshot =>
    normalizeFoxholeMaintenanceFilters(snapshot.state.maintenanceFilters).range !== filters.value.range));
const mixedCategories = computed(() => props.node.snapshots.some(snapshot =>
    JSON.stringify(normalizeFoxholeMaintenanceFilters(snapshot.state.maintenanceFilters).exclusions.slice().sort())
    !== JSON.stringify(filters.value.exclusions.slice().sort())));

function patchFilters(change: Partial<ReturnType<typeof normalizeFoxholeMaintenanceFilters>>, reason: string): void {
    const patchEntities = batch.value;
    if (patchEntities) {
        const snapshots = new Map(props.node.snapshots.map(snapshot => [String(snapshot.id), snapshot]));
        const edits = props.node.targetIds.flatMap(id => {
            const snapshot = snapshots.get(id);
            if (!snapshot) return [];
            const current = normalizeFoxholeMaintenanceFilters(snapshot.state.maintenanceFilters);
            return [{ id, patch: { maintenanceFilters: normalizeFoxholeMaintenanceFilters({ ...current, ...change }) } }];
        });
        if (edits.length === props.node.targetIds.length) void patchEntities(edits);
        return;
    }
    void props.patchNode({ maintenanceFilters: normalizeFoxholeMaintenanceFilters({ ...filters.value, ...change }) }, reason);
}

function setRange(range: number | null): void {
    if (disabled.value || range === null) {
        return;
    }
    patchFilters({ range }, 'inspector:foxhole-maintenance-range');
}
function setCategories(ids: string[]): void {
    if (disabled.value) {
        return;
    }
    patchFilters({ exclusions: FOXHOLE_MAINTENANCE_CATEGORIES.filter(key => !ids.includes(key)) }, 'inspector:foxhole-maintenance-categories');
}
const coverage = computed(() => {
    if (props.node.targetIds.length !== 1) {
        return null;
    }
    void session?.sceneV2Editor.value?.revision;
    const controller = session?.sceneV2Editor.value?.controller;
    let candidates;
    if (session?.isSceneV2Active.value && controller) {
        const draft = controller.placementInspector;
        candidates = projectFoxholeMaintenanceSceneV2([...controller.entities, ...(draft?.entities ?? [])], catalog.value);
    } else {
        const project = runtime.projectStore.project;
        if (!project) {
            return null;
        }
        void project.scene.revision.value;
        candidates = projectFoxholeMaintenanceSceneV1(project.scene.getRoots().map(node => node.toBoardSnapshot()), catalog.value);
    }
    const tunnel = candidates.find(candidate => candidate.id === String(props.node.snapshot.id));
    return tunnel ? resolveFoxholeMaintenanceCoverage(tunnel, candidates, filters.value) : null;
});
const maintenanceCost = computed<FoxholeCostBreakdownEntry[]>(() => {
    const item = supplyItem.value;
    const quantity = coverage.value?.suppliesPerHour ?? 0;
    return [{
        id: 'maintenancesupplies',
        name: item ? t(item.nameLocalizationId, item.name) : 'Maintenance Supplies',
        quantity,
        quantityLabel: `~${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} / hour`,
        iconUrl: item?.iconUrl,
        item: item ?? null,
    }];
});
const coveredAssets = computed<FoxholeCostBreakdownEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const structure of coverage.value?.structures ?? []) {
        counts.set(structure.assetId, (counts.get(structure.assetId) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => {
        const asset = catalog.value.assetByKey[key];
        return { id: key, quantity: count, name: asset ? t(asset.nameLocalizationId, asset.name) : key, iconUrl: asset?.iconUrl, structure: asset ?? null };
    }).sort((a, b) => a.name.localeCompare(b.name));
});
</script>

<template>
    <NixieSidebarFormSection title="Supply" :bare="bare" :collapsible="false">
        <div class="foxhole-supply">
            <p v-if="!supplyAvailable" class="foxhole-supply__hint">Update Foxhole Planner to edit supply settings in this scene.</p>
            <div>
                <div class="foxhole-supply__range">
                    <label :for="rangeInputId">Supply Range</label>
                    <NxNumberInput
                        :id="rangeInputId"
                        ariaLabel="Supply Range"
                        suffix="m"
                        :modelValue="filters.range"
                        :min="0"
                        :max="100"
                        :step="1"
                        :disabled="disabled"
                        @update:model-value="setRange"
                    />
                </div>
                <p v-if="mixedRange" class="foxhole-supply__hint">Mixed ranges. Editing applies to all selected tunnels.</p>
            </div>
            <div>
                <div class="foxhole-supply__label">Maintained Categories</div>
                <NxToggleGrid
                    :options="categories"
                    :modelValue="included"
                    appearance="icon"
                    ariaLabel="Maintained Categories"
                    :disabled="disabled"
                    @update:model-value="setCategories"
                />
                <p v-if="mixedCategories" class="foxhole-supply__hint">Mixed filters. Editing applies to all selected tunnels.</p>
            </div>
            <div v-if="coverage" class="foxhole-supply__coverage">
                <div class="foxhole-supply__label">Upkeep</div>

                <FoxholeCostBreakdownList
                    :entries="maintenanceCost"
                    aria-label="Maintenance Supply Upkeep"
                    title="Estimated upkeep, including this tunnel. Other supply sources can change actual consumption."
                />
                <div class="foxhole-supply__breakdown">
                    <div class="foxhole-supply__label">Coverage</div>

                    <FoxholeCostBreakdownList
                        :entries="coveredAssets"
                        quantityTone="neutral"
                        aria-label="Covered Structures"
                    />
                </div>
            </div>
            <p v-else class="foxhole-supply__hint">Select one placed tunnel to inspect coverage.</p>
        </div>
    </NixieSidebarFormSection>
</template>

<style scoped>
.foxhole-supply { display: grid; gap: 12px; }
.foxhole-supply__range { display: grid; grid-template-columns: minmax(0, 1fr) minmax(80px, 110px); align-items: center; gap: 12px; }
.foxhole-supply__label { margin-bottom: 6px; font-weight: 600; }
.foxhole-supply__hint { margin: 6px 0 0; opacity: 0.65; font-size: 11px; line-height: 1.5; }
.foxhole-supply__breakdown { margin-top: 12px; }
.foxhole-supply :deep(.foxhole-cost-breakdown__row) { padding: var(--nx-space-2); border-radius: var(--nx-radius-sm); }
</style>
