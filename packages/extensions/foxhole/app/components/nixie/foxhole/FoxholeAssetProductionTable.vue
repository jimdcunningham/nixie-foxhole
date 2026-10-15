<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
    resolveFoxholeRecipeResourceIconUrl,
    resolveFoxholeRecipeResourceLabel,
} from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import { resolveFoxholePowerDeltaMw } from '#foxhole/plugins/foxhole/nixie/facility-power.ts';

type FoxholeRecipeResourceRef = import('#foxhole/plugins/foxhole/nixie/production/recipe-display.ts').FoxholeRecipeResourceRef;
type FoxholeRecipeViewModel = import('#foxhole/plugins/foxhole/nixie/production/recipe-display.ts').FoxholeRecipeViewModel;

const props = defineProps<{
    recipes: readonly FoxholeRecipeViewModel[];
    showBottomBorder?: boolean;
}>();
const emit = defineEmits<{
    'preferred-width': [width: number];
}>();

const { t } = useFoxholeLocalization();
const wholeNumberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalNumberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const tableEl = ref<HTMLTableElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
const hasDurationColumn = computed(() => props.recipes.some(recipe => (
    recipe.durationSeconds != null
    && Number.isFinite(recipe.durationSeconds)
    && recipe.durationSeconds > 0
)));
const hasPowerColumn = computed(() => props.recipes.some(recipe => (
    resolveFoxholePowerDeltaMw(recipe.powerDelta) !== 0
)));

function emitPreferredWidth(): void {
    const width = tableEl.value?.scrollWidth ?? 0;
    if (width > 0) {
        emit('preferred-width', width);
    }
}

onMounted(() => {
    void nextTick(emitPreferredWidth);
    if (typeof ResizeObserver !== 'undefined' && tableEl.value) {
        resizeObserver = new ResizeObserver(emitPreferredWidth);
        resizeObserver.observe(tableEl.value);
    }
});

onBeforeUnmount(() => resizeObserver?.disconnect());

function resourceLabel(resource: FoxholeRecipeResourceRef): string {
    const label = resolveFoxholeRecipeResourceLabel(resource, (localizationId, fallback) => (
        t(localizationId, fallback)
    ));
    return resource.channel === 'crate' && label ? `${label} (Crate)` : label;
}

function formatQuantity(resource: FoxholeRecipeResourceRef): string {
    const quantity = Number.isInteger(resource.quantity)
        ? wholeNumberFormatter.format(resource.quantity)
        : decimalNumberFormatter.format(resource.quantity);
    return resource.quantityUnit === 'mw' ? `${quantity} MW` : `x${quantity}`;
}

function formatDuration(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
        return '—';
    }

    const rounded = Math.round(seconds);
    const days = Math.floor(rounded / 86_400);
    const hours = Math.floor((rounded % 86_400) / 3_600);
    const minutes = Math.floor((rounded % 3_600) / 60);
    const remainder = rounded % 60;
    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (minutes > 0 && remainder > 0) {
        return `${minutes}m ${remainder}s`;
    }
    return minutes > 0 ? `${minutes}m` : `${remainder}s`;
}

function formatPower(recipe: FoxholeRecipeViewModel): string {
    const power = resolveFoxholePowerDeltaMw(recipe.powerDelta);
    if (!power) {
        return '—';
    }
    const value = Number.isInteger(power) ? String(power) : power.toFixed(1);
    return `${power > 0 ? '+' : ''}${value} MW`;
}

function resourceIconName(resource: FoxholeRecipeResourceRef): string {
    return String(resource.iconName ?? '').trim();
}

function shouldShowQuantity(resource: FoxholeRecipeResourceRef): boolean {
    return resource.showQuantity !== false
        && !(hasPowerColumn.value && resource.quantityUnit === 'mw');
}
</script>

