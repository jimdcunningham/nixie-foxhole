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
import { isFoxholeModificationSlotTierEligible } from '../../../../../../../extensions/foxhole-planner/src/modification-tier.ts';
import { hasFoxholeModificationTypeConflict, filterFoxholeSameWallInfrastructureSelections, hasFoxholeSameWallModificationConflict } from '../../../../../../../extensions/foxhole-planner/src/modification-wall-conflicts.ts';

import { computeModificationSlotConnectionMask, isSocketConnectionMaskSatisfied, toSocketConnectionMask } from '../../../../../../../extensions/foxhole-planner/src/modification-connection-mask.ts';
export { computeFoxholeSocketConnectionMask } from '../../../../../../../extensions/foxhole-planner/src/modification-connection-mask.ts';

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

    // Choosing a blocked type replaces conflicting wall selections, just as
    // choosing a slot blocked by another slot already does below.
    for (const other of selectedWallModifications(asset, nextSelections)) {
        if (hasFoxholeModificationTypeConflict(slot, normalizedVariantId, asset.modificationSlotById, [other]))
            nextSelections = setFoxholeModificationSlotVariantSelection(nextSelections, asset.modificationSlotById[other.slotId]!, '');
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
    slot: Pick<FoxholeStructureModificationSlotAsset, 'blockedByModSlotNames' | 'blockedByModTypes'>,
    context: Pick<FoxholeStructureModAvailabilityContext, 'asset' | 'modificationVariantIds'>,
): boolean {
    return hasFoxholeModificationTypeConflict(slot, '', context.asset.modificationSlotById,
        selectedWallModifications(context.asset, context.modificationVariantIds)) || slot.blockedByModSlotNames.some(blockingSlotName =>
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
    if (hasFoxholeModificationTypeConflict(slot, variant.id, context.asset.modificationSlotById,
        selectedWallModifications(context.asset, context.modificationVariantIds))) return false;
    if (hasFoxholeSameWallModificationConflict(slot, variant.id, context.asset.modificationSlotById,
        selectedWallModifications(context.asset, context.modificationVariantIds))) {
        return false;
    }
    const connectionMask = computeModificationSlotConnectionMask(context, slot);
    const hiddenMask = toSocketConnectionMask(variant.hiddenBySocketConnectionMask);
    if (hiddenMask !== null && isSocketConnectionMaskSatisfied(connectionMask, hiddenMask)) {
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
