<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import FoxholeCostCard from '#foxhole/components/nixie/foxhole/FoxholeCostCard.vue';
import FoxholeAssetHoverOutputsList from '#foxhole/components/nixie/foxhole/FoxholeAssetHoverOutputsList.vue';
import FoxholeAssetProductionTable from '#foxhole/components/nixie/foxhole/FoxholeAssetProductionTable.vue';
import NxShortcutKeys from '#nixie/components/NxShortcutKeys.vue';
import { resolveFoxholeHoverCostPresentation } from '#foxhole/plugins/foxhole/nixie/asset-hover-cost.ts';
import type { FoxholeHoverCostSource } from '#foxhole/plugins/foxhole/nixie/asset-hover-cost.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    formatFoxholeHoverPowerLabel,
    formatFoxholeHoverRecipeOutputLabels,
    resolveFoxholeAssetHoverAttributes,
} from '#foxhole/plugins/foxhole/nixie/asset-hover-layout.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeItemCatalog,
    getFoxholeStructureAsset,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeStructureRecipes } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type {
    NixieAssetBrowserContext,
    NixieResolvedAssetEntry,
} from '#nixie/plugins/nixie/registry/types.ts';

type FoxholeCostBreakdownEntry = import('#foxhole/components/nixie/foxhole/FoxholeCostBreakdownList.vue').FoxholeCostBreakdownEntry;
type FoxholeItemAsset = import('#foxhole/plugins/foxhole/nixie/catalog.ts').FoxholeItemAsset;
type FoxholeStructureAsset = import('#foxhole/plugins/foxhole/nixie/catalog.ts').FoxholeStructureAsset;
type FoxholeRecipeViewModel = import('#foxhole/plugins/foxhole/nixie/production/recipe-display.ts').FoxholeRecipeViewModel;

type CatalogStructure = ReturnType<typeof getFoxholeStructureCatalog>['structureByKey'][string];

const settingsStore = useNixieSettingsStore();
const recipeFaction = computed(() => {
    const value = settingsStore.getValueOr('foxhole.assets.filter.faction', '');
    return value === 'c' || value === 'w' ? value : 'all';
});

interface HoverCostEntry {
    id: string;
    key: string;
    quantity: number;
    item: FoxholeItemAsset | null;
    structure: FoxholeStructureAsset | null;
}

type HoverCostSource = FoxholeHoverCostSource;

const props = defineProps<{
    asset: NixieResolvedAssetEntry;
    context: NixieAssetBrowserContext;
    isShiftHeld?: boolean;
    placement?: 'sidebar' | 'palette';
    /** When set, metadata and construction cost render in the Nixie masthead beside the preview. */
    mastheadTarget?: HTMLElement | null;
}>();
const emit = defineEmits<{
    'production-visibility': [visible: boolean];
    'production-preferred-width': [width: number];
}>();

const runtimeConfig = useRuntimeConfig();
const { t } = useFoxholeLocalization();

const assetsBaseUrl = createFoxholeAssetsBaseUrl(
    props.context.appBaseUrl ?? runtimeConfig.app.baseURL,
);
const structureCatalog = getFoxholeStructureCatalog(assetsBaseUrl);
const itemCatalog = getFoxholeItemCatalog(assetsBaseUrl);
const isWindowFocused = ref(true);
const metadata = computed<Record<string, unknown>>(() => props.asset.asset.metadata ?? {});
const isAssetComplete = computed(() => metadata.value.assetComplete !== false);
const showWipWarning = computed(() => !import.meta.dev && !isAssetComplete.value);
const isPalettePlacement = computed(() => props.placement === 'palette');

const itemLookup = computed(() => {
    const lookup = new Map<string, FoxholeItemAsset>();
    for (const item of itemCatalog.assets) {
        for (const candidate of [item.foxholeKey, item.resourceKey, item.codeName, item.legacyKey]) {
            const normalizedKey = normalizeLookupKey(candidate);
            if (!normalizedKey || lookup.has(normalizedKey)) {
                continue;
            }

            lookup.set(normalizedKey, item);
        }
    }

    return lookup;
});

const structureLookupKey = computed(() => {
    return normalizeLookupKey(metadata.value.foxholeKey ?? metadata.value.codeName);
});

