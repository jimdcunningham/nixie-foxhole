import {

    registerStyleClipboardHandler,
} from '#nixie/plugins/nixie/style-clipboard.ts';
import type { NixieStyleClipboardHandler, NixieStyleClipboardPayload } from '#nixie/plugins/nixie/style-clipboard.ts';

const TACTICAL_LINE_STYLE_KEYS = [
    'presetId',
    'scaleWithZoom',
    'curveMode',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'strokeStyle',
    'strokeDashLength',
    'strokeDashGap',
    'startCap',
    'endCap',
    'decoratorMode',
    'decoratorSide',
    'decoratorSize',
    'decoratorSpacing',
    'decoratorFill',
    'decoratorColor',
    'decoratorAlpha',
] as const;

const BINOCULAR_LINE_STYLE_KEYS = [
    'scaleWithZoom',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'multiSegmentAlpha',
    'showDistance',
    'showAzimuth',
    'showAzimuthArrows',
    'labelColor',
    'labelFontSize',
    'labelBackgroundColor',
    'labelBackgroundAlpha',
    'labelPadding',
    'labelStrokeWidth',
    'endpointRadius',
    'startCap',
    'endCap',
    'meterPixels',
    'decimals',
] as const;

const RANGE_STYLE_KEYS = [
    'sweepAngle',
    'scaleWithZoom',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'strokeStyle',
    'strokeDashLength',
    'strokeDashGap',
    'fillColor',
    'fillAlpha',
    'showCenterAxis',
    'showRadius',
    'showAngle',
    'labelColor',
    'labelFontSize',
    'labelBackgroundColor',
    'labelBackgroundAlpha',
    'labelPadding',
    'labelStrokeWidth',
    'centerMarkerRadius',
    'meterPixels',
    'decimals',
] as const;

const TACTICAL_LINE_STYLE_HANDLER: NixieStyleClipboardHandler = {
    id: 'foxhole-tactical-line',
    toolIds: ['foxhole-tactical-line'],
    family: 'foxhole-tactical-line',
    createPayloadStyle: options => pickStyleKeys(options, TACTICAL_LINE_STYLE_KEYS),
    createToolOptionsPatch: payload => createTacticalLineStylePatchFromStyleClipboard(payload),
};

const BINOCULAR_LINE_STYLE_HANDLER: NixieStyleClipboardHandler = {
    id: 'foxhole-binocular-line',
    toolIds: ['foxhole-binoculars'],
    family: 'foxhole-binocular-line',
    createPayloadStyle: options => pickStyleKeys(options, BINOCULAR_LINE_STYLE_KEYS),
    createToolOptionsPatch: payload => createBinocularLineStylePatchFromStyleClipboard(payload),
};

const RANGE_STYLE_HANDLER: NixieStyleClipboardHandler = {
    id: 'foxhole-range',
    toolIds: ['foxhole-range'],
    family: 'foxhole-range',
    createPayloadStyle: options => pickStyleKeys(options, RANGE_STYLE_KEYS),
    createToolOptionsPatch: payload => createRangeStylePatchFromStyleClipboard(payload),
};

let foxholeStyleClipboardHandlersRegistered = false;

export function registerFoxholeStyleClipboardHandlers(): void {
    if (foxholeStyleClipboardHandlersRegistered) {
        return;
    }

    registerStyleClipboardHandler(TACTICAL_LINE_STYLE_HANDLER);
    registerStyleClipboardHandler(BINOCULAR_LINE_STYLE_HANDLER);
    registerStyleClipboardHandler(RANGE_STYLE_HANDLER);
    foxholeStyleClipboardHandlersRegistered = true;
}

export function createTacticalLineStyleClipboardPayload(state: Record<string, unknown>): NixieStyleClipboardPayload {
    return {
        version: 1,
        family: 'foxhole-tactical-line',
        sourceNodeType: 'foxhole-tactical-line',
        style: pickStyleKeys(state, TACTICAL_LINE_STYLE_KEYS),
    };
}

export function createTacticalLineStylePatchFromStyleClipboard(payload: NixieStyleClipboardPayload): Record<string, unknown> | null {
    if (payload.family === 'foxhole-tactical-line') {
        const patch = normalizeTacticalLineStylePatch(payload.style);
        return Object.keys(patch).length ? patch : null;
    }

    if (payload.family !== 'graphics' && payload.family !== 'brush') {
        return null;
    }

    const stroke = readStrokeStyle(payload.style.stroke);
    if (!stroke) {
        return null;
    }

    return {
        ...(stroke.color !== undefined ? { strokeColor: stroke.color } : {}),
        ...(stroke.width !== undefined ? { strokeWidth: Math.max(1, stroke.width) } : {}),
        ...(stroke.alpha !== undefined ? { strokeAlpha: stroke.alpha } : {}),
    };
}

