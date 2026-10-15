<script setup lang="ts">
import { computed } from 'vue';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    createFoxholeItemHoverEntry,
    createFoxholeStructureHoverEntry,
    resolveFoxholeItemDefaultIconUrl,
    resolveFoxholeStructureDefaultIconUrl,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import { cleanNxAssistantChatDisplayLabel } from '#nixie/plugins/nixie/assistant/blocks.ts';
import type { NxAssistantChatBlockPresentation } from '#nixie/plugins/nixie/assistant/chat-blocks-context.ts';
import type { NxAssistantChatItemBlock } from '#nixie/components/nx-assistant-chat.model.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type {
    NixieAssetBrowserContext,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/types.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { placeFoxholeAssistantStructure } from '#foxhole/plugins/foxhole/nixie/assistant-place-structure.ts';

const props = withDefaults(defineProps<{
    block: NxAssistantChatItemBlock;
    presentation?: NxAssistantChatBlockPresentation;
}>(), {
    presentation: 'card',
});

const isLink = computed(() => props.presentation === 'link');

const { t } = useFoxholeLocalization();
const runtime = useNixieRuntime();
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();

const assetsBaseUrl = computed(() => createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL));

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

function structureKeyFromResourceId(resourceId: string): string {
    const normalized = resourceId.trim();
    const match = /^(?:structure|vehicle):([^:]+)$/i.exec(normalized);
    return match?.[1] ?? normalized;
}

function isInternalLabel(label: string, resourceId: string): boolean {
    const cleaned = cleanNxAssistantChatDisplayLabel(label);
    if (!cleaned || cleaned.includes(':')) {
        return true;
    }
    if (/^(asset|item|structure|recipe)$/i.test(cleaned)) {
        return true;
    }
    const resource = resourceId.trim();
    if (cleaned.toLowerCase() === resource.toLowerCase()) {
        return true;
    }
    const structureKey = structureKeyFromResourceId(resource);
    return Boolean(structureKey) && cleaned.toLowerCase() === structureKey.toLowerCase();
}

const resolved = computed(() => {
    const resourceId = String(props.block.resourceId ?? '').trim();
    const channel = String(props.block.channel ?? '').trim().toLowerCase();
    const itemCatalog = getFoxholeItemCatalog(assetsBaseUrl.value);
    const structureCatalog = getFoxholeStructureCatalog(assetsBaseUrl.value);
    const key = resourceId.toLowerCase();
    const structureKey = structureKeyFromResourceId(resourceId);
    const treatAsStructure = channel === 'build'
        || /^(?:structure|vehicle):/i.test(resourceId);

    if (treatAsStructure) {
        const structure = structureCatalog.assetByKey[structureKey]
            ?? structureCatalog.assetByKey[structureKey.toLowerCase()]
            ?? structureCatalog.assetByKey[resourceId]
            ?? structureCatalog.assetByKey[key]
            ?? null;
        const catalogLabel = structure
            ? t(structure.nameLocalizationId, structure.name)
            : '';
        const blockLabel = cleanNxAssistantChatDisplayLabel(props.block.label);
        const label = catalogLabel
            || (!isInternalLabel(blockLabel, resourceId) ? blockLabel : '')
            || 'Structure';
        return {
            kind: 'structure' as const,
            structure,
            item: null,
            label,
            iconUrl: props.block.iconUrl
                || resolveFoxholeStructureDefaultIconUrl(structure)
                || null,
        };
    }

    const item = itemCatalog.assetByKey[key]
        ?? itemCatalog.assets.find(asset => (
            String(asset.foxholeKey ?? '').trim().toLowerCase() === key
            || String(asset.codeName ?? '').trim().toLowerCase() === key
            || String(asset.resourceKey ?? '').trim().toLowerCase() === key
            || String(asset.legacyKey ?? '').trim().toLowerCase() === key
        ))
        ?? null;

    if (item) {
        const catalogLabel = t(item.nameLocalizationId, item.name);
        const blockLabel = cleanNxAssistantChatDisplayLabel(props.block.label);
        const label = catalogLabel
            || (!isInternalLabel(blockLabel, resourceId) ? blockLabel : '')
            || 'Item';
        return {
            kind: 'item' as const,
            item,
            structure: null,
            label,
            iconUrl: props.block.iconUrl || resolveFoxholeItemDefaultIconUrl(item) || null,
        };
    }

    // LAS / FMC emit vehicle codenames on the item channel — resolve via structures.
    const structure = structureCatalog.assetByKey[key]
        ?? structureCatalog.assetByKey[structureKey]
        ?? structureCatalog.assetByKey[structureKey.toLowerCase()]
        ?? null;
    if (structure) {
        const catalogLabel = t(structure.nameLocalizationId, structure.name);
        const blockLabel = cleanNxAssistantChatDisplayLabel(props.block.label);
        const label = catalogLabel
            || (!isInternalLabel(blockLabel, resourceId) ? blockLabel : '')
            || 'Structure';
        return {
            kind: 'structure' as const,
            structure,
            item: null,
            label,
            iconUrl: props.block.iconUrl
                || resolveFoxholeStructureDefaultIconUrl(structure)
                || null,
        };
    }

    const blockLabel = cleanNxAssistantChatDisplayLabel(props.block.label);
    return {
        kind: 'item' as const,
        item: null,
        structure: null,
        label: (!isInternalLabel(blockLabel, resourceId) ? blockLabel : '') || 'Item',
        iconUrl: props.block.iconUrl || null,
    };
});