const parentStructureId = computed(() => normalizeLookupKey(metadata.value.parentStructureId));
const appliedModificationId = computed(() => String(metadata.value.appliedModificationId ?? '').trim());
const modificationVariantId = computed(() => String(metadata.value.modificationVariantId ?? '').trim());
const modificationId = computed(() => String(metadata.value.modificationId ?? '').trim());
const slotId = computed(() => String(metadata.value.slotId ?? '').trim());
const defaultDestroyedState = computed(() => Boolean(metadata.value.defaultDestroyedState));
const isSyntheticUpgradePreview = computed(() => {
    return Boolean(appliedModificationId.value) && parentStructureId.value === structureLookupKey.value;
});

const hoveredModificationVariant = computed<HoverCostSource | null>(() => {
    if (!parentStructureId.value) {
        return null;
    }

    const parentAsset = getFoxholeStructureAsset(parentStructureId.value, assetsBaseUrl);
    if (!parentAsset) {
        return null;
    }

    const candidateIds = new Set(
        [appliedModificationId.value, modificationVariantId.value, modificationId.value]
            .map(value => String(value ?? '').trim())
            .filter(Boolean),
    );
    if (candidateIds.size === 0) {
        return null;
    }

    const candidateSlots = slotId.value
        ? [parentAsset.modificationSlotById[slotId.value] ?? null].filter((entry): entry is typeof parentAsset.modificationSlots[number] => entry !== null)
        : parentAsset.modificationSlots;

    for (const slot of candidateSlots) {
        for (const candidateId of candidateIds) {
            const directVariant = slot.variantById[candidateId] ?? null;
            if (directVariant) {
                return directVariant;
            }
        }

        const matchedVariant = slot.variants.find(variant => {
            const variantIds = [variant.appliedModificationId, variant.modificationId, variant.id]
                .map(value => String(value ?? '').trim())
                .filter(Boolean);
            return variantIds.some(candidateId => candidateIds.has(candidateId));
        }) ?? null;
        if (matchedVariant) {
            return matchedVariant;
        }
    }

    return null;
});

const structure = computed<CatalogStructure | null>(() => {
    if (!structureLookupKey.value || defaultDestroyedState.value || isSyntheticUpgradePreview.value) {
        return null;
    }

    return structureCatalog.structureByKey[structureLookupKey.value] ?? null;
});

const item = computed<FoxholeItemAsset | null>(() => (
    itemLookup.value.get(structureLookupKey.value) ?? null
));

const attributeStructureAsset = computed(() => {
    const key = isSyntheticUpgradePreview.value
        ? parentStructureId.value
        : structureLookupKey.value;
    if (!key) {
        return null;
    }
    return structureCatalog.assetByKey[key] ?? getFoxholeStructureAsset(key, assetsBaseUrl);
});

const attributeManifest = computed(() => {
    if (structure.value) {
        return structure.value;
    }
    if (parentStructureId.value) {
        return structureCatalog.structureByKey[parentStructureId.value] ?? null;
    }
    return null;
});

const attributes = computed(() => (
    costPresentation.value.showHostAttributes
        ? resolveFoxholeAssetHoverAttributes(attributeStructureAsset.value, attributeManifest.value)
        : []
));

const showMastheadMeta = computed(() => (
    showWipWarning.value
    || (!isPalettePlacement.value && !showProduction.value && (
        attributes.value.length > 0
        || Boolean(powerLabel.value)
        || showFooter.value
    ))
));

const costSource = computed<HoverCostSource | null>(() => {
    if (defaultDestroyedState.value) {
        return null;
    }

    if (hoveredModificationVariant.value) {
        return hoveredModificationVariant.value;
    }

    return structure.value ?? item.value;
});

const isModificationHover = computed(() => !defaultDestroyedState.value && Boolean(hoveredModificationVariant.value));
const costPresentation = computed(() => resolveFoxholeHoverCostPresentation(
    costSource.value,
    isModificationHover.value,
    !defaultDestroyedState.value && !isModificationHover.value && Boolean(attributeStructureAsset.value?.downgradeStructureId),
));
const structureTotalContext = computed(() => {
    const host = parentStructureId.value ? structureCatalog.assetByKey[parentStructureId.value] : null;
    return host ? `${t(host.nameLocalizationId, host.name)} + ${props.asset.displayName}` : props.asset.displayName;
});

