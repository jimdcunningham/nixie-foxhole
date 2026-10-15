<script setup lang="ts">
import NxBadge from '#nixie/components/NxBadge.vue';
import NxCallout from '#nixie/components/NxCallout.vue';
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NxSkeleton from '#nixie/components/NxSkeleton.vue';
import NxSkeletonCard from '#nixie/components/NxSkeletonCard.vue';
import NxSurfaceSection from '#nixie/components/NxSurfaceSection.vue';
import { useFoxholeWarSummaryMetrics } from '#foxhole/composables/useFoxholeWarSummaryMetrics.ts';

const {
    warSummary,
    factionStats,
    winRaceSummary,
    winRaceTone,
    momentumSummary,
    pulseSummaryState,
    controlTrendSeries,
    victoryRaceSeries,
    victoryRaceSummary,
    timelineSummaryState,
    momentumError,
    formatWarValue,
    formatRaceProgress,
    formatRemainingTowns,
} = useFoxholeWarSummaryMetrics();

function badgeVariantForTone(tone: 'colonial' | 'warden' | 'neutral'): 'default' | 'success' | 'accent' | 'warning' {
    if (tone === 'colonial') {
        return 'success';
    }
    if (tone === 'warden') {
        return 'accent';
    }
    return 'warning';
}
</script>

