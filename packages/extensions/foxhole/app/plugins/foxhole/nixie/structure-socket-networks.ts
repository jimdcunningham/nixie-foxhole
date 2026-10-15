/**
 * Connected-component networks over structure socketAttachments.
 * Modes filter which nodes are members and which occupied sockets count as edges.
 */

import type { FoxholeManifestBuildSocket } from './manifest.ts';
import {
    hasFoxholeLiquidPipeSocketTag,
    hasFoxholePowerSocketTag,
    normalizeFoxholeSocketTags,
} from './structure-socket-snapping.ts';
import { normalizeFoxholeBuildSocketName } from './structure-socket-resolution.ts';
import type { FoxholeStructureSocketAttachmentMap } from './types.ts';

const FORT_SOCKET_CONNECTION_CATEGORY = BigInt(4);
const FOXHOLE_FOUNDATION_SOCKET_MASK = BigInt(8);
const TRENCH_SOCKET_CONNECTION_CATEGORIES = new Set([BigInt(2), BigInt(64)]);

export type FoxholeSocketNetworkMode = 'bunker' | 'roof-hover' | 'trench' | 'power' | 'pipe' | 'all';

export interface FoxholeSocketNetworkSceneNode {
    nodeId: string;
    foxholeKey: string;
    buildSockets: readonly FoxholeManifestBuildSocket[];
    socketAttachments: FoxholeStructureSocketAttachmentMap;
    /** Optional catalog signals used by membership predicates. */
    profileType?: string | null;
    structuralIntegrity?: number | null;
    isBunker?: boolean | null;
    isFacility?: boolean | null;
    isDestroyed?: boolean | null;
    isBreached?: boolean | null;
    codeName?: string | null;
}

export interface FoxholeSocketNetworkUnion {
    unionId: string;
    memberNodeIds: string[];
}

export interface FoxholeSocketNetworkIndex {
    mode: FoxholeSocketNetworkMode;
    unions: FoxholeSocketNetworkUnion[];
    unionIdByNodeId: ReadonlyMap<string, string>;
}