function resolveCostEntries(cost: HoverCostSource['cost']): HoverCostEntry[] {
    return Object.entries(cost)
        .map(([resourceKey, resource]) => {
            const quantity = Number(resource?.quantity ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return null;
            }

            const normalizedKey = normalizeLookupKey(resourceKey);
            return {
                id: normalizedKey || resourceKey,
                key: resourceKey,
                quantity,
                item: itemLookup.value.get(normalizedKey) ?? null,
                structure: structureCatalog.assetByKey[normalizedKey] ?? null,
            } satisfies HoverCostEntry;
        })
        .filter((entry): entry is HoverCostEntry => entry !== null)
        .sort((left, right) => {
            const nameComparison = localizeResourceName(left)
                .localeCompare(localizeResourceName(right), undefined, { sensitivity: 'base' });
            if (nameComparison !== 0) {
                return nameComparison;
            }

            return left.key.localeCompare(right.key, undefined, { sensitivity: 'base' });
        });
}

function resolveCostBreakdownEntries(cost: HoverCostSource['cost']): FoxholeCostBreakdownEntry[] {
    return resolveCostEntries(cost).map(resource => ({
        id: resource.id,
        name: localizeResourceName(resource),
        quantity: resource.quantity,
        iconUrl: resource.item?.iconUrl ?? resource.structure?.iconUrl ?? null,
        item: resource.item,
        structure: resource.structure,
    }));
}

const costBreakdownEntries = computed(() => resolveCostBreakdownEntries(costPresentation.value.primaryCost));
const totalCostBreakdownEntries = computed(() => resolveCostBreakdownEntries(costPresentation.value.totalCost ?? {}));

const facilityRecipes = computed<FoxholeRecipeViewModel[]>(() => {
    if (defaultDestroyedState.value) {
        return [];
    }

    const structureId = isSyntheticUpgradePreview.value
        ? parentStructureId.value
        : structureLookupKey.value;
    if (!structureId) {
        return [];
    }

    const selectedVariantId = normalizeLookupKey(
        modificationVariantId.value || appliedModificationId.value || modificationId.value,
    );
    const modificationSelections = resolveHoverModificationSelections(
        structureId,
        selectedVariantId,
    );

    // Never dump every upgrade's recipes on the base asset (~80 LVAS cards).
    // Upgrade catalog entries only resolve that upgrade's recipes.
    const model = resolveFoxholeStructureRecipes({
        structureId,
        faction: recipeFaction.value,
        appBaseUrl: props.context.appBaseUrl ?? runtimeConfig.app.baseURL,
        baseAssetsUrl: assetsBaseUrl,
        includeModifications: Boolean(modificationSelections),
        modificationSelections,
        itemCatalog,
        structureCatalog,
    });

    return model.recipes.filter(recipe => {
        if (recipe.isBuildCost) {
            return false;
        }
        if (modificationSelections) {
            return recipe.id.startsWith('modification:');
        }
        return true;
    });
});

const hasProduction = computed(() => facilityRecipes.value.length > 0);
const showProduction = computed(() => props.isShiftHeld === true && hasProduction.value);
const showProductionHint = computed(() => !isPalettePlacement.value && hasProduction.value && isWindowFocused.value);
const productionContentEl = ref<HTMLElement | null>(null);
const productionTableEl = ref<HTMLElement | null>(null);
const showProductionOutputsOnly = ref(false);
const productionTableHeightPx = ref(0);
let productionResizeObserver: ResizeObserver | null = null;
let productionMeasureFrame = 0;
const productionOutputLabels = computed(() => formatFoxholeHoverRecipeOutputLabels(
    facilityRecipes.value,
    (localizationId, fallback) => t(localizationId, fallback),
));

watch([showProduction, () => props.asset.asset.id], ([visible, assetId], [, previousAssetId]) => {
    emit('production-visibility', visible);
    if (!visible || assetId !== previousAssetId) {
        showProductionOutputsOnly.value = false;
        productionTableHeightPx.value = 0;
    }
    void nextTick(() => connectProductionResizeObserver());
}, { immediate: true });

