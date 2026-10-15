import {
    buildArcLengthTable,
    nearestPointOnSegment,
    nearestPointOnSplinePath,
    samplePointAlongSplinePath,
} from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import type { FoxholeRailTrackGauge } from './spline-connector.ts';
import {
    DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE,
    DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES,
    DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
    normalizeAngleRadians,
} from './structure-socket-snapping.ts';
import { areFoxholeRailCouplerNamesCompatible } from './structure-socket-resolution.ts';

export const FOXHOLE_STRUCTURE_RAIL_TRACK_SNAP_RESULT_KIND = 'foxhole:structure-rail-track-snap';
export const FOXHOLE_STRUCTURE_RAIL_COUPLER_DOCK_SNAP_RESULT_KIND = 'foxhole:structure-rail-coupler-dock-snap';
/** Easy-to-hit rail distance around an open stationary coupler (board px). */
export const DEFAULT_FOXHOLE_RAIL_COUPLER_DOCK_CAPTURE_DISTANCE = 128;

export interface FoxholeRailTrackPathPoint {
    x: number;
    y: number;
}

export interface FoxholeRailTrackPath {
    nodeId: string;
    points: readonly FoxholeRailTrackPathPoint[];
    trackGauge?: FoxholeRailTrackGauge | null;
}

export interface FoxholeRailTrackSnapMatch {
    movingNodeId: string;
    targetNodeId: string;
    moveX: number;
    moveY: number;
    rotationDelta: number;
    distance: number;
}

export interface FoxholeLocalRailCouplerPoint {
    localX: number;
    localY: number;
    rotationRadians: number;
}

/** Point a coupler docking zone away from the vehicle along its front/rear axis. */
export function resolveFoxholeRailCouplerDockZoneRotation(
    socket: FoxholeLocalRailCouplerPoint,
    couplerSockets: readonly FoxholeLocalRailCouplerPoint[],
): number {
    let farthestSocket: FoxholeLocalRailCouplerPoint | null = null;
    let farthestDistanceSquared = 0;
    for (const candidate of couplerSockets) {
        if (candidate === socket) {
            continue;
        }
        const deltaX = socket.localX - candidate.localX;
        const deltaY = socket.localY - candidate.localY;
        const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
        if (distanceSquared > farthestDistanceSquared) {
            farthestSocket = candidate;
            farthestDistanceSquared = distanceSquared;
        }
    }

    if (farthestSocket && farthestDistanceSquared > 0.0001) {
        return Math.atan2(
            socket.localY - farthestSocket.localY,
            socket.localX - farthestSocket.localX,
        );
    }

    const radialDistanceSquared = (socket.localX * socket.localX) + (socket.localY * socket.localY);
    return radialDistanceSquared > 0.0001
        ? Math.atan2(socket.localY, socket.localX)
        : socket.rotationRadians;
}

export interface FindBestFoxholeRailTrackSnapOptions {
    movingNodeId: string;
    /** Train origin at drag-start pose (before moveX/moveY). */
    movingOrigin: { x: number; y: number; };
    /** Train rotation at drag-start pose (radians). */
    movingRotation: number;
    /** Distance between rail contacts in board-world pixels. */
    wheelBase?: number | null;
    trackGauge?: FoxholeRailTrackGauge | null;
    tracks: readonly FoxholeRailTrackPath[];
    moveX: number;
    moveY: number;
    maxDistance?: number;
    pointerWorld?: { x: number; y: number; } | null;
    /** Pointer-to-rail distance that counts as explicit track snap intent. */
    pointerBiasRadius?: number;
}

export interface FoxholeRailCouplerDockSnapMatch extends FoxholeRailTrackSnapMatch {
    movingSocketName: string;
    targetSocketName: string;
    couplerDistance: number;
}

export interface FoxholeRailCouplerSocketPoint extends FoxholeRailTrackPathPoint {
    nodeId: string;
    socketName: string;
    rotation: number;
    socketTags: readonly { mask: bigint; category: bigint; }[];
}

export interface FindBestFoxholeRailCouplerDockSnapOptions extends FindBestFoxholeRailTrackSnapOptions {
    movingSockets: readonly FoxholeRailCouplerSocketPoint[];
    targetSockets: readonly FoxholeRailCouplerSocketPoint[];
    captureDistance?: number;
    maxCouplerDistance?: number;
    maxCouplerRotationDeltaRadians?: number;
    isTargetSocketAvailable?: (
        movingSocket: FoxholeRailCouplerSocketPoint,
        targetSocket: FoxholeRailCouplerSocketPoint,
    ) => boolean;
}

