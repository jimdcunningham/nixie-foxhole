import type { FoxholeTacticalLineState } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    if (edge0 === edge1) {
        return value >= edge1 ? 1 : 0;
    }

    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - (2 * t));
}

export function getCapInset(cap: FoxholeTacticalLineState['startCap'], size: number): number {
    switch (cap) {
        case 'arrow':
            return size * 0.96;
        case 'circle':
            return size * 0.4;
        case 'flag':
        case 'none':
        default:
            return 0;
    }
}

export function getFoxholeTacticalLineMinimumUsefulVisibleLength(state: FoxholeTacticalLineState): number {
    if (state.strokeStyle === 'dashed' || state.decoratorMode === 'none') {
        const capAllowance = Math.max(
            getCapInset(state.startCap, 16),
            getCapInset(state.endCap, 16),
            state.strokeWidth * 2,
            24,
        );
        return capAllowance * 4;
    }

    const spacing = Math.max(
        state.decoratorSpacing,
        state.decoratorSize * 0.8,
        12,
    );
    const offset = Math.max(spacing * 0.65, state.strokeWidth * 1.4);
    return ((offset * 2) + spacing) * 1.5;
}

export function getFoxholeTacticalLineEffectiveRenderScale(
    state: FoxholeTacticalLineState,
    rawRenderScale: number,
    totalLength: number,
): number {
    if (!state.scaleWithZoom) {
        return 1;
    }

    const zoomScale = Math.max(0.1, rawRenderScale);
    if (!Number.isFinite(totalLength) || totalLength <= Number.EPSILON) {
        return zoomScale;
    }

    const minimumUsefulLength = getFoxholeTacticalLineMinimumUsefulVisibleLength(state);
    if (zoomScale <= 1) {
        const visibleLength = totalLength / Math.max(zoomScale, Number.EPSILON);
        const zoomInBlend = 0.2 + (0.8 * (1 - smoothstep(
            minimumUsefulLength * 4,
            minimumUsefulLength * 24,
            visibleLength,
        )));
        return 1 + ((zoomScale - 1) * zoomInBlend);
    }

    const maximumUsefulZoomScale = Math.max(1, totalLength / Math.max(minimumUsefulLength, 1));
    return Math.min(zoomScale, maximumUsefulZoomScale);
}
