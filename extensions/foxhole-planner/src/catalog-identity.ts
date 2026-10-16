export interface FoxholeAssetIdentity {
    id: string;
    codeName?: string;
    legacyKey?: string;
    legacyKeys?: readonly string[];
}

/** Canonical IDs win; ambiguous historical aliases never choose an arbitrary asset. */
export function createFoxholeAssetIdentityResolver(assets: readonly FoxholeAssetIdentity[]) {
    const canonical = new Map(assets.map(asset => [asset.id.toLowerCase(), asset.id]));
    const aliases = new Map<string, string | null>();
    for (const asset of assets) {
        for (const value of [asset.codeName, asset.legacyKey, ...(asset.legacyKeys ?? [])]) {
            const alias = value?.trim().toLowerCase();
            if (alias && !canonical.has(alias)) {
                aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== asset.id ? null : asset.id);
            }
        }
    }
    for (const [alias, target] of Object.entries({ emplacedaircraftc: 'emplacedaac', emplacedaircraftw: 'emplacedaaw' })) {
        if (canonical.has(target) && !canonical.has(alias) && !aliases.has(alias)) {
            aliases.set(alias, target);
        }
    }
    return (value: unknown): string | null => {
        const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return canonical.get(key) ?? aliases.get(key) ?? null;
    };
}
