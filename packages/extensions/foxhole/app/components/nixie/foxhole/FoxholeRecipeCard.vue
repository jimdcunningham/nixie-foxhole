<script setup lang="ts">
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';
import { resolveFoxholePowerDeltaMw } from '#foxhole/plugins/foxhole/nixie/facility-power.ts';
import {
    createFoxholeItemHoverEntry,
    createFoxholeStructureHoverEntry,
} from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import { FOXHOLE_RECIPE_POWER_RESOURCE_ID,
    resolveFoxholeRecipeResourceIconUrl,
    resolveFoxholeRecipeResourceLabel } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type {
    FoxholeRecipeResourceRef,
    FoxholeRecipeViewModel,
} from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import NxTooltip from '#nixie/components/NxTooltip.vue';
import { resolveNixieEditorRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSidebarAssetHoverCard } from '#nixie/composables/useNixieSidebarAssetHoverCard.ts';
import type { NixieAssetBrowserContext } from '#nixie/plugins/nixie/registry/types.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

const props = withDefaults(defineProps<{
    recipe: FoxholeRecipeViewModel;
    selected?: boolean;
    selectable?: boolean;
    compact?: boolean;
    /** When false, omit power meta chips (e.g. siblings all share the same draw/produce). */
    showPower?: boolean;
    /**
     * Prefer a single-line header: clip the title with ellipsis instead of stacking
     * or protecting power/duration from overflow.
     */
    clipTitle?: boolean;
    /** Hide conversion I/O tiles; keep title + power/duration meta only. */
    hideIo?: boolean;
    /** Show only the produced output tiles (used for assembly recipes in the order picker). */
    outputOnly?: boolean;
}>(), {
    selected: false,
    selectable: false,
    compact: true,
    showPower: true,
    clipTitle: false,
    hideIo: false,
    outputOnly: false,
});

const emit = defineEmits<{
    select: [recipeId: string];
}>();

const { t } = useFoxholeLocalization();
const runtimeConfig = useRuntimeConfig();
const settingsStore = useNixieSettingsStore();
const sidebarAssetHoverCard = useNixieSidebarAssetHoverCard();

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});
const decimalNumberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
});

function localizeResource(resource: FoxholeRecipeResourceRef): string {
    const label = resolveFoxholeRecipeResourceLabel(resource, (localizationId, fallback) => (
        t(localizationId, fallback)
    ));
    if (resource.channel === 'crate' && label) {
        return `${label} (Crate)`;
    }
    return label;
}

function formatQuantityValue(resource: FoxholeRecipeResourceRef): string {
    return Number.isInteger(resource.quantity)
        ? wholeNumberFormatter.format(resource.quantity)
        : decimalNumberFormatter.format(resource.quantity);
}

function formatQuantity(resource: FoxholeRecipeResourceRef): string {
    const formattedValue = formatQuantityValue(resource);
    if (resource.quantityUnit === 'mw') {
        return `${formattedValue} MW`;
    }
    return `x${formattedValue}`;
}

function resourceIconName(resource: FoxholeRecipeResourceRef): string {
    return String(resource.iconName ?? '').trim();
}

function resourceHasBitmapIcon(resource: FoxholeRecipeResourceRef): boolean {
    return Boolean(resolveFoxholeRecipeResourceIconUrl(resource));
}

const titleLabel = computed(() => {
    if (props.recipe.isBuildCost) {
        return props.recipe.title;
    }
    if (props.recipe.outputs.length > 0) {
        return props.recipe.outputs.map(localizeResource).filter(Boolean).join(', ');
    }
    return props.recipe.title;
});

const showConversionIo = computed(() => !props.recipe.isBuildCost && !props.hideIo);
const visibleInputs = computed(() => props.outputOnly ? [] : props.recipe.inputs);
const showIoSection = computed(() => {
    if (props.hideIo) {
        return false;
    }
    if (props.recipe.isBuildCost) {
        return props.recipe.inputs.length > 0;
    }
    return visibleInputs.value.length > 0 || props.recipe.outputs.length > 0;
});

const durationLabel = computed(() => {
    const rawSeconds = props.recipe.durationSeconds;
    if (rawSeconds == null || !Number.isFinite(rawSeconds) || rawSeconds <= 0) {
        return '';
    }

    const totalSeconds = Math.max(0, Math.round(rawSeconds));
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
});

