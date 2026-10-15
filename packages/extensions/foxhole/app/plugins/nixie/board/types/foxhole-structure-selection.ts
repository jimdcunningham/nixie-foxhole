import { resolveFoxholeTrenchSelectionBounds } from '../../../../../../../../extensions/foxhole-planner/src/structure-selection-bounds.ts';
import type { FoxholeManifestStructure } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import { FOXHOLE_BOARD_SPRITE_SCALE } from '#foxhole/plugins/foxhole/nixie/structure-dimensions.ts';
import { resolveFoxholeBuildSocketPosition } from '#foxhole/plugins/foxhole/nixie/structure-socket-resolution.ts';

export interface FoxholeSelectionBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface FoxholeSelectionHitBox {
    centerX: number;
    centerY: number;
    halfWidth: number;
    halfHeight: number;
    rotationRadians: number;
    bounds: FoxholeSelectionBounds;
}

export interface FoxholeStructureSelectionGeometry {
    bounds: FoxholeSelectionBounds;
    hitPolygons: readonly number[][];
    hitBoxes: readonly FoxholeSelectionHitBox[];
}

export interface FoxholeStructureSelectionGeometryInput {
    structure?: Pick<FoxholeManifestStructure, 'buildSockets' | 'structureVolumes'>;
    selectionPolygons?: readonly { shape: readonly number[]; }[];
    renderLayers?: readonly {
        width?: number | null;
        height?: number | null;
        offsetX?: number | null;
        offsetY?: number | null;
    }[];
    sprite: {
        width: number | null | undefined;
        height: number | null | undefined;
        anchorX: number | null | undefined;
        anchorY: number | null | undefined;
        offsetX: number;
        offsetY: number;
        rotationRadians?: number | null | undefined;
    };
    pixelsPerUnit?: number;
    socketPadding?: number;
}

function getSelectionPolygons(
    input: FoxholeStructureSelectionGeometryInput,
    pixelsPerUnit: number,
): number[][] {
    return (input.selectionPolygons ?? []).flatMap(polygon => {
        if (!Array.isArray(polygon.shape) || polygon.shape.length < 6 || polygon.shape.length % 2 !== 0) {
            return [];
        }

        const points = polygon.shape.map(value => Number(value) * pixelsPerUnit);
        return points.every(Number.isFinite) ? [points] : [];
    });
}

function getPolygonBounds(shape: readonly number[]): FoxholeSelectionBounds | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let index = 0; index + 1 < shape.length; index += 2) {
        minX = Math.min(minX, shape[index]!);
        minY = Math.min(minY, shape[index + 1]!);
        maxX = Math.max(maxX, shape[index]!);
        maxY = Math.max(maxY, shape[index + 1]!);
    }

    return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
        ? { minX, minY, maxX, maxY }
        : null;
}

function unionBounds(boundsList: Iterable<FoxholeSelectionBounds | null | undefined>): FoxholeSelectionBounds | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const bounds of boundsList) {
        if (!bounds) {
            continue;
        }

        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
    }

    return { minX, minY, maxX, maxY };
}

function getOrientedBoxBounds(
    centerX: number,
    centerY: number,
    halfWidth: number,
    halfHeight: number,
    rotationRadians: number,
): FoxholeSelectionBounds {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    const corners = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
    ].map(corner => ({
        x: centerX + (corner.x * cos) - (corner.y * sin),
        y: centerY + (corner.x * sin) + (corner.y * cos),
    }));

    return {
        minX: Math.min(...corners.map(corner => corner.x)),
        minY: Math.min(...corners.map(corner => corner.y)),
        maxX: Math.max(...corners.map(corner => corner.x)),
        maxY: Math.max(...corners.map(corner => corner.y)),
    };
}

