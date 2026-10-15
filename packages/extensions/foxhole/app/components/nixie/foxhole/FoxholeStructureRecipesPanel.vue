<script setup lang="ts">
import FoxholeRecipeCard from '#foxhole/components/nixie/foxhole/FoxholeRecipeCard.vue';
import { resolveFoxholeStructureDefaultIconUrl } from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import type { FoxholeRecipeGroupViewModel, FoxholeRecipeViewModel, FoxholeStructureRecipesViewModel } from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';

const props = withDefaults(defineProps<{
    model: FoxholeStructureRecipesViewModel;
    selectedRecipeId?: string | null;
    selectable?: boolean;
    compact?: boolean;
    showHeader?: boolean;
    showGroupTitles?: boolean;
    showAssemblyRecipes?: boolean;
}>(), {
    selectedRecipeId: null,
    selectable: false,
    compact: true,
    showHeader: true,
    showGroupTitles: true,
    showAssemblyRecipes: true,
});

const emit = defineEmits<{
    'update:selectedRecipeId': [recipeId: string | null];
    'select': [recipeId: string];
}>();

const { t } = useFoxholeLocalization();

const structureLabel = computed(() => {
    const structure = props.model.structure;
    if (!structure) {
        return props.model.structureId || 'Unknown Structure';
    }
    return t(structure.nameLocalizationId, structure.name);
});

const structureIconUrl = computed(() => (
    resolveFoxholeStructureDefaultIconUrl(props.model.structure)
));

const recipeCountLabel = computed(() => {
    const count = props.model.recipes.length;
    return `${count} recipe${count === 1 ? '' : 's'}`;
});

function splitRecipeColumns(recipes: readonly FoxholeRecipeViewModel[]): Array<{
    recipes: FoxholeRecipeViewModel[];
    pad: boolean;
}> {
    if (recipes.length <= 1) {
        return [{ recipes: [...recipes], pad: false }];
    }
    const midpoint = Math.ceil(recipes.length / 2);
    const left = recipes.slice(0, midpoint);
    const right = recipes.slice(midpoint);
    return [
        { recipes: left, pad: left.length < right.length },
        { recipes: right, pad: right.length < left.length },
    ];
}

function columnsForGroup(group: FoxholeRecipeGroupViewModel): Array<{
    recipes: FoxholeRecipeViewModel[];
    pad: boolean;
}> {
    if (usesAssemblyOutputGrid(group)) {
        return [{ recipes: [...group.recipes], pad: false }];
    }
    return splitRecipeColumns(group.recipes);
}

function onSelect(recipeId: string): void {
    emit('select', recipeId);
    emit('update:selectedRecipeId', recipeId);
}

function isAssemblyRecipe(recipe: FoxholeRecipeViewModel): boolean {
    return [
        'facilityvehiclefactory1',
        'facilityvehiclefactory2',
        'facilityvehiclefactory3',
    ].includes(recipe.recipe.sourceStructureId.toLowerCase());
}

function usesAssemblyOutputGrid(group: FoxholeRecipeGroupViewModel): boolean {
    return !props.showAssemblyRecipes
        && group.recipes.length > 0
        && group.recipes.every(isAssemblyRecipe);
}
</script>