function measureProductionOverflow(): void {
    if (!showProduction.value || !productionContentEl.value) {
        return;
    }

    const tableHeight = productionTableEl.value?.scrollHeight ?? productionTableHeightPx.value;
    if (tableHeight > 0) {
        productionTableHeightPx.value = tableHeight;
    }

    const panel = productionContentEl.value.closest('.nixie-sidebar-asset-hover');
    const maxPanelHeight = panel instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(panel).maxHeight)
        : Number.NaN;
    const mastheadHeight = panel?.querySelector('.nixie-sidebar-asset-hover__masthead') instanceof HTMLElement
        ? panel.querySelector<HTMLElement>('.nixie-sidebar-asset-hover__masthead')!.getBoundingClientRect().height
        : 0;
    const hintHeight = productionContentEl.value.parentElement
        ?.querySelector<HTMLElement>('.foxhole-asset-hover-card__production-hint')
        ?.getBoundingClientRect().height ?? 0;
    const availableHeight = Number.isFinite(maxPanelHeight) && maxPanelHeight > 0
        ? Math.max(0, maxPanelHeight - mastheadHeight - hintHeight)
        : productionContentEl.value.clientHeight;

    showProductionOutputsOnly.value = tableHeight > availableHeight + 1;
}

function scheduleProductionOverflowMeasure(): void {
    cancelAnimationFrame(productionMeasureFrame);
    productionMeasureFrame = requestAnimationFrame(measureProductionOverflow);
}

function connectProductionResizeObserver(): void {
    productionResizeObserver?.disconnect();
    productionResizeObserver = null;

    if (!showProduction.value || typeof ResizeObserver === 'undefined' || !productionContentEl.value) {
        scheduleProductionOverflowMeasure();
        return;
    }

    productionResizeObserver = new ResizeObserver(scheduleProductionOverflowMeasure);
    productionResizeObserver.observe(productionContentEl.value);
    const panel = productionContentEl.value.closest('.nixie-sidebar-asset-hover');
    if (panel instanceof HTMLElement) {
        productionResizeObserver.observe(panel);
    }
    scheduleProductionOverflowMeasure();
}

function markWindowFocused(): void {
    isWindowFocused.value = true;
}

function markWindowBlurred(): void {
    isWindowFocused.value = false;
}

onMounted(() => {
    isWindowFocused.value = document.hasFocus();
    window.addEventListener('focus', markWindowFocused);
    window.addEventListener('blur', markWindowBlurred);
});

onBeforeUnmount(() => {
    window.removeEventListener('focus', markWindowFocused);
    window.removeEventListener('blur', markWindowBlurred);
    cancelAnimationFrame(productionMeasureFrame);
    productionResizeObserver?.disconnect();
    productionResizeObserver = null;
});

const powerLabel = computed(() => (
    costPresentation.value.showHostAttributes ? formatFoxholeHoverPowerLabel(attributeManifest.value?.powerGridInfo?.powerDelta) : ''
));

const showFooter = computed(() => (
    isModificationHover.value || costBreakdownEntries.value.length > 0
));

function resolveHoverModificationSelections(
    structureId: string,
    selectedVariantId: string,
): Record<string, string> | undefined {
    if (!isSyntheticUpgradePreview.value || !selectedVariantId) {
        return undefined;
    }

    const baseStructure = structureCatalog.assetByKey[structureId] ?? null;
    if (!baseStructure?.modificationSlots?.length) {
        return undefined;
    }

    const preferredSlotId = normalizeLookupKey(slotId.value);
    const slots = preferredSlotId
        ? [baseStructure.modificationSlotById[preferredSlotId]
            ?? baseStructure.modificationSlots.find(slot => normalizeLookupKey(slot.id) === preferredSlotId)
            ?? null]
            .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
        : baseStructure.modificationSlots;

    for (const slot of slots) {
        const directVariant = slot.variantById[selectedVariantId]
            ?? Object.values(slot.variantById).find(variant => normalizeLookupKey(variant.id) === selectedVariantId)
            ?? slot.variants.find(variant => {
                const ids = [variant.id, variant.appliedModificationId, variant.modificationId]
                    .map(value => normalizeLookupKey(value))
                    .filter(Boolean);
                return ids.includes(selectedVariantId);
            })
            ?? null;
        if (!directVariant) {
            continue;
        }

        // Production index keys are case-sensitive (e.g. UpgradeSlotComponent).
        return { [slot.id]: directVariant.id };
    }

    return undefined;
}

