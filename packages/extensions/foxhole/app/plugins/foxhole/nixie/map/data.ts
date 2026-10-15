import publishedFoxholeMapData from '../../../../../public/foxhole/assets/maps/map-data.v1.json' with { type: 'json' };

export interface FoxholePublishedMapStaticIcon {
    iconType?: string | number;
    x?: number;
    y?: number;
    teamId?: string;
    flags?: number;
}

export interface FoxholePublishedMapRegion {
    name?: string;
    icon?: string;
    textureKey?: string;
    gridCoord?: {
        x?: number;
        y?: number;
    };
    static?: {
        icons?: FoxholePublishedMapStaticIcon[];
    };
    showForResistance?: boolean;
    regionId?: number;
}

export interface FoxholePublishedMapIcon {
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    color?: string | number;
    key?: string;
}

export interface FoxholePublishedMapLabel {
    text?: string;
    x?: number;
    y?: number;
    mapMarkerType?: string;
}

export interface FoxholePublishedMapFallbackEntry {
    regionId?: number;
    version?: number;
    fetchedAt?: number;
    labels?: {
        version?: number;
        items?: FoxholePublishedMapLabel[];
    };
}

export interface FoxholePublishedMapData {
    schemaVersion: string;
    source: {
        kind: string;
    };
    maps: Record<string, FoxholePublishedMapRegion>;
    mapIcons: Record<string, FoxholePublishedMapIcon>;
    warApiFallback?: {
        maps?: Record<string, FoxholePublishedMapFallbackEntry>;
    };
}

const rawPublishedFoxholeMapData = publishedFoxholeMapData as Partial<FoxholePublishedMapData>;

export const foxholePublishedMapData: FoxholePublishedMapData = {
    schemaVersion: String(rawPublishedFoxholeMapData.schemaVersion ?? '1.0.0'),
    source: {
        kind: String(rawPublishedFoxholeMapData.source?.kind ?? 'unknown'),
    },
    maps: rawPublishedFoxholeMapData.maps && typeof rawPublishedFoxholeMapData.maps === 'object'
        ? rawPublishedFoxholeMapData.maps
        : {},
    mapIcons: rawPublishedFoxholeMapData.mapIcons && typeof rawPublishedFoxholeMapData.mapIcons === 'object'
        ? rawPublishedFoxholeMapData.mapIcons
        : {},
    warApiFallback: rawPublishedFoxholeMapData.warApiFallback && typeof rawPublishedFoxholeMapData.warApiFallback === 'object'
        ? rawPublishedFoxholeMapData.warApiFallback
        : { maps: {} },
};

export const rawFoxholePublishedMaps = foxholePublishedMapData.maps;
export const rawFoxholePublishedMapIcons = foxholePublishedMapData.mapIcons;
export const rawFoxholePublishedMapWarApiFallback = foxholePublishedMapData.warApiFallback?.maps ?? {};

export function buildFoxholePublishedMapFallbackCache(): Record<string, {
    labels?: {
        version?: number;
        items?: FoxholePublishedMapLabel[];
    };
}> {
    return Object.fromEntries(
        Object.entries(rawFoxholePublishedMapWarApiFallback)
            .map(([regionKey, entry]) => [regionKey, {
                ...(entry?.labels && Array.isArray(entry.labels.items)
                    ? {
                        labels: {
                            version: typeof entry.labels.version === 'number' ? entry.labels.version : entry.version,
                            items: entry.labels.items,
                        },
                    }
                    : {}),
            }])
            .filter(([, entry]) => !!entry?.labels?.items?.length),
    );
}
