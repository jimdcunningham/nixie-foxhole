import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardGraphicsFillStyle, BoardGraphicsStrokeStyle } from '#nixie/plugins/nixie/board/types/primitives/graphics.ts';
import {
    createEllipseGraphicsSnapshot,
    createLineGraphicsSnapshot,
    createPolygonGraphicsSnapshot,
    createRectangleGraphicsSnapshot,
} from '#nixie/plugins/nixie/board/utils/graphics-shape-snapshot.ts';
import { createTextSnapshot } from '#nixie/plugins/nixie/board/utils/text-snapshot.ts';
import {
    BOARD_GRAPHICS_LINE_STROKE_ALIGNMENT,
    BOARD_GRAPHICS_SHAPE_STROKE_ALIGNMENT,
} from '#nixie/plugins/nixie/board/utils/graphics-stroke.ts';
import { createFoxholeBinocularLineSnapshot } from '../nixie/binocular-line-snapshot.ts';
import type { LegacyPlanEntity } from './plan-types.ts';
import {
    darkenLegacyColor,
    legacyStyleBoolean,
    legacyStyleNumber,
    legacyStyleString,
    parseLegacyColor,
    resolveLegacyLabelStyle,
    resolveLegacyShapeStyle,

} from './plan-legacy-styles.ts';
import type { LegacyShapeStyle } from './plan-legacy-styles.ts';

const DEG_TO_RAD = Math.PI / 180;

export const LEGACY_PLAN_SHAPE_ENTITY_TYPES = new Set([
    'text',
    'rectangle',
    'circle',
    'line',
    'polygon',
    'stroke',
]);

export type LegacyShapeMappingResult = {
    snapshot: BoardNodeSnapshot | null;
    consumedFields: string[];
    reason?: string;
};

function createNodeId(legacyId: number): string {
    return `legacy-${legacyId}`;
}

function applyPose(
    snapshot: BoardNodeSnapshot,
    entity: LegacyPlanEntity,
    options?: { originX?: number; originY?: number; preserveOrigin?: boolean; },
): BoardNodeSnapshot {
    const state = snapshot.state as Record<string, unknown>;
    if (!options?.preserveOrigin) {
        if (options?.originX != null) {
            state.x = options.originX;
        } else if (typeof state.x !== 'number') {
            state.x = Number(entity.x ?? 0);
        }
        if (options?.originY != null) {
            state.y = options.originY;
        } else if (typeof state.y !== 'number') {
            state.y = Number(entity.y ?? 0);
        }
    }
    if (entity.z != null && Number.isFinite(Number(entity.z))) {
        state.z = Number(entity.z);
    }
    state.rotation = Number(entity.rotation ?? 0) * DEG_TO_RAD;
    state.locked = entity.locked === true;
    return snapshot;
}

/**
 * Visually / code-confirmed vs legacy + Nixie rectangle:
 * - node alpha = shapeStyle.alpha (legacy `sprite.alpha = shapeStyle.alpha`)
 * - fill color = fillColor, fill alpha = 1 (legacy `sprite.fill(fillColor)` — no per-fill alpha)
 * - border stroke color = fillColor (legacy ignores lineColor for rect/circle borders)
 * - border stroke width = lineWidth, alignment 0.5 (wire `al`; centered)
 */
function shapeFill(style: LegacyShapeStyle, type?: string): BoardGraphicsFillStyle | undefined {
    const border = legacyStyleBoolean(style, 'border', false);
    const fill = legacyStyleBoolean(style, 'fill', false);
    // Legacy regenerate(): for non-line shapes, `!border` assigns fillColor even when
    // `fill` is false — so default rect/circle (fill+border false) still paint solid.
    const impliedFill = (type === 'rectangle' || type === 'circle') && !border;
    if (!fill && !impliedFill) {
        return { color: parseLegacyColor(style.fillColor, 0xFFFFFF), alpha: 0 };
    }
    return {
        color: parseLegacyColor(style.fillColor, 0xFFFFFF),
        alpha: 1,
    };
}

