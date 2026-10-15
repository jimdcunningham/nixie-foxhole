<script setup lang="ts">
import { computed } from 'vue';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    createFoxholeStructureHoverEntry,
    resolveFoxholeStructureDefaultIconUrl,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import {
    resolveFoxholeRecipeResourceIconUrl,
    resolveFoxholeRecipeViewModel,
} from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type { NxAssistantChatBlockPresentation } from '#nixie/plugins/nixie/assistant/chat-blocks-context.ts';
import type { NxAssistantChatRecipeBlock } from '#nixie/components/nx-assistant-chat.model.ts';
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
    block: NxAssistantChatRecipeBlock;
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

const recipe = computed(() => resolveFoxholeRecipeViewModel({
    recipeId: props.block.recipeId,
    baseAssetsUrl: assetsBaseUrl.value,
    appBaseUrl: runtimeConfig.app.baseURL,
}));

const structure = computed(() => {
    const structureId = String(
        props.block.structureId
        ?? recipe.value?.recipe.sourceStructureId
        ?? '',
    ).trim();
    if (!structureId) {
        return null;
    }
    const catalog = getFoxholeStructureCatalog(assetsBaseUrl.value);
    return catalog.assetByKey[structureId]
        ?? catalog.assetByKey[structureId.toLowerCase()]
        ?? null;
});

const label = computed(() => {
    const fromBlock = String(props.block.label ?? '').trim();
    if (fromBlock && !fromBlock.includes(':') && !/^(asset|recipe)$/i.test(fromBlock)) {
        return fromBlock;
    }
    if (structure.value) {
        return t(structure.value.nameLocalizationId, structure.value.name);
    }
    const fromRecipe = String(recipe.value?.title ?? '').trim();
    if (fromRecipe && !fromRecipe.includes(':')) {
        return fromRecipe;
    }
    return 'Recipe';
});

const iconUrl = computed(() => {
    const fromStructure = resolveFoxholeStructureDefaultIconUrl(structure.value);
    if (fromStructure) {
        return fromStructure;
    }
    const model = recipe.value;
    if (!model) {
        return null;
    }
    const primary = model.outputs[0] ?? model.inputs[0] ?? null;
    return primary ? (resolveFoxholeRecipeResourceIconUrl(primary) || null) : null;
});

const meta = computed(() => {
    if (!recipe.value) {
        return 'Recipe';
    }
    if (recipe.value.isBuildCost) {
        return recipe.value.subtitle || 'Rebuild / build cost';
    }
    return 'Recipe';
});

function createHoverEntry(): NixieResolvedAssetEntry | null {
    const current = structure.value;
    if (!current) {
        return null;
    }
    return createFoxholeStructureHoverEntry(
        current,
        asset => t(asset.nameLocalizationId, asset.name),
        asset => t(asset.descriptionLocalizationId, asset.description),
        asset => t(asset.categoryNameLocalizationId, asset.categoryName),
    );
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

const canPlace = computed(() => Boolean(structure.value));

const interactionTitle = computed(() => (
    canPlace.value
        ? `${label.value} — click to place in the scene`
        : label.value
));

async function placeInScene(): Promise<void> {
    const current = structure.value;
    if (!current) {
        showNxToast({
            kind: 'info',
            message: 'This recipe has no placeable structure.',
        });
        return;
    }
    scheduleHideHover();
    await placeFoxholeAssistantStructure({
        structure: current,
        label: label.value,
        assetsBaseUrl: assetsBaseUrl.value,
        reason: 'foxhole-assistant:recipe-chip',
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
        class="foxhole-assistant-recipe-chip"
        :class="{ 'is-placeable': canPlace }"
        :title="interactionTitle"
        @mouseenter="showHover"
        @mouseleave="scheduleHideHover"
        @focus="showHover"
        @blur="scheduleHideHover"
        @click="onActivate"
    >
        <span class="foxhole-assistant-recipe-chip__icon">
            <NxEntityIcon
                :src="iconUrl"
                :label="label"
            />
        </span>
        <span class="foxhole-assistant-recipe-chip__text">
            <span class="foxhole-assistant-recipe-chip__label">{{ label }}</span>
            <span class="foxhole-assistant-recipe-chip__meta">{{ meta }}</span>
        </span>
    </button>
    <span
        v-else
        class="foxhole-assistant-recipe-chip foxhole-assistant-recipe-chip--link nx-assistant-entity-link"
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
    >{{ label }}</span>
</template>

<style scoped>
.foxhole-assistant-recipe-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin: 0;
    padding: 0.2rem 0.5rem 0.2rem 0.25rem;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-hover-surface);
    color: var(--nx-text);
    font: inherit;
    font-size: 0.92em;
    line-height: 1.2;
    vertical-align: baseline;
    cursor: default;
}

.foxhole-assistant-recipe-chip.is-placeable {
    cursor: pointer;
}

.foxhole-assistant-recipe-chip--link {
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
    text-decoration: none;
    white-space: inherit;
    cursor: default;
}

.foxhole-assistant-recipe-chip--link.is-placeable {
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 0.15em;
}

.foxhole-assistant-recipe-chip--link:hover,
.foxhole-assistant-recipe-chip--link:focus-visible {
    border: none;
    color: var(--nx-accent-hover);
    filter: none;
    outline: none;
}

.foxhole-assistant-recipe-chip__icon {
    display: inline-flex;
    flex: 0 0 auto;
    width: 1.25rem;
    height: 1.25rem;
}

.foxhole-assistant-recipe-chip__icon :deep(.nx-entity-icon),
.foxhole-assistant-recipe-chip__icon :deep(img) {
    width: 1.25rem;
    height: 1.25rem;
}

.foxhole-assistant-recipe-chip__text {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.05rem;
}

.foxhole-assistant-recipe-chip--link .foxhole-assistant-recipe-chip__text {
    display: inline;
}

.foxhole-assistant-recipe-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.foxhole-assistant-recipe-chip--link .foxhole-assistant-recipe-chip__label {
    overflow: visible;
    text-overflow: clip;
    white-space: inherit;
}

.foxhole-assistant-recipe-chip__meta {
    color: var(--nx-text-muted);
    font-size: 0.78em;
}
</style>
