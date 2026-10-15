import type { BoardTransformState } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { findAlignedFoxholeSocketMatches, hasFoxholePowerSocketTag } from './structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint } from './structure-socket-snapping.ts';
import { normalizeFoxholeBuildSocketName } from './structure-socket-resolution.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';

export const FOXHOLE_ASSET_NODE_TYPE = 'foxholeAsset';

/** Legacy persisted type id retained for backward compatibility. */
export const LEGACY_FOXHOLE_STRUCTURE_NODE_TYPE = 'foxholeStructure';

/** @deprecated Use FOXHOLE_ASSET_NODE_TYPE. */
export const FOXHOLE_STRUCTURE_NODE_TYPE = FOXHOLE_ASSET_NODE_TYPE;

export type FoxholeFaction = 'c' | 'w' | null;

export interface FoxholeStructureSocketAttachment {
    nodeId: string;
    socketName: string;
}

export type FoxholeStructureSocketAttachmentMap = Record<string, FoxholeStructureSocketAttachment>;

export interface FoxholeStructureSocketOccupancyNode {
    nodeId: string;
    sockets: readonly FoxholeSocketSnapPoint[];
    attachments: FoxholeStructureSocketAttachmentMap;
    moving?: boolean;
}

function normalizeFoxholeSocketLookupName(value: unknown): string {
    return normalizeFoxholeBuildSocketName(value).toLowerCase();
}

function resolveFoxholeSocketAttachmentEntry(
    attachments: FoxholeStructureSocketAttachmentMap | null | undefined,
    socketName: unknown,
): [string, FoxholeStructureSocketAttachment] | null {
    const targetName = normalizeFoxholeSocketLookupName(socketName);
    if (!targetName) {
        return null;
    }

    return Object.entries(attachments ?? {}).find(([candidateName]) => (
        normalizeFoxholeSocketLookupName(candidateName) === targetName
    )) ?? null;
}

function createFoxholeSocketAttachmentPairKey(
    leftNodeId: string,
    leftSocketName: string,
    rightNodeId: string,
    rightSocketName: string,
): string {
    return [
        `${leftNodeId}:${normalizeFoxholeSocketLookupName(leftSocketName)}`,
        `${rightNodeId}:${normalizeFoxholeSocketLookupName(rightSocketName)}`,
    ].sort().join('|');
}

export function hasFoxholeReciprocalSocketAttachment(
    nodeId: string,
    socketName: string | null | undefined,
    attachments: FoxholeStructureSocketAttachmentMap,
    getNodeAttachments: (nodeId: string) => FoxholeStructureSocketAttachmentMap | null | undefined,
): boolean {
    const normalizedNodeId = String(nodeId ?? '').trim();
    const normalizedSocketName = normalizeFoxholeSocketLookupName(socketName);
    if (!normalizedNodeId || !normalizedSocketName) {
        return false;
    }

    const attachment = resolveFoxholeSocketAttachmentEntry(attachments, normalizedSocketName)?.[1];
    const targetNodeId = String(attachment?.nodeId ?? '').trim();
    const targetSocketName = String(attachment?.socketName ?? '').trim();
    if (!targetNodeId || !targetSocketName) {
        return false;
    }

    const counterpartAttachments = getNodeAttachments(targetNodeId) ?? {};
    const counterpartAttachment = resolveFoxholeSocketAttachmentEntry(counterpartAttachments, targetSocketName)?.[1];
    return counterpartAttachment?.nodeId === normalizedNodeId
        && normalizeFoxholeSocketLookupName(counterpartAttachment?.socketName) === normalizedSocketName;
}