export function createBinocularLineStyleClipboardPayload(state: Record<string, unknown>): NixieStyleClipboardPayload {
    return {
        version: 1,
        family: 'foxhole-binocular-line',
        sourceNodeType: 'foxhole-binocular-line',
        style: pickStyleKeys(state, BINOCULAR_LINE_STYLE_KEYS),
    };
}

export function createBinocularLineStylePatchFromStyleClipboard(payload: NixieStyleClipboardPayload): Record<string, unknown> | null {
    if (payload.family === 'foxhole-binocular-line') {
        const patch = normalizeBinocularLineStylePatch(payload.style);
        return Object.keys(patch).length ? patch : null;
    }

    if (payload.family !== 'graphics' && payload.family !== 'brush') {
        return null;
    }

    const stroke = readStrokeStyle(payload.style.stroke);
    if (!stroke) {
        return null;
    }

    return {
        ...(stroke.color !== undefined ? { strokeColor: stroke.color } : {}),
        ...(stroke.width !== undefined ? { strokeWidth: Math.max(1, stroke.width) } : {}),
        ...(stroke.alpha !== undefined ? { strokeAlpha: stroke.alpha } : {}),
    };
}

export function createRangeStyleClipboardPayload(state: Record<string, unknown>): NixieStyleClipboardPayload {
    return {
        version: 1,
        family: 'foxhole-range',
        sourceNodeType: 'foxhole-range',
        style: pickStyleKeys(state, RANGE_STYLE_KEYS),
    };
}

export function createRangeStylePatchFromStyleClipboard(payload: NixieStyleClipboardPayload): Record<string, unknown> | null {
    if (payload.family === 'foxhole-range') {
        const patch = normalizeRangeStylePatch(payload.style);
        return Object.keys(patch).length ? patch : null;
    }

    if (payload.family !== 'graphics' && payload.family !== 'brush') {
        return null;
    }

    const stroke = readStrokeStyle(payload.style.stroke);
    const fill = readFillStyle(payload.style.fill);
    const patch: Record<string, unknown> = {};

    if (stroke?.color !== undefined) {
        patch.strokeColor = stroke.color;
    }
    if (stroke?.width !== undefined) {
        patch.strokeWidth = Math.max(1, stroke.width);
    }
    if (stroke?.alpha !== undefined) {
        patch.strokeAlpha = stroke.alpha;
    }
    if (fill?.color !== undefined) {
        patch.fillColor = fill.color;
    }
    if (fill?.alpha !== undefined) {
        patch.fillAlpha = fill.alpha;
    }

    return Object.keys(patch).length ? patch : null;
}

function normalizeTacticalLineStylePatch(style: Record<string, unknown>): Record<string, unknown> {
    const patch = pickStyleKeys(style, TACTICAL_LINE_STYLE_KEYS);

    normalizePatchColor(patch, 'strokeColor');
    normalizePatchColor(patch, 'decoratorColor');
    normalizePatchNumber(patch, 'strokeWidth', 1);
    normalizePatchNumber(patch, 'strokeDashLength', 2);
    normalizePatchNumber(patch, 'strokeDashGap', 1);
    normalizePatchNumber(patch, 'decoratorSize', 1);
    normalizePatchNumber(patch, 'decoratorSpacing', 4);
    normalizePatchNumber(patch, 'strokeAlpha', 0, 1);
    normalizePatchNumber(patch, 'decoratorAlpha', 0, 1);
    normalizePatchBoolean(patch, 'scaleWithZoom');
    normalizePatchBoolean(patch, 'decoratorFill');

    return patch;
}

function normalizeBinocularLineStylePatch(style: Record<string, unknown>): Record<string, unknown> {
    const patch = pickStyleKeys(style, BINOCULAR_LINE_STYLE_KEYS);

    normalizePatchColor(patch, 'strokeColor');
    normalizePatchColor(patch, 'labelColor');
    normalizePatchColor(patch, 'labelBackgroundColor');
    normalizePatchNumber(patch, 'strokeWidth', 1);
    normalizePatchNumber(patch, 'strokeAlpha', 0, 1);
    normalizePatchNumber(patch, 'multiSegmentAlpha', 0, 1);
    normalizePatchNumber(patch, 'labelFontSize', 6);
    normalizePatchNumber(patch, 'labelBackgroundAlpha', 0, 1);
    normalizePatchNumber(patch, 'labelPadding', 0);
    normalizePatchNumber(patch, 'labelStrokeWidth', 0);
    normalizePatchNumber(patch, 'endpointRadius', 0);
    normalizePatchNumber(patch, 'meterPixels', 1);
    normalizePatchInteger(patch, 'decimals', 0, 4);
    normalizePatchBoolean(patch, 'scaleWithZoom');
    normalizePatchBoolean(patch, 'showDistance');
    normalizePatchBoolean(patch, 'showAzimuth');
    normalizePatchBoolean(patch, 'showAzimuthArrows');
    normalizePatchEnum(patch, 'startCap', ['none', 'arrow', 'circle']);
    normalizePatchEnum(patch, 'endCap', ['none', 'arrow', 'circle']);

    return patch;
}