/** Producer gain — shown in the header; bolt output tile stays as the visual cue. */
const powerProduceLabel = computed(() => {
    if (!props.showPower) {
        return '';
    }
    const powerOutput = props.recipe.outputs.find(output => (
        output.id === FOXHOLE_RECIPE_POWER_RESOURCE_ID
        || output.quantityUnit === 'mw'
    ));
    if (powerOutput && Number.isFinite(powerOutput.quantity) && powerOutput.quantity > 0) {
        const formatted = Number.isInteger(powerOutput.quantity)
            ? wholeNumberFormatter.format(powerOutput.quantity)
            : decimalNumberFormatter.format(powerOutput.quantity);
        return `+${formatted} MW`;
    }
    const mw = resolveFoxholePowerDeltaMw(props.recipe.powerDelta);
    if (mw <= 0) {
        return '';
    }
    const formatted = Number.isInteger(mw) ? String(mw) : mw.toFixed(1);
    return `+${formatted} MW`;
});

/** Consumer draw only — produced power is already a lightning-bolt output tile. */
const powerDrawLabel = computed(() => {
    if (!props.showPower || powerProduceLabel.value) {
        return '';
    }
    const mw = resolveFoxholePowerDeltaMw(props.recipe.powerDelta);
    if (mw >= 0) {
        return '';
    }
    const formatted = Number.isInteger(mw) ? String(mw) : mw.toFixed(1);
    return `${formatted} MW`;
});

