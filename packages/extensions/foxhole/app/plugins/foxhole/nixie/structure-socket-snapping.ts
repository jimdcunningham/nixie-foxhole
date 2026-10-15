import type { FoxholeManifestSocketTag } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import {
    areFoxholeRailCouplerNamesCompatible,
    isFoxholeRailCouplerSocket,
} from './structure-socket-resolution.ts';

export const FOXHOLE_SOCKET_SNAPPING_SETTING_ID = 'foxhole.viewport.socketSnapping';
export const DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE = 20;
export const DEFAULT_FOXHOLE_SOCKET_ROTATION_SNAP_DEGREES = 8;
export const DEFAULT_FOXHOLE_SOCKET_ALIGNMENT_DISTANCE = 1;
export const DEFAULT_FOXHOLE_SOCKET_ALIGNMENT_ROTATION_DEGREES = 1;
/** Connect distance for Front↔Rear when trains are posed on rails (board px). */
export const DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE = 32;
/** Keep distance once coupled this drag — slightly looser than connect. */
export const DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE = 48;
/** Facing leeway for articulated rail couplers on curved track (degrees). */
export const DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES = 30;

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

const FOXHOLE_FOUNDATION_SOCKET_MASK = BigInt(8);
const FOXHOLE_POWER_SOCKET_MASK = BigInt(131072);
const FOXHOLE_LIQUID_PIPE_NETWORK_SOCKET_CATEGORY = BigInt(2048);
const FOXHOLE_LIQUID_PIPE_NETWORK_SOCKET_MASK = BigInt(16795648);
const FOXHOLE_LIQUID_PIPE_BRANCH_SOCKET_MASK = BigInt(16779264);
const FOXHOLE_LIQUID_FACILITY_SOCKET_CATEGORY = BigInt(16384);
const FOXHOLE_LIQUID_FACILITY_INPUT_SOCKET_MASK = BigInt(2048);
const FOXHOLE_LIQUID_PIPE_VALVE_SOCKET_CATEGORY = BigInt(16777216);
const FOXHOLE_LIQUID_PIPE_VALVE_SOCKET_MASK = BigInt(18432);

export interface FoxholeSocketTagBitfield {
    mask: bigint;
    category: bigint;
}

export interface FoxholeSocketSnapPoint {
    nodeId: string;
    socketName: string;
    x: number;
    y: number;
    rotation: number;
    socketTags: readonly FoxholeSocketTagBitfield[];
}

export interface FoxholeSocketSnapMatch {
    movingNodeId: string;
    movingSocketName: string;
    targetNodeId: string;
    targetSocketName: string;
    moveX: number;
    moveY: number;
    rotationDelta: number;
    distance: number;
    tagOverlap: number;
}

