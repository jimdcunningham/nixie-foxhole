import type { FoxholeItemAsset, FoxholeItemCatalog, FoxholeStructureCatalog } from './catalog.ts';
import type { FoxholeManifestHoldProfile } from './manifest.ts';
import { resolveFoxholeStockpileSelectionGroups, resolveFoxholeStockpileGroupSelection } from './stockpile-groups.ts';

export interface FoxholeHoldProfileItemOption {
    codename: string;
    label: string;
    item: FoxholeItemAsset | null;
}

function normalizeCodenameLookupKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

export function isFoxholeBuildSiteKey(foxholeKey: string): boolean {
    return /buildsite$/i.test(String(foxholeKey ?? '').trim());
}

export function resolveFoxholeAssetHoldProfile(
    catalog: Pick<FoxholeStructureCatalog, 'structureByKey'>,
    foxholeKey: string,
): FoxholeManifestHoldProfile | null {
    const normalizedKey = String(foxholeKey ?? '').trim();
    if (!normalizedKey || isFoxholeBuildSiteKey(normalizedKey)) {
        return null;
    }

    return catalog.structureByKey[normalizedKey]?.holdProfile ?? null;
}

export function hasFoxholeHoldProfileItemSelection(
    holdProfile: FoxholeManifestHoldProfile | null | undefined,
): boolean {
    if (!holdProfile) {
        return false;
    }

    return holdProfile.allowsAnyItem === true || Boolean(holdProfile.allowedItems?.length);
}

/**
 * Structures with a stockpile / crate stockpile / fuel tank keep that cargo when packaged
 * (inventory must be empty first). Inventory-only holds cannot keep cargo while packaged.
 */
export function foxholeHoldProfileRetainsCargoWhenPackaged(
    holdProfile: FoxholeManifestHoldProfile | null | undefined,
): boolean {
    const mode = holdProfile?.mode;
    return mode === 'stockpile' || mode === 'crate-stockpile' || mode === 'fuel-tank';
}

export function buildFoxholeItemCodenameLookup(itemCatalog: FoxholeItemCatalog): Map<string, FoxholeItemAsset> {
    const lookup = new Map<string, FoxholeItemAsset>();

    for (const item of itemCatalog.assets) {
        for (const candidate of [item.codeName, item.foxholeKey, item.resourceKey, item.legacyKey]) {
            const normalizedKey = normalizeCodenameLookupKey(candidate);
            if (!normalizedKey || lookup.has(normalizedKey)) {
                continue;
            }

            lookup.set(normalizedKey, item);
        }
    }

    return lookup;
}

export function resolveFoxholeHoldProfileItemOptions(
    holdProfile: FoxholeManifestHoldProfile,
    itemCatalog: FoxholeItemCatalog,
    resolveLabel: (item: FoxholeItemAsset | null, codename: string) => string,
): FoxholeHoldProfileItemOption[] {
    const itemLookup = buildFoxholeItemCodenameLookup(itemCatalog);
    const codenames = holdProfile.allowsAnyItem
        ? itemCatalog.assets.map(item => item.codeName).filter(Boolean)
        : (holdProfile.allowedItems ?? []);

    const seen = new Set<string>();
    const options: FoxholeHoldProfileItemOption[] = [];

    for (const codename of codenames) {
        const normalizedCodename = String(codename ?? '').trim();
        if (!normalizedCodename) {
            continue;
        }

        const lookupKey = normalizeCodenameLookupKey(normalizedCodename);
        if (seen.has(lookupKey)) {
            continue;
        }

        seen.add(lookupKey);
        const item = itemLookup.get(lookupKey) ?? null;
        options.push({
            codename: normalizedCodename,
            label: resolveLabel(item, normalizedCodename),
            item,
        });
    }

    return options.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}

export function normalizeMarkedItemCodenames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const entry of value) {
        const codename = String(entry ?? '').trim();
        if (!codename || seen.has(codename)) {
            continue;
        }

        seen.add(codename);
        normalized.push(codename);
    }

    return normalized;
}

