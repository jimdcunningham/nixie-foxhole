export const FOXHOLE_MAP_REGION_WIDTH = 2183.9999 * 32;
export const FOXHOLE_MAP_REGION_HEIGHT = 1889.9999 * 32;
export const FOXHOLE_MAP_WORLD_SIZE = { width: 3840 * 307, height: 2160 * 307 } as const;
export const FOXHOLE_MAP_TEXTURE_DIRECTORIES = {
    terrain: 'HexMaps/Processed', base: 'IMM/BaseMap', topo: 'IMM/BaseMapTopo', full: 'IMM/BaseMapFull',
    roads: 'IMM/RoadsSingle', roadsTiers: 'IMM/RoadsMulti', rdz: 'IMM/RDZ', darkRdz: 'IMM/DarkRDZ',
    glaciers: 'IMM/Glaciers', bulwark: 'IMM/Bulwark', railBridge: 'IMM/RailBridge', rocks: 'IMM/Rocks',
    underwaterRocks: 'IMM/UnderWaterRocksStripes',
} as const;

interface PublishedMapIcon {
    name?: string; icon?: string; category?: string; color?: string | number; key?: string;
}
interface PublishedMapRegion {
    name?: string; textureKey?: string; showForResistance?: boolean; gridCoord?: { x?: number; y?: number; };
    static?: { icons?: Array<{ iconType?: string | number; x?: number; y?: number; teamId?: string; flags?: number; }>; };
}
export interface PublishedFoxholeMapData {
    maps: Record<string, PublishedMapRegion>;
    mapIcons: Record<string, PublishedMapIcon>;
    warApiFallback?: { maps?: Record<string, { version?: number; labels?: { version?: number; items?: Array<{
        text?: string; x?: number; y?: number; mapMarkerType?: string;
    }>; }; }>; };
}
export interface FoxholeMapResourceSource {
    id: string;
    /** Build input relative to the authored Foxhole asset directory, never a runtime URL. */
    sourcePath: string;
    path: string;
}
export interface FoxholeMapTooltipAsset {
    id: string; isItem: boolean; keys: string[]; category: string; previewSourcePath: string | null;
}
export function createFoxholeMapTooltipAssets(published: { assets?: Array<{ id: string; codeName?: string; legacyKey?: string; previewUrl?: string; icons?: { default?: string; rendered?: string; }; }>; },
    metadata: Readonly<Record<string, { label: string; codeName: string; categoryLabel?: string; isItem: boolean; colorVariants?: Record<string, unknown>; }>>): FoxholeMapTooltipAsset[] {
    return (published.assets ?? []).flatMap(asset => {
        const data = metadata[asset.id];
        if (!data) {
            return [];
        }
        const preview = asset.icons?.rendered ?? asset.icons?.default ?? null;
        const source = preview?.startsWith('/foxhole/assets/') ? preview.slice('/foxhole/assets/'.length) : null;
        if (source && (source.split('/').some(part => part === '..' || part === '.') || !/^[A-Za-z0-9/._-]+\.webp$/.test(source))) {
            throw new Error('Invalid map tooltip preview source.');
        }
        return [{ id: asset.id, isItem: data.isItem, keys: [asset.id, asset.codeName ?? data.codeName, asset.legacyKey ?? asset.id, data.label],
            category: data.categoryLabel ?? 'Uncategorized', previewSourcePath: source }];
    });
}

function filename(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(value)) {
        throw new Error(`Invalid published Foxhole map filename: ${value}`);
    }
    return value;
}

