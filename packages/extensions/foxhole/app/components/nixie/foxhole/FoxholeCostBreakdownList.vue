<script setup lang="ts">
import { computed } from 'vue';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import type {
    FoxholeItemAsset,
    FoxholeStructureAsset,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    createFoxholeItemHoverEntry,
    createFoxholeStructureHoverEntry,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type {
    NixieAssetBrowserContext,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/types.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

export interface FoxholeCostBreakdownEntry {
    id: string;
    name: string;
    quantity: number;
    iconUrl?: string | null;
    item?: FoxholeItemAsset | null;
    structure?: FoxholeStructureAsset | null;
}

const props = withDefaults(defineProps<{
    entries: readonly FoxholeCostBreakdownEntry[];
    /** Bleed rows to the edges of a padded sidebar form section. */
    flush?: boolean;
    /** Denser rows for compact recipe / list chrome. */
    compact?: boolean;
    /** `cost` (red) for spend, `gain` (green) for produce, `neutral` for plain counts. */
    quantityTone?: 'cost' | 'gain' | 'neutral';
}>(), {
    flush: false,
    compact: false,
    quantityTone: 'cost',
});

const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();
const { t } = useFoxholeLocalization();

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});
const decimalNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
});

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

function formatQuantity(value: number): string {
    const formattedValue = Number.isInteger(value)
        ? wholeNumberFormatter.format(value)
        : decimalNumberFormatter.format(value);

    return `x${formattedValue}`;
}

function resolveItemLabel(item: FoxholeItemAsset | null, codename: string): string {
    return item ? t(item.nameLocalizationId, item.name) : codename;
}

function resolveItemDescription(item: FoxholeItemAsset | null): string {
    return item ? t(item.descriptionLocalizationId, item.description) : '';
}

function resolveItemCategory(item: FoxholeItemAsset | null): string {
    return item ? t(item.categoryNameLocalizationId, item.categoryName) : '';
}

function resolveStructureLabel(structure: FoxholeStructureAsset): string {
    return t(structure.nameLocalizationId, structure.name);
}

function resolveStructureDescription(structure: FoxholeStructureAsset): string {
    return t(structure.descriptionLocalizationId, structure.description);
}

function resolveStructureCategory(structure: FoxholeStructureAsset): string {
    return t(structure.categoryNameLocalizationId, structure.categoryName);
}

function createHoverEntry(resource: FoxholeCostBreakdownEntry): NixieResolvedAssetEntry | null {
    if (resource.item) {
        const codename = String(resource.item.codeName ?? resource.item.foxholeKey ?? resource.id).trim();
        if (!codename) {
            return null;
        }

        return createFoxholeItemHoverEntry(
            resource.item,
            codename,
            resolveItemLabel,
            resolveItemDescription,
            resolveItemCategory,
        );
    }

    if (resource.structure) {
        return createFoxholeStructureHoverEntry(
            resource.structure,
            resolveStructureLabel,
            resolveStructureDescription,
            resolveStructureCategory,
        );
    }

    return null;
}

function showResourceHover(resource: FoxholeCostBreakdownEntry): void {
    const entry = createHoverEntry(resource);
    if (!entry) {
        return;
    }

    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideResourceHover(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}
</script>

<template>
    <ul
        class="foxhole-cost-breakdown"
        :class="{
            'foxhole-cost-breakdown--flush': props.flush,
            'foxhole-cost-breakdown--compact': props.compact,
        }"
    >
        <li
            v-for="resource in props.entries"
            :key="resource.id"
            class="foxhole-cost-breakdown__row"
            @mouseenter="showResourceHover(resource)"
            @mouseleave="scheduleHideResourceHover"
        >
            <div class="foxhole-cost-breakdown__icon">
                <NxEntityIcon
                    :src="resource.iconUrl"
                    :label="resource.name"
                />
            </div>

            <span class="foxhole-cost-breakdown__name">{{ resource.name }}</span>

            <span
                class="foxhole-cost-breakdown__quantity"
                :class="`foxhole-cost-breakdown__quantity--${props.quantityTone}`"
            >
                {{ formatQuantity(resource.quantity) }}
            </span>
        </li>
    </ul>
</template>

<style scoped>
.foxhole-cost-breakdown {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
    width: 100%;
    min-width: 0;
}

.foxhole-cost-breakdown--flush {
    width: auto;
    margin: calc(var(--nx-space-2) * -1) calc(var(--nx-space-3) * -1) calc(var(--nx-space-3) * -1);
}

.foxhole-cost-breakdown__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--nx-space-1);
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: var(--nx-space-1) 0;
    min-height: 28px;
}

.foxhole-cost-breakdown--compact .foxhole-cost-breakdown__row {
    min-height: 22px;
    padding: 2px 0;
}

.foxhole-cost-breakdown--flush .foxhole-cost-breakdown__row {
    padding-inline: var(--nx-space-3);
}

.foxhole-cost-breakdown__row + .foxhole-cost-breakdown__row {
    border-top: 1px solid var(--nx-border);
}

.foxhole-cost-breakdown--compact .foxhole-cost-breakdown__row + .foxhole-cost-breakdown__row {
    border-top-color: transparent;
}

.foxhole-cost-breakdown__row:hover {
    background: var(--nx-surface-raised);
}

.foxhole-cost-breakdown__icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}

.foxhole-cost-breakdown__icon :deep(.nx-entity-icon) {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.foxhole-cost-breakdown--compact .foxhole-cost-breakdown__icon :deep(.nx-entity-icon) {
    width: 12px;
    height: 12px;
}

.foxhole-cost-breakdown__icon :deep(.nx-entity-icon img) {
    object-fit: contain;
}

.foxhole-cost-breakdown__icon :deep(.nx-entity-icon span) {
    font-size: 8px;
}

.foxhole-cost-breakdown__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-font-weight);
    line-height: var(--nx-leading-tight);
    color: var(--nx-text);
}

.foxhole-cost-breakdown--compact .foxhole-cost-breakdown__name,
.foxhole-cost-breakdown--compact .foxhole-cost-breakdown__quantity {
    font-size: var(--nx-text-xs);
}

.foxhole-cost-breakdown__quantity {
    font-size: var(--nx-text-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: var(--nx-leading-tight);
}

.foxhole-cost-breakdown__quantity--cost {
    color: var(--nx-danger);
}

.foxhole-cost-breakdown__quantity--gain {
    color: var(--nx-success);
}

.foxhole-cost-breakdown__quantity--neutral {
    color: var(--nx-text-muted);
}
</style>