function showResourceHover(resource: FoxholeRecipeResourceRef): void {
    if ((!resource.item && !resource.structure) || !sidebarAssetHoverCard) {
        return;
    }

    const runtime = resolveNixieEditorRuntime();
    if (!runtime) {
        return;
    }

    const projectSettings = runtime.projectStore.project?.settings.value ?? runtime.projectStore.settings;
    const context: NixieAssetBrowserContext = {
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

    if (resource.structure) {
        sidebarAssetHoverCard.showAsset(
            createFoxholeStructureHoverEntry(
                resource.structure,
                structure => t(structure.nameLocalizationId, structure.name),
                structure => t(structure.descriptionLocalizationId, structure.description),
                structure => t(structure.categoryNameLocalizationId, structure.categoryName),
            ),
            context,
        );
        return;
    }

    sidebarAssetHoverCard.showAsset(
        createFoxholeItemHoverEntry(
            resource.item,
            resource.id,
            (item, resourceId) => (item ? t(item.nameLocalizationId, item.name) : resourceId),
            item => (item ? t(item.descriptionLocalizationId, item.description) : ''),
            item => (item ? t(item.categoryNameLocalizationId, item.categoryName) : ''),
        ),
        context,
    );
}

function scheduleHideResourceHover(): void {
    sidebarAssetHoverCard?.scheduleHideAsset();
}

function onActivate(): void {
    if (!props.selectable) {
        return;
    }
    emit('select', props.recipe.id);
}
</script>

<template>
    <div
        class="foxhole-recipe-card"
        :class="{
            'is-selectable': selectable,
            'is-selected': selected,
            'is-compact': compact,
            'is-clip-title': clipTitle,
            'is-hide-io': hideIo,
            'is-output-only': outputOnly,
        }"
        :role="selectable ? 'button' : undefined"
        :tabindex="selectable ? 0 : undefined"
        @click="onActivate"
        @keydown.enter.prevent="onActivate"
        @keydown.space.prevent="onActivate"
    >
        <div
            v-if="!outputOnly && !compact && (titleLabel || durationLabel || powerDrawLabel || powerProduceLabel || recipe.consumesResourceNodes)"
            class="foxhole-recipe-card__header"
        >
            <div v-if="titleLabel" class="foxhole-recipe-card__title-row">
                <Icon
                    name="ph:caret-right"
                    class="foxhole-recipe-card__title-arrow"
                    aria-hidden="true"
                />
                <strong class="foxhole-recipe-card__title">{{ titleLabel }}</strong>
            </div>
            <div
                v-if="durationLabel || powerDrawLabel || powerProduceLabel"
                class="foxhole-recipe-card__meta"
            >
                <span v-if="powerProduceLabel" class="foxhole-recipe-card__chip is-power-produce">
                    <NxIcon name="nx:lightning" class="foxhole-recipe-card__chip-icon" />
                    {{ powerProduceLabel }}
                </span>
                <span v-if="powerDrawLabel" class="foxhole-recipe-card__chip is-power-draw">
                    <NxIcon name="nx:lightning" class="foxhole-recipe-card__chip-icon" />
                    {{ powerDrawLabel }}
                </span>
                <span v-if="durationLabel" class="foxhole-recipe-card__chip is-duration">
                    <Icon name="ph:timer" class="foxhole-recipe-card__chip-icon" />
                    {{ durationLabel }}
                </span>
            </div>
        </div>

        <div
            v-if="showIoSection"
            class="foxhole-recipe-card__io"
            :class="{ 'is-cost-only': !showConversionIo }"
        >
            <div
                v-if="visibleInputs.length"
                class="foxhole-recipe-card__group"
            >
                <div
                    v-for="resource in visibleInputs"
                    :key="`in:${resource.channel}:${resource.id}`"
                    class="foxhole-recipe-card__resource"
                    @mouseenter="showResourceHover(resource)"
                    @mouseleave="scheduleHideResourceHover"
                >
                    <NxTooltip :text="localizeResource(resource)" position="top">
                        <span
                            class="foxhole-recipe-card__resource-icon"
                            :class="{
                                'is-power': Boolean(resourceIconName(resource)),
                            }"
                        >
                            <NxIcon
                                v-if="resourceIconName(resource) && !resourceHasBitmapIcon(resource)"
                                :name="resourceIconName(resource)"
                                class="foxhole-recipe-card__glyph-icon"
                            />
                            <NxEntityIcon
                                v-else
                                :src="resolveFoxholeRecipeResourceIconUrl(resource)"
                                :label="localizeResource(resource)"
                            />
                            <span
                                v-if="resource.channel === 'crate'"
                                class="foxhole-recipe-card__crate-badge"
                                aria-hidden="true"
                                title="Crate"
                            >
                                <Icon name="ph:package" class="foxhole-recipe-card__crate-badge-icon" />
                            </span>
                        </span>
                    </NxTooltip>
                    <span
                        v-if="resource.showQuantity !== false"
                        class="foxhole-recipe-card__resource-qty is-cost"
                    >
                        <template v-if="resource.quantityUnit === 'mw'">
                            {{ formatQuantityValue(resource) }}<span class="foxhole-recipe-card__resource-qty-unit"> MW</span>
                        </template>
                        <template v-else>
                            {{ formatQuantity(resource) }}
                        </template>
                    </span>
                </div>
            </div>

            <template v-if="showConversionIo">
                <div v-if="visibleInputs.length && recipe.outputs.length" class="foxhole-recipe-card__arrow" aria-hidden="true">
                    <Icon name="ph:arrow-right" class="foxhole-recipe-card__arrow-icon" />
                </div>

                <div
                    v-if="recipe.outputs.length"
                    class="foxhole-recipe-card__group"
                >
                    <div
                        v-for="resource in recipe.outputs"
                        :key="`out:${resource.channel}:${resource.id}`"
                        class="foxhole-recipe-card__resource"
                        @mouseenter="showResourceHover(resource)"
                        @mouseleave="scheduleHideResourceHover"
                    >
                        <NxTooltip :text="localizeResource(resource)" position="top">
                            <span
                                class="foxhole-recipe-card__resource-icon"
                                :class="{
                                    'is-power': Boolean(resourceIconName(resource)),
                                }"
                            >
                                <NxIcon
                                    v-if="resourceIconName(resource) && !resourceHasBitmapIcon(resource)"
                                    :name="resourceIconName(resource)"
                                    class="foxhole-recipe-card__glyph-icon"
                                />
                                <NxEntityIcon
                                    v-else
                                    :src="resolveFoxholeRecipeResourceIconUrl(resource)"
                                    :label="localizeResource(resource)"
                                />
                                <span
                                    v-if="resource.channel === 'crate'"
                                    class="foxhole-recipe-card__crate-badge"
                                    aria-hidden="true"
                                    title="Crate"
                                >
                                    <Icon name="ph:package" class="foxhole-recipe-card__crate-badge-icon" />
                                </span>
                            </span>
                        </NxTooltip>
                        <span
                        v-if="resource.showQuantity !== false && !outputOnly"
                            class="foxhole-recipe-card__resource-qty is-gain"
                        >
                            <template v-if="resource.quantityUnit === 'mw'">
                                {{ formatQuantityValue(resource) }}<span class="foxhole-recipe-card__resource-qty-unit"> MW</span>
                            </template>
                            <template v-else>
                                {{ formatQuantity(resource) }}
                            </template>
                        </span>
                    </div>
                </div>
            </template>
        </div>
        <div
            v-if="!outputOnly && compact && (durationLabel || powerDrawLabel || powerProduceLabel)"
            class="foxhole-recipe-card__meta foxhole-recipe-card__row-meta"
        >
            <span v-if="powerProduceLabel" class="foxhole-recipe-card__chip is-power-produce">
                <NxIcon name="nx:lightning" class="foxhole-recipe-card__chip-icon" />
                {{ powerProduceLabel }}
            </span>
            <span v-if="powerDrawLabel" class="foxhole-recipe-card__chip is-power-draw">
                <NxIcon name="nx:lightning" class="foxhole-recipe-card__chip-icon" />
                {{ powerDrawLabel }}
            </span>
            <span v-if="durationLabel" class="foxhole-recipe-card__chip is-duration">
                <Icon name="ph:timer" class="foxhole-recipe-card__chip-icon" />
                {{ durationLabel }}
            </span>
        </div>
    </div>