export function isFoxholeSocketAvailableForAttachment(
    targetSocket: Pick<FoxholeSocketSnapPoint, 'socketName' | 'socketTags'>,
    attachments: FoxholeStructureSocketAttachmentMap | null | undefined,
    expectedCounterpart: Pick<FoxholeStructureSocketAttachment, 'nodeId' | 'socketName'> | null = null,
): boolean {
    if (hasFoxholePowerSocketTag(targetSocket.socketTags)) {
        return true;
    }

    const normalizedSocketName = normalizeFoxholeSocketLookupName(targetSocket.socketName);
    if (!normalizedSocketName) {
        return true;
    }

    const currentAttachment = resolveFoxholeSocketAttachmentEntry(attachments, normalizedSocketName)?.[1];
    if (!currentAttachment) {
        return true;
    }
    if (!expectedCounterpart) {
        return false;
    }

    return String(currentAttachment.nodeId ?? '').trim() === String(expectedCounterpart.nodeId ?? '').trim()
        && normalizeFoxholeSocketLookupName(currentAttachment.socketName)
        === normalizeFoxholeSocketLookupName(expectedCounterpart.socketName);
}

/** Both sockets must be free (or already paired to each other). Power sockets stay multi-attach. */
export function areFoxholeSnapSocketsAvailableForAttachment(
    movingSocket: Pick<FoxholeSocketSnapPoint, 'nodeId' | 'socketName' | 'socketTags'>,
    movingAttachments: FoxholeStructureSocketAttachmentMap | null | undefined,
    targetSocket: Pick<FoxholeSocketSnapPoint, 'nodeId' | 'socketName' | 'socketTags'>,
    targetAttachments: FoxholeStructureSocketAttachmentMap | null | undefined,
): boolean {
    return isFoxholeSocketAvailableForAttachment(
        targetSocket,
        targetAttachments,
        {
            nodeId: movingSocket.nodeId,
            socketName: movingSocket.socketName,
        },
    ) && isFoxholeSocketAvailableForAttachment(
        movingSocket,
        movingAttachments,
        {
            nodeId: targetSocket.nodeId,
            socketName: targetSocket.socketName,
        },
    );
}

/** Dragging releases cross-selection links, but preserves links within each side. */
export function resolveFoxholeMoveSnapAttachments(
    attachmentsByNode: ReadonlyMap<string, FoxholeStructureSocketAttachmentMap>,
    selectedNodeIds: ReadonlySet<string>,
): Map<string, FoxholeStructureSocketAttachmentMap> {
    return new Map([...attachmentsByNode].map(([nodeId, attachments]) => [
        nodeId,
        filterFoxholeStructureSocketAttachments(attachments, attachment => (
            selectedNodeIds.has(nodeId) === selectedNodeIds.has(attachment.nodeId)
        )),
    ]));
}

export function filterFoxholeStructureSocketAttachments(
    attachments: FoxholeStructureSocketAttachmentMap | null | undefined,
    predicate: (attachment: FoxholeStructureSocketAttachment, socketName: string) => boolean,
): FoxholeStructureSocketAttachmentMap {
    const next: FoxholeStructureSocketAttachmentMap = {};
    for (const [socketName, attachment] of Object.entries(attachments ?? {})) {
        const normalizedSocketName = String(socketName ?? '').trim();
        const normalizedNodeId = String(attachment?.nodeId ?? '').trim();
        const normalizedTargetSocketName = String(attachment?.socketName ?? '').trim();
        if (!normalizedSocketName || !normalizedNodeId || !normalizedTargetSocketName) {
            continue;
        }

        const normalizedAttachment = {
            nodeId: normalizedNodeId,
            socketName: normalizedTargetSocketName,
        } satisfies FoxholeStructureSocketAttachment;
        if (!predicate(normalizedAttachment, normalizedSocketName)) {
            continue;
        }

        next[normalizedSocketName] = normalizedAttachment;
    }

    return next;
}

