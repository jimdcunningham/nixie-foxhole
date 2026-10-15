<script setup lang="ts">
import { computed } from 'vue';
import NxMultiSelect from '#nixie/components/NxMultiSelect.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { formatFoxholeStockpileLimits, resolveFoxholeStockpileGroupSelection, resolveFoxholeStockpileOptions } from '#foxhole/plugins/foxhole/nixie/stockpile-groups.ts';
import type { FoxholeStockpileSelectionGroup } from '#foxhole/plugins/foxhole/nixie/stockpile-groups.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { NixieInspectorContributionNode } from '#nixie/plugins/nixie/registry/index.ts';
import type { NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/index.ts';
import { createFoxholeItemHoverEntry, createFoxholeStructureHoverEntry, resolveFoxholeItemDefaultIconUrl, resolveFoxholeStructureDefaultIconUrl } from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';

const props = defineProps<{
    groups: FoxholeStockpileSelectionGroup[];
    node: NixieInspectorContributionNode<Record<string, unknown>>;
    canEdit: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
    patchNodeById?: (nodeId: string, patch: Record<string, unknown>, reason: string) => void | Promise<void>;
    showAsset: (entry: NixieResolvedAssetEntry) => void;
    hideAsset: () => void;
}>();
const { assetBaseUrl, t } = useFoxholeLocalization();
const runtime = useNixieRuntime();
const editable = computed(() => props.canEdit && (props.node.targetIds.length === 1 || Boolean(props.patchNodeById)));
function liveState(id: string): Partial<FoxholeStructureState> {
    const scene = runtime.projectStore.scene;
    void scene?.revision.value;
    return (scene?.getNodeById(id)?.boardState ?? props.node.snapshots.find(snapshot => snapshot.id === id)?.state
        ?? props.node.snapshot.state ?? {}) as Partial<FoxholeStructureState>;
}
const rows = computed(() => {
    const items = getFoxholeItemCatalog(assetBaseUrl.value);
    const structures = getFoxholeStructureCatalog(assetBaseUrl.value);
    return props.groups.map(group => {
        const options = resolveFoxholeStockpileOptions(group, items.assets, structures.assets, asset => t(asset.nameLocalizationId, asset.name));
        const selections = props.node.targetIds.map(id => {
            const state = liveState(id);
            return resolveFoxholeStockpileGroupSelection(group, state.markedStockpileItems, state.markedItemCodenames);
        });
        const selected = selections.every(value => JSON.stringify(value) === JSON.stringify(selections[0])) ? selections[0] ?? [] : [];
        return { group, options, selected };
    });
});
async function updateGroup(group: FoxholeStockpileSelectionGroup, value: string[]): Promise<void> {
    if (!editable.value) return;
    for (const id of props.node.targetIds) {
        const state = liveState(id);
        const markedStockpileItems = { ...(state.markedStockpileItems ?? {}), [group.key]: value };
        markedStockpileItems[group.key] = resolveFoxholeStockpileGroupSelection(group, markedStockpileItems, []);
        const patch = { markedStockpileItems };
        if (props.node.targetIds.length > 1 && props.patchNodeById) await props.patchNodeById(id, patch, 'inspector:foxhole-stockpile-cargo');
        else await props.patchNode(patch, 'inspector:foxhole-stockpile-cargo');
    }
}
type Option = ReturnType<typeof resolveFoxholeStockpileOptions>[number];
function icon(option: Option): string {
    return option.item ? resolveFoxholeItemDefaultIconUrl(option.item) : resolveFoxholeStructureDefaultIconUrl(option.structure);
}
function show(option: Option): void {
    const entry = option.structure
        ? createFoxholeStructureHoverEntry(option.structure, asset => t(asset.nameLocalizationId, asset.name), asset => t(asset.descriptionLocalizationId, asset.description), asset => t(asset.categoryNameLocalizationId, asset.categoryName))
        : createFoxholeItemHoverEntry(option.item, option.value, () => option.label, item => item ? t(item.descriptionLocalizationId, item.description) : '', item => item ? t(item.categoryNameLocalizationId, item.categoryName) : '');
    props.showAsset(entry);
}
</script>

<template>
    <div class="foxhole-stockpile-groups">
        <div v-for="row in rows" :key="row.group.key" role="group" :aria-label="row.group.label" class="foxhole-stockpile-groups__group">
            <h4>{{ row.group.label }}</h4>
            <NxMultiSelect
                :modelValue="row.selected"
                :options="row.options"
                placeholder="Select stored cargo..."
                searchPlaceholder="Search cargo…"
                searchable
                clearable
                commitOnClose
                :disabled="!editable || !row.options.length"
                @update:model-value="updateGroup(row.group, $event)"
            />
            <div v-if="row.selected.length" class="foxhole-stockpile-groups__selected">
                <div v-for="option in row.options.filter(option => row.selected.includes(option.value))" :key="option.value" class="nixie-build-icon-shell">
                <button type="button" class="nixie-build-icon"
                    :disabled="!editable" :aria-label="`Remove ${option.label}`" :title="option.label"
                    @click="updateGroup(row.group, row.selected.filter(code => code !== option.value))"
                    @mouseenter="show(option)" @focus="show(option)" @mouseleave="hideAsset" @blur="hideAsset">
                    <img v-if="icon(option)" :src="icon(option)" :alt="option.label" />
                    <span v-else>{{ option.label }}</span>
                </button>
                </div>
            </div>
            <p v-if="formatFoxholeStockpileLimits(row.group)" class="nixie-inspector-hint">{{ formatFoxholeStockpileLimits(row.group) }}</p>
        </div>
    </div>
</template>

<style scoped>
.foxhole-stockpile-groups, .foxhole-stockpile-groups__group { display: grid; gap: var(--nx-space-2); }
.foxhole-stockpile-groups { gap: var(--nx-space-4); }
h4 { margin: 0; font-size: inherit; font-weight: 500; }
p { margin: 0; }
.foxhole-stockpile-groups__selected { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: var(--nx-space-2); }
.foxhole-stockpile-groups__selected img { width: 100%; height: 100%; object-fit: contain; }
</style>