function normalizeLookupKey(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function formatFallbackLabel(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
}

function localizeResourceName(resource: HoverCostEntry): string {
    if (resource.item) {
        return t(resource.item.nameLocalizationId, resource.item.name);
    }

    if (resource.structure) {
        return t(resource.structure.nameLocalizationId, resource.structure.name);
    }

    return formatFallbackLabel(resource.key);
}

function attributeIconName(attributeId: string): string {
    const iconByAttributeId: Record<string, string> = {
        'inventory': 'ph:grid-nine-fill',
        'decays': 'ph:shield-warning-fill',
        'liquid-capacity': 'ph:drop-fill',
        'fuel-capacity': 'ph:gas-pump-fill',
        'stockpile-capacity': 'ph:archive-box-fill',
        'foundation': 'ph:buildings-fill',
        'seats': 'ph:seat-fill',
        'orders': 'ph:stack-fill',
    };
    return iconByAttributeId[attributeId] ?? 'ph:info';
}
</script>

<template>
    <div class="foxhole-asset-hover-card">
        <Teleport
            :disabled="!props.mastheadTarget"
            :to="props.mastheadTarget || 'body'"
        >
            <div
                v-if="showMastheadMeta"
                class="foxhole-asset-hover-card__masthead-meta"
            >
                <div
                    v-if="!isPalettePlacement && !showProduction && (attributes.length > 0 || powerLabel)"
                    class="foxhole-asset-hover-card__attributes"
                >
                    <span
                        v-for="attribute in attributes"
                        :key="attribute.id"
                        class="foxhole-asset-hover-card__attribute"
                    >
                        <Icon :name="attributeIconName(attribute.id)" />
                        {{ attribute.label }}
                    </span>
                    <span
                        v-if="powerLabel"
                        class="foxhole-asset-hover-card__power"
                    >
                        <NxIcon name="nx:lightning" class="foxhole-asset-hover-card__power-icon" />
                        {{ powerLabel }}
                    </span>
                </div>

                <div v-if="showWipWarning" class="foxhole-asset-hover-card__wip">
                    <NxIcon name="ph:x-circle" size="sm" />
                    <span>This asset is unfinished and untested. Expect bugs and missing features.</span>
                </div>

                <footer
                    v-if="!isPalettePlacement && !showProduction && showFooter"
                    class="foxhole-asset-hover-card__footer"
                    :class="{
                        'has-top-divider': !(attributes.length > 0 || powerLabel),
                        'has-bottom-divider': showProductionHint && !showProduction,
                    }"
                >
                    <div class="foxhole-asset-hover-card__costs">
                        <FoxholeCostCard
                            :entries="costBreakdownEntries"
                            :title="costPresentation.heading ?? 'Construction Cost'"
                        />
                        <FoxholeCostCard
                            v-if="totalCostBreakdownEntries.length"
                            :entries="totalCostBreakdownEntries"
                            title="Total Cost"
                            icon="ph:buildings"
                            variant="neutral"
                            quantityTone="neutral"
                            :context="structureTotalContext"
                        />
                    </div>
                </footer>
            </div>
        </Teleport>

        <div v-if="showProduction" ref="productionContentEl" class="foxhole-asset-hover-card__production-content">
            <FoxholeAssetHoverOutputsList
                v-if="showProductionOutputsOnly"
                :outputs="productionOutputLabels"
                :class="{ 'has-bottom-border': showProductionHint }"
            />
            <div v-else ref="productionTableEl" class="foxhole-asset-hover-card__production-table">
                <FoxholeAssetProductionTable
                    :recipes="facilityRecipes"
                    :showBottomBorder="showProductionHint"
                    @preferred-width="width => emit('production-preferred-width', width)"
                />
            </div>
        </div>

        <div
            v-if="showProductionHint"
            class="foxhole-asset-hover-card__production-hint"
        >
            <span class="foxhole-asset-hover-card__production-hint-copy">
                <span>{{ showProduction ? 'Release' : 'Hold' }}</span>
                <NxShortcutKeys :keys="['SHIFT']" aria-label="Shift" />
                <span>{{ showProduction ? 'to hide production' : 'to view production' }}</span>
            </span>
        </div>

    </div>