/**
 * Snap a rail vehicle to a track. Vehicles with an authored wheelbase align two
 * rigid rail-contact anchors to the path; older manifests retain center/tangent
 * snapping as a fallback.
 */
export function findBestFoxholeRailTrackSnap(
    options: FindBestFoxholeRailTrackSnapOptions,
): FoxholeRailTrackSnapMatch | null {
    const maxDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, Number(options.maxDistance))
        : DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE;
    const pointerCaptureRadius = Number.isFinite(options.pointerBiasRadius)
        ? Math.max(0, Number(options.pointerBiasRadius))
        : maxDistance;
    const movedOriginX = options.movingOrigin.x + options.moveX;
    const movedOriginY = options.movingOrigin.y + options.moveY;
    const movedOrigin = { x: movedOriginX, y: movedOriginY };
    const movingRotation = Number(options.movingRotation);
    const wheelBase = Number(options.wheelBase ?? 0);
    const trackCandidates = wheelBase > 0
        ? buildConnectedRailTrackPathCandidates(options.tracks, wheelBase, options.trackGauge)
        : options.tracks;

    let best: FoxholeRailTrackSnapMatch | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestUsesPointerIntent = false;

    for (const track of trackCandidates) {
        if (track.points.length < 1) {
            continue;
        }
        if (options.trackGauge && track.trackGauge && options.trackGauge !== track.trackGauge) {
            continue;
        }

        const nearest = nearestPointOnSplinePath(movedOrigin, track.points);
        const nearestToPointer = options.pointerWorld && pointerCaptureRadius > 0
            ? nearestPointOnSplinePath(options.pointerWorld, track.points)
            : null;
        const usesPointerIntent = nearestToPointer !== null
            && nearestToPointer.distance <= pointerCaptureRadius;
        if (!(nearest.distance <= maxDistance) && !usesPointerIntent) {
            continue;
        }

        const twoContactPose = wheelBase > 0
            ? resolveTwoContactRailPose(track.points, movedOrigin, movingRotation, wheelBase)
            : null;
        if (wheelBase > 0 && !twoContactPose) {
            continue;
        }
        const snappedOrigin = twoContactPose?.origin ?? nearest;
        const snappedRotation = twoContactPose?.rotation ?? nearest.tangent;
        const rotationDelta = resolveRailTrackFacingDelta(movingRotation, snappedRotation);
        const snapDistance = Math.hypot(
            movedOrigin.x - snappedOrigin.x,
            movedOrigin.y - snappedOrigin.y,
        );

        const rotationScore = Math.abs(rotationDelta) * (maxDistance / Math.PI);
        const score = usesPointerIntent
            ? (nearestToPointer.distance + (snapDistance * 0.1) + (rotationScore * 0.1))
            : (snapDistance + rotationScore);

        if (
            (!usesPointerIntent && bestUsesPointerIntent)
            || (usesPointerIntent === bestUsesPointerIntent && score >= bestScore)
        ) {
            continue;
        }

        bestScore = score;
        bestUsesPointerIntent = usesPointerIntent;
        best = {
            movingNodeId: options.movingNodeId,
            targetNodeId: track.nodeId,
            moveX: snappedOrigin.x - options.movingOrigin.x,
            moveY: snappedOrigin.y - options.movingOrigin.y,
            rotationDelta,
            distance: snapDistance,
        };
    }

    if (!best && wheelBase > 0) {
        return findBestFoxholeRailTrackSnap({
            ...options,
            wheelBase: null,
        });
    }

    return best;
}

/**
 * Find an exact coupler pose without taking either rail contact off the path.
 *
 * The search is centered around the car's current location on a connected rail
 * path. That creates a forgiving front/rear docking zone without allowing a car
 * to teleport to a distant coupler elsewhere on the same track network.
 */
