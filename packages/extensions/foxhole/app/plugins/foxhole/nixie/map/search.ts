import { readonly, shallowRef } from 'vue';
import type { Viewport } from 'pixi-viewport';
import {
    FOXHOLE_MAP_ICONS,
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_HEIGHT,
    FOXHOLE_REGION_WIDTH,
    getFoxholeRegionPosition,
} from './constants.ts';

export interface FoxholeMapSearchLabelItem {
    x?: number;
    y?: number;
    text?: string;
    mapMarkerType?: string;
    teamId?: string;
}

export interface FoxholeMapSearchIconItem {
    iconType?: string | number;
    x?: number;
    y?: number;
    teamId?: string;
    flags?: number;
}

export interface FoxholeMapSearchCacheEntry {
    labels?: {
        version?: number;
        items?: FoxholeMapSearchLabelItem[];
    };
    icons?: {
        version?: number;
        items?: FoxholeMapSearchIconItem[];
    };
}

export type FoxholeMapSearchEntryType
    = | 'region'
        | 'town'
        | 'district'
        | 'resource_field'
        | 'resource_mine';

export interface FoxholeMapSearchEntry {
    id: string;
    type: FoxholeMapSearchEntryType;
    label: string;
    regionKey: string;
    regionLabel: string;
    searchLabel: string;
    worldPosition: {
        x: number;
        y: number;
    };
}

export interface FoxholeMapSearchDataset {
    entries: FoxholeMapSearchEntry[];
    hasLabelData: boolean;
    hasResourceIconData: boolean;
}

const foxholeMapSearchCache = shallowRef<Record<string, FoxholeMapSearchCacheEntry>>({});

export const foxholeMapSearchCacheRef = readonly(foxholeMapSearchCache);

export function publishFoxholeMapSearchCache(
    cachedMaps: Record<string, FoxholeMapSearchCacheEntry>,
): void {
    foxholeMapSearchCache.value = { ...cachedMaps };
}

export function clearFoxholeMapSearchCache(): void {
    foxholeMapSearchCache.value = {};
}

export function isFoxholeMapSearchEntryType(value: unknown): value is FoxholeMapSearchEntryType {
    return value === 'region'
        || value === 'town'
        || value === 'district'
        || value === 'resource_field'
        || value === 'resource_mine';
}

function resourcePlaceTypeForIconName(name: string): FoxholeMapSearchEntryType {
    const lowered = name.toLowerCase();
    if (lowered.includes('mine')) {
        return 'resource_mine';
    }
    return 'resource_field';
}

function worldPositionFromNormalized(
    regionPosition: { x: number; y: number; },
    x: number,
    y: number,
): { x: number; y: number; } {
    return {
        x: regionPosition.x - (FOXHOLE_REGION_WIDTH / 2) + (x * FOXHOLE_REGION_WIDTH),
        y: regionPosition.y - (FOXHOLE_REGION_HEIGHT / 2) + (y * FOXHOLE_REGION_HEIGHT),
    };
}

export function buildFoxholeMapSearchDataset(
    cachedMaps: Record<string, FoxholeMapSearchCacheEntry>,
    options: {
        visibleRegionKeys?: readonly string[];
    } = {},
): FoxholeMapSearchDataset {
    const visibleRegionKeys = new Set(
        (options.visibleRegionKeys ?? []).map(regionKey => String(regionKey).trim()).filter(Boolean),
    );
    const restrictToVisibleRegions = visibleRegionKeys.size > 0;
    const entries: FoxholeMapSearchEntry[] = [];
    let hasLabelData = false;
    let hasResourceIconData = false;

    for (const region of FOXHOLE_MAP_REGIONS) {
        if (restrictToVisibleRegions && !visibleRegionKeys.has(region.key)) {
            continue;
        }

        const regionPosition = getFoxholeRegionPosition(region);
        entries.push({
            id: `region:${region.key}`,
            type: 'region',
            label: region.name,
            regionKey: region.key,
            regionLabel: region.name,
            searchLabel: region.name,
            worldPosition: regionPosition,
        });

        const labels = cachedMaps[region.key]?.labels?.items ?? [];
        if (labels.length > 0) {
            hasLabelData = true;
        }

        labels.forEach((label, index) => {
            const text = String(label.text ?? '').trim();
            const x = Number(label.x);
            const y = Number(label.y);
            if (!text || !Number.isFinite(x) || !Number.isFinite(y)) {
                return;
            }

            const type: FoxholeMapSearchEntryType = label.mapMarkerType === 'Major' ? 'town' : 'district';
            entries.push({
                id: `${type}:${region.key}:${index}:${text.toLowerCase()}`,
                type,
                label: text,
                regionKey: region.key,
                regionLabel: region.name,
                searchLabel: `${text} ${region.name} ${type}`,
                worldPosition: worldPositionFromNormalized(regionPosition, x, y),
            });
        });

        const icons = cachedMaps[region.key]?.icons?.items ?? [];
        let resourceIndex = 0;
        for (const icon of icons) {
            const iconType = String(icon.iconType ?? '').trim();
            const meta = FOXHOLE_MAP_ICONS[iconType];
            if (!meta || meta.category !== 'resources') {
                continue;
            }
            const x = Number(icon.x);
            const y = Number(icon.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }

            hasResourceIconData = true;
            const type = resourcePlaceTypeForIconName(meta.name);
            const label = meta.name;
            entries.push({
                id: `${type}:${region.key}:${iconType}:${resourceIndex}:${label.toLowerCase()}`,
                type,
                label,
                regionKey: region.key,
                regionLabel: region.name,
                searchLabel: `${label} ${region.name} ${type} resource field`,
                worldPosition: worldPositionFromNormalized(regionPosition, x, y),
            });
            resourceIndex += 1;
        }
    }

    return {
        entries,
        hasLabelData,
        hasResourceIconData,
    };
}

export function getFoxholeMapSearchCameraTarget(
    entry: FoxholeMapSearchEntry,
    viewport: Pick<Viewport, 'screenWidth' | 'screenHeight'>,
): {
    position: {
        x: number;
        y: number;
    };
    scale: number;
} {
    const availableWidth = Math.max(1, viewport.screenWidth - 192);
    const availableHeight = Math.max(1, viewport.screenHeight - 192);

    const focusBounds = entry.type === 'region'
        ? {
            width: FOXHOLE_REGION_WIDTH * 1.15,
            height: FOXHOLE_REGION_HEIGHT * 1.15,
        }
        : entry.type === 'town'
            ? {
                width: FOXHOLE_REGION_WIDTH * 0.3,
                height: FOXHOLE_REGION_HEIGHT * 0.3,
            }
            : {
                // districts + resource fields/mines
                width: FOXHOLE_REGION_WIDTH * 0.18,
                height: FOXHOLE_REGION_HEIGHT * 0.18,
            };

    return {
        position: entry.worldPosition,
        scale: Math.min(
            availableWidth / Math.max(1, focusBounds.width),
            availableHeight / Math.max(1, focusBounds.height),
        ),
    };
}