function shapeStroke(style: LegacyShapeStyle, options?: {
    force?: boolean;
    /** Prefer fillColor (legacy rect/circle border). Default true. */
    useFillColor?: boolean;
    /** Centered stroke (Nixie wire `al: 0.5`). Default true for shape borders. */
    centered?: boolean;
}): BoardGraphicsStrokeStyle | undefined {
    const force = options?.force === true;
    const bordered = legacyStyleBoolean(style, 'border', false) || force;
    const width = legacyStyleNumber(style, 'lineWidth', 0);
    if (!bordered || !(width > 0)) {
        return {
            color: 0xFFFFFF,
            width: 0,
            alpha: 0,
            alignment: BOARD_GRAPHICS_SHAPE_STROKE_ALIGNMENT,
        };
    }
    const useFillColor = options?.useFillColor !== false;
    const colorSource = useFillColor
        ? (style.fillColor ?? style.lineColor)
        : (style.lineColor ?? style.fillColor);
    const centered = options?.centered !== false;
    return {
        color: parseLegacyColor(colorSource, 0xFFFFFF),
        width,
        alpha: 1,
        alignment: centered
            ? BOARD_GRAPHICS_LINE_STROKE_ALIGNMENT
            : BOARD_GRAPHICS_SHAPE_STROKE_ALIGNMENT,
    };
}

function lineStroke(style: LegacyShapeStyle): BoardGraphicsStrokeStyle {
    return {
        color: parseLegacyColor(style.fillColor ?? style.lineColor, 0xFFFFFF),
        width: Math.max(1, legacyStyleNumber(style, 'lineWidth', 14)),
        alpha: 1,
        alignment: BOARD_GRAPHICS_LINE_STROKE_ALIGNMENT,
    };
}

function flattenLocalPoints(
    entity: LegacyPlanEntity,
    raw: unknown,
): number[] | null {
    const originX = Number(entity.x ?? 0);
    const originY = Number(entity.y ?? 0);
    if (Array.isArray(raw) && raw.every(value => typeof value === 'number')) {
        const numbers = raw as number[];
        if (numbers.length < 4 || numbers.length % 2 !== 0) {
            return null;
        }
        const world: number[] = [];
        for (let i = 0; i < numbers.length; i += 2) {
            world.push(originX + numbers[i]!, originY + numbers[i + 1]!);
        }
        return world;
    }
    if (Array.isArray(raw) && raw.length >= 2) {
        const world: number[] = [];
        for (const point of raw) {
            if (!point || typeof point !== 'object') {
                continue;
            }
            const record = point as { x?: unknown; y?: unknown; };
            if (!Number.isFinite(Number(record.x)) || !Number.isFinite(Number(record.y))) {
                continue;
            }
            world.push(originX + Number(record.x), originY + Number(record.y));
        }
        return world.length >= 4 ? world : null;
    }
    return null;
}

function mapText(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const label = typeof entity.label === 'string' ? entity.label : '';
    const style = resolveLegacyLabelStyle(entity.labelStyle ?? null);
    const snapshot = createTextSnapshot({
        id: createNodeId(entity.id),
        x: Number(entity.x ?? 0),
        y: Number(entity.y ?? 0),
        text: label,
        alpha: legacyStyleNumber(style, 'alpha', 1),
        style: {
            fontFamily: legacyStyleString(style, 'fontFamily', 'Arial') || 'Arial',
            fontSize: legacyStyleNumber(style, 'fontSize', 64),
            fontStyle: (legacyStyleString(style, 'fontStyle', 'normal') as 'normal' | 'italic' | 'oblique') || 'normal',
            fontWeight: String(style.fontWeight ?? 'normal'),
            fill: parseLegacyColor(style.fill, 0xFFFFFF),
            align: (legacyStyleString(style, 'align', 'center') as 'left' | 'center' | 'right') || 'center',
            lineHeight: legacyStyleNumber(style, 'fontSize', 64) * 1.25,
            letterSpacing: 0,
            wordWrap: false,
            wordWrapWidth: 500,
        },
        key: typeof entity.name === 'string' ? entity.name : undefined,
    });
    applyPose(snapshot, entity);
    // Legacy text uses center anchor; Nixie BoardTextNode default is also 0.5/0.5.
    // createTextSnapshot currently forces 0/0 — override for import parity.
    const state = snapshot.state as Record<string, unknown>;
    state.anchorX = 0.5;
    state.anchorY = 0.5;
    return {
        snapshot,
        consumedFields: ['label', 'labelStyle', 'shapeStyle'],
    };
}