export function findBestFoxholeRailCouplerDockSnap(
    options: FindBestFoxholeRailCouplerDockSnapOptions,
): FoxholeRailCouplerDockSnapMatch | null {
    const wheelBase = Number(options.wheelBase ?? 0);
    if (!(wheelBase > 0) || !options.movingSockets.length || !options.targetSockets.length) {
        return null;
    }

    const maxTrackDistance = Number.isFinite(options.maxDistance)
        ? Math.max(0, Number(options.maxDistance))
        : DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE;
    const captureDistance = Number.isFinite(options.captureDistance)
        ? Math.max(0, Number(options.captureDistance))
        : DEFAULT_FOXHOLE_RAIL_COUPLER_DOCK_CAPTURE_DISTANCE;
    const maxCouplerDistance = Number.isFinite(options.maxCouplerDistance)
        ? Math.max(0, Number(options.maxCouplerDistance))
        : DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_DISTANCE;
    const maxCouplerRotationDelta = Number.isFinite(options.maxCouplerRotationDeltaRadians)
        ? Math.max(0, Number(options.maxCouplerRotationDeltaRadians))
        : (DEFAULT_FOXHOLE_RAIL_COUPLER_ALIGNMENT_ROTATION_DEGREES * Math.PI) / 180;
    const movedOrigin = {
        x: options.movingOrigin.x + options.moveX,
        y: options.movingOrigin.y + options.moveY,
    };
    const localSockets = options.movingSockets.map(socket => ({
        socket,
        ...worldSocketToLocal(socket, options.movingOrigin, options.movingRotation),
    }));
    const trackCandidates = buildConnectedRailTrackPathCandidates(
        options.tracks,
        wheelBase,
        options.trackGauge,
    );

    let best: FoxholeRailCouplerDockSnapMatch | null = null;
    let bestCouplerDistance = Number.POSITIVE_INFINITY;
    let bestPoseDistance = Number.POSITIVE_INFINITY;
    let bestRotationDelta = Number.POSITIVE_INFINITY;

    for (const track of trackCandidates) {
        if (track.points.length < 2) {
            continue;
        }
        if (options.trackGauge && track.trackGauge && options.trackGauge !== track.trackGauge) {
            continue;
        }

        const nearestOrigin = nearestPointOnSplinePath(movedOrigin, track.points);
        if (nearestOrigin.distance > maxTrackDistance) {
            continue;
        }

        const lengths = buildArcLengthTable(track.points);
        const totalLength = lengths[lengths.length - 1] ?? 0;
        if (totalLength < wheelBase) {
            continue;
        }

        const nearestCenterDistance = nearestArcDistanceOnPath(movedOrigin, track.points, lengths);
        const searchStart = Math.max(0, nearestCenterDistance - captureDistance);
        const searchEnd = Math.min(totalLength, nearestCenterDistance + captureDistance);
        const centerDistances = new Set<number>([nearestCenterDistance, searchStart, searchEnd]);
        for (let distance = Math.ceil(searchStart); distance <= searchEnd; distance += 1) {
            centerDistances.add(distance);
        }

        for (const centerDistance of centerDistances) {
            const pose = resolveTwoContactRailPoseAtCenter(
                track.points,
                lengths,
                centerDistance,
                wheelBase,
            );
            if (!pose) {
                continue;
            }

            for (const vehicleRotation of [pose.rotation, normalizeAngleRadians(pose.rotation + Math.PI)]) {
                const rotationDelta = normalizeAngleRadians(vehicleRotation - options.movingRotation);
                const poseDistance = distanceBetween(movedOrigin, pose.origin);

                for (const moving of localSockets) {
                    const rawMovedSocket = {
                        x: moving.socket.x + options.moveX,
                        y: moving.socket.y + options.moveY,
                    };
                    const posedMovingSocket = localSocketToWorld(moving, pose.origin, vehicleRotation);
                    const posedMovingSocketRotation = normalizeAngleRadians(vehicleRotation + moving.localRotation);

                    for (const targetSocket of options.targetSockets) {
                        if (moving.socket.nodeId === targetSocket.nodeId) {
                            continue;
                        }
                        if (!areFoxholeRailCouplerNamesCompatible(moving.socket.socketName, targetSocket.socketName)) {
                            continue;
                        }
                        if (
                            options.isTargetSocketAvailable
                            && !options.isTargetSocketAvailable(moving.socket, targetSocket)
                        ) {
                            continue;
                        }
                        if (distanceBetween(rawMovedSocket, targetSocket) > captureDistance) {
                            continue;
                        }

                        const facingError = Math.abs(normalizeAngleRadians(
                            targetSocket.rotation - posedMovingSocketRotation - Math.PI,
                        ));
                        if (facingError > maxCouplerRotationDelta) {
                            continue;
                        }

                        const couplerDistance = distanceBetween(posedMovingSocket, targetSocket);
                        if (couplerDistance > maxCouplerDistance) {
                            continue;
                        }

                        const isBetter = couplerDistance < bestCouplerDistance - 1e-6
                            || (
                                Math.abs(couplerDistance - bestCouplerDistance) <= 1e-6
                                && (
                                    poseDistance < bestPoseDistance - 1e-6
                                    || (
                                        Math.abs(poseDistance - bestPoseDistance) <= 1e-6
                                        && Math.abs(rotationDelta) < bestRotationDelta
                                    )
                                )
                            );
                        if (!isBetter) {
                            continue;
                        }

                        bestCouplerDistance = couplerDistance;
                        bestPoseDistance = poseDistance;
                        bestRotationDelta = Math.abs(rotationDelta);
                        best = {
                            movingNodeId: options.movingNodeId,
                            movingSocketName: moving.socket.socketName,
                            targetNodeId: targetSocket.nodeId,
                            targetSocketName: targetSocket.socketName,
                            moveX: pose.origin.x - options.movingOrigin.x,
                            moveY: pose.origin.y - options.movingOrigin.y,
                            rotationDelta,
                            distance: poseDistance,
                            couplerDistance,
                        };
                    }
                }
            }
        }
    }

    return best;
}

