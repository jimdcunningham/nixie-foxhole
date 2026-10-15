<script setup lang="ts">
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NxSkeleton from '#nixie/components/NxSkeleton.vue';
import NxSurfaceSection from '#nixie/components/NxSurfaceSection.vue';
import { useFoxholeWarSummaryMetrics } from '#foxhole/composables/useFoxholeWarSummaryMetrics.ts';

const {
    breakdownRows,
    breakdownSummaryState,
} = useFoxholeWarSummaryMetrics();

const splitSkeletonRows = [0, 1, 2, 3, 4, 5];
</script>

<template>
    <div class="foxhole-war-nx-split-tab">
        <NxSurfaceSection title="Faction Split">
            <div
                v-if="breakdownSummaryState?.kind === 'loading'"
                class="foxhole-war-nx-split-tab__table"
                aria-busy="true"
                aria-label="Loading faction split"
            >
                <div class="foxhole-war-nx-split-tab__header-row">
                    <span>Signal</span>
                    <span>Colonials</span>
                    <span>Wardens</span>
                </div>
                <div
                    v-for="row in splitSkeletonRows"
                    :key="row"
                    class="foxhole-war-nx-split-tab__row"
                >
                    <NxSkeleton width="72%" height="12px" shape="pill" />
                    <NxSkeleton width="48%" height="12px" shape="pill" />
                    <NxSkeleton width="48%" height="12px" shape="pill" />
                </div>
            </div>

            <NxEmptyState
                v-else-if="breakdownSummaryState"
                icon="ph:columns"
                :message="breakdownSummaryState.detail"
            />

            <div v-else class="foxhole-war-nx-split-tab__table">
                <div class="foxhole-war-nx-split-tab__header-row">
                    <span>Signal</span>
                    <span>Colonials</span>
                    <span>Wardens</span>
                </div>
                <div
                    v-for="row in breakdownRows"
                    :key="row.label"
                    class="foxhole-war-nx-split-tab__row"
                >
                    <span class="foxhole-war-nx-split-tab__label">{{ row.label }}</span>
                    <span class="foxhole-war-nx-split-tab__value is-colonial">{{ row.colonial }}</span>
                    <span class="foxhole-war-nx-split-tab__value is-warden">{{ row.warden }}</span>
                </div>
            </div>
        </NxSurfaceSection>
    </div>
</template>

<style scoped>
.foxhole-war-nx-split-tab {
    display: flex;
    flex-direction: column;
    gap: var(--nx-space-2);
    width: 100%;
    min-width: 0;
    min-height: 0;
}

.foxhole-war-nx-split-tab :deep(.nx-surface-section) {
    width: 100%;
    min-width: 0;
}

.foxhole-war-nx-split-tab :deep(.nx-surface-section__body) {
    width: 100%;
    min-width: 0;
}

.foxhole-war-nx-split-tab__table {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: var(--nx-space-2);
}

.foxhole-war-nx-split-tab__header-row,
.foxhole-war-nx-split-tab__row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--nx-space-2);
    align-items: center;
}

.foxhole-war-nx-split-tab__header-row {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.foxhole-war-nx-split-tab__row {
    padding: var(--nx-space-2) 0;
    border-top: 1px solid var(--nx-border);
}

.foxhole-war-nx-split-tab__label {
    color: var(--nx-text-heading);
    font-size: var(--nx-text-sm);
}

.foxhole-war-nx-split-tab__value {
    color: var(--nx-text-heading);
    font-size: var(--nx-text-sm);
    font-variant-numeric: tabular-nums;
}

.foxhole-war-nx-split-tab__value.is-colonial {
    color: #9bc47f;
}

.foxhole-war-nx-split-tab__value.is-warden {
    color: #7eb0e8;
}
</style>
