<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Fuse from 'fuse.js';
import NxButton from '#nixie/components/NxButton.vue';
import NxEditorToolbar from '#nixie/components/NxEditorToolbar.vue';
import NxIcon from '#nixie/components/NxIcon.vue';
import NxMultiSelect from '#nixie/components/NxMultiSelect.vue';
import type { NxMultiSelectOption } from '#nixie/components/NxMultiSelect.vue';
import NxSearchInput from '#nixie/components/NxSearchInput.vue';
import NxTooltip from '#nixie/components/NxTooltip.vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { focusFoxholeMapSearchEntry } from '#foxhole/composables/foxholeMapNavigation.ts';
import { FOXHOLE_MAP_REGIONS } from '#foxhole/plugins/foxhole/nixie/map/constants.ts';
import {
    FOXHOLE_MAP_SETTING_KEYS,
    isFoxholeMapUserSettingKey,
    readFoxholeMapSettings,
    serializeFoxholeMapStringList,
} from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import {
    buildFoxholeMapSearchDataset,
    foxholeMapSearchCacheRef,
} from '#foxhole/plugins/foxhole/nixie/map/search.ts';
import type {
    FoxholeMapSearchCacheEntry,
    FoxholeMapSearchEntry,
    FoxholeMapSearchEntryType,
} from '#foxhole/plugins/foxhole/nixie/map/search.ts';

const runtime = useNixieRuntime();
const settingsStore = useNixieSettingsStore();

/** `null` = collapsed toolbar search; string (including '') = open. */
const searchQuery = ref<string | null>(null);
const searchInputRef = ref<{ focus: () => void; } | null>(null);
const activeResultIndex = ref(-1);
const resultButtons = ref<Array<HTMLButtonElement | null>>([]);

const mapSettings = computed(() => readFoxholeMapSettings(
    runtime.projectStore.settings,
    settingId => settingsStore.getValueOr(settingId, ''),
));

const searchOpen = computed(() => searchQuery.value !== null);
const searchActive = computed(() => (searchQuery.value ?? '').trim().length > 0);

const regionMultiSelectOptions = computed<NxMultiSelectOption[]>(() => [...FOXHOLE_MAP_REGIONS]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(region => ({
        value: region.key,
        label: region.name,
    })));

const locationSearchDataset = computed(() => buildFoxholeMapSearchDataset(
    foxholeMapSearchCacheRef.value as Record<string, FoxholeMapSearchCacheEntry>,
    {
        visibleRegionKeys: mapSettings.value.regionKeys,
    },
));

const locationSearchFuse = computed(() => new Fuse(locationSearchDataset.value.entries, {
    includeScore: true,
    shouldSort: true,
    threshold: 0.3,
    ignoreLocation: true,
    keys: [
        { name: 'label', weight: 0.7 },
        { name: 'regionLabel', weight: 0.2 },
        { name: 'searchLabel', weight: 0.1 },
    ],
}));

const searchResults = computed<FoxholeMapSearchEntry[]>(() => {
    const query = (searchQuery.value ?? '').trim();
    if (!query) {
        return [];
    }

    return locationSearchFuse.value.search(query, { limit: 12 }).map(result => result.item);
});

const activeResult = computed(() => {
    const index = activeResultIndex.value;
    if (index < 0 || index >= searchResults.value.length) {
        return null;
    }
    return searchResults.value[index] ?? null;
});

defineExpose({
    searchOpen,
    searchActive,
});

function patchSettings(patch: Record<string, boolean | number | string>, reason: string): void {
    const projectPatch: Record<string, boolean | number | string> = {};

    for (const [settingId, value] of Object.entries(patch)) {
        if (isFoxholeMapUserSettingKey(settingId)) {
            settingsStore.setValue(settingId, value, { reason });
            continue;
        }
        projectPatch[settingId] = value;
    }

    if (Object.keys(projectPatch).length > 0) {
        runtime.projectStore.patchSettings(projectPatch, reason);
    }
}

function onRegionKeysChange(nextRegionKeys: string[]): void {
    patchSettings({
        [FOXHOLE_MAP_SETTING_KEYS.regionKeys]: serializeFoxholeMapStringList(nextRegionKeys),
    }, 'foxhole-war-nx:region-keys');
}

function toggleMapEnabled(): void {
    patchSettings({
        [FOXHOLE_MAP_SETTING_KEYS.enabled]: !mapSettings.value.enabled,
    }, 'foxhole-war-nx:enabled');
}

function openSearch(): void {
    if (!mapSettings.value.enabled) {
        patchSettings({
            [FOXHOLE_MAP_SETTING_KEYS.enabled]: true,
        }, 'foxhole-war-nx:search-enable-map');
    }

    if (searchQuery.value === null) {
        searchQuery.value = '';
    }

    void nextTick(() => searchInputRef.value?.focus());
}