function normalizeId(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeLookupKey(value: unknown): string {
    return normalizeId(value).toLowerCase();
}

function socketHasCategory(
    socket: Pick<FoxholeManifestBuildSocket, 'socketTags'>,
    categories: ReadonlySet<bigint>,
): boolean {
    return (socket.socketTags ?? []).some(socketTag => {
        const category = Number(socketTag.category ?? NaN);
        if (!Number.isFinite(category)) {
            return false;
        }

        return categories.has(BigInt(Math.trunc(category)));
    });
}

export function socketHasFoxholeFortConnectionCategory(
    socket: Pick<FoxholeManifestBuildSocket, 'socketTags'>,
): boolean {
    // Fort wall faces use category 4 with non-foundation masks (2/4/1024/…).
    // FoundationSocket is also category 4 but mask 8 only — exclude it from bunker
    // unions / breach indicators (center pad, not a wall face).
    return (socket.socketTags ?? []).some(socketTag => {
        const category = Number(socketTag.category ?? NaN);
        if (!Number.isFinite(category) || BigInt(Math.trunc(category)) !== FORT_SOCKET_CONNECTION_CATEGORY) {
            return false;
        }

        const mask = Number(socketTag.mask ?? NaN);
        if (!Number.isFinite(mask) || mask < 0) {
            return false;
        }

        return (BigInt(Math.trunc(mask)) & ~FOXHOLE_FOUNDATION_SOCKET_MASK) !== BigInt(0);
    });
}

export function socketHasFoxholeTrenchConnectionCategory(
    socket: Pick<FoxholeManifestBuildSocket, 'socketTags'>,
): boolean {
    return socketHasCategory(socket, TRENCH_SOCKET_CONNECTION_CATEGORIES);
}

/** Fort-piece membership for bunker HP unions (excludes trenches). */
export function isFoxholeBunkerUnionMember(
    node: Pick<
        FoxholeSocketNetworkSceneNode,
        'profileType' | 'structuralIntegrity' | 'isDestroyed' | 'isBreached' | 'codeName' | 'foxholeKey'
    >,
): boolean {
    if (node.isDestroyed === true || node.isBreached === true) {
        return false;
    }

    const key = normalizeLookupKey(node.codeName ?? node.foxholeKey);
    if (!key || /destroyed|breached|buildsite/.test(key)) {
        return false;
    }

    const profile = normalizeLookupKey(node.profileType);
    if (profile === 'destroyedfort' || profile === 'trench') {
        return false;
    }

    if (profile.startsWith('fort')) {
        return true;
    }

    if (/^(rifle|mg|atgun|artillery)ait[123]$/.test(key)) {
        return true;
    }

    if (/^fort/.test(key)) {
        return true;
    }

    const structuralIntegrity = Number(node.structuralIntegrity ?? NaN);
    return Number.isFinite(structuralIntegrity) && structuralIntegrity > 0 && structuralIntegrity < 1;
}

export function isFoxholeTrenchNetworkMember(
    node: Pick<
        FoxholeSocketNetworkSceneNode,
        'profileType' | 'structuralIntegrity' | 'isDestroyed' | 'isBreached' | 'codeName' | 'foxholeKey' | 'isBunker'
    >,
): boolean {
    if (node.isDestroyed === true || node.isBreached === true) {
        return false;
    }

    if (isFoxholeBunkerUnionMember(node)) {
        return true;
    }

    const profile = normalizeLookupKey(node.profileType);
    if (profile === 'trench') {
        return true;
    }

    const key = normalizeLookupKey(node.codeName ?? node.foxholeKey);
    return /^trench/.test(key) && !/destroyed|breached|buildsite/.test(key);
}

function socketMatchesNetworkMode(
    socket: Pick<FoxholeManifestBuildSocket, 'socketTags'>,
    mode: FoxholeSocketNetworkMode,
): boolean {
    if (mode === 'all') {
        return true;
    }

    if (mode === 'bunker' || mode === 'roof-hover') {
        return socketHasFoxholeFortConnectionCategory(socket);
    }

    if (mode === 'trench') {
        return socketHasFoxholeFortConnectionCategory(socket)
            || socketHasFoxholeTrenchConnectionCategory(socket);
    }

    const tags = normalizeFoxholeSocketTags(socket.socketTags);
    if (mode === 'power') {
        return hasFoxholePowerSocketTag(tags);
    }

    if (mode === 'pipe') {
        return hasFoxholeLiquidPipeSocketTag(tags);
    }

    return false;
}

function isNetworkMember(node: FoxholeSocketNetworkSceneNode, mode: FoxholeSocketNetworkMode): boolean {
    if (mode === 'all') {
        return true;
    }

    if (mode === 'bunker') {
        return isFoxholeBunkerUnionMember(node);
    }

    if (mode === 'roof-hover') {
        // Bunkers fade as a joined group; optional trench roofs fade individually.
        // Fort-only edges below keep trenches from bridging separate bunkers.
        return isFoxholeBunkerUnionMember(node)
            || (node.isDestroyed !== true && node.isBreached !== true
                && /^trench(?:t|intt|connectort)3$/.test(normalizeLookupKey(node.codeName ?? node.foxholeKey)));
    }

    if (mode === 'trench') {
        return isFoxholeTrenchNetworkMember(node);
    }

    if (mode === 'power' || mode === 'pipe') {
        // Facilities and connector pieces: membership is “has a matching socket”
        // or is already linked via a matching attachment edge from a member walk.
        return (node.buildSockets ?? []).some(socket => socketMatchesNetworkMode(socket, mode))
            || node.isFacility === true;
    }

    return false;
}

function resolveSocketByName(
    buildSockets: readonly FoxholeManifestBuildSocket[],
    socketName: string,
): FoxholeManifestBuildSocket | null {
    const normalized = normalizeFoxholeBuildSocketName(socketName).toLowerCase();
    if (!normalized) {
        return null;
    }

    return buildSockets.find(socket => (
        normalizeFoxholeBuildSocketName(socket.name).toLowerCase() === normalized
    )) ?? null;
}

function collectFollowableNeighborIds(
    node: FoxholeSocketNetworkSceneNode,
    mode: FoxholeSocketNetworkMode,
    membersById: ReadonlyMap<string, FoxholeSocketNetworkSceneNode>,
): string[] {
    const neighbors: string[] = [];

    if (mode === 'roof-hover' && !isFoxholeBunkerUnionMember(node)) {
        return neighbors;
    }

    for (const [localSocketName, attachment] of Object.entries(node.socketAttachments ?? {})) {
        const localSocket = resolveSocketByName(node.buildSockets, localSocketName);
        if (!localSocket || !socketMatchesNetworkMode(localSocket, mode)) {
            continue;
        }

        const neighborId = normalizeId(attachment.nodeId);
        if (!neighborId || !membersById.has(neighborId)) {
            continue;
        }

        if (mode === 'roof-hover' && !isFoxholeBunkerUnionMember(membersById.get(neighborId)!)) {
            continue;
        }

        neighbors.push(neighborId);
    }

    return neighbors;
}

/**
 * Build connected components for the given network mode.
 * Isolated members become single-node unions.
 */
export function buildFoxholeSocketNetworkIndex(
    sceneNodes: readonly FoxholeSocketNetworkSceneNode[],
    mode: FoxholeSocketNetworkMode = 'bunker',
): FoxholeSocketNetworkIndex {
    const members = sceneNodes.filter(node => {
        const nodeId = normalizeId(node.nodeId);
        return Boolean(nodeId) && isNetworkMember({ ...node, nodeId }, mode);
    });

    const membersById = new Map(members.map(node => {
        const nodeId = normalizeId(node.nodeId);
        return [nodeId, { ...node, nodeId }] as const;
    }));

    const visited = new Set<string>();
    const unions: FoxholeSocketNetworkUnion[] = [];
    const unionIdByNodeId = new Map<string, string>();

    for (const nodeId of membersById.keys()) {
        if (visited.has(nodeId)) {
            continue;
        }

        const memberNodeIds: string[] = [];
        const queue = [nodeId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId || visited.has(currentId)) {
                continue;
            }

            visited.add(currentId);
            memberNodeIds.push(currentId);

            const current = membersById.get(currentId);
            if (!current) {
                continue;
            }

            for (const neighborId of collectFollowableNeighborIds(current, mode, membersById)) {
                if (!visited.has(neighborId)) {
                    queue.push(neighborId);
                }
            }
        }

        memberNodeIds.sort((left, right) => left.localeCompare(right));
        const unionId = memberNodeIds[0] ?? nodeId;
        unions.push({ unionId, memberNodeIds });
        for (const memberId of memberNodeIds) {
            unionIdByNodeId.set(memberId, unionId);
        }
    }

    unions.sort((left, right) => left.unionId.localeCompare(right.unionId));

    return {
        mode,
        unions,
        unionIdByNodeId,
    };
}

export function resolveFoxholeSocketNetworkUnionForNode(
    index: FoxholeSocketNetworkIndex,
    nodeId: string,
): FoxholeSocketNetworkUnion | null {
    const normalized = normalizeId(nodeId);
    const unionId = index.unionIdByNodeId.get(normalized);
    if (!unionId) {
        return null;
    }

    return index.unions.find(union => union.unionId === unionId) ?? null;
}

/**
 * Among unions that intersect `scopeNodeIds`, return the single union when exactly one
 * matches (legacy bunker stats scope rule). Otherwise null.
 */
export function resolveFoxholeSingleIntersectingSocketNetworkUnion(
    index: FoxholeSocketNetworkIndex,
    scopeNodeIds: readonly string[],
): FoxholeSocketNetworkUnion | null {
    const scopeSet = new Set(scopeNodeIds.map(normalizeId).filter(Boolean));
    if (scopeSet.size === 0) {
        return null;
    }

    const intersecting: FoxholeSocketNetworkUnion[] = [];
    for (const union of index.unions) {
        if (union.memberNodeIds.some(memberId => scopeSet.has(memberId))) {
            intersecting.push(union);
        }
    }

    return intersecting.length === 1 ? intersecting[0]! : null;
}
