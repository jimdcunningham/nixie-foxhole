<script setup lang="ts">
import { computed, ref } from 'vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxIconButton from '#nixie/components/NxIconButton.vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import FoxholeProductionOrderPickerDialog from '#foxhole/components/nixie/foxhole/FoxholeProductionOrderPickerDialog.vue';
import { createFoxholeAssetsBaseUrl, getFoxholeItemCatalog, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeProductionIndex } from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { clampFoxholeStructureProductionOrders, resolveFoxholeStructureMaxOrders } from '#foxhole/plugins/foxhole/nixie/production/orders.ts';
import { resolveFoxholeRecipeResourceLabel, resolveFoxholeStructureRecipes } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import { normalizeFoxholeModificationSelectionMap, setFoxholeModificationSlotVariantSelection } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import type { FoxholeStructureProductionOrder, FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { NixieInspectorContributionNode } from '#nixie/plugins/nixie/registry/index.ts';

const props = defineProps<{
    bare?: boolean;
    node: NixieInspectorContributionNode<Record<string, unknown>>;
    canEdit: boolean;
    effectiveLocked: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
}>();

const runtimeConfig = useRuntimeConfig();
const runtime = useNixieRuntime();
const { t } = useFoxholeLocalization();
const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
const catalog = getFoxholeStructureCatalog(assetsBaseUrl);
const itemCatalog = getFoxholeItemCatalog(assetsBaseUrl);
const productionIndex = getFoxholeProductionIndex(assetsBaseUrl);
const pickerOpen = ref(false);
const editingOrderIndex = ref<number | null>(null);
const snapshotState = computed(() => (props.node.snapshot.state ?? {}) as Partial<FoxholeStructureState>);
const state = computed(() => {
    const scene = runtime.projectStore.scene;
    const nodeId = props.node.targetIds[0];
    if (!scene || !nodeId || props.node.targetIds.length !== 1) {
        return snapshotState.value;
    }
    void scene.revision.value;
    return (scene.getNodeById(nodeId)?.boardState as Partial<FoxholeStructureState> | undefined) ?? snapshotState.value;
});
const foxholeKey = computed(() => String(state.value.foxholeKey ?? '').trim());
const structure = computed(() => catalog.structureByKey[foxholeKey.value] ?? null);
const maxOrders = computed(() => resolveFoxholeStructureMaxOrders(structure.value));
const orders = computed(() => clampFoxholeStructureProductionOrders(state.value.productionOrders, maxOrders.value));
const canEdit = computed(() => props.canEdit && !props.effectiveLocked && props.node.targetIds.length === 1);
function patchOrders(next: FoxholeStructureProductionOrder[], reason: string): void {
    void props.patchNode({ productionOrders: clampFoxholeStructureProductionOrders(next, maxOrders.value) }, reason);
}

function addOrders(selection: {
    recipeId: string;
    structureId: string;
    orders: number;
    cycles: number | null;
    label: string | null;
}): void {
    if (!canEdit.value || !structure.value) {
        return;
    }
    const editIndex = editingOrderIndex.value;
    const selectedStructureId = selection.structureId;
    const isParentRecipe = selectedStructureId === structure.value.parentStructureId;
    const changesStructure = selectedStructureId !== structure.value.id && !isParentRecipe;
    const selectedRecipe = productionIndex.recipeById[selection.recipeId];
    const asset = catalog.assetByKey[foxholeKey.value] ?? null;
    const modificationSlot = selectedRecipe?.sourceType === 'modification' && selectedRecipe.sourceSlotId
        ? asset?.modificationSlotById[selectedRecipe.sourceSlotId] ?? null
        : null;
    const currentModificationSelections = normalizeFoxholeModificationSelectionMap(state.value.modificationVariantIds);
    const nextModificationSelections = modificationSlot && selectedRecipe?.sourceVariantId
        ? setFoxholeModificationSlotVariantSelection(currentModificationSelections, modificationSlot, selectedRecipe.sourceVariantId)
        : currentModificationSelections;
    const changesModification = JSON.stringify(nextModificationSelections) !== JSON.stringify(currentModificationSelections);
    const nextOrders = changesStructure || changesModification ? [] : [...orders.value];
    const targetMaxOrders = changesStructure
        ? resolveFoxholeStructureMaxOrders(catalog.structureByKey[selectedStructureId])
        : maxOrders.value;
    const nextOrder: FoxholeStructureProductionOrder = {
        recipeId: selection.recipeId,
        parent: isParentRecipe,
        cycles: selection.cycles,
        label: selection.label,
    };
    if (editIndex != null && !changesStructure && editIndex >= 0 && editIndex < nextOrders.length) {
        nextOrders.splice(editIndex, 1, nextOrder);
    } else {
        for (let index = 0; index < selection.orders && nextOrders.length < targetMaxOrders; index += 1) {
            nextOrders.push(nextOrder);
        }
    }
    void props.patchNode({
        ...(changesStructure ? { foxholeKey: selectedStructureId } : {}),
        ...(changesModification ? { modificationVariantIds: nextModificationSelections } : {}),
        productionOrders: clampFoxholeStructureProductionOrders(nextOrders, targetMaxOrders),
    }, editIndex != null ? 'inspector:foxhole-production-update-order' : 'inspector:foxhole-production-add-orders');
    pickerOpen.value = false;
    editingOrderIndex.value = null;
}

function openAddOrders(): void {
    editingOrderIndex.value = null;
    pickerOpen.value = true;
}

function closePicker(): void {
    pickerOpen.value = false;
    editingOrderIndex.value = null;
}

function editOrder(index: number): void {
    if (!canEdit.value || !orders.value[index]) {
        return;
    }
    editingOrderIndex.value = index;
    pickerOpen.value = true;
}

function duplicateOrder(index: number): void {
    const order = orders.value[index];
    if (!canEdit.value || !order || orders.value.length >= maxOrders.value) {
        return;
    }
    patchOrders([...orders.value, { ...order }], 'inspector:foxhole-production-duplicate-order');
}

function removeOrder(index: number): void {
    patchOrders(orders.value.filter((_, entryIndex) => entryIndex !== index), 'inspector:foxhole-production-remove-order');
}

function clearOrders(): void {
    patchOrders([], 'inspector:foxhole-production-clear-orders');
}

function orderLabel(order: FoxholeStructureProductionOrder): string {
    const recipe = productionIndex.recipeById[order.recipeId];
    if (!recipe) {
        return order.recipeId;
    }
    const recipeModel = resolveFoxholeStructureRecipes({
        structureId: recipe.sourceStructureId,
        baseAssetsUrl: assetsBaseUrl,
        itemCatalog,
        structureCatalog: catalog,
        productionIndex,
        includeModifications: recipe.sourceType === 'modification',
        modificationSelections: recipe.sourceSlotId && recipe.sourceVariantId
            ? { [recipe.sourceSlotId]: recipe.sourceVariantId }
            : undefined,
    }).recipes.find(candidate => candidate.id === recipe.id);
    const outputs = recipeModel?.outputs
        .map(resource => resolveFoxholeRecipeResourceLabel(resource, t))
        .filter(Boolean) ?? [];
    return outputs.join(', ') || recipeModel?.title || order.recipeId;
}
</script>

<template>
    <NixieSidebarFormSection
        :bare="bare"
        :title="`Production Orders (${orders.length} / ${maxOrders})`"
        sectionKey="foxhole.structure.production"
        collapsible
        :class="{ 'has-production-orders': orders.length > 0 }"
    >
        <template #actions>
            <NxIconButton
                v-if="canEdit"
                class="nixie-sidebar-row__action"
                icon="ph:plus"
                label="Add Production Orders"
                tooltip="Add Production Orders"
                variant="bare"
                size="sm"
                @click="openAddOrders"
            />
            <NxIconButton
                v-if="canEdit"
                class="nixie-sidebar-row__action"
                icon="ph:trash"
                label="Clear Production Orders"
                tooltip="Clear Production Orders"
                variant="bare"
                size="sm"
                :disabled="orders.length === 0"
                @click="clearOrders"
            />
        </template>
        <div v-if="bare && orders.length > 0" class="foxhole-production-tab-actions">
            <NxIconButton
                v-if="canEdit"
                class="nixie-sidebar-row__action"
                icon="ph:plus"
                label="Add Production Orders"
                tooltip="Add Production Orders"
                variant="bare"
                size="sm"
                @click="openAddOrders"
            />
            <NxIconButton
                v-if="canEdit"
                class="nixie-sidebar-row__action"
                icon="ph:trash"
                label="Clear Production Orders"
                tooltip="Clear Production Orders"
                variant="bare"
                size="sm"
                :disabled="orders.length === 0"
                @click="clearOrders"
            />
        </div>
        <ul v-if="orders.length > 0" class="production-orders">
            <li v-for="(order, index) in orders" :key="`${order.recipeId}-${index}`">
                <span>{{ order.label || orderLabel(order) }}</span>
                <small v-if="order.cycles != null">{{ order.cycles }} cycles</small>
                <span v-else class="production-orders__infinite" aria-label="Unlimited cycles" title="Unlimited cycles">
                    <Icon name="ph:infinity" aria-hidden="true" />
                </span>
                <NxIconButton
                    v-if="canEdit"
                    icon="ph:pencil-simple"
                    label="Edit Order"
                    variant="bare"
                    size="sm"
                    @click="editOrder(index)"
                />
                <NxIconButton
                    v-if="canEdit"
                    icon="ph:copy"
                    label="Duplicate Order"
                    variant="bare"
                    size="sm"
                    :disabled="orders.length >= maxOrders"
                    @click="duplicateOrder(index)"
                />
                <NxIconButton
                    v-if="canEdit"
                    icon="ph:x"
                    label="Remove Order"
                    variant="bare"
                    size="sm"
                    @click="removeOrder(index)"
                />
            </li>
        </ul>
        <div v-if="canEdit && orders.length === 0" class="production-controls">
            <NxButton
                label="Add Production Orders"
                icon="ph:plus"
                @click="openAddOrders"
            />
        </div>
        <FoxholeProductionOrderPickerDialog
            :open="pickerOpen"
            :structureId="foxholeKey"
            :existingOrderCount="Math.max(0, orders.length - (editingOrderIndex == null ? 0 : 1))"
            :modificationVariantIds="normalizeFoxholeModificationSelectionMap(state.modificationVariantIds)"
            :editing="editingOrderIndex != null"
            :initialOrder="editingOrderIndex == null ? null : orders[editingOrderIndex] ?? null"
            @close="closePicker"
            @submit="addOrders"
        />
    </NixieSidebarFormSection>
</template>

<style scoped>
.foxhole-production-tab-actions { display: flex; justify-content: flex-end; gap: var(--nx-space-1); }
.production-orders { display: grid; gap: var(--nx-space-1); margin: 0; padding: 0; list-style: none; }
.production-orders li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; gap: var(--nx-space-1); align-items: center; }
.production-orders span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.production-orders small { color: var(--nx-text-muted); }
.production-orders__infinite { display: grid; place-items: center; width: 1.1rem; color: var(--nx-text-muted); }
.production-orders__infinite :deep(svg) { width: 1rem; height: 1rem; }
.production-controls { display: grid; gap: var(--nx-space-2); }
:deep(.has-production-orders .nixie-sidebar-form-section__body) { padding-bottom: 0; }
</style>