function mapRectangle(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const width = Math.abs(Number(entity.width ?? 0));
    const height = Math.abs(Number(entity.height ?? 0));
    if (!(width > 0) || !(height > 0)) {
        return { snapshot: null, consumedFields: [], reason: 'invalid_rectangle_size' };
    }
    const x = Number(entity.x ?? 0);
    const y = Number(entity.y ?? 0);
    const style = resolveLegacyShapeStyle('rectangle', entity.shapeStyle ?? null);
    const radius = legacyStyleNumber(style, 'lineRadius', 0);
    const snapshot = createRectangleGraphicsSnapshot({
        id: createNodeId(entity.id),
        key: typeof entity.name === 'string' ? entity.name : undefined,
        rect: {
            minX: x,
            minY: y,
            maxX: x + width,
            maxY: y + height,
        },
        fill: shapeFill(style, 'rectangle'),
        stroke: shapeStroke(style),
        radius: radius > 0 ? radius : undefined,
    });
    applyPose(snapshot, entity, { originX: x, originY: y });
    (snapshot.state as Record<string, unknown>).alpha = legacyStyleNumber(style, 'alpha', 1);
    return {
        snapshot,
        consumedFields: ['width', 'height', 'shapeStyle'],
    };
}

function mapCircle(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const radius = Math.abs(Number(entity.radius ?? 0));
    if (!(radius > 0)) {
        return { snapshot: null, consumedFields: [], reason: 'invalid_circle_radius' };
    }
    const x = Number(entity.x ?? 0);
    const y = Number(entity.y ?? 0);
    const style = resolveLegacyShapeStyle('circle', entity.shapeStyle ?? null);
    const snapshot = createEllipseGraphicsSnapshot({
        id: createNodeId(entity.id),
        key: typeof entity.name === 'string' ? entity.name : undefined,
        rect: {
            minX: x - radius,
            minY: y - radius,
            maxX: x + radius,
            maxY: y + radius,
        },
        fill: shapeFill(style, 'circle'),
        stroke: shapeStroke(style),
    });
    applyPose(snapshot, entity, { originX: x - radius, originY: y - radius });
    (snapshot.state as Record<string, unknown>).alpha = legacyStyleNumber(style, 'alpha', 1);
    return {
        snapshot,
        consumedFields: ['radius', 'shapeStyle'],
    };
}

function mapPolyline(entity: LegacyPlanEntity, kind: 'line' | 'stroke'): LegacyShapeMappingResult {
    if (kind === 'line') {
        return mapLine(entity);
    }
    const rawPoints = Array.isArray(entity.stroke) ? entity.stroke : entity.points;
    const points = flattenLocalPoints(entity, rawPoints);
    if (!points) {
        return { snapshot: null, consumedFields: [], reason: 'invalid_stroke_points' };
    }
    const style = resolveLegacyShapeStyle('stroke', entity.shapeStyle ?? null);
    const snapshot = createLineGraphicsSnapshot({
        id: createNodeId(entity.id),
        key: typeof entity.name === 'string' ? entity.name : undefined,
        points,
        stroke: lineStroke(style),
        metadata: { isBrushStroke: true, sourceTool: 'brush' },
    });
    // Line helpers normalize to bbox origin — keep that world position.
    applyPose(snapshot, entity, { preserveOrigin: true });
    (snapshot.state as Record<string, unknown>).alpha = legacyStyleNumber(style, 'alpha', 1);
    return {
        snapshot,
        consumedFields: ['points', 'shapeStyle', 'stroke'],
    };
}

/**
 * Legacy Line Tool and Binoculars Tool both save `type:"line"`.
 * Binoculars sets `key:"binoline"` and uses binoline style defaults.
 * Nixie graphics lines cannot express arrows / distance / azimuth — map to binocular nodes.
 */