<template>
    <div class="foxhole-war-nx-pulse-tab">
        <template v-if="pulseSummaryState">
            <div
                v-if="pulseSummaryState.kind === 'loading'"
                class="foxhole-war-nx-pulse-tab__skeleton"
                aria-busy="true"
                aria-label="Loading war summary"
            >
                <div class="foxhole-war-nx-pulse-tab__skeleton-hero">
                    <NxSkeleton width="72px" height="10px" shape="pill" />
                    <NxSkeleton width="68%" height="18px" shape="pill" />
                    <NxSkeleton width="88%" height="12px" shape="pill" />
                </div>
                <NxSkeletonCard :showMedia="false" />
                <NxSkeletonCard :showMedia="false" />
                <NxSkeleton width="100%" height="120px" shape="rect" />
            </div>
            <NxEmptyState
                v-else
                icon="ph:pulse"
                :message="pulseSummaryState.detail"
            />
        </template>

        <template v-else>
            <NxSurfaceSection title="Victory Towns">
                <template #header>
                    <div class="foxhole-war-nx-pulse-tab__section-header foxhole-war-nx-pulse-tab__section-header--divided">
                        <div class="foxhole-war-nx-pulse-tab__section-copy">
                            <p class="foxhole-war-nx-pulse-tab__kicker">Victory Towns</p>
                            <h2 class="foxhole-war-nx-pulse-tab__title">{{ victoryRaceSummary.title }}</h2>
                            <p class="foxhole-war-nx-pulse-tab__copy">{{ victoryRaceSummary.subtitle }}</p>
                        </div>
                    </div>
                </template>

                <div class="foxhole-war-nx-pulse-tab__race">
                    <div class="foxhole-war-nx-pulse-tab__race-labels">
                        <span class="foxhole-war-nx-pulse-tab__race-label">
                            <span class="foxhole-war-nx-pulse-tab__race-label-full">Colonials</span>
                            <span class="foxhole-war-nx-pulse-tab__race-label-short" aria-hidden="true">COL</span>
                        </span>
                        <span class="foxhole-war-nx-pulse-tab__race-label is-center">
                            Race to {{ formatWarValue(warSummary?.requiredVictoryTowns) }}
                        </span>
                        <span class="foxhole-war-nx-pulse-tab__race-label is-warden">
                            <span class="foxhole-war-nx-pulse-tab__race-label-full">Wardens</span>
                            <span class="foxhole-war-nx-pulse-tab__race-label-short" aria-hidden="true">WARD</span>
                        </span>
                    </div>

                    <div class="foxhole-war-nx-pulse-tab__race-values">
                        <span class="foxhole-war-nx-pulse-tab__race-value is-colonial">{{ formatWarValue(factionStats.colonial.victoryTowns) }}</span>
                        <NxBadge :variant="badgeVariantForTone(winRaceTone)">
                            {{ winRaceSummary.leadLabel }}
                        </NxBadge>
                        <span class="foxhole-war-nx-pulse-tab__race-value is-warden">{{ formatWarValue(factionStats.warden.victoryTowns) }}</span>
                    </div>

                    <div class="foxhole-war-nx-pulse-tab__race-meta-row">
                        <span class="foxhole-war-nx-pulse-tab__race-meta">{{ formatRemainingTowns(factionStats.colonial.townsToVictory) }}</span>
                        <span aria-hidden="true" />
                        <span class="foxhole-war-nx-pulse-tab__race-meta is-warden">{{ formatRemainingTowns(factionStats.warden.townsToVictory) }}</span>
                    </div>
                </div>

                <div class="foxhole-war-nx-pulse-tab__bars" aria-hidden="true">
                    <div class="foxhole-war-nx-pulse-tab__bar">
                        <span class="foxhole-war-nx-pulse-tab__bar-label">COL</span>
                        <div class="foxhole-war-nx-pulse-tab__bar-track">
                            <div
                                class="foxhole-war-nx-pulse-tab__bar-fill is-colonial"
                                :style="{ width: `${factionStats.colonial.progressPercent}%` }"
                            />
                        </div>
                        <span class="foxhole-war-nx-pulse-tab__bar-target">
                            {{ formatRaceProgress(factionStats.colonial.victoryTowns, warSummary?.requiredVictoryTowns) }}
                        </span>
                    </div>
                    <div class="foxhole-war-nx-pulse-tab__bar">
                        <span class="foxhole-war-nx-pulse-tab__bar-label">WARD</span>
                        <div class="foxhole-war-nx-pulse-tab__bar-track">
                            <div
                                class="foxhole-war-nx-pulse-tab__bar-fill is-warden"
                                :style="{ width: `${factionStats.warden.progressPercent}%` }"
                            />
                        </div>
                        <span class="foxhole-war-nx-pulse-tab__bar-target">
                            {{ formatRaceProgress(factionStats.warden.victoryTowns, warSummary?.requiredVictoryTowns) }}
                        </span>
                    </div>
                </div>

                <div
                    v-if="timelineSummaryState?.kind === 'loading' && !victoryRaceSeries.points.length"
                    class="foxhole-war-nx-pulse-tab__chart-skeleton foxhole-war-nx-pulse-tab__chart-wrap--victory"
                    aria-busy="true"
                    aria-label="Loading victory town trend"
                >
                    <NxSkeleton width="100%" height="120px" shape="rect" />
                </div>

                <NxCallout
                    v-else-if="momentumError && !victoryRaceSeries.points.length"
                    class="foxhole-war-nx-pulse-tab__chart-wrap--victory"
                    title="Playback Unavailable"
                    :message="momentumError"
                    variant="danger"
                />

                <div
                    v-else-if="victoryRaceSeries.points.length"
                    class="foxhole-war-nx-pulse-tab__chart-wrap foxhole-war-nx-pulse-tab__chart-wrap--victory"
                >
                    <svg
                        viewBox="0 0 100 44"
                        class="foxhole-war-nx-pulse-tab__chart"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Victory towns over the last 24 hours against the win line"
                    >
                        <line
                            x1="0"
                            :y1="victoryRaceSeries.targetY"
                            x2="100"
                            :y2="victoryRaceSeries.targetY"
                            class="foxhole-war-nx-pulse-tab__target"
                        />
                        <path
                            v-if="victoryRaceSeries.colonialPath"
                            :d="victoryRaceSeries.colonialPath"
                            class="foxhole-war-nx-pulse-tab__line is-colonial"
                        />
                        <path
                            v-if="victoryRaceSeries.wardenPath"
                            :d="victoryRaceSeries.wardenPath"
                            class="foxhole-war-nx-pulse-tab__line is-warden"
                        />
                    </svg>
                </div>
            </NxSurfaceSection>

            <NxSurfaceSection title="Territory Control">
                <template #header>
                    <div class="foxhole-war-nx-pulse-tab__section-header">
                        <div class="foxhole-war-nx-pulse-tab__section-copy">
                            <p class="foxhole-war-nx-pulse-tab__kicker">Territory Control</p>
                            <h2 class="foxhole-war-nx-pulse-tab__title">{{ momentumSummary.title }}</h2>
                            <p class="foxhole-war-nx-pulse-tab__copy">{{ momentumSummary.subtitle }}</p>
                        </div>
                    </div>
                </template>

                <div
                    v-if="timelineSummaryState?.kind === 'loading'"
                    class="foxhole-war-nx-pulse-tab__chart-skeleton"
                    aria-busy="true"
                    aria-label="Loading territory control"
                >
                    <NxSkeleton width="100%" height="120px" shape="rect" />
                </div>

                <NxEmptyState
                    v-else-if="timelineSummaryState"
                    icon="ph:chart-line"
                    :message="timelineSummaryState.detail"
                />

                <NxCallout
                    v-else-if="momentumError && !controlTrendSeries.points.length"
                    title="Playback Unavailable"
                    :message="momentumError"
                    variant="danger"
                />

                <div
                    v-else-if="controlTrendSeries.points.length"
                    class="foxhole-war-nx-pulse-tab__chart-wrap"
                >
                    <svg
                        viewBox="0 0 100 44"
                        class="foxhole-war-nx-pulse-tab__chart"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Territory lead over the last 24 hours. Above Even is a Colonial lead, below Even is a Warden lead."
                    >
                        <line
                            x1="0"
                            :y1="controlTrendSeries.baselineY"
                            x2="100"
                            :y2="controlTrendSeries.baselineY"
                            class="foxhole-war-nx-pulse-tab__baseline"
                        />
                        <path
                            v-if="controlTrendSeries.colonialAreaPath"
                            :d="controlTrendSeries.colonialAreaPath"
                            class="foxhole-war-nx-pulse-tab__area is-colonial"
                        />
                        <path
                            v-if="controlTrendSeries.wardenAreaPath"
                            :d="controlTrendSeries.wardenAreaPath"
                            class="foxhole-war-nx-pulse-tab__area is-warden"
                        />
                        <path
                            v-if="controlTrendSeries.colonialPath"
                            :d="controlTrendSeries.colonialPath"
                            class="foxhole-war-nx-pulse-tab__line is-colonial"
                        />
                        <path
                            v-if="controlTrendSeries.wardenPath"
                            :d="controlTrendSeries.wardenPath"
                            class="foxhole-war-nx-pulse-tab__line is-warden"
                        />
                    </svg>
                </div>
            </NxSurfaceSection>
        </template>
    </div>
