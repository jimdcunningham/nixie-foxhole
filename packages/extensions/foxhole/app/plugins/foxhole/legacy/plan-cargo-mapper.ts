import {
    buildFoxholeItemCodenameLookup,
    clampMarkedItemCodenames,
    isFoxholeBuildSiteKey,
    normalizeMarkedItemCodenames,
    resolveFoxholeHoldProfileMarkedItemLimit,
} from '../nixie/hold-profile.ts';
import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../nixie/catalog.ts';
import type { FoxholeManifestHoldProfile } from '../nixie/manifest.ts';

export type LegacyCargoMappingResult = {
    markedItemCodenames: string[];
    unresolvedItemKeys: string[];
    consumedFields: Array<'stockpileItems' | 'inventoryItems'>;
};

function normalizeLookup(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

// Legacy plans occasionally persisted construction-state keys in an item's
// inventory/stockpile list. They are not Foxhole item codenames and must not
// become cargo-overlay warnings in an otherwise valid import.
const LEGACY_NON_ITEM_OVERLAY_KEYS = new Set(['excavation']);

/**
 * Maps legacy stockpileItems / inventoryItems onto Nixie markedItemCodenames (cargo overlay).
 */
export class LegacyPlanCargoMapper {
    private readonly structureCatalog: FoxholeStructureCatalog;
    private readonly itemByLookup: ReturnType<typeof buildFoxholeItemCodenameLookup>;

    constructor(
        structureCatalog: FoxholeStructureCatalog,
        itemCatalog: FoxholeItemCatalog,
    ) {
        this.structureCatalog = structureCatalog;
        this.itemByLookup = buildFoxholeItemCodenameLookup(itemCatalog);
    }

    mapEntityCargo(options: {
        foxholeKey: string;
        stockpileItems?: string[] | null;
        inventoryItems?: string[] | null;
    }): LegacyCargoMappingResult {
        if (isFoxholeBuildSiteKey(options.foxholeKey)) {
            return { markedItemCodenames: [], unresolvedItemKeys: [], consumedFields: [] };
        }
        const holdProfile = this.resolveHoldProfile(options.foxholeKey);
        const preferredField = this.preferField(holdProfile, options);
        const sourceItems = preferredField === 'stockpileItems'
            ? options.stockpileItems
            : preferredField === 'inventoryItems'
                ? options.inventoryItems
                : (options.stockpileItems?.length ? options.stockpileItems : options.inventoryItems);

        const consumedFields: Array<'stockpileItems' | 'inventoryItems'> = [];
        if (Array.isArray(options.stockpileItems) && options.stockpileItems.length && (
            preferredField === 'stockpileItems' || (!preferredField && options.stockpileItems === sourceItems)
        )) {
            consumedFields.push('stockpileItems');
        }
        if (Array.isArray(options.inventoryItems) && options.inventoryItems.length && (
            preferredField === 'inventoryItems' || (!preferredField && options.inventoryItems === sourceItems)
        )) {
            consumedFields.push('inventoryItems');
        }
        // If both present and we only preferred one, still mark the unused sibling unconsumed.
        if (!consumedFields.length && Array.isArray(sourceItems) && sourceItems.length) {
            if (sourceItems === options.stockpileItems) {
                consumedFields.push('stockpileItems');
            } else {
                consumedFields.push('inventoryItems');
            }
        }

        const unresolvedItemKeys: string[] = [];
        const resolved: string[] = [];
        for (const raw of sourceItems ?? []) {
            const lookup = normalizeLookup(raw);
            if (!lookup) {
                continue;
            }
            if (LEGACY_NON_ITEM_OVERLAY_KEYS.has(lookup)) {
                continue;
            }
            const item = this.itemByLookup.get(lookup);
            if (!item) {
                unresolvedItemKeys.push(String(raw));
                continue;
            }
            resolved.push(item.codeName || item.foxholeKey);
        }

        const allowed = new Set(
            (holdProfile?.allowedItems ?? []).map(entry => normalizeLookup(entry)).filter(Boolean),
        );
        const filtered = holdProfile?.allowsAnyItem || allowed.size === 0
            ? resolved
            : resolved.filter(codename => allowed.has(normalizeLookup(codename)));

        const markedItemCodenames = clampMarkedItemCodenames(
            normalizeMarkedItemCodenames(filtered),
            resolveFoxholeHoldProfileMarkedItemLimit(holdProfile),
        );

        return {
            markedItemCodenames,
            unresolvedItemKeys: [...new Set(unresolvedItemKeys)].sort(),
            consumedFields,
        };
    }

    private resolveHoldProfile(foxholeKey: string): FoxholeManifestHoldProfile | null {
        return this.structureCatalog.structureByKey[foxholeKey]?.holdProfile ?? null;
    }

    private preferField(
        holdProfile: FoxholeManifestHoldProfile | null,
        options: { stockpileItems?: string[] | null; inventoryItems?: string[] | null; },
    ): 'stockpileItems' | 'inventoryItems' | null {
        const hasStockpile = Array.isArray(options.stockpileItems) && options.stockpileItems.length > 0;
        const hasInventory = Array.isArray(options.inventoryItems) && options.inventoryItems.length > 0;
        if (hasStockpile && !hasInventory) {
            return 'stockpileItems';
        }
        if (hasInventory && !hasStockpile) {
            return 'inventoryItems';
        }
        if (!hasStockpile && !hasInventory) {
            return null;
        }
        if (!holdProfile) {
            return 'stockpileItems';
        }
        if (holdProfile.mode === 'inventory') {
            return 'inventoryItems';
        }
        return 'stockpileItems';
    }
}
