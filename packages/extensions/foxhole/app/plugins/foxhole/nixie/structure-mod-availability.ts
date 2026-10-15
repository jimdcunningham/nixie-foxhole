import type { FoxholeManifestBuildSocket } from './manifest.ts';
import type {
    FoxholeStructureAsset,
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
} from './catalog.ts';
import {
    normalizeFoxholeModificationSelectionMap,
    resolveFoxholeModificationSlotVariantId,
    setFoxholeModificationSlotVariantSelection,

} from './modification-slots.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';
import type { FoxholeStructureSocketAttachmentMap } from './types.ts';
import { normalizeFoxholeStructureSocketAttachmentMap } from './types.ts';
import { normalizeFoxholeBuildSocketName } from './structure-socket-resolution.ts';
import { trenchConnectorTier } from './trench-connector.ts';
import { isFoxholeModificationSlotTierEligible } from '../../../../../../../extensions/foxhole-planner/src/modification-tier.ts';
import { filterFoxholeSameWallInfrastructureSelections, hasFoxholeSameWallModificationConflict } from '../../../../../../../extensions/foxhole-planner/src/modification-wall-conflicts.ts';

const BIGINT_ZERO = BigInt(0);

const FORT_SOCKET_CONNECTION_CATEGORY = BigInt(4);
const FORT_SOCKET_CONNECTION_BITS = (BigInt(1) << BigInt(36)) | (BigInt(1) << BigInt(37));

function selectedWallModifications(asset: FoxholeStructureModAvailabilityContext['asset'], selections: FoxholeStructureModificationSelectionMap) {
    return asset.modificationSlots.flatMap(slot => {
        const variantId = resolveFoxholeModificationSlotVariantId(slot, selections);
        return variantId ? [{ slotId: slot.id, variantId }] : [];
    });
}

export interface FoxholeStructureModAvailabilitySceneNode {
    nodeId: string;
    foxholeKey: string;
    buildSockets: readonly FoxholeManifestBuildSocket[];
    socketAttachments: FoxholeStructureSocketAttachmentMap;
}

export interface FoxholeStructureModAvailabilityContext {
    nodeId: string;
    asset: Pick<FoxholeStructureAsset, 'modificationSlots' | 'modificationSlotById'> & Partial<Pick<FoxholeStructureAsset, 'foxholeKey' | 'tier'>>;
    buildSockets: readonly FoxholeManifestBuildSocket[];
    socketAttachments: FoxholeStructureSocketAttachmentMap;
    modificationVariantIds: FoxholeStructureModificationSelectionMap;
    sceneNodes: readonly FoxholeStructureModAvailabilitySceneNode[];
}

