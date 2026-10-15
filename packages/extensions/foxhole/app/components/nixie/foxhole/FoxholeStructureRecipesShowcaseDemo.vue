<script setup lang="ts">
import FoxholeRecipeCard from '#foxhole/components/nixie/foxhole/FoxholeRecipeCard.vue';
import { resolveFoxholeRecipeShowcase } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';
import type { FoxholeRecipeShowcaseCase } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';

const runtimeConfig = useRuntimeConfig();
const appBaseUrl = computed(() => String(runtimeConfig.app.baseURL ?? '/'));

const showcaseCases = computed(() => (
    resolveFoxholeRecipeShowcase({ appBaseUrl: appBaseUrl.value })
));

const showcaseGroups = computed(() => {
    const groups: Array<{ name: string; cases: FoxholeRecipeShowcaseCase[]; }> = [];
    const byName = new Map<string, FoxholeRecipeShowcaseCase[]>();

    for (const entry of showcaseCases.value) {
        const existing = byName.get(entry.group);
        if (existing) {
            existing.push(entry);
            continue;
        }
        const cases = [entry];
        byName.set(entry.group, cases);
        groups.push({ name: entry.group, cases });
    }

    return groups;
});

function splitShowcaseColumns(
    cases: readonly FoxholeRecipeShowcaseCase[],
): Array<{ cases: FoxholeRecipeShowcaseCase[]; pad: boolean; }> {
    if (cases.length <= 1) {
        return [{ cases: [...cases], pad: false }];
    }
    const midpoint = Math.ceil(cases.length / 2);
    const left = cases.slice(0, midpoint);
    const right = cases.slice(midpoint);
    return [
        { cases: left, pad: left.length < right.length },
        { cases: right, pad: right.length < left.length },
    ];
}
</script>

<template>
    <div class="foxhole-recipes-showcase">
        <p class="foxhole-recipes-showcase__intro">
            Verbose recipe card coverage across layout edge cases, structure/vehicle build costs,
            and major production buildings — Refinery, Materials Factory, MPF, Field Modification
            Center, power plants, and more. Build costs show material costs only (no conversion
            arrow). Generators expose lightning-bolt Power as an output; facility power draw is
            text-only meta (resolved from recipe power, else structure powerGridInfo).
        </p>

        <NxCallout
            v-if="!showcaseCases.length"
            variant="info"
            title="No Showcase Recipes"
            message="The production index did not yield enough conversion recipes for the showcase set."
        />

        <div v-else class="foxhole-recipes-showcase__sections">
            <section
                v-for="group in showcaseGroups"
                :key="group.name"
                class="foxhole-recipes-showcase__section"
            >
                <h3 class="foxhole-recipes-showcase__section-title">
                    {{ group.name }}
                    <span class="foxhole-recipes-showcase__section-count">{{ group.cases.length }}</span>
                </h3>
                <div
                    class="foxhole-recipes-showcase__columns"
                    :class="{ 'is-single': group.cases.length <= 1 }"
                >
                    <div
                        v-for="(column, columnIndex) in splitShowcaseColumns(group.cases)"
                        :key="`${group.name}-${columnIndex}`"
                        class="foxhole-recipes-showcase__list"
                    >
                        <FoxholeRecipeCard
                            v-for="entry in column.cases"
                            :key="entry.id"
                            :recipe="entry.recipe"
                        />
                        <div
                            v-if="column.pad"
                            class="foxhole-recipes-showcase__pad"
                            aria-hidden="true"
                        />
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.foxhole-recipes-showcase {
    display: grid;
    gap: var(--nx-space-5);
    width: 100%;
    max-width: 960px;
    min-width: 0;
}

.foxhole-recipes-showcase__intro {
    margin: 0;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-normal);
}

.foxhole-recipes-showcase__sections {
    display: grid;
    gap: var(--nx-space-5);
    min-width: 0;
}

.foxhole-recipes-showcase__section {
    display: grid;
    gap: var(--nx-space-3);
    min-width: 0;
}

.foxhole-recipes-showcase__section-title {
    display: flex;
    align-items: baseline;
    gap: var(--nx-space-2);
    margin: 0;
    color: var(--nx-text);
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-heading-weight);
    line-height: var(--nx-leading-tight);
}

.foxhole-recipes-showcase__section-count {
    color: var(--nx-text-subtle);
    font-size: 11px;
    font-weight: 500;
}

.foxhole-recipes-showcase__columns {
    display: flex;
    align-items: stretch;
    min-width: 0;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    overflow: hidden;
    background: var(--nx-surface);
}

.foxhole-recipes-showcase__columns.is-single {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
}

.foxhole-recipes-showcase__list {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-self: stretch;
    min-width: 0;
    background: var(--nx-surface);
}

.foxhole-recipes-showcase__list + .foxhole-recipes-showcase__list {
    border-left: 1px solid var(--nx-border);
}

.foxhole-recipes-showcase__list :deep(.foxhole-recipe-card) {
    border: none;
    border-radius: 0;
    background: transparent;
}

.foxhole-recipes-showcase__list :deep(.foxhole-recipe-card + .foxhole-recipe-card),
.foxhole-recipes-showcase__pad {
    border-top: 1px solid var(--nx-border);
}

.foxhole-recipes-showcase__pad {
    flex: 1 1 auto;
    min-height: 0;
}

@media (max-width: 720px) {
    .foxhole-recipes-showcase__columns {
        flex-direction: column;
    }

    .foxhole-recipes-showcase__list + .foxhole-recipes-showcase__list {
        border-left: none;
        border-top: 1px solid var(--nx-border);
    }
}
</style>