function normalizeRangeStylePatch(style: Record<string, unknown>): Record<string, unknown> {
    const patch = pickStyleKeys(style, RANGE_STYLE_KEYS);

    normalizePatchColor(patch, 'strokeColor');
    normalizePatchColor(patch, 'fillColor');
    normalizePatchColor(patch, 'labelColor');
    normalizePatchColor(patch, 'labelBackgroundColor');
    normalizePatchNumber(patch, 'sweepAngle', 1, 360);
    normalizePatchNumber(patch, 'strokeWidth', 1);
    normalizePatchNumber(patch, 'strokeAlpha', 0, 1);
    normalizePatchNumber(patch, 'strokeDashLength', 1);
    normalizePatchNumber(patch, 'strokeDashGap', 1);
    normalizePatchNumber(patch, 'fillAlpha', 0, 1);
    normalizePatchNumber(patch, 'labelFontSize', 6);
    normalizePatchNumber(patch, 'labelBackgroundAlpha', 0, 1);
    normalizePatchNumber(patch, 'labelPadding', 0);
    normalizePatchNumber(patch, 'labelStrokeWidth', 0);
    normalizePatchNumber(patch, 'centerMarkerRadius', 1);
    normalizePatchNumber(patch, 'meterPixels', 1);
    normalizePatchInteger(patch, 'decimals', 0, 4);
    normalizePatchBoolean(patch, 'scaleWithZoom');
    normalizePatchBoolean(patch, 'showCenterAxis');
    normalizePatchBoolean(patch, 'showRadius');
    normalizePatchBoolean(patch, 'showAngle');
    normalizePatchEnum(patch, 'strokeStyle', ['solid', 'dashed']);

    return patch;
}

function normalizePatchColor(patch: Record<string, unknown>, key: string): void {
    if (!(key in patch)) {
        return;
    }
    const color = readColorValue(patch[key]);
    if (color === undefined) {
        delete patch[key];
        return;
    }
    patch[key] = color;
}

function normalizePatchNumber(patch: Record<string, unknown>, key: string, min: number, max = Number.POSITIVE_INFINITY): void {
    if (!(key in patch)) {
        return;
    }
    const value = toOptionalNumber(patch[key]);
    if (value === undefined) {
        delete patch[key];
        return;
    }
    patch[key] = clamp(value, min, max);
}

function normalizePatchInteger(patch: Record<string, unknown>, key: string, min: number, max = Number.POSITIVE_INFINITY): void {
    normalizePatchNumber(patch, key, min, max);
    if (key in patch) {
        patch[key] = Math.round(Number(patch[key]));
    }
}

function normalizePatchBoolean(patch: Record<string, unknown>, key: string): void {
    if (!(key in patch)) {
        return;
    }
    if (typeof patch[key] !== 'boolean') {
        delete patch[key];
    }
}

function normalizePatchEnum(patch: Record<string, unknown>, key: string, allowed: readonly string[]): void {
    if (!(key in patch)) {
        return;
    }
    if (typeof patch[key] !== 'string' || !allowed.includes(patch[key])) {
        delete patch[key];
    }
}

function readStrokeStyle(value: unknown): { color: number; alpha: number; width: number; } | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const color = readColorValue(record.color);
    const alpha = toOptionalNumber(record.alpha);
    const width = toOptionalNumber(record.width);
    if (color === undefined && alpha === undefined && width === undefined) {
        return undefined;
    }

    return {
        color: color ?? 0xFFFFFF,
        alpha: clamp(alpha ?? 1, 0, 1),
        width: Math.max(0, width ?? 2),
    };
}

function readFillStyle(value: unknown): { color: number; alpha: number; } | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const color = readColorValue(record.color);
    const alpha = toOptionalNumber(record.alpha);
    if (color === undefined && alpha === undefined) {
        return undefined;
    }

    return {
        color: color ?? 0xFFFFFF,
        alpha: clamp(alpha ?? 1, 0, 1),
    };
}

function readColorValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(0xFFFFFF, Math.round(value)));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseInt(value.trim().replace(/^#/, ''), 16);
        return Number.isFinite(parsed)
            ? Math.max(0, Math.min(0xFFFFFF, parsed))
            : undefined;
    }
    return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function cloneStyleValue<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // Fall through to JSON clone.
        }
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function pickStyleKeys<TKeys extends readonly string[]>(source: Record<string, unknown>, keys: TKeys): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const key of keys) {
        if (source[key] !== undefined) {
            picked[key] = cloneStyleValue(source[key]);
        }
    }
    return picked;
}