function isPointInsidePolygon(localX: number, localY: number, shape: readonly number[]): boolean {
    let inside = false;

    for (let index = 0, previousIndex = shape.length - 2; index < shape.length; previousIndex = index, index += 2) {
        const xi = Number(shape[index] ?? NaN);
        const yi = Number(shape[index + 1] ?? NaN);
        const xj = Number(shape[previousIndex] ?? NaN);
        const yj = Number(shape[previousIndex + 1] ?? NaN);
        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
            continue;
        }

        const intersects = ((yi > localY) !== (yj > localY))
            && (localX < (((xj - xi) * (localY - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

function isPointInsideOrientedBox(localX: number, localY: number, box: FoxholeSelectionHitBox): boolean {
    const dx = localX - box.centerX;
    const dy = localY - box.centerY;
    const cos = Math.cos(box.rotationRadians);
    const sin = Math.sin(box.rotationRadians);
    const rotatedX = (dx * cos) + (dy * sin);
    const rotatedY = (-dx * sin) + (dy * cos);

    return Math.abs(rotatedX) <= box.halfWidth && Math.abs(rotatedY) <= box.halfHeight;
}

function getSpriteHitBox(input: FoxholeStructureSelectionGeometryInput): FoxholeSelectionHitBox | null {
    const width = Number(input.sprite.width ?? NaN);
    const height = Number(input.sprite.height ?? NaN);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    const anchorX = Number(input.sprite.anchorX ?? 0.5);
    const anchorY = Number(input.sprite.anchorY ?? 0.5);
    const rotationRadians = Number(input.sprite.rotationRadians ?? 0);
    const normalizedRotationRadians = Number.isFinite(rotationRadians) ? rotationRadians : 0;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const centerX = input.sprite.offsetX + (width * (0.5 - anchorX));
    const centerY = input.sprite.offsetY + (height * (0.5 - anchorY));

    return {
        centerX,
        centerY,
        halfWidth,
        halfHeight,
        rotationRadians: normalizedRotationRadians,
        bounds: getOrientedBoxBounds(centerX, centerY, halfWidth, halfHeight, normalizedRotationRadians),
    };
}

function getRenderLayerHitBox(input: FoxholeStructureSelectionGeometryInput): FoxholeSelectionHitBox | null {
    const spriteBounds = getSpriteHitBox(input)?.bounds;
    if (!spriteBounds) return null;
    const bounds = resolveFoxholeTrenchSelectionBounds(spriteBounds, (input.renderLayers ?? []).map(layer => ({
        width: Number(layer.width ?? NaN) * FOXHOLE_BOARD_SPRITE_SCALE,
        height: Number(layer.height ?? NaN) * FOXHOLE_BOARD_SPRITE_SCALE,
        offsetX: Number(layer.offsetX ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
        offsetY: Number(layer.offsetY ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
    })));
    if (!bounds) return null;
    return { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2,
        halfWidth: (bounds.maxX - bounds.minX) / 2, halfHeight: (bounds.maxY - bounds.minY) / 2,
        rotationRadians: 0, bounds };
}

function getHitBoxes(
    input: FoxholeStructureSelectionGeometryInput,
    pixelsPerUnit: number,
    options: {
        category?: string;
        excludeCategories?: readonly string[];
    } = {},
): FoxholeSelectionHitBox[] {
    const excludedCategories = new Set(options.excludeCategories ?? []);

    return (input.structure?.structureVolumes ?? []).flatMap(volume => {
        const volumeCategory = String(volume.category ?? '').trim() || 'other';
        if (options.category && volumeCategory !== options.category) {
            return [];
        }

        if (excludedCategories.has(volumeCategory)) {
            return [];
        }

        const centerX = (Number(volume.x ?? 0) / 100) * pixelsPerUnit;
        const centerY = (Number(volume.y ?? 0) / 100) * pixelsPerUnit;
        const halfWidth = (Number(volume.width ?? NaN) / 100) * pixelsPerUnit;
        const halfHeight = (Number(volume.length ?? NaN) / 100) * pixelsPerUnit;
        const rotationRadians = (Number(volume.rotation ?? 0) * Math.PI) / 180;
        if (!Number.isFinite(halfWidth) || !Number.isFinite(halfHeight)) {
            return [];
        }

        return [{
            centerX,
            centerY,
            halfWidth,
            halfHeight,
            rotationRadians,
            bounds: getOrientedBoxBounds(centerX, centerY, halfWidth, halfHeight, rotationRadians),
        }];
    });
}

function getSocketBounds(input: FoxholeStructureSelectionGeometryInput, pixelsPerUnit: number): FoxholeSelectionBounds | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const socket of input.structure?.buildSockets ?? []) {
        const socketPosition = resolveFoxholeBuildSocketPosition(socket);
        if (!socketPosition) {
            continue;
        }

        const socketX = (socketPosition.x / 100) * pixelsPerUnit;
        const socketY = (socketPosition.y / 100) * pixelsPerUnit;

        minX = Math.min(minX, socketX);
        minY = Math.min(minY, socketY);
        maxX = Math.max(maxX, socketX);
        maxY = Math.max(maxY, socketY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
    }

    const padding = Number(input.socketPadding ?? 12);
    return {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding,
    };
}

export function buildFoxholeStructureSelectionGeometry(
    input: FoxholeStructureSelectionGeometryInput,
): FoxholeStructureSelectionGeometry | null {
    const pixelsPerUnit = Number(input.pixelsPerUnit ?? 32);
    const selectionPolygons = getSelectionPolygons(input, pixelsPerUnit);
    if (selectionPolygons.length > 0) {
        return {
            bounds: unionBounds(selectionPolygons.map(getPolygonBounds))!,
            hitPolygons: selectionPolygons,
            hitBoxes: [],
        };
    }

    const spriteHitBox = getRenderLayerHitBox(input) ?? getSpriteHitBox(input);
    const spriteBounds = spriteHitBox?.bounds ?? null;
    if (!input.structure) {
        return spriteBounds
            ? { bounds: spriteBounds, hitPolygons: [], hitBoxes: spriteHitBox ? [spriteHitBox] : [] }
            : null;
    }

    if (spriteBounds) {
        return {
            bounds: spriteBounds,
            hitPolygons: [],
            hitBoxes: spriteHitBox ? [spriteHitBox] : [],
        };
    }

    const structureBoxes = getHitBoxes(input, pixelsPerUnit, { excludeCategories: ['footprint'] });
    if (structureBoxes.length > 0) {
        return {
            bounds: unionBounds(structureBoxes.map(box => box.bounds))!,
            hitPolygons: [],
            hitBoxes: structureBoxes,
        };
    }

    const socketBounds = getSocketBounds(input, pixelsPerUnit);
    if (socketBounds) {
        return { bounds: socketBounds, hitPolygons: [], hitBoxes: [] };
    }

    return null;
}

export function isPointInsideFoxholeStructureSelectionGeometry(
    localX: number,
    localY: number,
    geometry: FoxholeStructureSelectionGeometry,
): boolean {
    if (
        localX < geometry.bounds.minX
        || localX > geometry.bounds.maxX
        || localY < geometry.bounds.minY
        || localY > geometry.bounds.maxY
    ) {
        return false;
    }

    if (geometry.hitPolygons.length > 0) {
        return geometry.hitPolygons.some(shape => isPointInsidePolygon(localX, localY, shape));
    }

    if (geometry.hitBoxes.length > 0) {
        return geometry.hitBoxes.some(box => isPointInsideOrientedBox(localX, localY, box));
    }

    return true;
}