export interface FindBestFoxholeSocketSnapOptions {
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

export interface FindAlignedFoxholeSocketMatchesOptions {
    movingSockets: readonly FoxholeSocketSnapPoint[];
    targetSockets: readonly FoxholeSocketSnapPoint[];
    maxDistance?: number;
    maxRotationErrorRadians?: number;
    /** Overrides maxDistance for Front↔Rear rail coupler pairs. */
    railCouplerMaxDistance?: number;
    /** Keep-distance for coupler pairs that are already attached (hysteresis). */
    railCouplerKeepDistance?: number;
    /** Overrides maxRotationErrorRadians for rail coupler pairs. */
    railCouplerMaxRotationErrorRadians?: number;
    isTargetSocketAvailable?: (movingSocket: FoxholeSocketSnapPoint, targetSocket: FoxholeSocketSnapPoint) => boolean;
    /** True when this moving/target coupler pair is already linked (enables keep distance). */
    isRailCouplerPairAttached?: (
        movingSocket: FoxholeSocketSnapPoint,
        targetSocket: FoxholeSocketSnapPoint,
    ) => boolean;
    /** When false, skip creating new rail coupler attachments (existing pairs can still keep). */
    allowNewRailCouplerAttachments?: boolean;
}

export interface CollectFoxholeLivePreviewTargetNodeIdsOptions {
    nearbyTargetNodeIds: Iterable<string>;
    previouslyTouchedTargetNodeIds: Iterable<string>;
    occupancyAttachmentsByNode: ReadonlyMap<string, Readonly<Record<string, { nodeId?: string | null; }>>>;
    selectedNodeIds: ReadonlySet<string>;
}

/**
 * Collect every stationary node whose attachment preview may need updating.
 *
 * Live drag previews intentionally reuse the drag-start occupancy cache. Targets
 * attached on an earlier pointer frame therefore need to be carried forward
 * explicitly so a later frame can restore them when the pointer moves away.
 */
export function collectFoxholeLivePreviewTargetNodeIds(
    options: CollectFoxholeLivePreviewTargetNodeIdsOptions,
): Set<string> {
    const targetNodeIds = new Set<string>();
    for (const candidateId of [
        ...options.nearbyTargetNodeIds,
        ...options.previouslyTouchedTargetNodeIds,
    ]) {
        const nodeId = String(candidateId ?? '').trim();
        if (nodeId && !options.selectedNodeIds.has(nodeId)) {
            targetNodeIds.add(nodeId);
        }
    }

    // Partners linked at drag start must also be cleared even when they are no
    // longer close enough to appear in the spatial query.
    for (const [candidateNodeId, attachments] of options.occupancyAttachmentsByNode) {
        const nodeId = String(candidateNodeId ?? '').trim();
        if (!nodeId || targetNodeIds.has(nodeId) || options.selectedNodeIds.has(nodeId)) {
            continue;
        }
        if (Object.values(attachments).some(attachment => (
            options.selectedNodeIds.has(String(attachment.nodeId ?? '').trim())
        ))) {
            targetNodeIds.add(nodeId);
        }
    }

    return targetNodeIds;
}

function toSocketTagBigInt(value: number | null | undefined): bigint {
    const normalized = Number(value ?? NaN);
    if (!Number.isFinite(normalized)) {
        return BIGINT_ZERO;
    }

    return BigInt(Math.max(0, Math.trunc(normalized)));
}

function isRelevantFoxholeSnapSocketTag(socketTag: FoxholeSocketTagBitfield): boolean {
    return socketTag.mask !== BIGINT_ZERO
        && socketTag.category !== BIGINT_ZERO
        && (socketTag.mask & ~FOXHOLE_FOUNDATION_SOCKET_MASK) !== BIGINT_ZERO;
}

function getRelevantFoxholeSnapTags(socketTags: readonly FoxholeSocketTagBitfield[]): FoxholeSocketTagBitfield[] {
    return socketTags.flatMap(socketTag => {
        if (!isRelevantFoxholeSnapSocketTag(socketTag)) {
            return [];
        }

        return [{
            mask: socketTag.mask & ~FOXHOLE_FOUNDATION_SOCKET_MASK,
            category: socketTag.category,
        } satisfies FoxholeSocketTagBitfield];
    });
}

function countSetBits(value: bigint): number {
    let remaining = value;
    let count = 0;
    while (remaining > BIGINT_ZERO) {
        remaining &= remaining - BIGINT_ONE;
        count += 1;
    }
    return count;
}

export function normalizeFoxholeSocketTags(socketTags: readonly FoxholeManifestSocketTag[] | null | undefined): FoxholeSocketTagBitfield[] {
    if (!socketTags?.length) {
        return [];
    }

    return socketTags.flatMap(socketTag => {
        const mask = toSocketTagBigInt(socketTag.mask);
        const category = toSocketTagBigInt(socketTag.category);
        if (mask === BIGINT_ZERO || category === BIGINT_ZERO) {
            return [];
        }

        return [{ mask, category } satisfies FoxholeSocketTagBitfield];
    });
}

export function hasFoxholeSnapSocketTags(socketTags: readonly FoxholeSocketTagBitfield[]): boolean {
    return getRelevantFoxholeSnapTags(socketTags).length > 0;
}

export function getSharedFoxholeSnapSocketTagCount(
    leftSocketTags: readonly FoxholeSocketTagBitfield[],
    rightSocketTags: readonly FoxholeSocketTagBitfield[],
): number {
    const leftRelevantSocketTags = getRelevantFoxholeSnapTags(leftSocketTags);
    const rightRelevantSocketTags = getRelevantFoxholeSnapTags(rightSocketTags);
    let sharedCount = 0;

    for (const leftSocketTag of leftRelevantSocketTags) {
        for (const rightSocketTag of rightRelevantSocketTags) {
            let overlap = BIGINT_ZERO;
            if ((leftSocketTag.category & rightSocketTag.category) !== BIGINT_ZERO) {
                overlap |= leftSocketTag.mask & rightSocketTag.mask;
            }

            overlap |= leftSocketTag.mask & rightSocketTag.category;
            overlap |= rightSocketTag.mask & leftSocketTag.category;
            sharedCount += countSetBits(overlap);
        }
    }

    return sharedCount;
}

export function hasFoxholePowerSocketTag(socketTags: readonly FoxholeSocketTagBitfield[]): boolean {
    return socketTags.some(socketTag => (socketTag.mask & FOXHOLE_POWER_SOCKET_MASK) !== BIGINT_ZERO);
}

function isFoxholeLiquidPipeSocketTag(socketTag: FoxholeSocketTagBitfield): boolean {
    if (socketTag.category === FOXHOLE_LIQUID_PIPE_NETWORK_SOCKET_CATEGORY) {
        return socketTag.mask === FOXHOLE_LIQUID_PIPE_NETWORK_SOCKET_MASK
            || socketTag.mask === FOXHOLE_LIQUID_PIPE_BRANCH_SOCKET_MASK;
    }

    if (socketTag.category === FOXHOLE_LIQUID_FACILITY_SOCKET_CATEGORY) {
        return socketTag.mask === FOXHOLE_LIQUID_FACILITY_INPUT_SOCKET_MASK
            || socketTag.mask === FOXHOLE_LIQUID_PIPE_BRANCH_SOCKET_MASK;
    }

    if (socketTag.category === FOXHOLE_LIQUID_PIPE_VALVE_SOCKET_CATEGORY) {
        return socketTag.mask === FOXHOLE_LIQUID_PIPE_VALVE_SOCKET_MASK;
    }

    return false;
}

export function hasFoxholeLiquidPipeSocketTag(socketTags: readonly FoxholeSocketTagBitfield[]): boolean {
    return socketTags.some(isFoxholeLiquidPipeSocketTag);
}

export function areFoxholeSnapSocketsCompatible(left: Pick<FoxholeSocketSnapPoint, 'socketName' | 'socketTags'>, right: Pick<FoxholeSocketSnapPoint, 'socketName' | 'socketTags'>): boolean {
    if (areFoxholeRailCouplerNamesCompatible(left.socketName, right.socketName)) {
        return true;
    }

    return hasFoxholeSnapSocketTags(left.socketTags)
        && hasFoxholeSnapSocketTags(right.socketTags)
        && getSharedFoxholeSnapSocketTagCount(left.socketTags, right.socketTags) > 0;
}

export function normalizeAngleRadians(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    let normalized = value % (Math.PI * 2);
    if (normalized <= -Math.PI) {
        normalized += Math.PI * 2;
    } else if (normalized > Math.PI) {
        normalized -= Math.PI * 2;
    }
    return normalized;
}

/** Pick the 2π-equivalent of `value` closest to `reference` (avoids ±π flicker). */
export function unwrapAngleNearReference(value: number, reference: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) {
        return value;
    }