function normalizeSocketName(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeBuildSocketLookupName(value: unknown): string {
    return normalizeFoxholeBuildSocketName(value).toLowerCase();
}

function resolveSocketAttachment(
    socketAttachments: FoxholeStructureSocketAttachmentMap,
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

function toSocketConnectionMask(value: number | null | undefined): bigint | null {
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
    sockets: readonly Pick<FoxholeManifestBuildSocket, 'name' | 'socketTags'>[],
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
    socket: Pick<FoxholeManifestBuildSocket, 'socketTags'>,
): boolean {
    return (socket.socketTags ?? []).some(socketTag => {
        const category = Number(socketTag.category ?? NaN);
        return Number.isFinite(category) && BigInt(Math.trunc(category)) === FORT_SOCKET_CONNECTION_CATEGORY;
    });
}

function resolveSceneNodeById(
    sceneNodes: readonly FoxholeStructureModAvailabilitySceneNode[],
    nodeId: string,
): FoxholeStructureModAvailabilitySceneNode | null {
    const normalizedNodeId = normalizeSocketName(nodeId);
    if (!normalizedNodeId) {
        return null;
    }

    return sceneNodes.find(node => node.nodeId === normalizedNodeId) ?? null;
}

function resolveOccupiedLocalSocketNames(
    socketAttachments: FoxholeStructureSocketAttachmentMap,
): Set<string> {
    return new Set(
        Object.keys(socketAttachments)
            .map(socketName => normalizeBuildSocketLookupName(socketName))
            .filter(Boolean),
    );
}

function resolveNeighborSocketLists(
    context: FoxholeStructureModAvailabilityContext,
    occupiedLocalSocketNames: ReadonlySet<string>,
): FoxholeManifestBuildSocket[][] {
    const neighborSocketLists: FoxholeManifestBuildSocket[][] = [];

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
    buildSockets: readonly FoxholeManifestBuildSocket[],
    occupiedLocalSocketNames: ReadonlySet<string>,
    socketAttachments: FoxholeStructureSocketAttachmentMap,
    sceneNodes: readonly FoxholeStructureModAvailabilitySceneNode[],
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
    sceneNodes: readonly FoxholeStructureModAvailabilitySceneNode[],
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
        FoxholeStructureModAvailabilityContext,
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
                foxholeKey: '',
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

function computeModificationSlotConnectionMask(
    context: FoxholeStructureModAvailabilityContext,
    slot: Pick<FoxholeStructureModificationSlotAsset, 'isLinkedToSocket' | 'linkedSocketNames'> & Partial<Pick<FoxholeStructureModificationSlotAsset, 'componentType'>>,
): bigint {
    // Connector defense slots run along the two solid sides. Their inherited
    // trench mask must not treat a Front/Back endpoint connection as a side opening.
    if (trenchConnectorTier(context.asset.foxholeKey) !== null
        && slot.componentType === 'BPTrenchDefenseModSlot_C'
        && !slot.isLinkedToSocket && slot.linkedSocketNames.length === 0) {
        return BIGINT_ZERO;
    }
    if (!slot.isLinkedToSocket || slot.linkedSocketNames.length === 0) {
        return computeFoxholeSocketConnectionMask(context);
    }

    // Wall-local conditions describe this slot's attachment, not every joined
    // bunker or another wall on its host. Include only the linked socket pair.
    const linkedNames = new Set(slot.linkedSocketNames.map(normalizeBuildSocketLookupName));
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

function isSocketConnectionMaskSatisfied(
    connectionMask: bigint,
    requiredMask: bigint,
): boolean {
    return (connectionMask & requiredMask) === requiredMask;
}

function isSocketConnectionMaskHidden(
    connectionMask: bigint,
    hiddenMask: bigint,
): boolean {
    return (connectionMask & hiddenMask) === hiddenMask;
}

function resolveSlotByName(
    asset: Pick<FoxholeStructureAsset, 'modificationSlots' | 'modificationSlotById'>,
    slotName: string,
): FoxholeStructureModificationSlotAsset | null {
    const normalizedSlotName = normalizeSocketName(slotName);
    if (!normalizedSlotName) {
        return null;
    }

    return asset.modificationSlots.find(slot => slot.name === normalizedSlotName)
        ?? asset.modificationSlots.find(slot => slot.id === normalizedSlotName)
        ?? null;
}

function isBlockingModificationSlotActive(
    asset: Pick<FoxholeStructureAsset, 'modificationSlots' | 'modificationSlotById'>,
    slotName: string,
    selections: FoxholeStructureModificationSelectionMap,
): boolean {
    const blockingSlot = resolveSlotByName(asset, slotName);
    if (!blockingSlot) {
        return false;
    }

    return resolveFoxholeModificationSlotVariantId(blockingSlot, selections) !== null;
}

export function resolveActiveFoxholeModificationSlotBlockers(
    asset: Pick<FoxholeStructureAsset, 'modificationSlots' | 'modificationSlotById'>,
    slot: Pick<FoxholeStructureModificationSlotAsset, 'blockedByModSlotNames'>,
    selections: FoxholeStructureModificationSelectionMap,
): FoxholeStructureModificationSlotAsset[] {
    return slot.blockedByModSlotNames.flatMap(blockingSlotName => {
        const blockingSlot = resolveSlotByName(asset, blockingSlotName);
        if (!blockingSlot || resolveFoxholeModificationSlotVariantId(blockingSlot, selections) === null) {
            return [];
        }

        return [blockingSlot];
    });
}

export function prepareFoxholeModificationSelection(
    asset: FoxholeStructureModAvailabilityContext['asset'],
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
    slot: FoxholeStructureModificationSlotAsset,
    variantId: string | null | undefined,
): FoxholeStructureModificationSelectionMap {
    const normalizedVariantId = String(variantId ?? '').trim();
    let nextSelections = normalizeFoxholeModificationSelectionMap(selections);

    if (!normalizedVariantId || !slot.variantById[normalizedVariantId]
        || !isFoxholeModificationSlotTierEligible(slot.componentType, asset.tier)) {
        return setFoxholeModificationSlotVariantSelection(nextSelections, slot, '');
    }

    if (hasFoxholeSameWallModificationConflict(slot, normalizedVariantId, asset.modificationSlotById,
        selectedWallModifications(asset, nextSelections))) {
        return nextSelections;
    }

    // Infrastructure slots are alternate wall positions for one modification
    // per bunker piece, rather than four independently occupied slots.
    if (slot.componentType === 'BPFortInfraModSlot_C') {
        for (const otherSlot of asset.modificationSlots) {
            if (otherSlot.id !== slot.id && otherSlot.componentType === slot.componentType) {
                nextSelections = setFoxholeModificationSlotVariantSelection(nextSelections, otherSlot, '');
            }
        }
    }

    for (const blockingSlot of resolveActiveFoxholeModificationSlotBlockers(asset, slot, nextSelections)) {
        nextSelections = setFoxholeModificationSlotVariantSelection(nextSelections, blockingSlot, '');
    }

    return setFoxholeModificationSlotVariantSelection(nextSelections, slot, normalizedVariantId);
}

export function isFoxholeModificationSlotBlocked(
    slot: Pick<FoxholeStructureModificationSlotAsset, 'blockedByModSlotNames'>,
    context: Pick<FoxholeStructureModAvailabilityContext, 'asset' | 'modificationVariantIds'>,
): boolean {
    return slot.blockedByModSlotNames.some(blockingSlotName =>
        isBlockingModificationSlotActive(
            context.asset,
            blockingSlotName,
            context.modificationVariantIds,
        ));
}

export function isFoxholeModificationSlotAvailable(
    slot: FoxholeStructureModificationSlotAsset,
    context: FoxholeStructureModAvailabilityContext,
): boolean {
    if (!isFoxholeModificationSlotTierEligible(slot.componentType, context.asset.tier)
        || isFoxholeModificationSlotBlocked(slot, context)) {
        return false;
    }

    const selectedVariantId = resolveFoxholeModificationSlotVariantId(slot, context.modificationVariantIds);
    return filterAvailableModificationVariants(slot, context).length > 0
        || (selectedVariantId !== null && !hasFoxholeSameWallModificationConflict(slot, selectedVariantId,
            context.asset.modificationSlotById, selectedWallModifications(context.asset, context.modificationVariantIds)));
}

export function isFoxholeModificationVariantAvailable(
    variant: Pick<
        FoxholeStructureModificationSlotVariantAsset,
        'id' | 'requiredSocketConnectionMask' | 'hiddenBySocketConnectionMask'
    >,
    context: FoxholeStructureModAvailabilityContext,
    slot: Pick<FoxholeStructureModificationSlotAsset, 'isLinkedToSocket' | 'linkedSocketNames'> & Partial<Pick<FoxholeStructureModificationSlotAsset, 'componentType'>>,
): boolean {
    if (!isFoxholeModificationSlotTierEligible(slot.componentType, context.asset.tier)) {
        return false;
    }
    if (hasFoxholeSameWallModificationConflict(slot, variant.id, context.asset.modificationSlotById,
        selectedWallModifications(context.asset, context.modificationVariantIds))) {
        return false;
    }
    const connectionMask = computeModificationSlotConnectionMask(context, slot);
    const hiddenMask = toSocketConnectionMask(variant.hiddenBySocketConnectionMask);
    if (hiddenMask !== null && isSocketConnectionMaskHidden(connectionMask, hiddenMask)) {
        return false;
    }

    const requiredMask = toSocketConnectionMask(variant.requiredSocketConnectionMask);
    if (requiredMask !== null && !isSocketConnectionMaskSatisfied(connectionMask, requiredMask)) {
        return false;
    }

    return true;
}

export function filterAvailableModificationVariants(
    slot: FoxholeStructureModificationSlotAsset,
    context: FoxholeStructureModAvailabilityContext,
): FoxholeStructureModificationSlotVariantAsset[] {
    return slot.variants.filter(variant => isFoxholeModificationVariantAvailable(variant, context, slot));
}

export function sanitizeFoxholeModificationSelections(
    asset: FoxholeStructureModAvailabilityContext['asset'],
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
    context: Omit<FoxholeStructureModAvailabilityContext, 'asset' | 'modificationVariantIds'>,
): FoxholeStructureModificationSelectionMap {
    const normalizedSelections = Object.fromEntries(filterFoxholeSameWallInfrastructureSelections(
        asset.modificationSlotById, selectedWallModifications(asset, normalizeFoxholeModificationSelectionMap(selections)),
    ).map(selection => [selection.slotId, selection.variantId]));
    const availabilityContext: FoxholeStructureModAvailabilityContext = {
        ...context,
        asset,
        modificationVariantIds: normalizedSelections,
    };

    const nextSelections: FoxholeStructureModificationSelectionMap = {};

    for (const slot of asset.modificationSlots) {
        const selectedVariantId = resolveFoxholeModificationSlotVariantId(slot, normalizedSelections);
        if (!selectedVariantId) {
            continue;
        }

        const variant = slot.variantById[selectedVariantId];
        if (!variant) {
            continue;
        }

        if (
            isFoxholeModificationSlotBlocked(slot, availabilityContext)
            || !isFoxholeModificationVariantAvailable(variant, availabilityContext, slot)
        ) {
            continue;
        }

        nextSelections[slot.id] = selectedVariantId;
    }

    return nextSelections;
}

export function buildFoxholeStructureModAvailabilityContext(options: {
    nodeId: string;
    asset: FoxholeStructureAsset;
    buildSockets: readonly FoxholeManifestBuildSocket[];
    socketAttachments: FoxholeStructureSocketAttachmentMap;
    modificationVariantIds: FoxholeStructureModificationSelectionMap | null | undefined;
    sceneNodes: readonly FoxholeStructureModAvailabilitySceneNode[];
}): FoxholeStructureModAvailabilityContext {
    return {
        nodeId: options.nodeId,
        asset: options.asset,
        buildSockets: options.buildSockets,
        socketAttachments: options.socketAttachments,
        modificationVariantIds: normalizeFoxholeModificationSelectionMap(options.modificationVariantIds),
        sceneNodes: options.sceneNodes,
    };
}

interface FoxholeStructureModAvailabilityBoardNodeLike {
    boardId?: string | number;
    boardChildren?: readonly FoxholeStructureModAvailabilityBoardNodeLike[];
    toBoardSnapshot?: () => {
        type?: string;
        state?: {
            foxholeKey?: string;
            socketAttachments?: unknown;
        };
    };
}

export function collectFoxholeStructureModAvailabilitySceneNodes(
    roots: readonly FoxholeStructureModAvailabilityBoardNodeLike[],
    structureByKey: Record<string, Pick<{ buildSockets?: readonly FoxholeManifestBuildSocket[]; }, 'buildSockets'> | undefined>,
    nodeType: string,
): FoxholeStructureModAvailabilitySceneNode[] {
    const sceneNodes: FoxholeStructureModAvailabilitySceneNode[] = [];

    const visit = (node: FoxholeStructureModAvailabilityBoardNodeLike | null | undefined): void => {
        if (!node) {
            return;
        }

        const snapshot = node.toBoardSnapshot?.();
        if (snapshot?.type === nodeType) {
            const foxholeKey = String(snapshot.state?.foxholeKey ?? '').trim();
            const structure = foxholeKey ? structureByKey[foxholeKey] : undefined;
            if (foxholeKey && structure) {
                sceneNodes.push({
                    nodeId: String(node.boardId ?? '').trim(),
                    foxholeKey,
                    buildSockets: structure.buildSockets ?? [],
                    socketAttachments: normalizeFoxholeStructureSocketAttachmentMap(snapshot.state?.socketAttachments),
                });
            }
        }

        for (const child of node.boardChildren ?? []) {
            visit(child);
        }
    };

    for (const root of roots) {
        visit(root);
    }

    return sceneNodes;
}
