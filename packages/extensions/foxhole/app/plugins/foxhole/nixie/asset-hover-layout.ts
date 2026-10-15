import { resolveFoxholePowerDeltaMw } from '#foxhole/plugins/foxhole/nixie/facility-power.ts';
import {
    resolveFoxholeRecipeResourceLabel,
} from '#foxhole/plugins/foxhole/nixie/production/recipe-display.ts';

type FoxholeRecipeResourceRef = import('#foxhole/plugins/foxhole/nixie/production/recipe-display.ts').FoxholeRecipeResourceRef;
type FoxholeRecipeViewModel = import('#foxhole/plugins/foxhole/nixie/production/recipe-display.ts').FoxholeRecipeViewModel;

/** Above this count, hover shows a wrapping outputs paragraph instead of recipe cards. */
export const FOXHOLE_ASSET_HOVER_RECIPE_LIST_THRESHOLD = 12;

export type FoxholeAssetHoverAttribute = {
    id: string;
    label: string;
};

type FoxholeAssetHoverAttributeManifest = {
    inventorySlots?: number | null;
    /** Explicit War blueprint flag — do not infer from isFacility. */
    bIsBuiltOnFoundation?: boolean | null;
    vehicleSeats?: unknown[] | null;
    decays?: boolean | null;
    maxOrders?: number | null;
    liquidCapacity?: number | null;
    fuelTanks?: Array<{ capacity?: number | null; }> | null;
    stockpile?: {
        totalItemCapacity?: number | null;
        totalCrateCapacity?: number | null;
    } | null;
    holdProfile?: {
        mode?: string | null;
        capacity?: number | null;
        itemQuantityLimits?: Record<string, number> | null;
    } | null;
};

/** Compact recipe card with I/O tiles (2-col row height). */
export const FOXHOLE_ASSET_HOVER_RECIPE_FULL_ROW_PX = 76;
/** Title + power/duration only (2-col row height). */
export const FOXHOLE_ASSET_HOVER_RECIPE_HEADER_ROW_PX = 34;

export type FoxholeAssetHoverRecipePresentation = 'grid' | 'outputs-list';

export type FoxholeAssetHoverRecipeLayout = {
    presentation: FoxholeAssetHoverRecipePresentation;
    hideIo: boolean;
    visibleRecipes: FoxholeRecipeViewModel[];
    hiddenCount: number;
};

export function resolveFoxholeAssetHoverRecipePresentation(
    recipeCount: number,
): FoxholeAssetHoverRecipePresentation {
    return recipeCount > FOXHOLE_ASSET_HOVER_RECIPE_LIST_THRESHOLD
        ? 'outputs-list'
        : 'grid';
}

export function planFoxholeAssetHoverRecipeGridLayout(
    recipes: readonly FoxholeRecipeViewModel[],
    availableHeightPx: number,
): FoxholeAssetHoverRecipeLayout {
    if (recipes.length === 0) {
        return {
            presentation: 'grid',
            hideIo: false,
            visibleRecipes: [],
            hiddenCount: 0,
        };
    }

    const available = Math.max(0, availableHeightPx);
    const rows = Math.ceil(recipes.length / 2);
    const fullHeight = rows * FOXHOLE_ASSET_HOVER_RECIPE_FULL_ROW_PX;
    if (fullHeight <= available) {
        return {
            presentation: 'grid',
            hideIo: false,
            visibleRecipes: [...recipes],
            hiddenCount: 0,
        };
    }

    const headerHeight = rows * FOXHOLE_ASSET_HOVER_RECIPE_HEADER_ROW_PX;
    if (headerHeight <= available) {
        return {
            presentation: 'grid',
            hideIo: true,
            visibleRecipes: [...recipes],
            hiddenCount: 0,
        };
    }

    const rowsFit = Math.max(1, Math.floor(available / FOXHOLE_ASSET_HOVER_RECIPE_HEADER_ROW_PX));
    const recipesFit = Math.min(recipes.length, rowsFit * 2);
    const visibleRecipes = recipes.slice(0, recipesFit);
    return {
        presentation: 'grid',
        hideIo: true,
        visibleRecipes,
        hiddenCount: Math.max(0, recipes.length - visibleRecipes.length),
    };
}

export function splitFoxholeHoverRecipeColumns(recipes: readonly FoxholeRecipeViewModel[]): Array<{
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

export function formatFoxholeHoverRecipeOutputLabels(
    recipes: readonly FoxholeRecipeViewModel[],
    localize: (localizationId: string | null | undefined, fallback: string) => string,
): string[] {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const recipe of recipes) {
        const label = recipeOutputLabel(recipe, localize);
        const key = label.toLowerCase();
        if (!label || seen.has(key)) {
            continue;
        }
        seen.add(key);
        labels.push(label);
    }
    return labels;
}

