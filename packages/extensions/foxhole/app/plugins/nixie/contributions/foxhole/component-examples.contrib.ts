import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import FoxholeStructureRecipesShowcaseDemo from '#foxhole/components/nixie/foxhole/FoxholeStructureRecipesShowcaseDemo.vue';

export default defineContribution({
    componentExamples: [
        {
            id: 'foxhole.example.structure-recipes',
            name: 'FoxholeRecipeCard',
            title: 'Facility Recipes',
            subtitle: 'Verbose recipe cards across refinery/MPF/FMC/power plants — Power outputs for generators, structure power draw as meta.',
            keywords: [
                'recipe',
                'recipes',
                'production',
                'facility',
                'conversion',
                'resources',
                'foxhole',
                'FoxholeRecipeCard',
            ],
            order: 10,
            group: 'Foxhole',
            component: FoxholeStructureRecipesShowcaseDemo,
        },
    ],
});
