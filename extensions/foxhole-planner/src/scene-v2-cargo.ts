import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { resolveFoxholeStockpileGroupSelection, stockpileEntriesToSelections } from './stockpile-groups.ts';

const CARGO_MAX_ITEMS = 256;
const CARGO_FRAME_BACKGROUND = 0x18181B;
const CARGO_FRAME_BORDER = 0x52525B;
const PRODUCTION_FRAME_BORDER = 0x22C55E;
const OVERLAY_COLUMN_GAP = 12;

interface CargoSizing {
    frame: number;
    inner: number;
    gap: number;
    radius: number;
}

function cargoColumns(count: number): number {
    if (count <= 2) {
        return count;
    }
    if (count <= 4) {
        return 2;
    }
    if (count <= 6) {
        return 3;
    }
    return 4;
}

function resolveCargoSizing(count: number, width: number, height: number): CargoSizing {
    const base = count <= 1
        ? { frame: 128, gap: 8 }
        : count <= 3
            ? { frame: 80, gap: 8 }
            : { frame: 48, gap: 6 };
    const columns = cargoColumns(count);
    const rows = Math.ceil(count / columns);
    const gridWidth = columns * base.frame + (columns - 1) * base.gap;
    const gridHeight = rows * base.frame + (rows - 1) * base.gap;
    const scale = Math.min(width * 0.92 / gridWidth, height * 0.92 / gridHeight, 1);
    const frame = Math.max(24, Math.round(base.frame * scale));
    const gap = Math.max(4, Math.round(base.gap * scale));
    const padding = Math.max(3, Math.round(frame * 6 / 64));
    return {
        frame,
        inner: Math.max(1, frame - padding * 2),
        gap,
        radius: Math.max(4, Math.round(frame * 9 / 64)),
    };
}

function cargoPositions(count: number, sizing: CargoSizing): Array<{ x: number; y: number; }> {
    const columns = cargoColumns(count);
    const rows = Math.ceil(count / columns);
    const width = columns * sizing.frame + (columns - 1) * sizing.gap;
    const height = rows * sizing.frame + (rows - 1) * sizing.gap;
    return Array.from({ length: count }, (_, index) => ({
        x: -width / 2 + (index % columns) * (sizing.frame + sizing.gap) + sizing.frame / 2,
        y: -height / 2 + Math.floor(index / columns) * (sizing.frame + sizing.gap) + sizing.frame / 2,
    }));
}

function cargoGridWidth(count: number, sizing: CargoSizing): number {
    const columns = cargoColumns(count);
    return columns * sizing.frame + Math.max(0, columns - 1) * sizing.gap;
}

function normalizeCargoItems(value: unknown, limit: number | null): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const items = value.flatMap(entry => {
        const codeName = typeof entry === 'string' ? entry.trim() : '';
        if (!codeName || seen.has(codeName)) {
            return [];
        }
        seen.add(codeName);
        return [codeName];
    });
    return items.slice(0, Math.min(CARGO_MAX_ITEMS, limit ?? CARGO_MAX_ITEMS));
}

function resolveProductionOutputs(
    data: Record<string, unknown> | undefined,
    productionOutputsByRecipeId: Readonly<Record<string, readonly string[]>>,
): string[] {
    if (data?.disabled === true || !Array.isArray(data?.orders)) {
        return [];
    }
    return data.orders.slice(0, CARGO_MAX_ITEMS).flatMap(order => {
        if (!order || typeof order !== 'object' || Array.isArray(order)) {
            return [];
        }
        const recipeId = typeof order.recipeId === 'string' ? order.recipeId.trim() : '';
        return recipeId ? [...(productionOutputsByRecipeId[recipeId] ?? [])] : [];
    }).slice(0, CARGO_MAX_ITEMS);
}

function renderOverlayCells(options: {
    prefix: 'cargo' | 'production';
    itemIds: string[];
    sizing: CargoSizing;
    border: number;
}): NixieExtensionRenderNodeV1[] {
    const positions = cargoPositions(options.itemIds.length, options.sizing);
    return options.itemIds.map((itemId, index) => ({
        id: `${options.prefix}-${index + 1}`,
        kind: 'group' as const,
        x: positions[index]?.x ?? 0,
        y: positions[index]?.y ?? 0,
        children: [{
            id: `${options.prefix}-frame-${index + 1}`,
            kind: 'graphics' as const,
            commands: [{
                op: 'round-rect' as const,
                x: -options.sizing.frame / 2,
                y: -options.sizing.frame / 2,
                width: options.sizing.frame,
                height: options.sizing.frame,
                radius: options.sizing.radius,
            }, {
                op: 'fill' as const,
                color: CARGO_FRAME_BACKGROUND,
                alpha: 0.94,
            }, {
                op: 'stroke' as const,
                color: options.border,
                width: 1,
                alpha: 0.9,
            }],
        }, {
            id: `${options.prefix}-icon-${index + 1}`,
            kind: 'sprite' as const,
            resourceId: `foxhole.icon.${itemId}`,
            anchorX: 0.5,
            anchorY: 0.5,
            width: options.sizing.inner,
            height: options.sizing.inner,
        }],
    }));
}