function closeSearch(): void {
    searchQuery.value = null;
    activeResultIndex.value = -1;
    (document.activeElement as HTMLElement | null)?.blur();
}

function toggleSearch(): void {
    if (searchOpen.value) {
        closeSearch();
        return;
    }
    openSearch();
}

function getEntryTypeLabel(type: FoxholeMapSearchEntryType): string {
    switch (type) {
        case 'region':
            return 'Region';
        case 'town':
            return 'Town';
        case 'district':
            return 'District';
        default:
            return 'Location';
    }
}

function getResultId(index: number): string {
    return `foxhole-war-nx-map-search-result-${index}`;
}

function setResultButton(element: HTMLButtonElement | null, index: number): void {
    resultButtons.value[index] = element;
}

function setActiveResultIndex(index: number): void {
    if (searchResults.value.length === 0) {
        activeResultIndex.value = -1;
        return;
    }

    const maxIndex = searchResults.value.length - 1;
    activeResultIndex.value = Math.min(Math.max(index, 0), maxIndex);
}

function focusLocation(entry: FoxholeMapSearchEntry): void {
    focusFoxholeMapSearchEntry({
        runtime,
        mapSettings: mapSettings.value,
        entry,
        ensureMapEnabled: true,
        reason: 'foxhole-war-nx:search-focus',
    });
    closeSearch();
}

function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        if ((searchQuery.value ?? '').length > 0) {
            searchQuery.value = '';
            activeResultIndex.value = -1;
            event.preventDefault();
            return;
        }

        closeSearch();
        event.preventDefault();
        return;
    }

    const resultCount = searchResults.value.length;
    if (resultCount <= 0) {
        return;
    }

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            setActiveResultIndex(activeResultIndex.value + 1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            setActiveResultIndex(
                activeResultIndex.value <= 0
                    ? resultCount - 1
                    : activeResultIndex.value - 1,
            );
            break;
        case 'Home':
            event.preventDefault();
            setActiveResultIndex(0);
            break;
        case 'End':
            event.preventDefault();
            setActiveResultIndex(resultCount - 1);
            break;
        case 'Enter': {
            const target = activeResult.value ?? searchResults.value[0] ?? null;
            if (!target) {
                return;
            }
            event.preventDefault();
            focusLocation(target);
            break;
        }
        default:
            break;
    }
}

watch(searchQuery, () => {
    activeResultIndex.value = -1;
});

watch(searchResults, results => {
    resultButtons.value = resultButtons.value.slice(0, results.length);
    if (results.length === 0) {
        activeResultIndex.value = -1;
        return;
    }
    if (activeResultIndex.value >= results.length) {
        activeResultIndex.value = results.length - 1;
    }
});

watch(activeResultIndex, async index => {
    if (index < 0) {
        return;
    }
    await nextTick();
    resultButtons.value[index]?.scrollIntoView({ block: 'nearest' });
});

watch(() => mapSettings.value.enabled, enabled => {
    if (!enabled && searchOpen.value) {
        closeSearch();
    }
});
</script>