</template>

<style scoped>
.foxhole-asset-hover-card {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--nx-space-3);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.foxhole-asset-hover-card:has(.foxhole-asset-production-table),
.foxhole-asset-hover-card:has(.foxhole-asset-hover-outputs) {
    gap: 0;
}

.foxhole-asset-hover-card:has(.foxhole-asset-production-table) {
    overflow: visible;
}

.foxhole-asset-hover-card__production-content { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: visible; }
.foxhole-asset-hover-card__production-table { position: relative; overflow: visible; }
.foxhole-asset-hover-card__production-content > :deep(.foxhole-asset-hover-outputs) { border-bottom: 0; }
.foxhole-asset-hover-card__production-content > :deep(.foxhole-asset-hover-outputs.has-bottom-border) { border-bottom: 1px solid var(--nx-border); }

.foxhole-asset-hover-card__masthead-meta {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
}

.foxhole-asset-hover-card__wip {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    gap: var(--nx-space-2);
    margin-inline: var(--nx-space-4);
    padding: var(--nx-space-2) var(--nx-space-3);
    border-radius: var(--nx-radius-sm);
    border: 1px solid var(--nx-control-border-error);
    background: color-mix(in srgb, var(--nx-danger-muted) 60%, var(--nx-surface-raised));
    color: var(--nx-text);
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-font-weight);
    line-height: var(--nx-leading-normal);
}

.foxhole-asset-hover-card__wip :deep(.nx-icon) {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--nx-danger);
}

.foxhole-asset-hover-card__attributes {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    align-items: center;
    gap: 0;
    min-width: 0;
    margin: 0;
    padding: 0;
    border-block: 1px solid var(--nx-border);
    color: var(--nx-accent-muted-text);
    font-size: var(--nx-text-md);
    line-height: var(--nx-leading-normal);
}

.foxhole-asset-hover-card__attribute,
.foxhole-asset-hover-card__power {
    display: flex;
    position: relative;
    align-items: center;
    gap: var(--nx-space-1);
    min-height: 42px;
    justify-content: center;
    min-width: 0;
    padding-inline: var(--nx-space-4);
    box-sizing: border-box;
    white-space: nowrap;
}

.foxhole-asset-hover-card__attribute :deep(.iconify),
.foxhole-asset-hover-card__attribute :deep(svg),
.foxhole-asset-hover-card__power :deep(.iconify),
.foxhole-asset-hover-card__power :deep(svg) {
    flex: 0 0 auto;
}

.foxhole-asset-hover-card__attribute + .foxhole-asset-hover-card__attribute::before,
.foxhole-asset-hover-card__attribute + .foxhole-asset-hover-card__power::before,
.foxhole-asset-hover-card__power + .foxhole-asset-hover-card__attribute::before {
    width: 1px;
    height: 22px;
    position: absolute;
    left: 0;
    margin: 0;
    background: var(--nx-border);
    content: '';
}

.foxhole-asset-hover-card__footer {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: stretch;
    gap: var(--nx-space-1);
    min-width: 0;
    padding: 0;
}

.foxhole-asset-hover-card__footer.has-bottom-divider {
    border-bottom: 1px solid var(--nx-border);
}

.foxhole-asset-hover-card__footer.has-top-divider {
    border-top: 1px solid var(--nx-border);
}

.foxhole-asset-hover-card__costs {
    display: grid;
    gap: var(--nx-space-3);
    padding: var(--nx-space-3) var(--nx-space-4) var(--nx-space-4);
}

.foxhole-asset-hover-card__power {
    color: var(--nx-warning);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.foxhole-asset-hover-card__power-icon {
    flex: 0 0 auto;
}

.foxhole-asset-hover-card__production-hint {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-height: 44px;
    position: relative;
    margin-top: auto;
    min-width: 0;
    padding: 0 var(--nx-space-4);
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-normal);
}

.foxhole-asset-hover-card__production-hint-copy {
    position: absolute;
    top: 50%;
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: var(--nx-space-1);
    transform: translate(-50%, -50%);
    white-space: nowrap;
}

.foxhole-asset-hover-card__production-hint-copy :deep(.nx-shortcut-keys__key) {
    transform: translateY(-1px);
}
</style>