<template>
    <div class="foxhole-structure-recipes" :class="{ 'is-compact': compact }">
        <div v-if="showHeader" class="foxhole-structure-recipes__header">
            <div class="foxhole-structure-recipes__identity">
                <NxEntityIcon
                    :src="structureIconUrl"
                    :label="structureLabel"
                    size="md"
                />
                <div class="foxhole-structure-recipes__copy">
                    <strong class="foxhole-structure-recipes__title">{{ structureLabel }}</strong>
                    <span class="foxhole-structure-recipes__meta">
                        {{ model.structureId }} · {{ recipeCountLabel }}
                    </span>
                </div>
            </div>
        </div>

        <NxCallout
            v-if="!model.recipes.length"
            variant="info"
            title="No Recipes"
            message="This structure has no conversion recipes in the production index."
        />

        <div v-else class="foxhole-structure-recipes__groups">
            <section
                v-for="group in model.groups"
                :key="group.id"
                class="foxhole-structure-recipes__group"
            >
                <h3 v-if="showGroupTitles" class="foxhole-structure-recipes__group-title">{{ group.title }}</h3>
                <div
                    class="foxhole-structure-recipes__columns"
                    :class="{
                        'is-single': group.recipes.length <= 1,
                        'is-assembly-output-grid': usesAssemblyOutputGrid(group),
                    }"
                >
                    <div
                        v-for="(column, columnIndex) in columnsForGroup(group)"
                        :key="`${group.id}-${columnIndex}`"
                        class="foxhole-structure-recipes__list"
                    >
                        <FoxholeRecipeCard
                            v-for="recipe in column.recipes"
                            :key="recipe.id"
                            :recipe="recipe"
                            :selectable="selectable"
                            :selected="selectedRecipeId === recipe.id"
                            :compact="compact"
                            :outputOnly="!showAssemblyRecipes && isAssemblyRecipe(recipe)"
                            @select="onSelect"
                        />
                        <div
                            v-if="column.pad"
                            class="foxhole-structure-recipes__pad"
                            aria-hidden="true"
                        />
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.foxhole-structure-recipes {
    display: grid;
    gap: var(--nx-space-3);
    width: 100%;
    min-width: 0;
}

.foxhole-structure-recipes__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--nx-space-3);
}

.foxhole-structure-recipes__identity {
    display: flex;
    align-items: center;
    gap: var(--nx-space-3);
    min-width: 0;
}

.foxhole-structure-recipes__copy {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.foxhole-structure-recipes__title {
    color: var(--nx-text);
    font-size: var(--nx-text-sm);
    font-weight: var(--nx-heading-weight);
    line-height: var(--nx-leading-tight);
}

.foxhole-structure-recipes__meta {
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    line-height: var(--nx-leading-normal);
}

.foxhole-structure-recipes__groups {
    display: grid;
    gap: var(--nx-space-4);
}

.foxhole-structure-recipes__group {
    display: grid;
    gap: var(--nx-space-2);
    min-width: 0;
}

.foxhole-structure-recipes__group-title {
    margin: 0;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    font-weight: var(--nx-heading-weight);
    line-height: var(--nx-leading-tight);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.foxhole-structure-recipes__columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: stretch;
    gap: 0;
    min-width: 0;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-md);
    overflow: hidden;
    background: var(--nx-surface);
}

.foxhole-structure-recipes__columns.is-single {
    grid-template-columns: minmax(0, 1fr);
}

.foxhole-structure-recipes__columns.is-assembly-output-grid {
    grid-template-columns: minmax(0, 1fr);
    overflow: visible;
    padding: var(--nx-space-2);
    border: 0;
    background: transparent;
}

.foxhole-structure-recipes__columns.is-assembly-output-grid .foxhole-structure-recipes__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: var(--nx-space-2);
    min-height: 0;
    background: transparent;
}

.foxhole-structure-recipes__columns.is-assembly-output-grid .foxhole-structure-recipes__list :deep(.foxhole-recipe-card + .foxhole-recipe-card) {
    border-top: 0;
}

.foxhole-structure-recipes__list {
    display: flex;
    flex-direction: column;
    align-self: stretch;
    gap: 0;
    min-width: 0;
    min-height: 100%;
    background: var(--nx-surface);
}

.foxhole-structure-recipes__list + .foxhole-structure-recipes__list {
    border-left: 1px solid var(--nx-border);
}

.foxhole-structure-recipes__list :deep(.foxhole-recipe-card) {
    border: none;
    border-radius: 0;
    background: transparent;
}

.foxhole-structure-recipes__list :deep(.foxhole-recipe-card + .foxhole-recipe-card),
.foxhole-structure-recipes__pad {
    border-top: 1px solid var(--nx-border);
}

.foxhole-structure-recipes__pad {
    flex: 1 1 auto;
    min-height: 0;
}

.foxhole-structure-recipes__list :deep(.foxhole-recipe-card.is-selectable:hover),
.foxhole-structure-recipes__list :deep(.foxhole-recipe-card.is-selected) {
    position: relative;
    z-index: 1;
}

@media (max-width: 640px) {
    .foxhole-structure-recipes__columns {
        grid-template-columns: minmax(0, 1fr);
    }

    .foxhole-structure-recipes__list + .foxhole-structure-recipes__list {
        border-left: none;
        border-top: 1px solid var(--nx-border);
    }
}
</style>