    let best = value;
    for (let turns = -2; turns <= 2; turns += 1) {
        const candidate = value + (turns * Math.PI * 2);
        if (Math.abs(candidate - reference) < Math.abs(best - reference)) {
            best = candidate;
        }
    }
    return best;
}

export function rotateWorldPointAroundPivot(point: { x: number; y: number; }, pivot: { x: number; y: number; }, rotationDelta: number): { x: number; y: number; } {
    const offsetX = point.x - pivot.x;
    const offsetY = point.y - pivot.y;
    const cosine = Math.cos(rotationDelta);
    const sine = Math.sin(rotationDelta);
    return {
        x: pivot.x + (offsetX * cosine) - (offsetY * sine),
        y: pivot.y + (offsetX * sine) + (offsetY * cosine),
    };
}

export function getFoxholeSocketFacingErrorRadians(movingRotation: number, targetRotation: number): number {
    return Math.abs(normalizeAngleRadians((movingRotation + Math.PI) - targetRotation));
}

export function findAlignedFoxholeSocketMatches(options: FindAlignedFoxholeSocketMatchesOptions): FoxholeSocketSnapMatch[] {
    const maxDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, Number(options.maxDistance))
        : DEFAULT_FOXHOLE_SOCKET_ALIGNMENT_DISTANCE;
    const maxRotationErrorRadians = Number.isFinite(options.maxRotationErrorRadians)
        ? Math.max(0, Number(options.maxRotationErrorRadians))
        : (DEFAULT_FOXHOLE_SOCKET_ALIGNMENT_ROTATION_DEGREES * Math.PI) / 180;
    const railCouplerMaxDistance = Number.isFinite(options.railCouplerMaxDistance)
        ? Math.max(0, Number(options.railCouplerMaxDistance))
        : DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE;
    const railCouplerKeepDistance = Number.isFinite(options.railCouplerKeepDistance)
        ? Math.max(railCouplerMaxDistance, Number(options.railCouplerKeepDistance))
        : Math.max(railCouplerMaxDistance, DEFAULT_FOXHOLE_RAIL_COUPLER_KEEP_DISTANCE);
    const railCouplerMaxRotationErrorRadians = Number.isFinite(options.railCouplerMaxRotationErrorRadians)
        ? Math.max(0, Number(options.railCouplerMaxRotationErrorRadians))
        : (DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES * Math.PI) / 180;
    const allowNewRailCouplerAttachments = options.allowNewRailCouplerAttachments !== false;

    const candidates: FoxholeSocketSnapMatch[] = [];
    for (const movingSocket of options.movingSockets) {
        const movingIsRailCoupler = isFoxholeRailCouplerSocket({ name: movingSocket.socketName });
        if (
            !movingIsRailCoupler
            && !hasFoxholeSnapSocketTags(movingSocket.socketTags)
        ) {
            continue;
        }

        for (const targetSocket of options.targetSockets) {
            if (movingSocket.nodeId === targetSocket.nodeId) {
                continue;
            }
            if (!areFoxholeSnapSocketsCompatible(movingSocket, targetSocket)) {
                continue;
            }
            if (options.isTargetSocketAvailable && !options.isTargetSocketAvailable(movingSocket, targetSocket)) {
                continue;
            }

            const pairIsRailCoupler = movingIsRailCoupler
                && isFoxholeRailCouplerSocket({ name: targetSocket.socketName });
            const alreadyAttached = pairIsRailCoupler
                && options.isRailCouplerPairAttached?.(movingSocket, targetSocket) === true;
            if (pairIsRailCoupler && !alreadyAttached && !allowNewRailCouplerAttachments) {
                continue;
            }

            const distance = Math.hypot(targetSocket.x - movingSocket.x, targetSocket.y - movingSocket.y);
            const pairMaxDistance = pairIsRailCoupler
                ? (alreadyAttached ? railCouplerKeepDistance : railCouplerMaxDistance)
                : maxDistance;
            if (distance > pairMaxDistance) {
                continue;
            }

            const rotationError = getFoxholeSocketFacingErrorRadians(movingSocket.rotation, targetSocket.rotation);
            const pairMaxRotationError = pairIsRailCoupler
                ? railCouplerMaxRotationErrorRadians
                : maxRotationErrorRadians;
            if (rotationError > pairMaxRotationError) {
                continue;
            }

            candidates.push({
                movingNodeId: movingSocket.nodeId,
                movingSocketName: movingSocket.socketName,
                targetNodeId: targetSocket.nodeId,
                targetSocketName: targetSocket.socketName,
                moveX: 0,
                moveY: 0,
                rotationDelta: 0,
                distance,
                tagOverlap: getSharedFoxholeSnapSocketTagCount(movingSocket.socketTags, targetSocket.socketTags),
            });
        }
    }

    candidates.sort((left, right) => {
        const score = (value: FoxholeSocketSnapMatch) => value.distance - (value.tagOverlap * 0.01);
        return score(left) - score(right);
    });

    const usedMovingSockets = new Set<string>();
    const usedTargetSockets = new Set<string>();
    const matches: FoxholeSocketSnapMatch[] = [];
    for (const candidate of candidates) {
        const movingKey = `${candidate.movingNodeId}:${candidate.movingSocketName}`;
        const targetKey = `${candidate.targetNodeId}:${candidate.targetSocketName}`;
        if (usedMovingSockets.has(movingKey) || usedTargetSockets.has(targetKey)) {
            continue;
        }

        usedMovingSockets.add(movingKey);
        usedTargetSockets.add(targetKey);
        matches.push(candidate);
    }

    return matches;
}

export function findBestFoxholeSocketSnap(options: FindBestFoxholeSocketSnapOptions): FoxholeSocketSnapMatch | null {
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
        if (
            !isFoxholeRailCouplerSocket({ name: movingSocket.socketName })
            && !hasFoxholeSnapSocketTags(movingSocket.socketTags)
        ) {
            continue;
        }

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
            if (!areFoxholeSnapSocketsCompatible(movingSocket, targetSocket)) {
                continue;
            }
            if (options.isTargetSocketAvailable && !options.isTargetSocketAvailable(movingSocket, targetSocket)) {
                continue;
            }

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

            const tagOverlap = getSharedFoxholeSnapSocketTagCount(movingSocket.socketTags, targetSocket.socketTags);
            const rotationScore = pointerTargetsSocket
                ? 0
                : (Math.abs(rotationDelta) * (maxDistance / Math.PI));
            const pointerBias = pointerTargetsSocket && pointerSocketRadius > 0
                ? ((pointerSocketRadius - pointerDistance) / pointerSocketRadius) * (maxDistance + 1)
                : 0;
            const score = distance + rotationScore - (tagOverlap * 0.01) - pointerBias;
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
                tagOverlap,
            };
        }
    }

    return bestMatch;
}