</template>

<style scoped>
.foxhole-recipe-card {
    container-type: inline-size;
    container-name: foxhole-recipe-card;
    display: grid;
    gap: 5px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 12px var(--nx-space-2);
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    background: var(--nx-surface);
    color: inherit;
    text-align: left;
    font: inherit;
}

.foxhole-recipe-card.is-compact {
    padding: 10px 8px;
    gap: 5px;
}

.foxhole-recipe-card.is-hide-io.is-compact {
    padding-block: 8px;
    gap: 0;
}

.foxhole-recipe-card.is-selectable {
    cursor: pointer;
    transition:
        border-color var(--nx-duration-fast) var(--nx-ease-out),
        background var(--nx-duration-fast) var(--nx-ease-out),
        box-shadow var(--nx-duration-fast) var(--nx-ease-out);
}

.foxhole-recipe-card.is-selectable:hover {
    background: var(--nx-surface-raised);
}

.foxhole-recipe-card.is-selected {
    box-shadow: inset 0 0 0 1px var(--nx-control-border-focus);
    background: var(--nx-control-bg-focus);
}

.foxhole-recipe-card__header {
    display: flex;
    flex-wrap: nowrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--nx-space-2);
    min-width: 0;
}

.foxhole-recipe-card__meta {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: max-content;
    margin-top: 1px;
}

.foxhole-recipe-card.is-output-only {
    gap: 0;
    padding: 0;
    border: 0;
    border-radius: var(--nx-radius-sm);
    background: transparent;
}

.foxhole-recipe-card.is-output-only .foxhole-recipe-card__io,
.foxhole-recipe-card.is-output-only .foxhole-recipe-card__group {
    width: 100%;
}

.foxhole-recipe-card.is-output-only .foxhole-recipe-card__group {
    justify-content: center;
    border: 0;
}

.foxhole-recipe-card.is-output-only .foxhole-recipe-card__resource {
    flex-basis: 48px;
    width: 48px;
    height: 48px;
}

.foxhole-recipe-card__row-meta {
    justify-self: end;
    margin-top: 1px;
}

.foxhole-recipe-card__meta > * + *::before {
    content: '/';
    margin-inline: 6px;
    color: var(--nx-border-strong, var(--nx-border));
    font-size: 10px;
    font-weight: var(--nx-font-weight-normal, 400);
    line-height: 1;
}

.foxhole-recipe-card__title-row {
    display: flex;
    align-items: flex-start;
    gap: 3px;
    flex: 1 1 auto;
    min-width: 0;
}

.foxhole-recipe-card__title-arrow {
    flex: 0 0 auto;
    width: 11px;
    height: 11px;
    margin-top: 1px;
    color: var(--nx-success);
}

.foxhole-recipe-card__title {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--nx-success);
    font-size: var(--nx-text-xs);
    font-weight: var(--nx-heading-weight);
    line-height: var(--nx-leading-tight);
    overflow-wrap: anywhere;
}

