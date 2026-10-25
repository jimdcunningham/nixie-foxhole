import {shallowRef} from 'vue';
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

export function parseFoxholePublishedMapData(value: unknown): FoxholePublishedMapData {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid selected map data.');
    const rawPublishedFoxholeMapData = value as Partial<FoxholePublishedMapData>;
    for (const [name, limit] of [['maps', 512], ['mapIcons', 65536]] as const) {
        const rows = rawPublishedFoxholeMapData[name];
        if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length > limit) throw new Error('Invalid selected map inventory.');
    }
    return {
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
}

const revision = shallowRef(0);
const listeners = new Set<() => void>();
export let foxholePublishedMapData = parseFoxholePublishedMapData(publishedFoxholeMapData);
export let rawFoxholePublishedMaps = foxholePublishedMapData.maps;
export let rawFoxholePublishedMapIcons = foxholePublishedMapData.mapIcons;
export let rawFoxholePublishedMapWarApiFallback = foxholePublishedMapData.warApiFallback?.maps ?? {};

export function getFoxholeMapDataRevision(): number {return revision.value;}
export function onFoxholeMapDataChanged(callback: () => void): () => void {listeners.add(callback); return () => {listeners.delete(callback);};}
export function installFoxholeMapData(value: unknown): void {
    foxholePublishedMapData = parseFoxholePublishedMapData(value ?? publishedFoxholeMapData);
    rawFoxholePublishedMaps = foxholePublishedMapData.maps;
    rawFoxholePublishedMapIcons = foxholePublishedMapData.mapIcons;
    rawFoxholePublishedMapWarApiFallback = foxholePublishedMapData.warApiFallback?.maps ?? {};
    for (const listener of listeners) listener();
    revision.value++;
}

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
