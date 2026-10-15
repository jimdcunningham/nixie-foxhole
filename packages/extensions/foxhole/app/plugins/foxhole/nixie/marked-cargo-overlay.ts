import type { FoxholeManifestMarkedCargoOverlay } from './manifest.ts';

/** Reference size for `.nixie-build-icon` / `.build-icon-img` inset rules. */
export const MARKED_CARGO_ASSET_TILE_REFERENCE_PX = 64;
export const MARKED_CARGO_ASSET_TILE_BORDER_PX = 1.75;
export const MARKED_CARGO_ASSET_TILE_PADDING_PX = 6;
export const MARKED_CARGO_ASSET_TILE_RADIUS_PX = 10;

export const MARKED_CARGO_ICON_SMALL_FRAME_LOCAL_PX = 48;
export const MARKED_CARGO_ICON_SMALL_GAP_LOCAL_PX = 6;

export const MARKED_CARGO_ICON_MEDIUM_FRAME_LOCAL_PX = 80;
export const MARKED_CARGO_ICON_MEDIUM_GAP_LOCAL_PX = 8;

export const MARKED_CARGO_ICON_LARGE_FRAME_LOCAL_PX = 128;
export const MARKED_CARGO_ICON_LARGE_GAP_LOCAL_PX = 8;

export type MarkedCargoIconTier = 'large' | 'medium' | 'small';

export interface MarkedCargoIconSizing {
    tier: MarkedCargoIconTier;
    framePx: number;
    innerPx: number;
    gapPx: number;
    frameRadiusPx: number;
}

export interface MarkedCargoIconLayoutPosition {
    x: number;
    y: number;
}

export interface MarkedCargoOverlayLocalOffset {
    x: number;
    y: number;
}

export interface MarkedCargoAssetTileMetrics {
    framePx: number;
    innerPx: number;
    frameRadiusPx: number;
    borderPx: number;
    paddingPx: number;
}

export function resolveMarkedCargoAssetTileMetrics(framePx: number): MarkedCargoAssetTileMetrics {
    const scale = framePx / MARKED_CARGO_ASSET_TILE_REFERENCE_PX;
    const paddingPx = Math.max(3, Math.round(MARKED_CARGO_ASSET_TILE_PADDING_PX * scale));
    const frameRadiusPx = Math.max(4, Math.round(MARKED_CARGO_ASSET_TILE_RADIUS_PX * scale));
    const borderPx = Math.max(1.5, MARKED_CARGO_ASSET_TILE_BORDER_PX * scale);

    return {
        framePx,
        innerPx: Math.max(1, framePx - (paddingPx * 2)),
        frameRadiusPx,
        borderPx,
        paddingPx,
    };
}

function createMarkedCargoIconSizing(
    tier: MarkedCargoIconTier,
    framePx: number,
    gapPx: number,
): MarkedCargoIconSizing {
    const tileMetrics = resolveMarkedCargoAssetTileMetrics(framePx);

    return {
        tier,
        framePx,
        gapPx,
        innerPx: tileMetrics.innerPx,
        frameRadiusPx: tileMetrics.frameRadiusPx,
    };
}

const SMALL_ICON_SIZING = createMarkedCargoIconSizing(
    'small',
    MARKED_CARGO_ICON_SMALL_FRAME_LOCAL_PX,
    MARKED_CARGO_ICON_SMALL_GAP_LOCAL_PX,
);

const MEDIUM_ICON_SIZING = createMarkedCargoIconSizing(
    'medium',
    MARKED_CARGO_ICON_MEDIUM_FRAME_LOCAL_PX,
    MARKED_CARGO_ICON_MEDIUM_GAP_LOCAL_PX,
);

const LARGE_ICON_SIZING = createMarkedCargoIconSizing(
    'large',
    MARKED_CARGO_ICON_LARGE_FRAME_LOCAL_PX,
    MARKED_CARGO_ICON_LARGE_GAP_LOCAL_PX,
);

const MARKED_CARGO_ICON_SIZING_BY_TIER: Record<MarkedCargoIconTier, MarkedCargoIconSizing> = {
    small: SMALL_ICON_SIZING,
    medium: MEDIUM_ICON_SIZING,
    large: LARGE_ICON_SIZING,
};

