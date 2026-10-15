export const FOXHOLE_POWERLINE_CORE_WIDTH = 3;
export const FOXHOLE_POWERLINE_INVALID_COLOR = 0xFF5A5A;

export function isFoxholePowerlineOverLength(
    start: Readonly<{ x: number; y: number; }>,
    end: Readonly<{ x: number; y: number; }>,
    maxLength: number,
): boolean {
    return Number.isFinite(maxLength) && maxLength > 0
        && Math.hypot(end.x - start.x, end.y - start.y) > maxLength + 0.0001;
}

export function resolveFoxholePowerlineStroke(alpha = 1, overLength = false) {
    return {
        color: overLength ? FOXHOLE_POWERLINE_INVALID_COLOR : 0x000000,
        width: FOXHOLE_POWERLINE_CORE_WIDTH,
        alpha,
        cap: 'round' as const,
        join: 'round' as const,
    };
}
