import { DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE } from './structure-socket-snapping.ts';

export const FOXHOLE_STRUCTURE_EMPLACEMENT_SNAP_RESULT_KIND = 'foxhole:structure-emplacement-snap';

/** Board pixels per meter (cm → board uses /100 * this). Matches structure socket conversion. */
export const FOXHOLE_EMPLACEMENT_BOARD_PIXELS_PER_METER = 32;

export interface FoxholeEmplacementPadPoint {
    nodeId: string;
    x: number;
    y: number;
}

export interface FoxholeEmplacementSnapMatch {
    movingNodeId: string;
    targetNodeId: string;
    moveX: number;
    moveY: number;
    distance: number;
}

export interface FindBestFoxholeEmplacementSnapOptions {
    movingNodeId: string;
    /** Weapon origin at drag-start pose (before moveX/moveY). */
    movingOrigin: { x: number; y: number; };
    pads: readonly FoxholeEmplacementPadPoint[];
    moveX: number;
    moveY: number;
    maxDistance?: number;
    pointerWorld?: { x: number; y: number; } | null;
    pointerBiasRadius?: number;
}

export function foxholeEmplacementLocalToBoardOffset(location: {
    x?: number | null;
    y?: number | null;
}): { x: number; y: number; } {
    const xCm = Number(location.x ?? 0);
    const yCm = Number(location.y ?? 0);
    return {
        x: (Number.isFinite(xCm) ? xCm : 0) / 100 * FOXHOLE_EMPLACEMENT_BOARD_PIXELS_PER_METER,
        y: (Number.isFinite(yCm) ? yCm : 0) / 100 * FOXHOLE_EMPLACEMENT_BOARD_PIXELS_PER_METER,
    };
}

/**
 * Translation-only snap: align the moving structure origin to a host emplacement pad.
 * Never applies rotation (emplaced weapons rotate freely on the pad).
 */
export function findBestFoxholeEmplacementSnap(
    options: FindBestFoxholeEmplacementSnapOptions,
): FoxholeEmplacementSnapMatch | null {
    const maxDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, Number(options.maxDistance))
        : DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE;
    const pointerBiasRadius = Number.isFinite(options.pointerBiasRadius)
        ? Math.max(0, Number(options.pointerBiasRadius))
        : maxDistance;
    const movedOriginX = options.movingOrigin.x + options.moveX;
    const movedOriginY = options.movingOrigin.y + options.moveY;

    let best: FoxholeEmplacementSnapMatch | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const pad of options.pads) {
        const distance = Math.hypot(movedOriginX - pad.x, movedOriginY - pad.y);
        if (!(distance <= maxDistance)) {
            continue;
        }

        let score = distance;
        if (options.pointerWorld && pointerBiasRadius > 0) {
            const pointerDistance = Math.hypot(
                options.pointerWorld.x - pad.x,
                options.pointerWorld.y - pad.y,
            );
            if (pointerDistance <= pointerBiasRadius) {
                score -= (pointerBiasRadius - pointerDistance) * 0.25;
            }
        }

        if (score >= bestScore) {
            continue;
        }

        bestScore = score;
        best = {
            movingNodeId: options.movingNodeId,
            targetNodeId: pad.nodeId,
            moveX: pad.x - options.movingOrigin.x,
            moveY: pad.y - options.movingOrigin.y,
            distance,
        };
    }

    return best;
}