.foxhole-recipe-card.is-clip-title .foxhole-recipe-card__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
}

@container foxhole-recipe-card (max-width: 360px) {
    .foxhole-recipe-card:not(.is-clip-title) .foxhole-recipe-card__header {
        flex-direction: column;
        align-items: flex-start;
        row-gap: 2px;
    }
}

.foxhole-recipe-card__chip {
    display: inline-flex;
    align-items: center;
    color: var(--nx-text-subtle);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
}

.foxhole-recipe-card__chip-icon {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
    margin-right: 3px;
}

.foxhole-recipe-card__chip-icon :deep(svg) {
    width: 100%;
    height: 100%;
}

.foxhole-recipe-card__chip.is-duration {
    color: var(--nx-info, #4ea1ff);
}

.foxhole-recipe-card__chip.is-power-draw {
    color: var(--nx-warning, #e3b341);
}

.foxhole-recipe-card__chip.is-power-produce {
    color: var(--nx-success);
}

.foxhole-recipe-card__io {
    --foxhole-recipe-icon-size: 40px;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
}

.foxhole-recipe-card__group {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    border: 1px solid var(--nx-border);
    border-radius: 3px;
}

.foxhole-recipe-card__resource {
    position: relative;
    flex: 0 0 var(--foxhole-recipe-icon-size);
    width: var(--foxhole-recipe-icon-size);
    height: var(--foxhole-recipe-icon-size);
}

.foxhole-recipe-card__group > .foxhole-recipe-card__resource + .foxhole-recipe-card__resource {
    border-left: 1px solid var(--nx-border);
}

.foxhole-recipe-card__group > .foxhole-recipe-card__resource:first-child .foxhole-recipe-card__resource-icon {
    border-radius: 3px 0 0 3px;
}

.foxhole-recipe-card__group > .foxhole-recipe-card__resource:last-child .foxhole-recipe-card__resource-icon {
    border-radius: 0 3px 3px 0;
}

.foxhole-recipe-card__group > .foxhole-recipe-card__resource:only-child .foxhole-recipe-card__resource-icon {
    border-radius: 3px;
}

.foxhole-recipe-card__resource :deep(.nx-tooltip) {
    display: block;
    width: 100%;
    height: 100%;
}

.foxhole-recipe-card__resource-icon {
    position: relative;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.foxhole-recipe-card__resource-icon :deep(.nx-entity-icon) {
    position: relative;
    z-index: 0;
    width: 80%;
    height: 80%;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.foxhole-recipe-card__resource-icon :deep(.nx-entity-icon img) {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.foxhole-recipe-card__resource-icon :deep(.nx-entity-icon span) {
    font-size: 10px;
}

.foxhole-recipe-card__resource-icon.is-power {
    color: #fff;
}

.foxhole-recipe-card__glyph-icon {
    width: 55%;
    height: 55%;
}

.foxhole-recipe-card__glyph-icon :deep(svg) {
    width: 100%;
    height: 100%;
}

.foxhole-recipe-card__crate-badge {
    position: absolute;
    top: -5px;
    left: -5px;
    z-index: 5;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    border: 1px solid var(--nx-border);
    border-radius: 3px;
    background: var(--nx-surface);
    color: var(--nx-warning, #e3b341);
    pointer-events: none;
}

.foxhole-recipe-card__crate-badge-icon {
    width: 11px;
    height: 11px;
}

.foxhole-recipe-card__resource-qty {
    position: absolute;
    right: -5px;
    bottom: -5px;
    z-index: 5;
    box-sizing: border-box;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--nx-border);
    border-radius: 3px;
    background: var(--nx-surface);
    font-size: 10px;
    font-weight: var(--nx-font-weight-normal, 400);
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    white-space: nowrap;
    pointer-events: none;
}

.foxhole-recipe-card__resource-qty.is-cost {
    color: var(--nx-danger);
}

.foxhole-recipe-card__resource-qty.is-gain {
    color: var(--nx-success);
}

.foxhole-recipe-card__resource-qty-unit {
    font-size: 8px;
    letter-spacing: 0.02em;
}

.foxhole-recipe-card__arrow {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--nx-text) 55%, var(--nx-text-muted));
    line-height: 1;
}

.foxhole-recipe-card__arrow-icon {
    width: 18px;
    height: 18px;
}
</style>