export function resolveFoxholeAlignedReciprocalSocketAttachments(
    nodes: readonly FoxholeStructureSocketOccupancyNode[],
    options?: {
        /**
         * When false, keep reciprocal pairs without re-checking socket coincidence.
         * Use for co-selected nodes under a shared transform — relative poses stay fixed.
         */
        requireAlignment?: boolean;
    },
): Map<string, FoxholeStructureSocketAttachmentMap> {
    const requireAlignment = options?.requireAlignment !== false;
    const nodesById = new Map(nodes.map(node => [String(node.nodeId ?? '').trim(), node]));
    const alignedAttachmentsByNode = new Map<string, FoxholeStructureSocketAttachmentMap>(
        nodes.map(node => [String(node.nodeId ?? '').trim(), {}]),
    );
    const persistedAttachmentPairs = new Map<string, {
        leftNodeId: string;
        leftSocketName: string;
        rightNodeId: string;
        rightSocketName: string;
    }>();
    const socketsByKey = new Map<string, FoxholeSocketSnapPoint>();

    for (const socket of nodes.flatMap(node => node.sockets)) {
        const nodeId = String(socket.nodeId ?? '').trim();
        const socketName = normalizeFoxholeSocketLookupName(socket.socketName);
        if (!nodeId || !socketName) {
            continue;
        }

        socketsByKey.set(`${nodeId}:${socketName}`, socket);
    }

    for (const node of nodes) {
        const nodeId = String(node.nodeId ?? '').trim();
        if (!nodeId) {
            continue;
        }

        for (const [socketName, attachment] of Object.entries(node.attachments)) {
            if (!hasFoxholeReciprocalSocketAttachment(
                nodeId,
                socketName,
                node.attachments,
                targetNodeId => nodesById.get(String(targetNodeId ?? '').trim())?.attachments,
            )) {
                continue;
            }

            const targetNodeId = String(attachment.nodeId ?? '').trim();
            const targetSocketName = String(attachment.socketName ?? '').trim();
            const pairKey = createFoxholeSocketAttachmentPairKey(
                nodeId,
                socketName,
                targetNodeId,
                targetSocketName,
            );
            if (!persistedAttachmentPairs.has(pairKey)) {
                persistedAttachmentPairs.set(pairKey, {
                    leftNodeId: nodeId,
                    leftSocketName: socketName,
                    rightNodeId: targetNodeId,
                    rightSocketName: targetSocketName,
                });
            }
        }
    }

    if (persistedAttachmentPairs.size === 0) {
        return alignedAttachmentsByNode;
    }

    if (!requireAlignment) {
        for (const persistedPair of persistedAttachmentPairs.values()) {
            const leftSocket = socketsByKey.get(`${persistedPair.leftNodeId}:${normalizeFoxholeSocketLookupName(persistedPair.leftSocketName)}`);
            const rightSocket = socketsByKey.get(`${persistedPair.rightNodeId}:${normalizeFoxholeSocketLookupName(persistedPair.rightSocketName)}`);
            const leftSocketName = String(leftSocket?.socketName ?? persistedPair.leftSocketName).trim();
            const rightSocketName = String(rightSocket?.socketName ?? persistedPair.rightSocketName).trim();
            const movingAttachments = alignedAttachmentsByNode.get(persistedPair.leftNodeId) ?? {};
            movingAttachments[leftSocketName] = {
                nodeId: persistedPair.rightNodeId,
                socketName: rightSocketName,
            };
            alignedAttachmentsByNode.set(persistedPair.leftNodeId, movingAttachments);

            const targetAttachments = alignedAttachmentsByNode.get(persistedPair.rightNodeId) ?? {};
            targetAttachments[rightSocketName] = {
                nodeId: persistedPair.leftNodeId,
                socketName: leftSocketName,
            };
            alignedAttachmentsByNode.set(persistedPair.rightNodeId, targetAttachments);
        }
        return alignedAttachmentsByNode;
    }

    if (socketsByKey.size === 0) {
        return alignedAttachmentsByNode;
    }

    for (const persistedPair of persistedAttachmentPairs.values()) {
        const leftSocket = socketsByKey.get(`${persistedPair.leftNodeId}:${normalizeFoxholeSocketLookupName(persistedPair.leftSocketName)}`);
        const rightSocket = socketsByKey.get(`${persistedPair.rightNodeId}:${normalizeFoxholeSocketLookupName(persistedPair.rightSocketName)}`);
        if (!leftSocket || !rightSocket) {
            continue;
        }

        const alignedMatches = findAlignedFoxholeSocketMatches({
            movingSockets: [leftSocket],
            targetSockets: [rightSocket],
        });
        if (alignedMatches.length === 0) {
            continue;
        }

        const movingAttachments = alignedAttachmentsByNode.get(persistedPair.leftNodeId) ?? {};
        movingAttachments[leftSocket.socketName] = {
            nodeId: persistedPair.rightNodeId,
            socketName: rightSocket.socketName,
        };
        alignedAttachmentsByNode.set(persistedPair.leftNodeId, movingAttachments);

        const targetAttachments = alignedAttachmentsByNode.get(persistedPair.rightNodeId) ?? {};
        targetAttachments[rightSocket.socketName] = {
            nodeId: persistedPair.leftNodeId,
            socketName: leftSocket.socketName,
        };
        alignedAttachmentsByNode.set(persistedPair.rightNodeId, targetAttachments);
    }

    return alignedAttachmentsByNode;
}

