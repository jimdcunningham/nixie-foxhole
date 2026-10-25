import {shallowReactive} from 'vue';
import {onFoxholeMapDataChanged} from './data.ts';
import {resolveFoxholeAssetUrl} from '../asset-locations.ts';
import {
    rawFoxholePublishedMapIcons,
    rawFoxholePublishedMaps,
} from './data.ts';

export interface FoxholeMapRegionRecord {
    key: string;
    name: string;
    textureKey: string;
    showForResistance: boolean;
    gridCoord: {
        x: number;
        y: number;
    };
    staticIcons: Array<{
        iconType: string | number;
        x: number;
        y: number;
        teamId?: string;
        flags?: number;
    }>;
}

export interface FoxholeMapIconRecord {
    key: string;
    name: string;
    iconName: string;
    assetKey: string | null;
    category: 'bases' | 'resources' | 'structures';
    color: number | null;
}

const METER_BOARD_PIXEL_SIZE = 32;

export const FOXHOLE_REGION_WIDTH = 2183.9999 * METER_BOARD_PIXEL_SIZE;
export const FOXHOLE_REGION_HEIGHT = 1889.9999 * METER_BOARD_PIXEL_SIZE;
export const FOXHOLE_REGION_POLYGON = [
    -FOXHOLE_REGION_WIDTH / 2, 0,
    -FOXHOLE_REGION_WIDTH / 4, -FOXHOLE_REGION_HEIGHT / 2,
    FOXHOLE_REGION_WIDTH / 4, -FOXHOLE_REGION_HEIGHT / 2,
    FOXHOLE_REGION_WIDTH / 2, 0,
    FOXHOLE_REGION_WIDTH / 4, FOXHOLE_REGION_HEIGHT / 2,
    -FOXHOLE_REGION_WIDTH / 4, FOXHOLE_REGION_HEIGHT / 2,
] as const;

export const FOXHOLE_WORLD_BACKGROUND_SCALE = 307;
export const FOXHOLE_WORLD_BACKGROUND_SIZE = {
    width: 3840 * FOXHOLE_WORLD_BACKGROUND_SCALE,
    height: 2160 * FOXHOLE_WORLD_BACKGROUND_SCALE,
} as const;

function createMapRegions(): FoxholeMapRegionRecord[] {return Object.entries(rawFoxholePublishedMaps)
    .map(([key, region]) => ({
        key,
        name: String(region?.name ?? key).trim() || key,
        textureKey: String(region?.textureKey ?? '').trim(),
        showForResistance: region?.showForResistance === true,
        gridCoord: {
            x: Number(region?.gridCoord?.x ?? 0),
            y: Number(region?.gridCoord?.y ?? 0),
        },
        staticIcons: Array.isArray(region?.static?.icons)
            ? region.static.icons.map(icon => ({
                iconType: typeof icon?.iconType === 'number' || typeof icon?.iconType === 'string'
                    ? icon.iconType
                    : '',
                x: Number(icon?.x ?? 0),
                y: Number(icon?.y ?? 0),
                teamId: typeof icon?.teamId === 'string' ? icon.teamId : undefined,
                flags: typeof icon?.flags === 'number' ? icon.flags : undefined,
            }))
            : [],
    }))
    .filter(region => region.textureKey.length > 0)
    .sort((left, right) => {
        if (left.gridCoord.y !== right.gridCoord.y) {
            return left.gridCoord.y - right.gridCoord.y;
        }
        if (left.gridCoord.x !== right.gridCoord.x) {
            return left.gridCoord.x - right.gridCoord.x;
        }
        return left.name.localeCompare(right.name);
    });
}
const regions = shallowReactive(createMapRegions());
export const FOXHOLE_MAP_REGIONS: readonly FoxholeMapRegionRecord[] = regions;

export function resolveFoxholeMapActiveRegions(
    regionKeys: readonly string[],
): readonly FoxholeMapRegionRecord[] {
    const selectedRegions = new Set(regionKeys);
    return selectedRegions.size > 0
        ? FOXHOLE_MAP_REGIONS.filter(region => selectedRegions.has(region.key))
        : FOXHOLE_MAP_REGIONS;
}

function createMapIcons(): Record<string, FoxholeMapIconRecord> {return Object.fromEntries(
        Object.entries(rawFoxholePublishedMapIcons).map(([key, icon]) => {
            const category = icon?.category === 'bases' || icon?.category === 'resources' || icon?.category === 'structures'
                ? icon.category
                : 'structures';
            const rawColor = typeof icon?.color === 'string'
                ? Number(icon.color)
                : typeof icon?.color === 'number'
                    ? icon.color
                    : Number.NaN;

            return [key, {
                key,
                name: String(icon?.name ?? key).trim() || key,
                iconName: String(icon?.icon ?? '').trim(),
                assetKey: String(icon?.key ?? '').trim() || null,
                category,
                color: Number.isFinite(rawColor) ? rawColor : null,
            } satisfies FoxholeMapIconRecord];
        }),
    );
}
const icons = shallowReactive(createMapIcons());
export const FOXHOLE_MAP_ICONS: Readonly<Record<string, FoxholeMapIconRecord>> = icons;
onFoxholeMapDataChanged(() => {
    regions.splice(0, regions.length, ...createMapRegions());
    for (const key of Object.keys(icons)) delete icons[key];
    Object.assign(icons, createMapIcons());
});

export function getFoxholeRegionPosition(region: Pick<FoxholeMapRegionRecord, 'gridCoord'>): { x: number; y: number; } {
    return {
        x: region.gridCoord.x * ((FOXHOLE_REGION_WIDTH / 2048) * (2048 * 0.75)),
        y: (region.gridCoord.y * FOXHOLE_REGION_HEIGHT) + (region.gridCoord.x * (FOXHOLE_REGION_HEIGHT / 2)),
    };
}

export function resolveFoxholeMapIconUrl(baseAssetsUrl: string, icon: Pick<FoxholeMapIconRecord, 'iconName'>): string | null {
    const iconName = String(icon.iconName ?? '').trim();
    if (!iconName) {
        return null;
    }

    return resolveFoxholeAssetUrl(`${baseAssetsUrl}maps/MapIcons/${iconName}.webp`, baseAssetsUrl);
}
