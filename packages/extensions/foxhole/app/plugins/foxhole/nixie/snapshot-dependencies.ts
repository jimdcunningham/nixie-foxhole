import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeSnapshotDependency } from '#nixie/plugins/nixie/board/types/registration.ts';
import type { getFoxholeStructureCatalog } from './catalog.ts';

/** Inspect the same catalog used by the destination node factory, without loading images. */
export function getFoxholeSnapshotDependencies(
    snapshot: BoardNodeSnapshot,
    catalog: ReturnType<typeof getFoxholeStructureCatalog>,
): BoardNodeSnapshotDependency[] {
    const key = String(snapshot.state.foxholeKey ?? '').trim();
    const asset = catalog.assetByKey[key];
    if (!asset) {
        return [{ kind: 'missing', reason: `Missing Foxhole catalog asset: ${key || '(empty key)'}.` }];
    }
    const dependencies: BoardNodeSnapshotDependency[] = [];
    const variants = snapshot.state.modificationVariantIds;
    if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
        for (const [slotId, variantId] of Object.entries(variants)) {
            if (typeof variantId === 'string' && variantId && !asset.modificationSlotById[slotId]?.variantById[variantId]) {
                dependencies.push({ kind: 'missing', reason: `Missing Foxhole modification: ${key}/${slotId}/${variantId}.` });
            }
        }
    }
    const attachments = [snapshot.state.startAttachment, snapshot.state.endAttachment,
        ...Object.values((snapshot.state.socketAttachments ?? {}) as Record<string, unknown>)];
    for (const attachment of attachments) {
        if (attachment && typeof attachment === 'object' && 'nodeId' in attachment && typeof attachment.nodeId === 'string') {
            dependencies.push({ kind: 'node', nodeId: attachment.nodeId });
        }
    }
    return dependencies;
}