interface FoxholeLocalRailCoupler {
    localX: number;
    localY: number;
    localRotation: number;
}

function worldSocketToLocal(
    socket: FoxholeRailCouplerSocketPoint,
    origin: FoxholeRailTrackPathPoint,
    rotation: number,
): FoxholeLocalRailCoupler {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = socket.x - origin.x;
    const dy = socket.y - origin.y;
    return {
        localX: (dx * cos) + (dy * sin),
        localY: (-dx * sin) + (dy * cos),
        localRotation: normalizeAngleRadians(socket.rotation - rotation),
    };
}

function localSocketToWorld(
    socket: FoxholeLocalRailCoupler,
    origin: FoxholeRailTrackPathPoint,
    rotation: number,
): FoxholeRailTrackPathPoint {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
        x: origin.x + (socket.localX * cos) - (socket.localY * sin),
        y: origin.y + (socket.localX * sin) + (socket.localY * cos),
    };
}

function buildConnectedRailTrackPathCandidates(
    tracks: readonly FoxholeRailTrackPath[],
    wheelBase: number,
    movingGauge?: FoxholeRailTrackGauge | null,
): FoxholeRailTrackPath[] {
    const compatibleTracks = tracks.filter(track => (
        !movingGauge || !track.trackGauge || movingGauge === track.trackGauge
    ) && track.points.length > 0);
    const candidates: FoxholeRailTrackPath[] = [];
    const seen = new Set<string>();
    const maxDepth = 6;
    const maxPathLength = Math.max(wheelBase * 2, wheelBase + 64);

    const appendCandidate = (
        points: readonly FoxholeRailTrackPathPoint[],
        nodeIds: readonly string[],
        trackGauge: FoxholeRailTrackGauge | null | undefined,
    ) => {
        const key = nodeIds.join('>');
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push({
            nodeId: nodeIds[0] ?? '',
            points,
            trackGauge,
        });
    };

    const extend = (
        points: readonly FoxholeRailTrackPathPoint[],
        nodeIds: readonly string[],
        trackGauge: FoxholeRailTrackGauge | null | undefined,
        depth: number,
    ) => {
        appendCandidate(points, nodeIds, trackGauge);
        const pathLength = buildArcLengthTable(points).at(-1) ?? 0;
        if (depth >= maxDepth || (depth > 0 && pathLength >= maxPathLength)) {
            return;
        }

        const end = points.at(-1);
        if (!end) {
            return;
        }

        for (const neighbor of compatibleTracks) {
            if (nodeIds.includes(neighbor.nodeId) || neighbor.points.length < 1) {
                continue;
            }
            if (trackGauge && neighbor.trackGauge && trackGauge !== neighbor.trackGauge) {
                continue;
            }

            const neighborStart = neighbor.points[0]!;
            const neighborEnd = neighbor.points.at(-1)!;
            let orientedNeighbor: readonly FoxholeRailTrackPathPoint[] | null = null;
            if (distanceBetween(end, neighborStart) <= 2) {
                orientedNeighbor = neighbor.points;
            } else if (distanceBetween(end, neighborEnd) <= 2) {
                orientedNeighbor = [...neighbor.points].reverse();
            }
            if (!orientedNeighbor) {
                continue;
            }

            extend(
                [...points, ...orientedNeighbor.slice(1)],
                [...nodeIds, neighbor.nodeId],
                trackGauge ?? neighbor.trackGauge,
                depth + 1,
            );
        }
    };

    for (const track of compatibleTracks) {
        extend(track.points, [track.nodeId], track.trackGauge, 0);
        if (track.points.length > 1) {
            extend([...track.points].reverse(), [track.nodeId], track.trackGauge, 0);
        }
    }

    return candidates;
}

interface FoxholeTwoContactRailPose {
    origin: FoxholeRailTrackPathPoint;
    rotation: number;
}

