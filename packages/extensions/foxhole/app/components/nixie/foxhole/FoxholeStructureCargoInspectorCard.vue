<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import FoxholeStockpileGroupsInspector from './FoxholeStockpileGroupsInspector.vue';
import { resolveFoxholeStockpileSelectionGroups } from '#foxhole/plugins/foxhole/nixie/stockpile-groups.ts';
import NxButton from '#nixie/components/NxButton.vue';
import NxMultiSelect from '#nixie/components/NxMultiSelect.vue';
import NxNumberInput from '#nixie/components/NxNumberInput.vue';
import NixieAssetIncompleteBadge from '#nixie/components/nixie/NixieAssetIncompleteBadge.vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import {
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    clampMarkedItemCodenames,
    hasFoxholeHoldProfileItemSelection,
    normalizeMarkedItemCodenames,
    resolveFoxholeAssetHoldProfile,
    resolveFoxholeHoldProfileItemOptions,
    resolveFoxholeHoldProfileMarkedItemLimit,
} from '#foxhole/plugins/foxhole/nixie/hold-profile.ts';
import {
    createFoxholeItemHoverEntry,
    createFoxholeStructureHoverEntry,
    FOXHOLE_ITEM_FALLBACK_ICON,
    resolveFoxholeItemDefaultIconUrl,
    resolveFoxholeStoredStructureAsset,
    resolveFoxholeStructureDefaultIconUrl,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import {
    formatMarkedCargoOverlayOverridePrompt,
} from '#foxhole/plugins/foxhole/nixie/marked-cargo-overlay.ts';
import {
    getFoxholeMarkedCargoOverlayDevOverride,
    resolveFoxholeMarkedCargoOverlayLocalOffset,
    setFoxholeMarkedCargoOverlayDevOverride,
    useFoxholeMarkedCargoOverlayDevOverrides,
} from '#foxhole/plugins/foxhole/nixie/marked-cargo-overlay-dev.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import type {
    NixieAssetBrowserContext,
    NixieInspectorContributionNode,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/index.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

const showDevCargoOverlayControls = import.meta.dev;
const { devOverridesByFoxholeKey } = useFoxholeMarkedCargoOverlayDevOverrides();

const props = defineProps<{
    bare?: boolean;
    node: NixieInspectorContributionNode<Record<string, unknown>>;
    canEdit: boolean;
    effectiveLocked: boolean;
    patchNode: (patch: Record<string, unknown>, reason: string) => void | Promise<void>;
    patchNodeById?: (nodeId: string, patch: Record<string, unknown>, reason: string) => void | Promise<void>;
}>();

defineEmits<{
    contextmenu: [event: MouseEvent];
}>();

defineOptions({
    inheritAttrs: false,
});

const { assetBaseUrl, t } = useFoxholeLocalization();
const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();

const state = computed(() => (props.node.snapshot.state ?? {}) as Partial<FoxholeStructureState>);
const hasMultiTargetSelection = computed(() => props.node.targetIds.length > 1);
const uniformFoxholeKey = computed(() => {
    const snapshots = props.node.snapshots.length > 0
        ? props.node.snapshots
        : [props.node.snapshot];

    const keys = [...new Set(snapshots
        .map(snapshot => String(snapshot.state?.foxholeKey ?? '').trim())
        .filter(Boolean))];

    return keys.length === 1 ? keys[0] ?? '' : '';
});
const foxholeKey = computed(() => uniformFoxholeKey.value || String(state.value.foxholeKey ?? '').trim());
const structureCatalog = computed(() => getFoxholeStructureCatalog(assetBaseUrl.value));
const manifestStructure = computed(() => (
    foxholeKey.value
        ? structureCatalog.value.structureByKey[foxholeKey.value]
        ?? structureCatalog.value.structureByKey[foxholeKey.value.toLowerCase()]
        ?? null
        : null
));
const manifestMarkedCargoOverlay = computed(() => manifestStructure.value?.markedCargoOverlay ?? null);
const stockpileGroups = computed(() => resolveFoxholeStockpileSelectionGroups(manifestStructure.value?.stockpiles));
const structureAsset = computed(() => (
    foxholeKey.value
        ? structureCatalog.value.assetByKey[foxholeKey.value]
        ?? structureCatalog.value.assetByKey[foxholeKey.value.toLowerCase()]
        ?? null
        : null
));
const holdTargetLabel = computed(() => (structureAsset.value?.isVehicle ? 'vehicle' : 'structure'));
const itemCatalog = computed(() => getFoxholeItemCatalog(assetBaseUrl.value));
const holdProfile = computed(() => (
    foxholeKey.value
        ? resolveFoxholeAssetHoldProfile(structureCatalog.value, foxholeKey.value)
        : null
));
const canSelectItems = computed(() => hasFoxholeHoldProfileItemSelection(holdProfile.value));
const itemOptions = computed(() => {
    if (!holdProfile.value || !canSelectItems.value) {
        return [];
    }

    return resolveFoxholeHoldProfileItemOptions(
        holdProfile.value,
        itemCatalog.value,
        (item, codename) => item
            ? t(item.nameLocalizationId, item.name)
            : codename,
    );
});
const itemOptionByCodename = computed(() => new Map(
    itemOptions.value.map(option => [option.codename, option]),
));
const markedItemLimit = computed(() => resolveFoxholeHoldProfileMarkedItemLimit(holdProfile.value));
const multiSelectOptions = computed(() => itemOptions.value.map(option => ({
    value: option.codename,
    label: option.label,
})));
const allowedCodenameSet = computed(() => new Set(itemOptions.value.map(option => option.codename)));

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

function resolveItemLabel(item: ReturnType<typeof resolveFoxholeHoldProfileItemOptions>[number]['item'], codename: string): string {
    return item ? t(item.nameLocalizationId, item.name) : codename;
}

function resolveItemDescription(item: ReturnType<typeof resolveFoxholeHoldProfileItemOptions>[number]['item']): string {
    return item ? t(item.descriptionLocalizationId, item.description) : '';
}

function resolveItemCategory(item: ReturnType<typeof resolveFoxholeHoldProfileItemOptions>[number]['item']): string {
    return item ? t(item.categoryNameLocalizationId, item.categoryName) : '';
}

function createSelectedItemHoverEntry(codename: string): NixieResolvedAssetEntry | null {
    const option = itemOptionByCodename.value.get(codename);
    if (!option) {
        return null;
    }

    const storedStructure = resolveFoxholeStoredStructureAsset(option.codename, option.item, structureCatalog.value);
    if (storedStructure) {
        return createFoxholeStructureHoverEntry(
            storedStructure,
            () => option.label,
            asset => t(asset.descriptionLocalizationId, asset.description),
            asset => t(asset.categoryNameLocalizationId, asset.categoryName),
        );
    }

    return createFoxholeItemHoverEntry(
        option.item,
        option.codename,
        resolveItemLabel,
        resolveItemDescription,
        resolveItemCategory,
    );
}

function buildIconStyle(iconUrl: string): { backgroundImage: string; } {
    return {
        backgroundImage: `url(${iconUrl})`,
    };
}

function getSelectedItemIconUrl(codename: string): string {
    const option = itemOptionByCodename.value.get(codename);
    if (!option) return '';
    return option.item
        ? resolveFoxholeItemDefaultIconUrl(option.item)
        : resolveFoxholeStructureDefaultIconUrl(resolveFoxholeStoredStructureAsset(
            option.codename, option.item, structureCatalog.value,
        ));
}

function resolveLiveMarkedItemCodenamesForTargets(): string[] {
    const scene = runtime.projectStore.scene;
    if (!scene || props.node.targetIds.length === 0) {
        return normalizeMarkedItemCodenames(state.value.markedItemCodenames);
    }

    void scene.revision.value;
    const selections = props.node.targetIds.map(nodeId => {
        const node = scene.getNodeById(nodeId);
        return normalizeMarkedItemCodenames(
            (node?.boardState as Partial<FoxholeStructureState> | undefined)?.markedItemCodenames,
        );
    });

    if (!selections.length) {
        return [];
    }

    const first = JSON.stringify(selections[0]);
    const allMatch = selections.every(selection => JSON.stringify(selection) === first);
    return allMatch ? selections[0] ?? [] : [];
}

const markedItemCodenames = computed(() => clampMarkedItemCodenames(
    resolveLiveMarkedItemCodenamesForTargets().filter(codename => allowedCodenameSet.value.has(codename)),
    markedItemLimit.value,
));

const canEdit = computed(() => (
    props.canEdit
    && !props.effectiveLocked
    && Boolean(uniformFoxholeKey.value)
    && canSelectItems.value
));
const selectionHint = computed(() => {
    if (!hasMultiTargetSelection.value || uniformFoxholeKey.value) {
        return '';
    }

    return 'Select a single structure type to edit stored items.';
});
const capacitySummary = computed(() => {
    const profile = holdProfile.value;
    if (!profile) {
        return '';
    }

    const target = holdTargetLabel.value;

    if (profile.mode === 'inventory' && profile.capacity) {
        const stackLimit = profile.stackLimit ? `, stacks up to ${profile.stackLimit} per slot` : '';
        return `This ${target} has ${profile.capacity} inventory slot${profile.capacity === 1 ? '' : 's'}${stackLimit}.`;
    }

    if (profile.mode === 'fuel-tank') {
        return `This ${target} holds one fuel type at a time.`;
    }

    if (profile.mode === 'crate-stockpile' && profile.capacity) {
        return `This ${target} can hold up to ${profile.capacity} crate${profile.capacity === 1 ? '' : 's'}.`;
    }

    if (profile.capacity != null && profile.capacity > 0) {
        return `This ${target} can hold up to ${profile.capacity} item${profile.capacity === 1 ? '' : 's'}.`;
    }

    if (profile.allowsAnyItem) {
        return `This ${target} can hold any item type.`;
    }

    return '';
});

function onMarkedItemsChange(next: string[]): void {
    const normalized = clampMarkedItemCodenames(
        normalizeMarkedItemCodenames(next).filter(codename => allowedCodenameSet.value.has(codename)),
        markedItemLimit.value,
    );

    void props.patchNode(
        { markedItemCodenames: normalized },
        'inspector:foxhole-structure-cargo-select',
    );
}

function removeMarkedItem(codename: string): void {
    if (!canEdit.value) {
        return;
    }

    onMarkedItemsChange(markedItemCodenames.value.filter(entry => entry !== codename));
}

function showSelectedItemHoverCard(codename: string): void {
    const entry = createSelectedItemHoverEntry(codename);
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideSelectedItemHoverCard(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}

function showStockpileAsset(entry: NixieResolvedAssetEntry): void {
    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function getSelectedItemLabel(codename: string): string {
    return itemOptionByCodename.value.get(codename)?.label ?? codename;
}

void devOverridesByFoxholeKey;

const effectiveMarkedCargoOffset = computed(() => resolveFoxholeMarkedCargoOverlayLocalOffset({
    foxholeKey: foxholeKey.value,
    manifestOverlay: manifestMarkedCargoOverlay.value,
}));

const devMarkedCargoOverlay = computed(() => getFoxholeMarkedCargoOverlayDevOverride(foxholeKey.value));

const cargoOverlayOverridePrompt = computed(() => formatMarkedCargoOverlayOverridePrompt(
    foxholeKey.value,
    effectiveMarkedCargoOffset.value,
));

function updateDevMarkedCargoOffsetX(value: number): void {
    setFoxholeMarkedCargoOverlayDevOverride(foxholeKey.value, { offsetX: value });
}

function updateDevMarkedCargoOffsetY(value: number): void {
    setFoxholeMarkedCargoOverlayDevOverride(foxholeKey.value, { offsetY: value });
}

function resetDevMarkedCargoOverlay(): void {
    setFoxholeMarkedCargoOverlayDevOverride(foxholeKey.value, null);
}

async function copyCargoOverlayOverridePrompt(): Promise<void> {
    if (!import.meta.client || !navigator?.clipboard?.writeText) {
        return;
    }

    await navigator.clipboard.writeText(cargoOverlayOverridePrompt.value);
}

onBeforeUnmount(() => {
    sidebarAssetHoverCard?.hideAsset();
});
</script>

<template>
    <NixieSidebarFormSection
        :bare="bare"
        class="foxhole-structure-cargo-card"
        title="Storage"
        sectionKey="foxhole.inspector.cargo"
        collapsible
    >
        <p
            v-if="selectionHint"
            class="nixie-inspector-hint"
        >
            {{ selectionHint }}
        </p>

        <FoxholeStockpileGroupsInspector
            v-if="stockpileGroups.length"
            :groups="stockpileGroups"
            :node="node"
            :canEdit="canEdit"
            :patchNode="patchNode"
            :patchNodeById="patchNodeById"
            :showAsset="showStockpileAsset"
            :hideAsset="scheduleHideSelectedItemHoverCard"
        />
        <template v-else>
        <NxMultiSelect
            :modelValue="markedItemCodenames"
            :options="multiSelectOptions"
            :placeholder="markedItemLimit === 1 ? 'Select stored item...' : 'Select stored items...'"
            searchable
            clearable
            commitOnClose
            searchPlaceholder="Search items…"
            :maxSelections="markedItemLimit ?? undefined"
            :disabled="!canEdit"
            @update:model-value="onMarkedItemsChange"
        />

        <div
            v-if="markedItemCodenames.length > 0"
            class="foxhole-structure-cargo-card__selected"
        >
            <div
                v-for="codename in markedItemCodenames"
                :key="codename"
                class="nixie-build-icon-shell"
            >
                <button
                    type="button"
                    class="nixie-build-icon"
                    :disabled="!canEdit"
                    :aria-label="`Remove ${getSelectedItemLabel(codename)}`"
                    :title="getSelectedItemLabel(codename)"
                    :data-tooltip="getSelectedItemLabel(codename)"
                    data-tooltip-position="top"
                    @mouseenter="showSelectedItemHoverCard(codename)"
                    @focus="showSelectedItemHoverCard(codename)"
                    @mouseleave="scheduleHideSelectedItemHoverCard"
                    @blur="scheduleHideSelectedItemHoverCard"
                    @click="removeMarkedItem(codename)"
                >
                    <div
                        v-if="getSelectedItemIconUrl(codename)"
                        class="build-icon-img"
                        :style="buildIconStyle(getSelectedItemIconUrl(codename))"
                    />
                    <div v-else class="build-icon-extension">
                        <Icon :name="FOXHOLE_ITEM_FALLBACK_ICON" />
                    </div>
                    <NixieAssetIncompleteBadge
                        v-if="createSelectedItemHoverEntry(codename)"
                        :entry="createSelectedItemHoverEntry(codename)!"
                    />
                </button>
            </div>
        </div>
        <p v-if="!selectionHint && capacitySummary" class="nixie-inspector-hint">
            {{ capacitySummary }}
        </p>
        </template>
        <div
            v-if="showDevCargoOverlayControls && foxholeKey"
            class="foxhole-structure-cargo-card__dev"
        >
            <div class="nx-field foxhole-structure-cargo-card__offset" role="group" aria-label="Storage Overlay Offset">
                <span class="nx-field__label">Offset</span>
                <div class="nixie-sidebar-form-field-row">
                    <NxNumberInput
                        :modelValue="effectiveMarkedCargoOffset.x"
                        class="foxhole-structure-cargo-card__offset-field"
                        label="X"
                        suffix="px"
                        :step="1"
                        @update:model-value="updateDevMarkedCargoOffsetX"
                    />
                    <NxNumberInput
                        :modelValue="effectiveMarkedCargoOffset.y"
                        class="foxhole-structure-cargo-card__offset-field"
                        label="Y"
                        suffix="px"
                        :step="1"
                        @update:model-value="updateDevMarkedCargoOffsetY"
                    />
                </div>
            </div>
            <NxButton
                label="Copy Handoff Prompt"
                @click="copyCargoOverlayOverridePrompt"
            />
            <NxButton
                label="Reset Offset Overrides"
                variant="danger"
                :disabled="!devMarkedCargoOverlay"
                @click="resetDevMarkedCargoOverlay"
            />
        </div>
    </NixieSidebarFormSection>
</template>

<style scoped>
.foxhole-structure-cargo-card {
    container-type: inline-size;
    container-name: foxhole-storage;
}

.foxhole-structure-cargo-card .nixie-inspector-hint {
    text-align: center;
}

@container foxhole-storage (min-width: 240px) {
    .foxhole-structure-cargo-card__offset {
        grid-template-columns: 4.5rem minmax(0, 1fr);
        column-gap: var(--nx-space-2);
        align-items: start;
    }

    .foxhole-structure-cargo-card__offset > .nx-field__label {
        display: flex;
        align-items: center;
        min-height: var(--nx-control-height);
    }
}

.foxhole-structure-cargo-card__dev {
    display: grid;
    gap: var(--nx-space-2);
}

.foxhole-structure-cargo-card__dev :deep(.foxhole-structure-cargo-card__offset-field) {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
}

.foxhole-structure-cargo-card__dev :deep(.foxhole-structure-cargo-card__offset-field > .nx-field__label) {
    display: flex;
    align-items: center;
    min-height: var(--nx-control-height);
}

.foxhole-structure-cargo-card__dev :deep(.nx-field__hint) {
    grid-column: 1 / -1;
}

.foxhole-structure-cargo-card__selected {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: var(--nx-space-2);
}
</style>
