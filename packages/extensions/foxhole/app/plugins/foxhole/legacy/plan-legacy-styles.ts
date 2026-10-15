/**
 * Legacy Foxhole Planner runtime style defaults.
 *
 * Saves only persist deltas vs these defaults (`game.getDefaultStyle` / `onSave`).
 * Import must bake defaults before mapping into Nixie board styles.
 *
 * Sourced from game-kitchen `app/plugins/libs/game.js` DEFAULT_SHAPE_STYLE
 * and `defaultSettings.styles`.
 */

export type LegacyShapeStyle = Record<string, unknown>;

const DEFAULT_SHAPE_STYLE: LegacyShapeStyle = {
    alpha: 1,
    fill: false,
    fillColor: '#FFFFFF',
    border: false,
    lineWidth: 8,
    lineColor: '#FFFFFF',
};

const DEFAULT_TEXT_STYLE: LegacyShapeStyle = {
    fontFamily: 'Arial',
    fontSize: 64,
    fontStyle: 'normal',
    fontWeight: 'normal',
    fill: '#FFFFFF',
    align: 'center',
};

const TYPE_DEFAULTS: Record<string, LegacyShapeStyle> = {
    text: { ...DEFAULT_TEXT_STYLE },
    rectangle: { ...DEFAULT_SHAPE_STYLE },
    circle: { ...DEFAULT_SHAPE_STYLE },
    line: {
        ...DEFAULT_SHAPE_STYLE,
        lineWidth: 14,
        frontArrow: true,
        backArrow: true,
        showDist: false,
    },
    // Binoculars tool still saves type:"line" with key:"binoline".
    binoline: {
        ...DEFAULT_SHAPE_STYLE,
        fillColor: '#77E5C3',
        lineWidth: 2,
        lineMode: 'multi',
        frontArrow: false,
        backArrow: true,
        ignoreSnapSettings: true,
        scaleToZoom: true,
        showDist: true,
        showAzimuth: true,
    },
    stroke: {
        ...DEFAULT_SHAPE_STYLE,
        lineWidth: 6,
    },
    polygon: {
        ...DEFAULT_SHAPE_STYLE,
        alpha: 0.5,
        // Saved default is undefined; regenerate() hardcodes stroke width 6 for polygons.
        lineWidth: undefined,
    },
    icon: {
        ...DEFAULT_SHAPE_STYLE,
        iconColor: '#FFFFFF',
        fill: true,
        fillColor: '#0B0B0B',
        border: true,
        lineWidth: 3,
        lineRadius: 0,
        lineColor: '#00FF00',
        label: false,
        labelColor: '#FFFFFF',
        labelPosition: 'bottom',
        labelSize: 28,
        maintainAspectRatio: true,
    },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeStyle(base: LegacyShapeStyle, overlay: LegacyShapeStyle | null | undefined): LegacyShapeStyle {
    const result: LegacyShapeStyle = { ...base };
    if (!isPlainObject(overlay)) {
        return result;
    }
    for (const [key, value] of Object.entries(overlay)) {
        if (value === undefined) {
            continue;
        }
        result[key] = value;
    }
    return result;
}

export function parseLegacyColor(value: unknown, fallback = 0xFFFFFF): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value >>> 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return fallback;
        }
        if (trimmed.startsWith('#')) {
            const hex = trimmed.slice(1);
            if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                return Number.parseInt(hex, 16) >>> 0;
            }
            if (/^[0-9a-fA-F]{3}$/.test(hex)) {
                const expanded = hex.split('').map(ch => ch + ch).join('');
                return Number.parseInt(expanded, 16) >>> 0;
            }
        }
        if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) {
            return Number.parseInt(trimmed, 16) >>> 0;
        }
        if (/^[0-9]+$/.test(trimmed)) {
            return Number.parseInt(trimmed, 10) >>> 0;
        }
    }
    return fallback;
}

/**
 * Legacy `game.getDarkColor` — multiply RGB by #B0B0B0.
 * Used for measurement label backgrounds on lines/binoculars.
 */
export function darkenLegacyColor(value: unknown, fallback = 0xFFFFFF): number {
    const color = parseLegacyColor(value, fallback) & 0xFFFFFF;
    const scale = 0xB0 / 0xFF;
    const r = Math.round(((color >> 16) & 0xFF) * scale);
    const g = Math.round(((color >> 8) & 0xFF) * scale);
    const b = Math.round((color & 0xFF) * scale);
    return ((r << 16) | (g << 8) | b) >>> 0;
}

export function resolveLegacyShapeStyle(
    type: string,
    shapeStyle?: LegacyShapeStyle | null,
): LegacyShapeStyle {
    const defaults = TYPE_DEFAULTS[String(type ?? '').trim()] ?? { ...DEFAULT_SHAPE_STYLE };
    return deepMergeStyle(defaults, shapeStyle ?? null);
}

export function resolveLegacyLabelStyle(
    labelStyle?: LegacyShapeStyle | null,
): LegacyShapeStyle {
    return deepMergeStyle(DEFAULT_TEXT_STYLE, labelStyle ?? null);
}

export function legacyStyleNumber(style: LegacyShapeStyle, key: string, fallback: number): number {
    const value = style[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return fallback;
}

export function legacyStyleBoolean(style: LegacyShapeStyle, key: string, fallback = false): boolean {
    const value = style[key];
    if (typeof value === 'boolean') {
        return value;
    }
    return fallback;
}

export function legacyStyleString(style: LegacyShapeStyle, key: string, fallback = ''): string {
    const value = style[key];
    return typeof value === 'string' ? value : fallback;
}