export function renderFoxholeSceneV2Cargo(options: {
    cargoData: Record<string, unknown> | undefined;
    productionData: Record<string, unknown> | undefined;
    productionOutputsByRecipeId: Readonly<Record<string, readonly string[]>>;
    asset: FoxholeSceneV2AssetMetadata;
    assetIdByCodeName: ReadonlyMap<string, string>;
    stockpileAssetIds?: ReadonlyMap<string, string>;
    rotation: number;
    destroyed: boolean;
    packaged: boolean;
}): NixieExtensionRenderNodeV1 | null {
    if (options.destroyed) {
        return null;
    }
    const allowedCargo = new Set((options.asset.cargo?.allowedItems ?? []).map(item => item.toLowerCase()));
    const groups = options.asset.cargo?.groups ?? [];
    const groupedSelections = Array.isArray(options.cargoData?.stockpileItems)
        ? stockpileEntriesToSelections(groups, options.cargoData.stockpileItems) : undefined;
    const supportedCargo = groups.length
        ? groups.flatMap(group => resolveFoxholeStockpileGroupSelection(group, groupedSelections, options.cargoData?.items))
        : normalizeCargoItems(options.cargoData?.items, null).filter(item => (
        options.asset.cargo && (options.asset.cargo.allowsAnyItem === true || allowedCargo.has(item.toLowerCase()))
    ));
    const cargoCodenames = options.packaged && options.asset.cargo?.retainsWhenPackaged !== true
        ? []
        : normalizeCargoItems(supportedCargo, options.asset.cargo?.limit ?? null);
    const productionCodenames = options.packaged
        ? []
        : resolveProductionOutputs(options.productionData, options.productionOutputsByRecipeId);
    const cargoItemIds = groups.length && options.stockpileAssetIds
        ? (options.packaged && options.asset.cargo?.retainsWhenPackaged !== true ? [] : [...new Set(groups.flatMap(group =>
            resolveFoxholeStockpileGroupSelection(group, groupedSelections, options.cargoData?.items).flatMap(code => {
                const id = options.stockpileAssetIds!.get(`${group.entryType}:${code.toLowerCase()}`);
                return id ? [id] : [];
            })))])
        : cargoCodenames.flatMap(codeName => {
        const itemId = options.assetIdByCodeName.get(codeName.toLocaleLowerCase());
        return itemId ? [itemId] : [];
    });
    const productionItemIds = productionCodenames.flatMap(codeName => {
        const itemId = options.assetIdByCodeName.get(codeName.toLocaleLowerCase());
        return itemId ? [itemId] : [];
    });
    if (cargoItemIds.length === 0 && productionItemIds.length === 0) {
        return null;
    }
    const hasBoth = cargoItemIds.length > 0 && productionItemIds.length > 0;
    const columnWidth = options.asset.width / (hasBoth ? 2 : 1);
    const cargoSizing = resolveCargoSizing(cargoItemIds.length, columnWidth, options.asset.height);
    const productionSizing = resolveCargoSizing(productionItemIds.length, columnWidth, options.asset.height);
    const cargoWidth = cargoGridWidth(cargoItemIds.length, cargoSizing);
    const productionWidth = cargoGridWidth(productionItemIds.length, productionSizing);
    const cargoX = hasBoth ? (productionWidth + OVERLAY_COLUMN_GAP) / 2 : 0;
    const productionX = hasBoth ? -(cargoWidth + OVERLAY_COLUMN_GAP) / 2 : 0;
    const cargoCells = renderOverlayCells({
        prefix: 'cargo',
        itemIds: cargoItemIds,
        sizing: cargoSizing,
        border: CARGO_FRAME_BORDER,
    });
    const productionCells = renderOverlayCells({
        prefix: 'production',
        itemIds: productionItemIds,
        sizing: productionSizing,
        border: PRODUCTION_FRAME_BORDER,
    });
    const children = hasBoth
        ? [{
            id: 'production-column',
            kind: 'group' as const,
            x: productionX,
            children: productionCells,
        }, {
            id: 'cargo-column',
            kind: 'group' as const,
            x: cargoX,
            children: cargoCells,
        }]
        : productionCells.length > 0 ? productionCells : cargoCells;
    return {
        id: hasBoth ? 'cargo-and-production' : productionCells.length > 0 ? 'production-output' : 'marked-cargo',
        kind: 'group',
        laneId: 'overlay',
        laneOrder: 1000,
        x: options.asset.cargo?.offsetX ?? 0,
        y: options.asset.cargo?.offsetY ?? 0,
        rotation: -options.rotation,
        experimentalPresentation: { contractVersion: 1, worldUpright: true },
        children,
    };
}