<template>
    <div class="foxhole-war-nx-map-toolbar">
        <NxEditorToolbar
            variant="secondary"
            sidebar
            :expanded="searchOpen"
            :overflowVisible="searchOpen"
        >
            <template #main>
                <template v-if="searchOpen">
                    <div class="foxhole-war-nx-map-toolbar__search-field">
                        <NxSearchInput
                            ref="searchInputRef"
                            :modelValue="searchQuery ?? ''"
                            placeholder="Search Map"
                            aria-label="Search Map"
                            size="sm"
                            :showClear="false"
                            @update:model-value="searchQuery = $event"
                            @keydown="handleSearchKeydown"
                        >
                            <template #suffix>
                                <button
                                    type="button"
                                    class="foxhole-war-nx-map-toolbar__search-close"
                                    aria-label="Close Search"
                                    @click="closeSearch()"
                                >
                                    <NxIcon name="ph:x" size="sm" label="Close Search" />
                                </button>
                            </template>
                        </NxSearchInput>
                    </div>
                </template>

                <template v-else>
                    <div class="nx-btn-group nx-btn-group--compact foxhole-war-nx-map-toolbar__search-trigger">
                        <NxTooltip text="Search Map" position="top">
                            <button
                                type="button"
                                class="nx-btn-group__option nx-btn-group__option--icon-only"
                                aria-label="Search Map"
                                @click="toggleSearch"
                            >
                                <NxIcon name="ph:magnifying-glass" size="sm" label="Search Map" />
                            </button>
                        </NxTooltip>
                    </div>

                    <div class="foxhole-war-nx-map-toolbar__regions">
                        <NxMultiSelect
                            :modelValue="mapSettings.regionKeys"
                            :options="regionMultiSelectOptions"
                            placeholder="All Regions"
                            searchable
                            clearable
                            commitOnClose
                            searchPlaceholder="Search Regions…"
                            search-aria-label="Search Regions"
                            :disabled="!mapSettings.enabled"
                            @update:model-value="onRegionKeysChange"
                        />
                    </div>
                </template>
            </template>

            <template v-if="!searchOpen" #trailing>
                <NxButton
                    :label="mapSettings.enabled ? 'Hide Map' : 'Show Map'"
                    :variant="mapSettings.enabled ? 'primary' : 'secondary'"
                    size="sm"
                    @click="toggleMapEnabled"
                />
            </template>
        </NxEditorToolbar>

        <div
            v-if="searchActive"
            id="foxhole-war-nx-map-search-results"
            class="foxhole-war-nx-map-toolbar__results"
            role="listbox"
            aria-label="Map Location Search Results"
        >
            <button
                v-for="(entry, index) in searchResults"
                :id="getResultId(index)"
                :key="entry.id"
                :ref="element => setResultButton(element as HTMLButtonElement | null, index)"
                type="button"
                class="foxhole-war-nx-map-toolbar__result"
                :class="{ 'is-active': index === activeResultIndex }"
                role="option"
                :aria-selected="index === activeResultIndex"
                @mouseenter="setActiveResultIndex(index)"
                @click="focusLocation(entry)"
            >
                <span class="foxhole-war-nx-map-toolbar__result-type">{{ getEntryTypeLabel(entry.type) }}</span>
                <span class="foxhole-war-nx-map-toolbar__result-main">{{ entry.label }}</span>
                <span class="foxhole-war-nx-map-toolbar__result-region">{{ entry.regionLabel }}</span>
            </button>

            <div v-if="!searchResults.length" class="foxhole-war-nx-map-toolbar__results-empty">
                No visible matches for "{{ (searchQuery ?? '').trim() }}".
            </div>
        </div>
    </div>
</template>

<style scoped>
.foxhole-war-nx-map-toolbar {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.foxhole-war-nx-map-toolbar__search-trigger {
    flex: 0 0 auto;
}

.foxhole-war-nx-map-toolbar__regions {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
}

.foxhole-war-nx-map-toolbar__regions :deep(.nx-multi-select),
.foxhole-war-nx-map-toolbar__regions :deep(.nx-field) {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
}

.foxhole-war-nx-map-toolbar__search-field {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow: visible;
}

.foxhole-war-nx-map-toolbar__search-field :deep(.nx-search-input) {
    width: 100%;
}

.foxhole-war-nx-map-toolbar__search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--nx-radius-sm);
    background: transparent;
    color: var(--nx-text-subtle);
    cursor: pointer;
    transition:
        background var(--nx-duration-fast) var(--nx-ease-out),
        color var(--nx-duration-fast) var(--nx-ease-out);
}

.foxhole-war-nx-map-toolbar__search-close:hover {
    background: var(--nx-hover-surface);
    color: var(--nx-text);
}

.foxhole-war-nx-map-toolbar__results {
    display: grid;
    gap: 2px;
    max-height: min(40vh, 280px);
    margin: 0 var(--nx-space-2) var(--nx-space-2);
    padding: var(--nx-space-1);
    overflow: auto;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-surface);
}

.foxhole-war-nx-map-toolbar__result {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: var(--nx-space-2);
    row-gap: 2px;
    width: 100%;
    margin: 0;
    padding: var(--nx-space-2);
    border: none;
    border-radius: var(--nx-radius-sm);
    background: transparent;
    color: var(--nx-text);
    text-align: left;
    cursor: pointer;
    transition: background var(--nx-duration-fast) var(--nx-ease-out);
}

.foxhole-war-nx-map-toolbar__result:hover,
.foxhole-war-nx-map-toolbar__result.is-active,
.foxhole-war-nx-map-toolbar__result:focus-visible {
    background: var(--nx-hover-surface);
}

.foxhole-war-nx-map-toolbar__result-type {
    grid-row: 1 / span 2;
    align-self: center;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.foxhole-war-nx-map-toolbar__result-main,
.foxhole-war-nx-map-toolbar__result-region {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.foxhole-war-nx-map-toolbar__result-main {
    font-size: var(--nx-text-sm);
}

.foxhole-war-nx-map-toolbar__result-region {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
}

.foxhole-war-nx-map-toolbar__results-empty {
    padding: var(--nx-space-3) var(--nx-space-2);
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
}
</style>
