<script setup lang="ts">
import FoxholeCostBreakdownList from './FoxholeCostBreakdownList.vue';
import type { FoxholeCostBreakdownEntry } from './FoxholeCostBreakdownList.vue';

withDefaults(defineProps<{
    entries: readonly FoxholeCostBreakdownEntry[];
    title?: string;
    icon?: string;
    context?: string;
    variant?: 'accent' | 'neutral';
    showHeading?: boolean;
    quantityTone?: 'cost' | 'gain' | 'neutral';
}>(), { title: 'Construction Cost', icon: 'ph:hammer', context: '', variant: 'accent', showHeading: true, quantityTone: 'cost' });
</script>

<template>
    <section class="foxhole-cost-card" :class="`foxhole-cost-card--${variant}`" :aria-label="title">
        <h5 v-if="showHeading" class="foxhole-cost-card__heading">
            <NxIcon :name="icon" size="sm" />
            {{ title }}
        </h5>
        <p v-if="context" class="foxhole-cost-card__context" :title="context">{{ context }}</p>
        <FoxholeCostBreakdownList
            v-if="entries.length"
            :entries="entries"
            :compact="variant === 'neutral'"
            :quantityTone="quantityTone"
        />
        <p v-else class="foxhole-cost-card__empty">No materials required.</p>
    </section>
</template>

<style scoped>
.foxhole-cost-card {
    min-width: 0;
    padding: var(--nx-space-3);
    border-radius: var(--nx-radius-md);
}
.foxhole-cost-card--accent {
    border: 1px solid color-mix(in srgb, var(--nx-accent) 24%, var(--nx-border));
    background: linear-gradient(115deg, color-mix(in srgb, var(--nx-accent) 6%, transparent), transparent);
}
.foxhole-cost-card--neutral {
    border: 1px solid var(--nx-border);
    background: var(--nx-surface-raised);
}
.foxhole-cost-card__heading {
    display: flex;
    align-items: center;
    gap: var(--nx-space-2);
    margin: 0;
    color: var(--nx-accent-muted-text);
    font-size: var(--nx-text-sm);
    font-weight: 600;
    line-height: var(--nx-leading-normal);
}
.foxhole-cost-card--neutral .foxhole-cost-card__heading { color: var(--nx-text-muted); }
.foxhole-cost-card__context {
    margin: var(--nx-space-1) 0 var(--nx-space-2);
    overflow: hidden;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.foxhole-cost-card__empty { margin: var(--nx-space-2) 0 0; color: var(--nx-text-muted); font-size: var(--nx-text-sm); }
.foxhole-cost-card.foxhole-cost-card--accent :deep(.foxhole-cost-breakdown__row) { min-height: 36px; padding-inline: 0; }
.foxhole-cost-card.foxhole-cost-card--accent :deep(.foxhole-cost-breakdown__name) { font-size: var(--nx-text-md); }
.foxhole-cost-card.foxhole-cost-card--accent :deep(.foxhole-cost-breakdown__quantity) { font-size: var(--nx-text-lg); }
.foxhole-cost-card :deep(.foxhole-cost-breakdown__icon .nx-entity-icon) { width: 16px; height: 16px; }
.foxhole-cost-card.foxhole-cost-card--neutral :deep(.foxhole-cost-breakdown__row) { min-height: 24px; padding-inline: 0; }
.foxhole-cost-card.foxhole-cost-card--neutral :deep(.foxhole-cost-breakdown__name),
.foxhole-cost-card.foxhole-cost-card--neutral :deep(.foxhole-cost-breakdown__quantity) { color: var(--nx-text-muted); font-size: var(--nx-text-sm); }
.foxhole-cost-card :deep(.foxhole-cost-breakdown__row + .foxhole-cost-breakdown__row) { border-top-color: transparent; }
</style>