export function resolveFoxholeOccupiedSocketKeys(
    nodes: readonly FoxholeStructureSocketOccupancyNode[],
): Set<string> {
    const occupied = new Set<string>();
    const alignedAttachmentsByNode = resolveFoxholeAlignedReciprocalSocketAttachments(nodes);
    for (const [nodeId, attachments] of alignedAttachmentsByNode.entries()) {
        for (const socketName of Object.keys(attachments)) {
            occupied.add(`${nodeId}:${socketName}`);
        }
    }

    const movingSockets = nodes.filter(node => node.moving === true).flatMap(node => node.sockets);
    const targetSockets = nodes.filter(node => node.moving !== true).flatMap(node => node.sockets);
    if (movingSockets.length > 0 && targetSockets.length > 0) {
        const stationaryAlignedAttachmentsByNode = resolveFoxholeAlignedReciprocalSocketAttachments(
            nodes.filter(node => node.moving !== true),
        );
        for (const match of findAlignedFoxholeSocketMatches({
            movingSockets,
            targetSockets,
            isTargetSocketAvailable: (movingSocket, targetSocket) => isFoxholeSocketAvailableForAttachment(
                targetSocket,
                stationaryAlignedAttachmentsByNode.get(String(targetSocket.nodeId ?? '').trim()),
                {
                    nodeId: movingSocket.nodeId,
                    socketName: movingSocket.socketName,
                },
            ),
        })) {
            occupied.add(`${match.movingNodeId}:${match.movingSocketName}`);
            occupied.add(`${match.targetNodeId}:${match.targetSocketName}`);
        }
    }

    return occupied;
}

export interface FoxholeStructureState extends BoardTransformState {
    foxholeKey: string;
    faction?: FoxholeFaction;
    colorHex?: string;
    destroyed?: boolean;
    packaged?: boolean;
    blueprint?: boolean;
    tint?: number;
    /** Legacy ColorMatrixFilter brightness multiplier (1 = unset). */
    brightness?: number;
    anchorX: number;
    anchorY: number;
    modificationVariantIds: FoxholeStructureModificationSelectionMap;
    socketAttachments: FoxholeStructureSocketAttachmentMap;
    markedItemCodenames?: string[];
    /** Marked cargo by native component/config key; absent groups inherit legacy markers. */
    markedStockpileItems?: Record<string, string[]>;
    productionOrders?: FoxholeStructureProductionOrder[];
    disableProduction?: boolean;
    maintenanceFilters?: Record<string, unknown>;
    /** Legacy base-upgrade selections retained for imported planner projects. */
    baseUpgrades?: Record<string, string>;
}

/** A persisted facility order. `parent` selects recipes inherited from the parent structure. */
export interface FoxholeStructureProductionOrder {
    recipeId: string;
    parent: boolean;
    /** Null means unlimited, matching legacy `cycles: false`. */
    cycles: number | null;
    label: string | null;
}

