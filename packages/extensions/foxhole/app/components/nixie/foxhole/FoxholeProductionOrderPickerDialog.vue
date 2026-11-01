<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxIconButton from '#nixie/components/NxIconButton.vue';
import NxInput from '#nixie/components/NxInput.vue';
import NxMenuButton from '#nixie/components/NxMenuButton.vue';
import NxModal from '#nixie/components/NxModal.vue';
import NxNumberInput from '#nixie/components/NxNumberInput.vue';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { nixieSidebarAssetHoverCardKey, useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import FoxholeCostCard from '#foxhole/components/nixie/foxhole/FoxholeCostCard.vue';
import FoxholeStructureRecipesPanel from '#foxhole/components/nixie/foxhole/FoxholeStructureRecipesPanel.vue';
import { createFoxholeAssetsBaseUrl, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { normalizeFoxholeModificationSelectionMap } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import { resolveFoxholeStructureMaxOrders } from '#foxhole/plugins/foxhole/nixie/production/orders.ts';
import { resolveFoxholeStructureRecipes, toFoxholeCostBreakdownEntries } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type { FoxholeRecipeViewModel, FoxholeStructureRecipesViewModel } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';

const props = defineProps<{
    open: boolean;
    structureId: string;
    existingOrderCount: number;
    modificationVariantIds?: Record<string, string> | null;
    editing?: boolean;
    initialOrder?: {
        recipeId: string;
        parent: boolean;
        cycles: number | null;
        label: string | null;
    } | null;
}>();

const emit = defineEmits<{
    close: [];
    submit: [selection: {
        recipeId: string;
        structureId: string;
        orders: number;
        cycles: number | null;
        label: string | null;
    }];
}>();

// Modal descendants must not activate the sidebar's background asset preview.
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();
provide(nixieSidebarAssetHoverCardKey, {
    side: sidebarAssetHoverCard?.side ?? 'right',
    showAsset: () => {},
    hideAsset: () => {},
    scheduleHideAsset: () => {},
    clearHideAssetTimer: () => {},
});

const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const recipeFaction = computed(() => {
    const value = settingsStore.getValueOr('foxhole.assets.filter.faction', '');
    return value === 'c' || value === 'w' ? value : 'all';
});
const { t } = useFoxholeLocalization();
const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
const catalog = getFoxholeStructureCatalog(assetsBaseUrl);
const productionIndex = getFoxholeProductionIndex(assetsBaseUrl);
const selectedRecipeId = ref<string | null>(null);
const selectedStructureId = ref('');
const orders = ref(1);
const cycles = ref<number | null>(null);
const label = ref('');
const searchQuery = ref('');
const showSiblingUpgrades = ref(true);
const showOutputResources = ref(true);
const showAssemblyRecipes = ref(false);

const structure = computed(() => catalog.structureByKey[props.structureId] ?? null);
const structureAsset = computed(() => catalog.assetByKey[props.structureId] ?? null);
const selectedModificationVariantIds = computed(() => normalizeFoxholeModificationSelectionMap(props.modificationVariantIds));
const recipeSources = computed(() => {
    const currentStructure = structure.value;
    const asset = structureAsset.value;
    if (!currentStructure || !asset) {
        return [];
    }

    const baseModel = resolveFoxholeStructureRecipes({
        structureId: currentStructure.id,
        faction: recipeFaction.value,
        baseAssetsUrl: assetsBaseUrl,
        productionIndex,
        structureCatalog: catalog,
    });
    const baseSource = baseModel.recipes.length
        ? [{ key: 'base', structure: currentStructure, model: baseModel, label: 'Base Facility', isUpgrade: false, isSelected: true, slotId: null, variantId: null }]
        : [];
    const upgradeSources = asset.modificationSlots.flatMap(slot => slot.variants.flatMap(variant => {
        if (!variant.isUpgrade) {
            return [];
        }
        const model = filterRecipeModel(
            resolveFoxholeStructureRecipes({
                structureId: currentStructure.id,
                faction: recipeFaction.value,
                baseAssetsUrl: assetsBaseUrl,
                productionIndex,
                structureCatalog: catalog,
                includeModifications: true,
                modificationSelections: { [slot.id]: variant.id },
            }),
            recipe => recipe.recipe.sourceType === 'modification'
                && recipe.recipe.sourceSlotId === slot.id
                && recipe.recipe.sourceVariantId === variant.id,
        );
        return model.recipes.length
            ? [{
                key: `${slot.id}:${variant.id}`,
                structure: currentStructure,
                model,
                label: variant.name,
                isUpgrade: true,
                isSelected: selectedModificationVariantIds.value[slot.id] === variant.id,
                slotId: slot.id,
                variantId: variant.id,
            }]
            : [];
    }));

    return [...baseSource, ...upgradeSources];
});
const selectedSource = computed(() => recipeSources.value.find(source => source.structure.id === selectedStructureId.value) ?? null);
const selectedRecipe = computed(() => selectedRecipeId.value
    ? productionIndex.recipeById[selectedRecipeId.value] ?? null
    : null);
const selectedRecipeModel = computed<FoxholeRecipeViewModel | null>(() => {
    const recipe = selectedRecipe.value;
    if (!recipe) {
        return null;
    }
    return resolveFoxholeStructureRecipes({
        structureId: recipe.sourceStructureId,
        baseAssetsUrl: assetsBaseUrl,
        productionIndex,
        structureCatalog: catalog,
        includeModifications: recipe.sourceType === 'modification',
        modificationSelections: recipe.sourceSlotId && recipe.sourceVariantId
            ? { [recipe.sourceSlotId]: recipe.sourceVariantId }
            : undefined,
    }).recipes.find(candidate => candidate.id === recipe.id) ?? null;
});
const isRecipeSelected = computed(() => selectedRecipeModel.value !== null);
const selectedStructureMaxOrders = computed(() => resolveFoxholeStructureMaxOrders(selectedSource.value?.structure));
const replacesStructure = computed(() => (
    selectedStructureId.value !== props.structureId
    && selectedStructureId.value !== structure.value?.parentStructureId
));
const occupiedOrderCount = computed(() => replacesStructure.value
    ? 0
    : Math.max(0, props.existingOrderCount - (props.editing ? 1 : 0)));
const availableOrders = computed(() => Math.max(0, selectedStructureMaxOrders.value - occupiedOrderCount.value));
const canSubmit = computed(() => Boolean(selectedRecipeId.value) && availableOrders.value > 0);
const submitLabel = computed(() => Math.max(1, Math.floor(Number(orders.value) || 1)) === 1
    ? 'Submit Order'
    : 'Submit Orders');
const quantityMultiplier = computed(() => Math.max(1, Math.floor(Number(orders.value) || 1)) * Math.max(1, Math.floor(Number(cycles.value) || 1)));
const selectedRecipeTotals = computed<FoxholeRecipeViewModel | null>(() => {
    const recipe = selectedRecipeModel.value;
    if (!recipe) {
        return null;
    }
    const multiplier = quantityMultiplier.value;
    return {
        ...recipe,
        durationSeconds: cycles.value != null && recipe.durationSeconds != null
            ? recipe.durationSeconds * Math.max(1, Math.floor(Number(cycles.value) || 1))
            : recipe.durationSeconds,
        inputs: recipe.inputs.map(resource => ({ ...resource, quantity: resource.quantity * multiplier })),
        outputs: recipe.outputs.map(resource => ({ ...resource, quantity: resource.quantity * multiplier })),
    };
});
const selectedInputEntries = computed(() => selectedRecipeTotals.value
    ? toFoxholeCostBreakdownEntries(selectedRecipeTotals.value.inputs, t)
    : []);
const selectedOutputEntries = computed(() => selectedRecipeTotals.value
    ? toFoxholeCostBreakdownEntries(selectedRecipeTotals.value.outputs, t)
    : []);
const visibleRecipeSources = computed(() => recipeSources.value
    .filter(source => !source.isUpgrade
        || showSiblingUpgrades.value
        || selectedModificationVariantIds.value[source.slotId ?? ''] === source.variantId)
    .map(source => ({
        ...source,
        model: filterRecipeModel(source.model, recipe => recipeMatchesSearch(recipe, searchQuery.value)),
    }))
    .filter(source => source.model.recipes.length > 0));

const displayOptions = computed<ResolvedMenuItem[]>(() => [
    {
        type: 'checkbox', label: 'Show Assembly Recipes', icon: 'ph:factory', checked: showAssemblyRecipes.value,
        closeOnClick: false, adminOnly: false, disabled: false, visible: true,
        onClick: () => { showAssemblyRecipes.value = !showAssemblyRecipes.value; },
    },
    {
        type: 'checkbox', label: 'Show Output Resources', icon: 'ph:package', checked: showOutputResources.value,
        closeOnClick: false, adminOnly: false, disabled: false, visible: true,
        onClick: () => { showOutputResources.value = !showOutputResources.value; },
    },
    {
        type: 'checkbox', label: 'Show All Upgrades', icon: 'ph:circles-three-plus', checked: showSiblingUpgrades.value,
        closeOnClick: false, adminOnly: false, disabled: false, visible: true,
        onClick: () => { showSiblingUpgrades.value = !showSiblingUpgrades.value; },
    },
]);

function recipeMatchesSearch(recipe: FoxholeRecipeViewModel, query: string): boolean {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const haystack = [
        recipe.id,
        recipe.title,
        recipe.subtitle,
        ...recipe.inputs.map(resource => resource.resolvedName ?? resource.id),
        ...recipe.outputs.map(resource => resource.resolvedName ?? resource.id),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
}

function filterRecipeModel(
    model: FoxholeStructureRecipesViewModel,
    predicate: (recipe: FoxholeRecipeViewModel) => boolean,
): FoxholeStructureRecipesViewModel {
    const recipes = model.recipes.filter(predicate);
    return {
        ...model,
        recipes,
        groups: model.groups.map(group => ({
            ...group,
            recipes: group.recipes.filter(predicate),
        })).filter(group => group.recipes.length > 0),
    };
}

function reset(): void {
    const initialOrder = props.initialOrder;
    selectedRecipeId.value = initialOrder?.recipeId ?? null;
    selectedStructureId.value = initialOrder?.parent
        ? (structure.value?.parentStructureId ?? props.structureId)
        : props.structureId;
    orders.value = 1;
    cycles.value = initialOrder?.cycles ?? null;
    label.value = initialOrder?.label ?? '';
    searchQuery.value = '';
    showSiblingUpgrades.value = true;
    showOutputResources.value = true;
    showAssemblyRecipes.value = false;
}

function selectRecipe(structureId: string, recipeId: string): void {
    resetOrderDetails();
    selectedStructureId.value = structureId;
    selectedRecipeId.value = recipeId;
}

function resetOrderDetails(): void {
    orders.value = 1;
    cycles.value = null;
    label.value = '';
}

function returnToRecipes(): void {
    selectedRecipeId.value = null;
    selectedStructureId.value = props.structureId;
    resetOrderDetails();
}

function formatDuration(seconds: number | null): string {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    if (!totalSeconds) {
        return '—';
    }
    const minutes = Math.floor(totalSeconds / 60);
    const remainder = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function submit(): void {
    if (!selectedRecipeId.value || !canSubmit.value) {
        return;
    }
    emit('submit', {
        recipeId: selectedRecipeId.value,
        structureId: selectedStructureId.value,
        orders: Math.max(1, Math.min(availableOrders.value, Math.floor(Number(orders.value) || 1))),
        cycles: cycles.value != null && Number.isFinite(cycles.value) && cycles.value > 0
            ? Math.max(1, Math.floor(cycles.value))
            : null,
        label: label.value.trim() || null,
    });
}

watch(() => props.open, open => {
    if (open) {
        sidebarAssetHoverCard?.hideAsset();
        reset();
    }
}, { immediate: true });

watch([availableOrders, orders], () => {
    orders.value = Math.max(1, Math.min(availableOrders.value || 1, Math.floor(Number(orders.value) || 1)));
});
</script>

<template>
    <NxModal
        :open="open"
        title="Add Production Orders"
        :width="isRecipeSelected ? 'min(560px, calc(100vw - 32px))' : 'min(960px, calc(100vw - 32px))'"
        showClose
        @close="emit('close')"
    >
        <template #header>
            <NxIconButton
                v-if="isRecipeSelected"
                icon="ph:arrow-left"
                label="Back to Recipes"
                tooltip="Back to Recipes"
                variant="ghost"
                size="sm"
                @click="returnToRecipes"
            />
            <div class="nx-modal__header-main production-picker__header-main">
                <h2 class="nx-modal__title">{{ isRecipeSelected ? 'Recipe Breakdown' : 'Add Production Orders' }}</h2>
            </div>
            <NxSearchInput
                v-if="!isRecipeSelected"
                v-model="searchQuery"
                class="production-picker__search"
                ariaLabel="Search Recipes"
                placeholder="Search recipes..."
                size="sm"
            />
            <NxMenuButton
                v-if="!isRecipeSelected"
                class="production-picker__display-options"
                icon="ph:gear"
                ariaLabel="Production Order Display Options"
                :items="displayOptions"
                horizontalAlign="end"
                variant="ghost"
                menuZIndex="calc(var(--nx-z-modal) + 1)"
            />
        </template>
        <div class="production-picker">
            <div v-if="!isRecipeSelected && visibleRecipeSources.length" class="production-picker__sources">
                <section
                    v-for="source in visibleRecipeSources"
                    :key="source.key"
                    class="production-picker__source"
                    :class="{ 'is-muted': source.isUpgrade && !source.isSelected }"
                >
                    <h3>{{ source.label }}</h3>
                    <FoxholeStructureRecipesPanel
                    :model="source.model"
                    :selectedRecipeId="selectedStructureId === source.structure.id ? selectedRecipeId : null"
                    selectable
                    :compact="!showOutputResources"
                    :showHeader="false"
                    :showGroupTitles="false"
                    :showAssemblyRecipes="showAssemblyRecipes"
                    @select="recipeId => selectRecipe(source.structure.id, recipeId)"
                    />
                </section>
            </div>
            <p v-else-if="!isRecipeSelected" class="nx-form-hint">No recipes match the current search and upgrade filters.</p>
            <div v-else-if="selectedRecipeTotals" class="production-picker__breakdown">
                <FoxholeCostCard v-if="selectedInputEntries.length" title="Production Input" icon="" :entries="selectedInputEntries" :hoverable="false" />
                <FoxholeCostCard
                    v-if="selectedOutputEntries.length"
                    title="Production Output"
                    icon=""
                    :entries="selectedOutputEntries"
                    quantityTone="gain"
                    :hoverable="false"
                />
                <div class="production-picker__timing">
                    <span>Cycle Time: {{ formatDuration(selectedRecipeModel?.durationSeconds ?? null) }}</span>
                    <span v-if="cycles != null">Total: {{ formatDuration(selectedRecipeTotals.durationSeconds) }}</span>
                </div>
            </div>
            <div v-if="isRecipeSelected" class="production-picker__details">
                <NxInput v-model="label" label="Label" placeholder="Optional" />
                <NxNumberInput v-if="!editing" v-model="orders" label="Orders" :min="1" :max="availableOrders" />
                <NxNumberInput
                    v-model="cycles"
                    label="Cycles"
                    :min="1"
                    nullable
                    allowInfinity
                />
            </div>
        </div>
        <template #footer>
            <NxButton label="Cancel" variant="secondary" @click="emit('close')" />
            <NxButton :label="submitLabel" variant="primary" :disabled="!canSubmit" @click="submit" />
        </template>
    </NxModal>
</template>

<style scoped>
.production-picker { display: grid; gap: var(--nx-space-3); }
/* Keep the picker header controls aligned with the modal close button. */
:global(.nx-modal__header:has(> .production-picker__header-main)) { align-items: center; gap: var(--nx-space-2); }
:global(.nx-modal__header:has(> .production-picker__header-main) > .nx-modal__close) { margin: 0; }
.production-picker__search { flex: 0 1 280px; min-width: 140px; }
.production-picker__display-options { display: flex; flex: none; }
.production-picker__sources :deep(.foxhole-recipe-card) { padding: var(--nx-space-3); gap: var(--nx-space-3); }
.production-picker__sources :deep(.foxhole-recipe-card__title) { font-size: var(--nx-text-sm); }
.production-picker__sources :deep(.foxhole-recipe-card__chip) { font-size: var(--nx-text-xs); }
.production-picker__sources :deep(.foxhole-recipe-card__chip-icon),
.production-picker__sources :deep(.foxhole-recipe-card__title-arrow) { width: 14px; height: 14px; }
.production-picker__sources :deep(.foxhole-recipe-card__io) { --foxhole-recipe-icon-size: 48px; }
.production-picker__sources :deep(.foxhole-recipe-card__resource-qty) { padding: 2px 5px; font-size: var(--nx-text-xs); }
.production-picker__sources :deep(.foxhole-recipe-card__resource-qty-unit) { font-size: 10px; }
.production-picker__sources { display: grid; gap: var(--nx-space-4); max-height: min(58vh, 640px); overflow: auto; padding-inline-end: var(--nx-space-1); }
.production-picker__source { display: grid; gap: var(--nx-space-2); }
.production-picker__source.is-muted { opacity: 0.45; transition: opacity var(--nx-duration-fast) var(--nx-ease-out); }
.production-picker__source.is-muted:hover, .production-picker__source.is-muted:focus-within { opacity: 0.78; }
.production-picker__source > h3 { margin: 0; color: var(--nx-text); font-size: var(--nx-text-sm); }
.production-picker__header-main { flex: 1 1 auto; }
.production-picker__breakdown { display: grid; gap: var(--nx-space-3); }
.production-picker__breakdown :deep(.foxhole-cost-card .foxhole-cost-breakdown__icon .nx-entity-icon) { width: 28px; height: 28px; }
.production-picker__breakdown :deep(.foxhole-cost-breakdown__row) { column-gap: var(--nx-space-3); }
.production-picker__timing { display: flex; flex-wrap: wrap; gap: var(--nx-space-3); color: var(--nx-text-muted); font-size: var(--nx-text-sm); }
.production-picker__details { display: grid; grid-template-columns: minmax(0, 1fr) 120px 120px; gap: var(--nx-space-2); align-items: center; }
@media (max-width: 640px) {
    :global(.nx-modal__header:has(> .production-picker__header-main)) { flex-wrap: wrap; }
    .production-picker__header-main { flex-basis: calc(100% - 80px); }
    .production-picker__search { order: 1; flex-basis: 100%; }
    .production-picker__details { grid-template-columns: 1fr; }
}
</style>