/** Pure offline projection. Live war packets, local imports and host stores are deliberately absent. */
export function createFoxholeSceneV2MapMetadata(published: PublishedFoxholeMapData, tooltipAssets: readonly FoxholeMapTooltipAsset[] = []) {
    const sources = new Map<string, FoxholeMapResourceSource>();
    const resource = (id: string, sourcePath: string) => {
        const existing = sources.get(id);
        if (existing && existing.sourcePath !== sourcePath) {
            throw new Error(`Ambiguous published Foxhole map resource: ${id}`);
        }
        sources.set(id, { id, sourcePath, path: `dist/assets/maps/${id.slice('foxhole.map.'.length)}.webp` });
        return id;
    };
    const regions = Object.entries(published.maps).map(([key, input]) => {
        const textureKey = filename(String(input.textureKey ?? ''));
        const gridCoord = { x: Number(input.gridCoord?.x ?? 0), y: Number(input.gridCoord?.y ?? 0) };
        if (!Number.isFinite(gridCoord.x) || !Number.isFinite(gridCoord.y)) {
            throw new Error(`Invalid published Foxhole map coordinates: ${key}`);
        }
        return { key, name: String(input.name ?? key).trim() || key, textureKey, gridCoord,
            showForResistance: input.showForResistance === true,
            x: gridCoord.x * ((FOXHOLE_MAP_REGION_WIDTH / 2048) * (2048 * 0.75)),
            y: gridCoord.y * FOXHOLE_MAP_REGION_HEIGHT + gridCoord.x * (FOXHOLE_MAP_REGION_HEIGHT / 2),
            textures: Object.fromEntries(Object.entries(FOXHOLE_MAP_TEXTURE_DIRECTORIES).map(([layer, directory]) => [layer,
                resource(`foxhole.map.${layer.toLowerCase()}-${textureKey.toLowerCase()}`, `maps/${directory}/${textureKey}.webp`)])) as Record<keyof typeof FOXHOLE_MAP_TEXTURE_DIRECTORIES, string>,
            staticIcons: (input.static?.icons ?? []).map(icon => ({ iconType: icon.iconType ?? '', x: Number(icon.x ?? 0), y: Number(icon.y ?? 0),
                ...(icon.teamId === undefined ? {} : { teamId: icon.teamId }), ...(icon.flags === undefined ? {} : { flags: icon.flags }) })),
            labels: structuredClone(published.warApiFallback?.maps?.[key]?.labels?.items ?? []),
        };
    }).sort((left, right) => left.gridCoord.y - right.gridCoord.y || left.gridCoord.x - right.gridCoord.x || left.name.localeCompare(right.name));
    const icons = Object.fromEntries(Object.entries(published.mapIcons).map(([key, icon]) => {
        const iconName = String(icon.icon ?? '').trim();
        const numericColor = Number(icon.color ?? NaN);
        const normalize = (value: string) => value.trim().toLowerCase().replace(/['']/g, '').replace(/\s+/g, ' ');
        const lookupKeys = [String(icon.key ?? ''), String(icon.name ?? '')].map(normalize).filter(Boolean);
        const candidates = [...tooltipAssets.filter(asset => !asset.isItem), ...tooltipAssets.filter(asset => asset.isItem)];
        const tooltipAsset = candidates.find(asset => lookupKeys.some(value => asset.keys.some(alias => normalize(alias) === value)));
        const category = tooltipAsset?.category ?? (icon.category === 'bases' ? 'Base' : icon.category === 'resources' ? 'Resource' : 'Structure');
        const previewResourceId = tooltipAsset?.previewSourcePath ? resource(`foxhole.map.preview-${tooltipAsset.id}`, tooltipAsset.previewSourcePath) : null;
        return [key, { key, name: String(icon.name ?? key).trim() || key, iconName,
            assetKey: String(icon.key ?? '').trim() || null,
            category: icon.category === 'bases' || icon.category === 'resources' ? icon.category : 'structures',
            color: Number.isFinite(numericColor) ? numericColor : null,
            tooltipCategory: category, previewResourceId,
            resourceId: iconName ? resource(`foxhole.map.icon-${filename(iconName).toLowerCase()}`, `maps/MapIcons/${iconName}.webp`) : null }];
    }));
    const background = { light: resource('foxhole.map.world-light', 'maps/WorldMapBG.webp'), dark: resource('foxhole.map.world-dark', 'maps/WorldMapDarkBG.webp') };
    return { metadata: { regions, icons, background, regionWidth: FOXHOLE_MAP_REGION_WIDTH, regionHeight: FOXHOLE_MAP_REGION_HEIGHT, worldSize: { ...FOXHOLE_MAP_WORLD_SIZE } },
        resources: [...sources.values()] };
}

export type FoxholeSceneV2MapMetadata = ReturnType<typeof createFoxholeSceneV2MapMetadata>['metadata'];

export function foxholeSceneV2MapBounds(metadata: FoxholeSceneV2MapMetadata, regionKeys: readonly string[], background: boolean) {
    if (background) {
        return { minX: -metadata.worldSize.width / 2, minY: -metadata.worldSize.height / 2, maxX: metadata.worldSize.width / 2, maxY: metadata.worldSize.height / 2 };
    }
    const regions = metadata.regions.filter(region => !regionKeys.length || regionKeys.includes(region.key));
    if (!regions.length) {
        return { minX: -metadata.regionWidth / 2, minY: -metadata.regionHeight / 2, maxX: metadata.regionWidth / 2, maxY: metadata.regionHeight / 2 };
    }
    return { minX: Math.min(...regions.map(region => region.x - metadata.regionWidth / 2)),
        minY: Math.min(...regions.map(region => region.y - metadata.regionHeight / 2)),
        maxX: Math.max(...regions.map(region => region.x + metadata.regionWidth / 2)),
        maxY: Math.max(...regions.map(region => region.y + metadata.regionHeight / 2)) };
}