export function normalizeFoxholeStructureSocketAttachmentMap(value: unknown): FoxholeStructureSocketAttachmentMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const next: FoxholeStructureSocketAttachmentMap = {};
    for (const [socketName, attachment] of Object.entries(value)) {
        const normalizedSocketName = String(socketName ?? '').trim();
        if (!normalizedSocketName || !attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
            continue;
        }

        const nodeId = String((attachment as { nodeId?: unknown; }).nodeId ?? '').trim();
        const targetSocketName = String((attachment as { socketName?: unknown; }).socketName ?? '').trim();
        if (!nodeId || !targetSocketName) {
            continue;
        }

        next[normalizedSocketName] = {
            nodeId,
            socketName: targetSocketName,
        };
    }

    return next;
}

export function normalizeFoxholeFaction(value: unknown): FoxholeFaction {
    if (value === 'c' || value === 'w') {
        return value;
    }

    return null;
}

export function normalizeFoxholeColorHex(value: unknown): string | null {
    const normalized = String(value ?? '')
        .trim()
        .replace(/^0x/i, '')
        .replace(/^#/, '')
        .replace(/[^a-fA-F0-9]/g, '')
        .toLowerCase();

    return normalized.length === 6 || normalized.length === 8
        ? normalized
        : null;
}

export function createFoxholeStructureTextureKey(
    foxholeKey: string,
    faction: FoxholeFaction = null,
    destroyed = false,
    colorHex: string | null = null,
    packaged = false,
): string {
    const normalizedKey = String(foxholeKey ?? '').trim();
    const normalizedColorHex = normalizeFoxholeColorHex(colorHex);
    const usePackaged = packaged === true;
    const useDestroyed = usePackaged ? false : destroyed === true;
    if (!useDestroyed && normalizedColorHex) {
        if (usePackaged) {
            return `foxhole:structure:${normalizedKey}:color:${normalizedColorHex}:packaged`;
        }

        return `foxhole:structure:${normalizedKey}:color:${normalizedColorHex}`;
    }

    const variant = normalizeFoxholeFaction(faction) ?? 'default';
    if (usePackaged) {
        return `foxhole:structure:${normalizedKey}:${variant}:packaged`;
    }

    return useDestroyed
        ? `foxhole:structure:${normalizedKey}:${variant}:destroyed`
        : `foxhole:structure:${normalizedKey}:${variant}`;
}

export function parseFoxholeStructureTextureKey(textureKey: string): {
    foxholeKey: string;
    faction: FoxholeFaction;
    destroyed: boolean;
    packaged: boolean;
    colorHex: string | null;
} | null {
    const raw = String(textureKey ?? '').trim();
    if (!raw.startsWith('foxhole:structure:')) {
        return null;
    }

    const parts = raw.split(':');
    if (parts.length < 4) {
        return null;
    }

    const packaged = parts[parts.length - 1] === 'packaged';
    const destroyed = !packaged && parts[parts.length - 1] === 'destroyed';
    const relevantParts = destroyed || packaged ? parts.slice(0, -1) : [...parts];
    if (relevantParts.length < 4) {
        return null;
    }

    let colorHex: string | null = null;
    let variant = relevantParts[relevantParts.length - 1] ?? 'default';
    let foxholeKey = '';
    if (relevantParts[relevantParts.length - 2] === 'color') {
        colorHex = normalizeFoxholeColorHex(variant);
        foxholeKey = relevantParts.slice(2, -2).join(':').replace(/^structure:/, '').trim();
        variant = 'default';
    } else {
        foxholeKey = relevantParts.slice(2, -1).join(':').replace(/^structure:/, '').trim();
    }

    if (!foxholeKey) {
        return null;
    }

    return {
        foxholeKey,
        faction: normalizeFoxholeFaction(variant),
        destroyed,
        packaged,
        colorHex,
    };
}

export function createFoxholeStructureNodeId(prefix = 'foxhole-structure'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
