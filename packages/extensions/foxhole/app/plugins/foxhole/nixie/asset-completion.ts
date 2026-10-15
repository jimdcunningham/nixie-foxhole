/**
 * All current Foxhole assets are finished. Keep completion tracking enabled
 * so adding a category or asset to an unfinished list restores its WIP marker
 * and the completion filter when further work is needed.
 */
export const FOXHOLE_ASSET_COMPLETION_MARKERS_ENABLED = true;

const INCOMPLETE_FOXHOLE_CATEGORY_KEYS = new Set<string>([]);

const INCOMPLETE_FOXHOLE_ASSET_KEYS = new Set<string>([]);

function normalizeFoxholeAssetKey(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

export function isFoxholeAssetComplete(foxholeKey: string, categoryKey?: string): boolean {
    if (!FOXHOLE_ASSET_COMPLETION_MARKERS_ENABLED) {
        return true;
    }

    const normalizedCategoryKey = normalizeFoxholeAssetKey(categoryKey);
    if (normalizedCategoryKey && INCOMPLETE_FOXHOLE_CATEGORY_KEYS.has(normalizedCategoryKey)) {
        return false;
    }

    return !INCOMPLETE_FOXHOLE_ASSET_KEYS.has(normalizeFoxholeAssetKey(foxholeKey));
}

export function resolveFoxholeAssetCompletionMetadata(foxholeKey: string, categoryKey?: string) {
    return {
        assetComplete: isFoxholeAssetComplete(foxholeKey, categoryKey),
    };
}