<template>
    <table
        ref="tableEl"
        class="foxhole-asset-production-table"
        :class="{ 'has-bottom-border': props.showBottomBorder }"
    >
        <colgroup>
            <col class="foxhole-asset-production-table__inputs-column">
            <col>
            <col v-if="hasPowerColumn" class="foxhole-asset-production-table__power-column">
            <col v-if="hasDurationColumn" class="foxhole-asset-production-table__time-column">
        </colgroup>
        <thead>
            <tr>
                <th scope="col">Inputs</th>
                <th scope="col">Outputs</th>
                <th v-if="hasPowerColumn" scope="col" class="foxhole-asset-production-table__centered-heading"><span>Power</span></th>
                <th v-if="hasDurationColumn" scope="col" class="foxhole-asset-production-table__centered-heading"><span>Time</span></th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="recipe in props.recipes" :key="recipe.id">
                <td>
                    <div class="foxhole-asset-production-table__resources is-inputs">
                        <span
                            v-for="resource in recipe.inputs"
                            :key="`in:${resource.channel}:${resource.id}`"
                            class="foxhole-asset-production-table__resource"
                            :title="resourceLabel(resource)"
                        >
                            <span class="foxhole-asset-production-table__resource-icon">
                                <Icon
                                    v-if="resourceIconName(resource)"
                                    :name="resourceIconName(resource)"
                                    class="foxhole-asset-production-table__glyph"
                                    :class="{ 'is-power': resource.quantityUnit === 'mw' }"
                                />
                                <NxEntityIcon
                                    v-else
                                    :src="resolveFoxholeRecipeResourceIconUrl(resource)"
                                    :label="resourceLabel(resource)"
                                />
                                <span v-if="shouldShowQuantity(resource)" class="foxhole-asset-production-table__quantity is-cost">{{ formatQuantity(resource) }}</span>
                            </span>
                        </span>
                    </div>
                </td>
                <td>
                    <div class="foxhole-asset-production-table__resources is-outputs">
                        <span
                            v-for="resource in recipe.outputs"
                            :key="`out:${resource.channel}:${resource.id}`"
                            class="foxhole-asset-production-table__resource is-labeled"
                            :title="resourceLabel(resource)"
                        >
                            <span class="foxhole-asset-production-table__resource-icon">
                                <Icon
                                    v-if="resourceIconName(resource)"
                                    :name="resourceIconName(resource)"
                                    class="foxhole-asset-production-table__glyph"
                                    :class="{ 'is-power': resource.quantityUnit === 'mw' }"
                                />
                                <NxEntityIcon
                                    v-else
                                    :src="resolveFoxholeRecipeResourceIconUrl(resource)"
                                    :label="resourceLabel(resource)"
                                />
                                <span v-if="shouldShowQuantity(resource)" class="foxhole-asset-production-table__quantity is-output">{{ formatQuantity(resource) }}</span>
                            </span>
                            <span class="foxhole-asset-production-table__resource-name">{{ resourceLabel(resource) }}</span>
                        </span>
                    </div>
                </td>
                <td v-if="hasPowerColumn" class="foxhole-asset-production-table__power"><span>{{ formatPower(recipe) }}</span></td>
                <td v-if="hasDurationColumn" class="foxhole-asset-production-table__time"><span>{{ formatDuration(recipe.durationSeconds) }}</span></td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped>
.foxhole-asset-production-table { width: max-content; min-width: 100%; border-collapse: collapse; border-top: 1px solid var(--nx-border); table-layout: auto; }
.foxhole-asset-production-table.has-bottom-border { border-bottom: 1px solid var(--nx-border); }
.foxhole-asset-production-table__inputs-column, .foxhole-asset-production-table__power-column, .foxhole-asset-production-table__time-column { width: 1%; }
.foxhole-asset-production-table th, .foxhole-asset-production-table td { min-width: 0; padding-inline: var(--nx-space-3); text-align: left; vertical-align: middle; }
.foxhole-asset-production-table th { height: 34px; color: var(--nx-text-subtle); font-size: var(--nx-text-xs); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.foxhole-asset-production-table td { height: 40px; border-top: 1px solid var(--nx-border); }
.foxhole-asset-production-table th + th, .foxhole-asset-production-table td + td { border-left: 1px solid var(--nx-border); }
.foxhole-asset-production-table__centered-heading > span, .foxhole-asset-production-table__power > span, .foxhole-asset-production-table__time > span { display: flex; align-items: center; justify-content: center; width: 100%; }
.foxhole-asset-production-table__power { color: var(--nx-warning); font-size: var(--nx-text-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
.foxhole-asset-production-table__time { color: var(--nx-info); font-size: var(--nx-text-sm); font-variant-numeric: tabular-nums; white-space: nowrap; }
.foxhole-asset-production-table__resources { display: flex; align-items: center; gap: var(--nx-space-2); min-width: 0; }
.foxhole-asset-production-table__resources.is-outputs { flex-direction: column; align-items: stretch; gap: var(--nx-space-1); }
.foxhole-asset-production-table__resource { position: relative; flex: 0 0 32px; width: 32px; height: 32px; }
.foxhole-asset-production-table__resource.is-labeled { display: flex; align-items: center; gap: var(--nx-space-2); width: auto; min-width: 0; }
.foxhole-asset-production-table__resource-icon { position: relative; display: grid; place-items: center; width: 100%; height: 100%; }
.foxhole-asset-production-table__resource.is-labeled .foxhole-asset-production-table__resource-icon { flex: 0 0 32px; width: 32px; }
.foxhole-asset-production-table__resource-name { min-width: 0; overflow: hidden; color: var(--nx-success); font-size: var(--nx-text-sm); text-overflow: ellipsis; white-space: nowrap; }
.foxhole-asset-production-table__resource-icon :deep(.nx-entity-icon) { width: 84%; height: 84%; border: 0; border-radius: 0; background: transparent; }
.foxhole-asset-production-table__resource-icon :deep(.nx-entity-icon img) { width: 100%; height: 100%; object-fit: contain; }
.foxhole-asset-production-table__glyph { width: 62%; height: 62%; color: var(--nx-warning); }
.foxhole-asset-production-table__glyph.is-power { color: var(--nx-text); }
.foxhole-asset-production-table__quantity { position: absolute; right: -5px; bottom: -5px; z-index: 1; padding: 1px 4px; border: 1px solid var(--nx-border); border-radius: 3px; background: var(--nx-surface); font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1.15; white-space: nowrap; pointer-events: none; }
.foxhole-asset-production-table__quantity.is-output { color: var(--nx-success); }
.foxhole-asset-production-table__quantity.is-cost { color: var(--nx-danger); }
.foxhole-asset-production-table__quantity.is-gain { color: var(--nx-success); }
</style>