</template>

<style scoped>
.foxhole-war-nx-pulse-tab {
    display: flex;
    flex-direction: column;
    gap: var(--nx-space-2);
    min-height: 0;
}

.foxhole-war-nx-pulse-tab__skeleton,
.foxhole-war-nx-pulse-tab__skeleton-hero,
.foxhole-war-nx-pulse-tab__chart-skeleton,
.foxhole-war-nx-pulse-tab__chart-wrap {
    display: grid;
    gap: var(--nx-space-2);
}

.foxhole-war-nx-pulse-tab__chart-wrap--victory {
    margin-top: var(--nx-space-2);
}

.foxhole-war-nx-pulse-tab__section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--nx-space-3);
    width: 100%;
}

.foxhole-war-nx-pulse-tab__section-header--divided {
    padding-bottom: var(--nx-space-3);
    border-bottom: 1px solid var(--nx-border);
}

.foxhole-war-nx-pulse-tab__section-copy {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
}

.foxhole-war-nx-pulse-tab__kicker {
    margin: 0 0 var(--nx-space-1);
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.foxhole-war-nx-pulse-tab__title {
    margin: 0;
    color: var(--nx-text-heading);
    font-size: var(--nx-text-lg);
    font-weight: var(--nx-heading-weight);
}

.foxhole-war-nx-pulse-tab__copy {
    margin: var(--nx-space-2) 0 0;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-normal);
}

