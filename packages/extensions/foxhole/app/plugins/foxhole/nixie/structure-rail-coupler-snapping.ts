import {
    DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
} from './structure-socket-snapping.ts';
import type { FoxholeSocketSnapMatch, FoxholeSocketSnapPoint } from './structure-socket-snapping.ts';
import { areFoxholeRailCouplerNamesCompatible } from './structure-socket-resolution.ts';

function normalizeAngleRadians(radians: number): number {
    let value = radians;
    while (value <= -Math.PI) {
        value += Math.PI * 2;
    }
    while (value > Math.PI) {
        value -= Math.PI * 2;
    }
    return value;
}

function rotateWorldPointAroundPivot(
    point: { x: number; y: number; },
    pivot: { x: number; y: number; },
    radians: number,
): { x: number; y: number; } {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return {
        x: pivot.x + (dx * cos) - (dy * sin),
        y: pivot.y + (dx * sin) + (dy * cos),
    };
}

export interface FindBestFoxholeRailCouplerSnapOptions {
    movingSockets: readonly FoxholeSocketSnapPoint[];
    targetSockets: readonly FoxholeSocketSnapPoint[];
    rotatePivot?: { x: number; y: number; } | null;
    moveX: number;
    moveY: number;
    maxDistance?: number;
    maxRotationDeltaRadians?: number;
    pointerWorld?: { x: number; y: number; } | null;
    pointerSocketRadius?: number;
    isTargetSocketAvailable?: (movingSocket: FoxholeSocketSnapPoint, targetSocket: FoxholeSocketSnapPoint) => boolean;
}

/**
 * Translation + facing snap for train couplers. Only FrontCoupler ↔ RearCoupler.
 */
export function findBestFoxholeRailCouplerSnap(
    options: FindBestFoxholeRailCouplerSnapOptions,
): FoxholeSocketSnapMatch | null {
    const maxDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, Number(options.maxDistance))
        : DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE;
    const maxRotationDeltaRadians = Number.isFinite(options.maxRotationDeltaRadians)
        ? Math.max(0, Number(options.maxRotationDeltaRadians))
        : Number.POSITIVE_INFINITY;
    const pointerSocketRadius = Number.isFinite(options.pointerSocketRadius)
        ? Math.max(0, Number(options.pointerSocketRadius))
        : 0;

    let bestMatch: FoxholeSocketSnapMatch | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const movingSocket of options.movingSockets) {
        const movedX = movingSocket.x + options.moveX;
        const movedY = movingSocket.y + options.moveY;
        const pointerDistance = options.pointerWorld
            ? Math.hypot(options.pointerWorld.x - movedX, options.pointerWorld.y - movedY)
            : Number.POSITIVE_INFINITY;
        const pointerTargetsSocket = pointerSocketRadius > 0 && pointerDistance <= pointerSocketRadius;

        for (const targetSocket of options.targetSockets) {
            if (movingSocket.nodeId === targetSocket.nodeId) {
                continue;
            }
            if (!areFoxholeRailCouplerNamesCompatible(movingSocket.socketName, targetSocket.socketName)) {
                continue;
            }
            if (options.isTargetSocketAvailable && !options.isTargetSocketAvailable(movingSocket, targetSocket)) {
                continue;
            }

            // Couplers face opposite directions when coupled.
            const rotationDelta = normalizeAngleRadians(targetSocket.rotation - movingSocket.rotation - Math.PI);
            if (!pointerTargetsSocket && Math.abs(rotationDelta) > maxRotationDeltaRadians) {
                continue;
            }

            const rotatedMovingPoint = options.rotatePivot
                ? rotateWorldPointAroundPivot({ x: movingSocket.x, y: movingSocket.y }, options.rotatePivot, rotationDelta)
                : { x: movingSocket.x, y: movingSocket.y };

            const visibleDistance = Math.hypot(targetSocket.x - movedX, targetSocket.y - movedY);
            const dx = targetSocket.x - (rotatedMovingPoint.x + options.moveX);
            const dy = targetSocket.y - (rotatedMovingPoint.y + options.moveY);
            const distance = Math.hypot(dx, dy);
            if (visibleDistance > maxDistance && distance > maxDistance) {
                continue;
            }

            const rotationScore = pointerTargetsSocket
                ? 0
                : (Math.abs(rotationDelta) * (maxDistance / Math.PI));
            const pointerBias = pointerTargetsSocket && pointerSocketRadius > 0
                ? ((pointerSocketRadius - pointerDistance) / pointerSocketRadius) * (maxDistance + 1)
                : 0;
            const score = distance + rotationScore - pointerBias;
            if (score >= bestScore) {
                continue;
            }

            bestScore = score;
            bestMatch = {
                movingNodeId: movingSocket.nodeId,
                movingSocketName: movingSocket.socketName,
                targetNodeId: targetSocket.nodeId,
                targetSocketName: targetSocket.socketName,
                moveX: options.moveX + dx,
                moveY: options.moveY + dy,
                rotationDelta,
                distance,
                tagOverlap: 1,
            };
        }
    }

    return bestMatch;
}