function mapLine(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const points = flattenLocalPoints(entity, entity.points);
    if (!points) {
        return { snapshot: null, consumedFields: [], reason: 'invalid_line_points' };
    }
    const styleKey = String(entity.key ?? '').trim() === 'binoline' ? 'binoline' : 'line';
    const style = resolveLegacyShapeStyle(styleKey, entity.shapeStyle ?? null);
    const showDistance = legacyStyleBoolean(style, 'showDist', false);
    const showAzimuth = legacyStyleBoolean(style, 'showAzimuth', false);
    const pointCount = Math.floor(points.length / 2);
    const lineModeMulti = legacyStyleString(style, 'lineMode', '') === 'multi';
    // Legacy _checkValidArrows(): multi + >2 points forces both caps off.
    const arrowsAllowed = !(lineModeMulti && pointCount > 2);
    const frontArrow = arrowsAllowed && legacyStyleBoolean(style, 'frontArrow', styleKey === 'line');
    const backArrow = arrowsAllowed && legacyStyleBoolean(style, 'backArrow', true);
    const strokeColor = parseLegacyColor(
        style.fillColor,
        styleKey === 'binoline' ? 0x77E5C3 : 0xFFFFFF,
    );
    // Legacy multi-mode draws circles on non-arrow ends; plain lines use flat (butt) ends.
    const nonArrowCap = lineModeMulti || styleKey === 'binoline' ? 'circle' : 'none';
    const snapshot = createFoxholeBinocularLineSnapshot({
        id: createNodeId(entity.id),
        key: typeof entity.name === 'string'
            ? entity.name
            : (styleKey === 'binoline' ? 'Binoculars Tool' : 'Line Tool'),
        points,
        state: {
            strokeColor,
            strokeWidth: Math.max(1, legacyStyleNumber(style, 'lineWidth', styleKey === 'binoline' ? 2 : 14)),
            strokeAlpha: 1,
            alpha: legacyStyleNumber(style, 'alpha', 1),
            // Stroke scale follows legacy scaleToZoom; labels always screen-scale in the renderer.
            scaleWithZoom: legacyStyleBoolean(style, 'scaleToZoom', false),
            showDistance,
            showAzimuth,
            showAzimuthArrows: showAzimuth,
            startCap: frontArrow ? 'arrow' : nonArrowCap,
            endCap: backArrow ? 'arrow' : nonArrowCap,
            endpointRadius: 0,
            multiSegmentAlpha: 0.5,
            // Legacy: fill(getDarkColor(fillColor), 0.85) + stroke(fillColor)
            labelBackgroundColor: darkenLegacyColor(strokeColor),
            labelBackgroundAlpha: 0.85,
            labelStrokeWidth: 2,
        },
    });
    applyPose(snapshot, entity, { preserveOrigin: true });
    return {
        snapshot,
        consumedFields: ['points', 'shapeStyle', 'key'],
    };
}

function mapPolygon(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const points = flattenLocalPoints(entity, entity.polygon);
    if (!points) {
        return { snapshot: null, consumedFields: [], reason: 'invalid_polygon' };
    }
    const style = resolveLegacyShapeStyle('polygon', entity.shapeStyle ?? null);
    const fillColor = parseLegacyColor(style.fillColor, 0xFFFFFF);
    // Legacy regenerate() for polygon always:
    // - sets fillColor and fills
    // - strokes with hardcoded width 6 (ignores shapeStyle.lineWidth) and fillColor
    // - applies opacity via sprite.alpha (= shapeStyle.alpha, default 0.5)
    const snapshot = createPolygonGraphicsSnapshot({
        id: createNodeId(entity.id),
        key: typeof entity.name === 'string' ? entity.name : undefined,
        points,
        fill: {
            color: fillColor,
            alpha: 1,
        },
        stroke: {
            color: fillColor,
            width: 6,
            alpha: 1,
            alignment: BOARD_GRAPHICS_LINE_STROKE_ALIGNMENT,
        },
    });
    // createPolygonGraphicsSnapshot normalizes to bbox origin (e.g. x=-20 when
    // local points include -20) — keep that world position.
    applyPose(snapshot, entity, { preserveOrigin: true });
    (snapshot.state as Record<string, unknown>).alpha = legacyStyleNumber(style, 'alpha', 0.5);
    return {
        snapshot,
        consumedFields: ['polygon', 'shapeStyle'],
    };
}

/**
 * Map a legacy drawable entity into a Nixie board snapshot.
 */
export function mapLegacyPlanShapeEntity(entity: LegacyPlanEntity): LegacyShapeMappingResult {
    const type = String(entity.type ?? '').trim();
    switch (type) {
        case 'text':
            return mapText(entity);
        case 'rectangle':
            return mapRectangle(entity);
        case 'circle':
            return mapCircle(entity);
        case 'line':
            return mapPolyline(entity, 'line');
        case 'stroke':
            return mapPolyline(entity, 'stroke');
        case 'polygon':
            return mapPolygon(entity);
        default:
            return { snapshot: null, consumedFields: [], reason: 'unsupported_shape_type' };
    }
}
