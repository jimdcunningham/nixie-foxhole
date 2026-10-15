/**
 * Authored search aliases for Foxhole catalog items/structures.
 * Search-only: display names stay canonical; aliases are extra match keys.
 *
 * Keys are lowercased foxholeKey / id / codeName / legacyKey values.
 */

/** Canonical asset key → community / legacy search aliases. */
export const FOXHOLE_CATALOG_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
    // Materials / resources
    cloth: ['bmats', 'bmat', 'basic mats'],
    wood: ['rmats', 'rmat', 'refined mats'],
    explosive: ['emats', 'emat', 'explosive materials', 'explosive mats'],
    heavyexplosive: ['hemats', 'hemat', 'heavy emats', 'heavy explosive materials'],
    metal: ['salvage'],
    facilitymaterials1: ['cmats', 'cmat'],
    facilitymaterials2: ['pcmats', 'pcmat'],
    facilitymaterials3: ['scmats', 'scmat', 'steel cmats'],
    concrete: ['conmats', 'conc'],
    components: ['comps'],
    facilitymaterials9: ['rare alloys'],
    raremetal: ['rare metal'],
    facilityoil1: ['heavy oil'],

    // Legacy weapon short names (game-kitchen data.js `alias`)
    hegrenade: ['he grenade'],
    helaunchedgrenade: ['he launcher'],
    mortarammo: ['mortar'],
    herocketammo: ['rocket'],
    firerocketammo: ['fire rocket'],
    explosivelightc: ['hydras'],
    bomberammo: ['raidbreaker'],
    mortartankammo: ['250mm'],
    satchelchargew: ['satchel'],
    satchelcharget: ['havoc'],

    // Vehicles (game-kitchen data.js `aliases`)
    construction: ['cv'],
    constructionutility: ['acv', 'advanced construction vehicle'],
    aircraftbomberw: ['welkinrive', 'heavy bomber', 'bomber'],
    aircraftbomberc: ['tzykalia', 'heavy bomber', 'bomber'],
    aircraftfighterw: ['harbinger', 'fighter'],
    aircraftfighterc: ['blind silver', 'fighter'],

    // Facilities / world structures (community acronyms)
    facilityvehiclefactory2: ['las', 'laf', 'large assembly factory'],
    facilityvehiclefactory1: ['sas'],
    massproduction: ['mpf'],
};

function normalizeAliasKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeAliasTerm(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

let reverseAliasIndex: Map<string, string> | null = null;

function getReverseAliasIndex(): Map<string, string> {
    if (reverseAliasIndex) {
        return reverseAliasIndex;
    }
    const index = new Map<string, string>();
    for (const [canonicalKey, aliases] of Object.entries(FOXHOLE_CATALOG_SEARCH_ALIASES)) {
        for (const alias of aliases) {
            const normalizedAlias = normalizeAliasTerm(alias);
            if (!normalizedAlias || index.has(normalizedAlias)) {
                continue;
            }
            index.set(normalizedAlias, canonicalKey);
        }
    }
    reverseAliasIndex = index;
    return index;
}

/** Resolve authored aliases for any of the given asset identity keys. */
export function resolveFoxholeCatalogSearchAliases(
    ...keys: Array<string | null | undefined>
): string[] {
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const key of keys) {
        const normalizedKey = normalizeAliasKey(key);
        if (!normalizedKey) {
            continue;
        }
        const list = FOXHOLE_CATALOG_SEARCH_ALIASES[normalizedKey];
        if (!list) {
            continue;
        }
        for (const alias of list) {
            const normalizedAlias = normalizeAliasTerm(alias);
            if (!normalizedAlias || seen.has(normalizedAlias)) {
                continue;
            }
            seen.add(normalizedAlias);
            aliases.push(normalizedAlias);
        }
    }
    return aliases;
}

/** Map an exact alias term back to its canonical catalog key, if known. */
export function resolveFoxholeCatalogCanonicalKeyFromAlias(
    alias: string | null | undefined,
): string | null {
    const normalizedAlias = normalizeAliasTerm(alias);
    if (!normalizedAlias) {
        return null;
    }
    return getReverseAliasIndex().get(normalizedAlias) ?? null;
}

/** True when `query` exactly matches one of the asset's authored aliases. */
export function foxholeCatalogAssetHasExactAlias(
    aliases: readonly string[] | null | undefined,
    query: string | null | undefined,
): boolean {
    const normalizedQuery = normalizeAliasTerm(query);
    if (!normalizedQuery || !aliases?.length) {
        return false;
    }
    return aliases.some(alias => normalizeAliasTerm(alias) === normalizedQuery);
}