function createHoverEntry(): NixieResolvedAssetEntry | null {
    const current = resolved.value;
    if (current.kind === 'structure' && current.structure) {
        return createFoxholeStructureHoverEntry(
            current.structure,
            structure => t(structure.nameLocalizationId, structure.name),
            structure => t(structure.descriptionLocalizationId, structure.description),
            structure => t(structure.categoryNameLocalizationId, structure.categoryName),
        );
    }
    if (current.kind === 'item') {
        const codename = String(
            current.item?.codeName
            ?? current.item?.foxholeKey
            ?? props.block.resourceId,
        ).trim();
        if (!codename) {
            return null;
        }
        return createFoxholeItemHoverEntry(
            current.item,
            codename,
            (item, _code) => (item ? t(item.nameLocalizationId, item.name) : current.label),
            item => (item ? t(item.descriptionLocalizationId, item.description) : ''),
            item => (item ? t(item.categoryNameLocalizationId, item.categoryName) : ''),
        );
    }
    return null;
}

function showHover(): void {
    const entry = createHoverEntry();
    if (!entry) {
        return;
    }
    sidebarAssetHoverCard?.showAsset(entry, assetBrowserContext.value);
}

function scheduleHideHover(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}

const canPlace = computed(() => (
    resolved.value.kind === 'structure' && Boolean(resolved.value.structure)
));

const interactionTitle = computed(() => (
    canPlace.value
        ? `${resolved.value.label} — click to place in the scene`
        : resolved.value.label
));

async function placeInScene(): Promise<void> {
    const current = resolved.value;
    if (current.kind !== 'structure' || !current.structure) {
        showNxToast({
            kind: 'info',
            message: `${current.label} is an item — only structures and vehicles can be placed in the scene.`,
        });
        return;
    }
    scheduleHideHover();
    await placeFoxholeAssistantStructure({
        structure: current.structure,
        label: current.label,
        assetsBaseUrl: assetsBaseUrl.value,
        reason: 'foxhole-assistant:item-chip',
    });
}

function onActivate(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') {
        return;
    }
    event.preventDefault();
    void placeInScene();
}
</script>

<template>
    <button
        v-if="!isLink"
        type="button"
        class="foxhole-assistant-item-chip"
        :class="{ 'is-placeable': canPlace }"
        :title="interactionTitle"
        @mouseenter="showHover"
        @mouseleave="scheduleHideHover"
        @focus="showHover"
        @blur="scheduleHideHover"
        @click="onActivate"
    >
        <span class="foxhole-assistant-item-chip__icon">
            <NxEntityIcon
                :src="resolved.iconUrl"
                :label="resolved.label"
            />
        </span>
        <span class="foxhole-assistant-item-chip__label">{{ resolved.label }}</span>
    </button>
    <!--
      Link presentation must be a real inline box (not <button>).
      Buttons stay atomic inlines and orphan trailing punctuation onto the next line.
    -->
    <span
        v-else
        class="foxhole-assistant-item-chip foxhole-assistant-item-chip--link nx-assistant-entity-link"
        :class="{ 'is-placeable': canPlace }"
        role="button"
        tabindex="0"
        :title="interactionTitle"
        @mouseenter="showHover"
        @mouseleave="scheduleHideHover"
        @focus="showHover"
        @blur="scheduleHideHover"
        @click="onActivate"
        @keydown="onActivate"
    >{{ resolved.label }}</span>
</template>

<style scoped>
.foxhole-assistant-item-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin: 0;
    padding: 0.15rem 0.45rem 0.15rem 0.2rem;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-hover-surface);
    color: var(--nx-text);
    font: inherit;
    font-size: 0.92em;
    line-height: 1.2;
    cursor: default;
    vertical-align: baseline;
}

.foxhole-assistant-item-chip.is-placeable {
    cursor: pointer;
}

.foxhole-assistant-item-chip:hover,
.foxhole-assistant-item-chip:focus-visible {
    border-color: var(--nx-accent-muted);
    outline: none;
}

.foxhole-assistant-item-chip--link {
    display: inline;
    max-width: none;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--nx-accent-text);
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
    text-decoration: none !important;
    text-decoration-line: none !important;
    white-space: inherit;
    cursor: default;
}

.foxhole-assistant-item-chip--link.is-placeable {
    cursor: pointer;
    text-decoration-line: underline !important;
    text-decoration-style: dotted !important;
    text-underline-offset: 0.15em;
}

.foxhole-assistant-item-chip--link:hover,
.foxhole-assistant-item-chip--link:focus-visible {
    border: none;
    color: var(--nx-accent-hover);
    filter: none;
    outline: none;
}

.foxhole-assistant-item-chip__icon {
    display: inline-flex;
    flex: 0 0 auto;
    width: 1.25rem;
    height: 1.25rem;
}

.foxhole-assistant-item-chip__icon :deep(.nx-entity-icon),
.foxhole-assistant-item-chip__icon :deep(img) {
    width: 1.25rem;
    height: 1.25rem;
}

.foxhole-assistant-item-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.foxhole-assistant-item-chip--link .foxhole-assistant-item-chip__label {
    overflow: visible;
    text-overflow: clip;
    white-space: inherit;
}
</style>