export function resolveFoxholeHoldProfileMarkedItemLimit(
    holdProfile: FoxholeManifestHoldProfile | null | undefined,
): number | null {
    if (!holdProfile) {
        return null;
    }

    if (holdProfile.mode === 'inventory' || holdProfile.mode === 'crate-stockpile') {
        return holdProfile.capacity != null && holdProfile.capacity > 0
            ? holdProfile.capacity
            : null;
    }

    if (holdProfile.mode === 'fuel-tank') {
        return 1;
    }

    return null;
}

export function clampMarkedItemCodenames(
    codenames: string[],
    limit: number | null | undefined,
): string[] {
    const normalized = normalizeMarkedItemCodenames(codenames);
    if (limit == null || limit <= 0 || normalized.length <= limit) {
        return normalized;
    }

    return normalized.slice(0, limit);
}

export function resolveSupportedMarkedItemCodenames(
    holdProfile: FoxholeManifestHoldProfile | null | undefined,
    value: unknown,
): string[] {
    if (!hasFoxholeHoldProfileItemSelection(holdProfile)) {
        return [];
    }
    const allowed = new Set((holdProfile?.allowedItems ?? []).map(normalizeCodenameLookupKey));
    const supported = normalizeMarkedItemCodenames(value).filter(codename => (
        holdProfile?.allowsAnyItem === true || allowed.has(normalizeCodenameLookupKey(codename))
    ));
    return clampMarkedItemCodenames(supported, resolveFoxholeHoldProfileMarkedItemLimit(holdProfile));
}

/** Include cargo reconciliation in the same patch so undo restores it too. */
export function reconcileFoxholeAssetCargoPatch<T extends Record<string, unknown>>(
    catalog: Partial<Pick<FoxholeStructureCatalog, 'structureByKey'>>,
    state: Record<string, unknown>,
    patch: T,
): T {
    if (!('foxholeKey' in patch) || patch.foxholeKey === state.foxholeKey
        || (!('markedItemCodenames' in patch) && !Array.isArray(state.markedItemCodenames) && !state.markedStockpileItems && !('markedStockpileItems' in patch))) {
        return patch;
    }
    const destination = catalog.structureByKey?.[String(patch.foxholeKey ?? '')];
    const groups = resolveFoxholeStockpileSelectionGroups(isFoxholeBuildSiteKey(String(patch.foxholeKey ?? '')) ? undefined : destination?.stockpiles);
    const sourceGroups = resolveFoxholeStockpileSelectionGroups(catalog.structureByKey?.[String(state.foxholeKey ?? '')]?.stockpiles);
    const nativeNonItems = new Set(sourceGroups.filter(group => group.entryType !== 'Items').flatMap(group => group.allowed.map(code => code.toLowerCase())));
    const nativeItems = new Set(sourceGroups.filter(group => group.entryType === 'Items').flatMap(group => group.allowed.map(code => code.toLowerCase())));
    const legacyCargo = normalizeMarkedItemCodenames(patch.markedItemCodenames ?? state.markedItemCodenames).filter(code =>
        !destination?.holdProfile?.allowsAnyItem || !nativeNonItems.has(code.toLowerCase()) || nativeItems.has(code.toLowerCase()));
    return { ...patch,
        ...((state.markedStockpileItems || 'markedStockpileItems' in patch) ? { markedStockpileItems: groups.length
            ? Object.fromEntries(groups.map(group => [group.key, resolveFoxholeStockpileGroupSelection(group, patch.markedStockpileItems ?? state.markedStockpileItems, patch.markedItemCodenames ?? state.markedItemCodenames)]))
            : undefined } : {}),
        markedItemCodenames: resolveSupportedMarkedItemCodenames(
        resolveFoxholeAssetHoldProfile({ structureByKey: catalog.structureByKey ?? {} }, String(patch.foxholeKey ?? '')),
        legacyCargo,
    ) };
}
