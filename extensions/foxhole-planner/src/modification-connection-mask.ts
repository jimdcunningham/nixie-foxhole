import { normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import { trenchConnectorTier } from './trench-connector.ts';

type SocketAttachments = Readonly<Record<string, { nodeId: string; socketName: string; }>>;
interface FoxholeModificationSocket {
    name: string;
    socketTags?: readonly { mask?: number | null; category?: number | null; }[] | null;
}

export interface FoxholeModificationSocketNode {
    nodeId: string;
    buildSockets: readonly FoxholeModificationSocket[];
    socketAttachments: SocketAttachments;
}

interface FoxholeModificationSocketContext extends FoxholeModificationSocketNode {
    asset?: { foxholeKey?: string; };
    sceneNodes: readonly FoxholeModificationSocketNode[];
}

const BIGINT_ZERO = 0n;
const FORT_SOCKET_CONNECTION_CATEGORY = 4n;
const FORT_SOCKET_CONNECTION_BITS = (1n << 36n) | (1n << 37n);

function normalizeSocketName(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeBuildSocketLookupName(value: unknown): string {
    return normalizeFoxholeBuildSocketName(value).toLowerCase();
}

function resolveSocketAttachment(
    socketAttachments: SocketAttachments,
    socketName: unknown,
) {
    const targetName = normalizeBuildSocketLookupName(socketName);
    if (!targetName) {
        return null;
    }

    return Object.entries(socketAttachments).find(([candidateName]) => (
        normalizeBuildSocketLookupName(candidateName) === targetName
    ))?.[1] ?? null;
}

export function toSocketConnectionMask(value: number | null | undefined): bigint | null {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        return null;
    }

    return BigInt(Math.trunc(normalized));
}

function orSocketTagMasks(
    sockets: readonly Pick<FoxholeModificationSocket, 'name' | 'socketTags'>[],
    socketNames?: ReadonlySet<string>,
): bigint {
    let connectionMask = BIGINT_ZERO;

    for (const socket of sockets) {
        const socketName = normalizeBuildSocketLookupName(socket.name);
        if (!socketName || (socketNames && !socketNames.has(socketName))) {
            continue;
        }

        for (const socketTag of socket.socketTags ?? []) {
            const mask = Number(socketTag.mask ?? NaN);
            if (Number.isFinite(mask) && mask >= 0) {
                connectionMask |= BigInt(Math.trunc(mask));
            }
        }
    }

    return connectionMask;
}

function socketHasFortConnectionCategory(
    socket: Pick<FoxholeModificationSocket, 'socketTags'>,
): boolean {
    return (socket.socketTags ?? []).some(socketTag => {
        const category = Number(socketTag.category ?? NaN);
        return Number.isFinite(category) && BigInt(Math.trunc(category)) === FORT_SOCKET_CONNECTION_CATEGORY;
    });
}

function resolveSceneNodeById(
    sceneNodes: readonly FoxholeModificationSocketNode[],
    nodeId: string,
): FoxholeModificationSocketNode | null {
    const normalizedNodeId = normalizeSocketName(nodeId);
    if (!normalizedNodeId) {
        return null;
    }

    return sceneNodes.find(node => node.nodeId === normalizedNodeId) ?? null;
}

function resolveOccupiedLocalSocketNames(
    socketAttachments: SocketAttachments,
): Set<string> {
    return new Set(
        Object.keys(socketAttachments)
            .map(socketName => normalizeBuildSocketLookupName(socketName))
            .filter(Boolean),
    );
}

function resolveNeighborSocketLists(
    context: FoxholeModificationSocketContext,
    occupiedLocalSocketNames: ReadonlySet<string>,
): FoxholeModificationSocket[][] {
    const neighborSocketLists: FoxholeModificationSocket[][] = [];

    for (const socketName of occupiedLocalSocketNames) {
        const attachment = resolveSocketAttachment(context.socketAttachments, socketName);
        if (!attachment) {
            continue;
        }

        const neighborNode = resolveSceneNodeById(context.sceneNodes, attachment.nodeId);
        if (!neighborNode) {
            continue;
        }

        const reciprocalSocketName = normalizeBuildSocketLookupName(attachment.socketName);
        if (!reciprocalSocketName) {
            continue;
        }

        neighborSocketLists.push(
            neighborNode.buildSockets.filter(socket => normalizeBuildSocketLookupName(socket.name) === reciprocalSocketName),
        );
    }

    return neighborSocketLists;
}

function resolveFortConnectedSocketNames(
    buildSockets: readonly FoxholeModificationSocket[],
    occupiedLocalSocketNames: ReadonlySet<string>,
    socketAttachments: SocketAttachments,
    sceneNodes: readonly FoxholeModificationSocketNode[],
): string[] {
    return buildSockets.flatMap(socket => {
        const socketName = normalizeBuildSocketLookupName(socket.name);
        if (!socketName || !occupiedLocalSocketNames.has(socketName)) {
            return [];
        }

        const attachment = resolveSocketAttachment(socketAttachments, socketName);
        if (!attachment || !socketHasFortConnectionCategory(socket)) {
            return [];
        }

        // A bunker wall also accepts trenches. Only a fort socket on the other
        // end constitutes the fort-to-fort connection that hides doorways.
        const neighbor = resolveSceneNodeById(sceneNodes, attachment.nodeId);
        const neighborSocketName = normalizeBuildSocketLookupName(attachment.socketName);
        if (!neighbor?.buildSockets.some(candidate => normalizeBuildSocketLookupName(candidate.name) === neighborSocketName
            && socketHasFortConnectionCategory(candidate))) {
            return [];
        }

        return [socketName];
    });
}

function resolveConnectedSceneNodeIds(
    startNodeId: string,
    sceneNodes: readonly FoxholeModificationSocketNode[],
): Set<string> {
    const nodesById = new Map(sceneNodes.map(node => [node.nodeId, node] as const));
    const visited = new Set<string>();
    const queue = [normalizeSocketName(startNodeId)].filter(Boolean);

    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!nodeId || visited.has(nodeId)) {
            continue;
        }

        visited.add(nodeId);
        const node = nodesById.get(nodeId);
        if (!node) {
            continue;
        }

        for (const attachment of Object.values(node.socketAttachments)) {
            const neighborNodeId = normalizeSocketName(attachment.nodeId);
            if (neighborNodeId && !visited.has(neighborNodeId)) {
                queue.push(neighborNodeId);
            }
        }
    }

    return visited;
}