function resolveTwoContactRailPose(
    points: readonly FoxholeRailTrackPathPoint[],
    movedOrigin: FoxholeRailTrackPathPoint,
    movingRotation: number,
    wheelBase: number,
): FoxholeTwoContactRailPose | null {
    if (points.length < 2 || !(wheelBase > 0)) {
        return null;
    }

    const lengths = buildArcLengthTable(points);
    const totalLength = lengths[lengths.length - 1] ?? 0;
    if (!(totalLength >= wheelBase)) {
        return null;
    }

    const nearestDistance = nearestArcDistanceOnPath(movedOrigin, points, lengths);
    const searchStep = Math.max(2, Math.min(wheelBase / 8, totalLength / 64));
    const centerDistances = new Set<number>([nearestDistance, totalLength / 2]);
    for (let distance = 0; distance <= totalLength; distance += searchStep) {
        centerDistances.add(Math.min(totalLength, distance));
    }

    let best: FoxholeTwoContactRailPose | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const centerDistance of centerDistances) {
        const pose = resolveTwoContactRailPoseAtCenter(points, lengths, centerDistance, wheelBase);
        if (!pose) {
            continue;
        }

        const rotationDelta = resolveRailTrackFacingDelta(movingRotation, pose.rotation);
        const score = Math.hypot(
            movedOrigin.x - pose.origin.x,
            movedOrigin.y - pose.origin.y,
        ) + (Math.abs(rotationDelta) * 0.001);
        if (score < bestScore) {
            bestScore = score;
            best = pose;
        }
    }

    return best;
}

function resolveTwoContactRailPoseAtCenter(
    points: readonly FoxholeRailTrackPathPoint[],
    lengths: readonly number[],
    centerDistance: number,
    wheelBase: number,
): FoxholeTwoContactRailPose | null {
    const totalLength = lengths[lengths.length - 1] ?? 0;
    const maxHalfSpan = Math.min(centerDistance, totalLength - centerDistance);
    if (!(maxHalfSpan > 0)) {
        return null;
    }

    const maxRear = samplePointAlongSplinePath(points, lengths, centerDistance - maxHalfSpan);
    const maxFront = samplePointAlongSplinePath(points, lengths, centerDistance + maxHalfSpan);
    if (!maxRear || !maxFront || distanceBetween(maxRear, maxFront) + 1e-6 < wheelBase) {
        return null;
    }

    let low = 0;
    let high = maxHalfSpan;
    for (let iteration = 0; iteration < 32; iteration += 1) {
        const halfSpan = (low + high) / 2;
        const rear = samplePointAlongSplinePath(points, lengths, centerDistance - halfSpan);
        const front = samplePointAlongSplinePath(points, lengths, centerDistance + halfSpan);
        if (!rear || !front) {
            return null;
        }

        if (distanceBetween(rear, front) < wheelBase) {
            low = halfSpan;
        } else {
            high = halfSpan;
        }
    }

    const rear = samplePointAlongSplinePath(points, lengths, centerDistance - high);
    const front = samplePointAlongSplinePath(points, lengths, centerDistance + high);
    if (!rear || !front) {
        return null;
    }

    return {
        origin: {
            x: (rear.x + front.x) / 2,
            y: (rear.y + front.y) / 2,
        },
        rotation: Math.atan2(front.y - rear.y, front.x - rear.x),
    };
}

function nearestArcDistanceOnPath(
    point: FoxholeRailTrackPathPoint,
    points: readonly FoxholeRailTrackPathPoint[],
    lengths: readonly number[],
): number {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestArcDistance = 0;
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]!;
        const end = points[index]!;
        const nearest = nearestPointOnSegment(point, start, end);
        if (nearest.distance >= bestDistance) {
            continue;
        }

        bestDistance = nearest.distance;
        const segmentLength = (lengths[index] ?? 0) - (lengths[index - 1] ?? 0);
        bestArcDistance = (lengths[index - 1] ?? 0) + (segmentLength * nearest.t);
    }
    return bestArcDistance;
}

function distanceBetween(left: FoxholeRailTrackPathPoint, right: FoxholeRailTrackPathPoint): number {
    return Math.hypot(right.x - left.x, right.y - left.y);
}

function resolveRailTrackFacingDelta(movingRotation: number, trackTangent: number): number {
    const alignWithTangent = normalizeAngleRadians(trackTangent - movingRotation);
    const alignOpposite = normalizeAngleRadians(trackTangent + Math.PI - movingRotation);
    return Math.abs(alignWithTangent) <= Math.abs(alignOpposite)
        ? alignWithTangent
        : alignOpposite;
}
