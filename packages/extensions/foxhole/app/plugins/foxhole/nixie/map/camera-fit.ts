const FOXHOLE_MAP_FIT_PADDING_PX = 96;

export interface FoxholeMapFitBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
}

export function shouldFitFoxholeMapOnEnable(
    wasEnabled: boolean,
    enabled: boolean,
    sceneNodeCount: number,
): boolean {
    return !wasEnabled && enabled && sceneNodeCount === 0;
}

export function resolveFoxholeMapFitCamera(
    bounds: FoxholeMapFitBounds,
    viewport: { width: number; height: number; },
): { position: { x: number; y: number; }; scale: number; } {
    const availableWidth = Math.max(1, viewport.width - (FOXHOLE_MAP_FIT_PADDING_PX * 2));
    const availableHeight = Math.max(1, viewport.height - (FOXHOLE_MAP_FIT_PADDING_PX * 2));

    return {
        position: {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
        },
        scale: Math.min(
            availableWidth / Math.max(1, bounds.width),
            availableHeight / Math.max(1, bounds.height),
        ),
    };
}