.foxhole-war-nx-pulse-tab__race {
    display: grid;
    gap: 2px;
    padding: 0 0 var(--nx-space-2);
    container-type: inline-size;
    container-name: foxhole-war-nx-pulse-race;
}

.foxhole-war-nx-pulse-tab__race-labels,
.foxhole-war-nx-pulse-tab__race-values,
.foxhole-war-nx-pulse-tab__race-meta-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: var(--nx-space-3);
    align-items: center;
}

.foxhole-war-nx-pulse-tab__race-values :deep(.nx-badge) {
    justify-self: center;
    /* Digits sit slightly below their line-box center; nudge the pill to match ink. */
    transform: translateY(1px);
}

.foxhole-war-nx-pulse-tab__race-label.is-warden,
.foxhole-war-nx-pulse-tab__race-value.is-warden,
.foxhole-war-nx-pulse-tab__race-meta.is-warden {
    text-align: right;
}

.foxhole-war-nx-pulse-tab__race-label {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.foxhole-war-nx-pulse-tab__race-label-short {
    display: none;
}

.foxhole-war-nx-pulse-tab__race-label.is-center {
    text-align: center;
}

@container foxhole-war-nx-pulse-race (max-width: 180px) {
    .foxhole-war-nx-pulse-tab__race-label-full {
        display: none;
    }

    .foxhole-war-nx-pulse-tab__race-label-short {
        display: inline;
    }
}

.foxhole-war-nx-pulse-tab__race-value {
    color: var(--nx-text-heading);
    font-size: var(--nx-text-xl);
    font-weight: var(--nx-heading-weight);
    font-variant-numeric: tabular-nums;
    line-height: 1;
}

.foxhole-war-nx-pulse-tab__race-value.is-colonial {
    color: #9bc07a;
}

.foxhole-war-nx-pulse-tab__race-value.is-warden {
    color: #7e9fd0;
}

.foxhole-war-nx-pulse-tab__race-meta {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
}

.foxhole-war-nx-pulse-tab__bars {
    display: grid;
    gap: var(--nx-space-2);
}

.foxhole-war-nx-pulse-tab__bar {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: var(--nx-space-2);
    align-items: center;
}

.foxhole-war-nx-pulse-tab__bar-label,
.foxhole-war-nx-pulse-tab__bar-target {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    font-variant-numeric: tabular-nums;
}

.foxhole-war-nx-pulse-tab__bar-track {
    position: relative;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--nx-hover-surface);
}

.foxhole-war-nx-pulse-tab__bar-fill {
    height: 100%;
    border-radius: inherit;
}

.foxhole-war-nx-pulse-tab__bar-fill.is-colonial {
    background: #9bc07a;
}

.foxhole-war-nx-pulse-tab__bar-fill.is-warden {
    background: #7e9fd0;
}

.foxhole-war-nx-pulse-tab__chart {
    display: block;
    width: 100%;
    height: 120px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    background: var(--nx-hover-surface);
}

.foxhole-war-nx-pulse-tab__baseline {
    stroke: var(--nx-border);
    stroke-width: 0.35;
}

.foxhole-war-nx-pulse-tab__area.is-colonial {
    fill: color-mix(in srgb, #7eaa62 22%, transparent);
}

.foxhole-war-nx-pulse-tab__area.is-warden {
    fill: color-mix(in srgb, #5c95d6 22%, transparent);
}

.foxhole-war-nx-pulse-tab__line {
    fill: none;
    stroke-width: 0.9;
}

.foxhole-war-nx-pulse-tab__line.is-colonial {
    stroke: #7eaa62;
}

.foxhole-war-nx-pulse-tab__line.is-warden {
    stroke: #5c95d6;
}

.foxhole-war-nx-pulse-tab__target {
    stroke: var(--nx-text-muted);
    stroke-width: 0.45;
    stroke-dasharray: 1.6 1.2;
}
</style>