function downgradeMarkedCargoIconTier(tier: MarkedCargoIconTier): MarkedCargoIconTier | null {
    if (tier === 'large') {
        return 'medium';
    }

    if (tier === 'medium') {
        return 'small';
    }

    return null;
}

/** Dimensions of an icon grid, shared when cargo and production sit side-by-side. */
export function resolveMarkedCargoIconGridMetrics(
    count: number,
    sizing: MarkedCargoIconSizing,
): { width: number; height: number; } {
    const columns = resolveMarkedCargoGridColumns(count);
    const rows = Math.ceil(count / columns);
    const iconPx = sizing.framePx;
    const gap = sizing.gapPx;

    return {
        width: columns * iconPx + ((columns - 1) * gap),
        height: rows * iconPx + ((rows - 1) * gap),
    };
}

function markedCargoIconGridFitsAsset(
    count: number,
    sizing: MarkedCargoIconSizing,
    assetWidthPx: number,
    assetHeightPx: number,
    marginRatio = 0.92,
): boolean {
    const grid = resolveMarkedCargoIconGridMetrics(count, sizing);
    return grid.width <= assetWidthPx * marginRatio
        && grid.height <= assetHeightPx * marginRatio;
}

function scaleMarkedCargoIconSizingToFit(
    count: number,
    sizing: MarkedCargoIconSizing,
    assetWidthPx: number,
    assetHeightPx: number,
    marginRatio = 0.92,
): MarkedCargoIconSizing {
    const grid = resolveMarkedCargoIconGridMetrics(count, sizing);
    const maxWidth = assetWidthPx * marginRatio;
    const maxHeight = assetHeightPx * marginRatio;
    const scale = Math.min(
        maxWidth / grid.width,
        maxHeight / grid.height,
        1,
    );

    if (!Number.isFinite(scale) || scale >= 1) {
        return sizing;
    }

    return {
        ...sizing,
        ...createMarkedCargoIconSizing(
            sizing.tier,
            Math.max(24, Math.round(sizing.framePx * scale)),
            Math.max(4, Math.round(sizing.gapPx * scale)),
        ),
    };
}

export function resolveMarkedCargoIconTier(count: number): MarkedCargoIconTier {
    if (count <= 1) {
        return 'large';
    }

    if (count <= 3) {
        return 'medium';
    }

    return 'small';
}

export function resolveMarkedCargoIconSizing(options: {
    count: number;
    assetWidthPx?: number | null;
    assetHeightPx?: number | null;
}): MarkedCargoIconSizing {
    const count = Math.max(0, options.count);
    const assetWidthPx = typeof options.assetWidthPx === 'number'
        && Number.isFinite(options.assetWidthPx)
        ? Math.max(0, options.assetWidthPx)
        : null;
    const assetHeightPx = typeof options.assetHeightPx === 'number'
        && Number.isFinite(options.assetHeightPx)
        ? Math.max(0, options.assetHeightPx)
        : assetWidthPx;

    if (count <= 0) {
        return MEDIUM_ICON_SIZING;
    }

    let tier = resolveMarkedCargoIconTier(count);
    let sizing = MARKED_CARGO_ICON_SIZING_BY_TIER[tier];

    if (assetWidthPx !== null && assetHeightPx !== null) {
        while (!markedCargoIconGridFitsAsset(count, sizing, assetWidthPx, assetHeightPx)) {
            const nextTier = downgradeMarkedCargoIconTier(tier);
            if (!nextTier) {
                sizing = scaleMarkedCargoIconSizingToFit(count, sizing, assetWidthPx, assetHeightPx);
                break;
            }

            tier = nextTier;
            sizing = MARKED_CARGO_ICON_SIZING_BY_TIER[tier];
        }
    }

    return sizing;
}

export function resolveMarkedCargoGridColumns(count: number): number {
    if (count <= 0) {
        return 0;
    }

    if (count <= 2) {
        return count;
    }

    if (count === 3) {
        return 2;
    }

    if (count === 4) {
        return 2;
    }

    if (count <= 6) {
        return 3;
    }

    return 4;
}