export function formatFoxholeHoverPowerLabel(powerDelta: number | null | undefined): string {
    const powerMw = resolveFoxholePowerDeltaMw(powerDelta);
    if (!Number.isFinite(powerMw) || powerMw === 0) {
        return '';
    }
    const formatted = Number.isInteger(powerMw) ? String(powerMw) : powerMw.toFixed(1);
    return powerMw > 0 ? `+${formatted} MW` : `${formatted} MW`;
}

export function resolveFoxholeAssetHoverAttributes(
    _structure: unknown,
    manifest: FoxholeAssetHoverAttributeManifest | null | undefined,
): FoxholeAssetHoverAttribute[] {
    if (!manifest) {
        return [];
    }

    const attributes: FoxholeAssetHoverAttribute[] = [];
    const inventorySlots = Number(manifest.inventorySlots ?? NaN);
    if (Number.isFinite(inventorySlots) && inventorySlots > 0) {
        attributes.push({
            id: 'inventory',
            label: `Slots: ${Math.round(inventorySlots)}`,
        });
    }

    // Only the explicit blueprint flag — never infer from isFacility (#Factory, etc.).
    if (manifest.bIsBuiltOnFoundation === true) {
        attributes.push({
            id: 'foundation',
            label: 'Requires Foundation',
        });
    }

    const seatCount = Array.isArray(manifest.vehicleSeats) ? manifest.vehicleSeats.length : 0;
    if (seatCount > 0) {
        attributes.push({
            id: 'seats',
            label: `Seats: ${seatCount}`,
        });
    }

    if (manifest.decays === true) {
        attributes.push({
            id: 'decays',
            label: 'Decays',
        });
    }

    const liquidCapacity = Number(manifest.liquidCapacity ?? NaN);
    if (Number.isFinite(liquidCapacity) && liquidCapacity > 0) {
        attributes.push({
            id: 'liquid-capacity',
            label: `Liquid: ${formatCapacity(liquidCapacity)}`,
        });
    }

    const fuelCapacity = resolveFuelCapacity(manifest);
    if (fuelCapacity > 0) {
        attributes.push({
            id: 'fuel-capacity',
            label: `Fuel: ${formatCapacity(fuelCapacity)}`,
        });
    }

    const stockpileCapacity = Math.max(
        Number(manifest.stockpile?.totalItemCapacity ?? 0),
        Number(manifest.stockpile?.totalCrateCapacity ?? 0),
    );
    if (Number.isFinite(stockpileCapacity) && stockpileCapacity > 0) {
        attributes.push({
            id: 'stockpile-capacity',
            label: `Stockpile: ${formatCapacity(stockpileCapacity)}`,
        });
    }

    return attributes;
}

function resolveFuelCapacity(manifest: FoxholeAssetHoverAttributeManifest): number {
    const fuelTankCapacity = (manifest.fuelTanks ?? []).reduce((total, fuelTank) => (
        total + Math.max(0, Number(fuelTank.capacity ?? 0))
    ), 0);
    if (fuelTankCapacity > 0) {
        return fuelTankCapacity;
    }

    if (manifest.holdProfile?.mode !== 'fuel-tank') {
        return 0;
    }

    const profileCapacity = Number(manifest.holdProfile.capacity ?? 0);
    if (Number.isFinite(profileCapacity) && profileCapacity > 0) {
        return profileCapacity;
    }

    return Object.values(manifest.holdProfile.itemQuantityLimits ?? {})
        .reduce((total, capacity) => total + Math.max(0, Number(capacity ?? 0)), 0);
}

function formatCapacity(capacity: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(capacity);
}

function recipeOutputLabel(
    recipe: FoxholeRecipeViewModel,
    localize: (localizationId: string | null | undefined, fallback: string) => string,
): string {
    if (recipe.outputs.length > 0) {
        return recipe.outputs
            .map(resource => localizeRecipeResource(resource, localize))
            .filter(Boolean)
            .join(', ');
    }
    return recipe.title;
}

function localizeRecipeResource(
    resource: FoxholeRecipeResourceRef,
    localize: (localizationId: string | null | undefined, fallback: string) => string,
): string {
    const label = resolveFoxholeRecipeResourceLabel(resource, localize);
    if (resource.channel === 'crate' && label) {
        return `${label} (Crate)`;
    }
    return label;
}