export function computeFoxholeSocketConnectionMask(
    context: Pick<
        FoxholeModificationSocketContext,
        'nodeId' | 'buildSockets' | 'socketAttachments' | 'sceneNodes'
    >,
): bigint {
    const nodesById = new Map(context.sceneNodes.map(node => [node.nodeId, node] as const));
    const connectedNodeIds = resolveConnectedSceneNodeIds(context.nodeId, context.sceneNodes);
    if (!connectedNodeIds.has(context.nodeId)) {
        connectedNodeIds.add(context.nodeId);
    }

    let connectionMask = BIGINT_ZERO;

    for (const nodeId of connectedNodeIds) {
        const sceneNode = nodeId === context.nodeId
            ? {
                nodeId: context.nodeId,
                buildSockets: context.buildSockets,
                socketAttachments: context.socketAttachments,
            }
            : nodesById.get(nodeId);
        if (!sceneNode) {
            continue;
        }

        const occupiedLocalSocketNames = resolveOccupiedLocalSocketNames(sceneNode.socketAttachments);
        connectionMask |= orSocketTagMasks(sceneNode.buildSockets, occupiedLocalSocketNames);

        for (const neighborSockets of resolveNeighborSocketLists(
            {
                ...context,
                nodeId: sceneNode.nodeId,
                buildSockets: sceneNode.buildSockets,
                socketAttachments: sceneNode.socketAttachments,
            },
            occupiedLocalSocketNames,
        )) {
            connectionMask |= orSocketTagMasks(neighborSockets);
        }

        for (const socketName of resolveFortConnectedSocketNames(
            sceneNode.buildSockets,
            occupiedLocalSocketNames,
            sceneNode.socketAttachments,
            context.sceneNodes,
        )) {
            if (resolveSocketAttachment(sceneNode.socketAttachments, socketName)) {
                connectionMask |= FORT_SOCKET_CONNECTION_BITS;
            }
        }
    }

    return connectionMask;
}

export function computeModificationSlotConnectionMask(
    context: FoxholeModificationSocketContext,
    slot: { isLinkedToSocket?: boolean; linkedSocketNames?: readonly string[]; componentType?: string | null; },
): bigint {
    const linkedSocketNames = slot.linkedSocketNames ?? [];
    // Connector defense slots run along the two solid sides. Their inherited
    // trench mask must not treat a Front/Back endpoint connection as a side opening.
    if (trenchConnectorTier(context.asset?.foxholeKey) !== null
        && slot.componentType === 'BPTrenchDefenseModSlot_C'
        && !slot.isLinkedToSocket && linkedSocketNames.length === 0) {
        return BIGINT_ZERO;
    }
    if (!slot.isLinkedToSocket || linkedSocketNames.length === 0) {
        return computeFoxholeSocketConnectionMask(context);
    }

    // Wall-local conditions describe this slot's attachment, not every joined
    // bunker or another wall on its host. Include only the linked socket pair.
    const linkedNames = new Set(linkedSocketNames.map(normalizeBuildSocketLookupName));
    const occupiedNames = new Set([...resolveOccupiedLocalSocketNames(context.socketAttachments)]
        .filter(name => linkedNames.has(name)));
    let connectionMask = orSocketTagMasks(context.buildSockets, occupiedNames);
    for (const neighborSockets of resolveNeighborSocketLists(context, occupiedNames)) {
        connectionMask |= orSocketTagMasks(neighborSockets);
    }
    if (resolveFortConnectedSocketNames(context.buildSockets, occupiedNames, context.socketAttachments, context.sceneNodes).length > 0) {
        connectionMask |= FORT_SOCKET_CONNECTION_BITS;
    }
    return connectionMask;
}

export function isSocketConnectionMaskSatisfied(
    connectionMask: bigint,
    requiredMask: bigint,
): boolean {
    return (connectionMask & requiredMask) === requiredMask;
}