export function layoutMarkedCargoIconGrid(
    count: number,
    sizing: MarkedCargoIconSizing = MEDIUM_ICON_SIZING,
): MarkedCargoIconLayoutPosition[] {
    const columns = resolveMarkedCargoGridColumns(count);
    if (columns <= 0) {
        return [];
    }

    const rows = Math.ceil(count / columns);
    const iconPx = sizing.framePx;
    const gap = sizing.gapPx;
    const totalWidth = columns * iconPx + ((columns - 1) * gap);
    const totalHeight = rows * iconPx + ((rows - 1) * gap);
    const positions: MarkedCargoIconLayoutPosition[] = [];

    for (let index = 0; index < count; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        positions.push({
            x: (-totalWidth / 2) + (column * (iconPx + gap)) + (iconPx / 2),
            y: (-totalHeight / 2) + (row * (iconPx + gap)) + (iconPx / 2),
        });
    }

    return positions;
}

/** Position separate production (left) and cargo (right) grids around one structure anchor. */
export function resolveMarkedCargoOverlayColumnPositions(options: {
    cargoCount: number;
    cargoSizing: MarkedCargoIconSizing;
    productionCount: number;
    productionSizing: MarkedCargoIconSizing;
    columnGapPx?: number;
}): { cargoX: number; productionX: number; } {
    const hasBoth = options.cargoCount > 0 && options.productionCount > 0;
    if (!hasBoth) {
        return { cargoX: 0, productionX: 0 };
    }
    const cargoMetrics = resolveMarkedCargoIconGridMetrics(options.cargoCount, options.cargoSizing);
    const productionMetrics = resolveMarkedCargoIconGridMetrics(options.productionCount, options.productionSizing);
    const gap = Math.max(0, options.columnGapPx ?? 12);
    return {
        cargoX: (productionMetrics.width + gap) / 2,
        productionX: -(cargoMetrics.width + gap) / 2,
    };
}

function normalizeMarkedCargoOverlayAxis(value: unknown): number | undefined {
    if (value === null || typeof value === 'undefined' || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeMarkedCargoOverlayOffset(
    value: FoxholeManifestMarkedCargoOverlay | null | undefined,
): MarkedCargoOverlayLocalOffset {
    return {
        x: normalizeMarkedCargoOverlayAxis(value?.offsetX) ?? 0,
        y: normalizeMarkedCargoOverlayAxis(value?.offsetY) ?? 0,
    };
}

export function resolveMarkedCargoOverlayLocalPosition(options: {
    transformOrigin: { x: number; y: number; };
    localOffset: MarkedCargoOverlayLocalOffset;
}): { x: number; y: number; } {
    return {
        x: options.transformOrigin.x + options.localOffset.x,
        y: options.transformOrigin.y + options.localOffset.y,
    };
}

export function formatMarkedCargoOverlayOverridePrompt(
    codename: string,
    offset: MarkedCargoOverlayLocalOffset,
): string {
    const normalizedCodename = String(codename ?? '').trim();
    const manifestPath = `tools/foxwatch/asset-overrides/${normalizedCodename}/manifest.json`;
    const payload: FoxholeManifestMarkedCargoOverlay = {};

    if (offset.x !== 0) {
        payload.offsetX = offset.x;
    }

    if (offset.y !== 0) {
        payload.offsetY = offset.y;
    }

    const jsonBlock = Object.keys(payload).length === 0
        ? JSON.stringify({ markedCargoOverlay: {} }, null, 2)
        : JSON.stringify({ markedCargoOverlay: payload }, null, 2);

    return [
        `Update the asset override for ${normalizedCodename} to set the storage overlay anchor offset (board-local units relative to the transform center).`,
        '',
        'Repository: https://github.com/jimdcunningham/nixie-foxhole',
        `File: ${manifestPath}`,
        '',
        'Merge this into the manifest:',
        '',
        jsonBlock,
        '',
        `From the nixie-foxhole repository root, run: node ./tools/foxwatch/run-foxwatch.mjs refresh --only ${normalizedCodename}`,
    ].join('\n');
}
