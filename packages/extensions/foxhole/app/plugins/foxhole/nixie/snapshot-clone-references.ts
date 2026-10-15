function remapSocketAttachmentMap(
    socketAttachments: unknown,
    idMap: ReadonlyMap<string, string>,
): { next: Record<string, { nodeId: string; socketName: string; }>; changed: boolean; } | null {
    if (!socketAttachments || typeof socketAttachments !== 'object' || Array.isArray(socketAttachments)) {
        return null;
    }

    const next: Record<string, { nodeId: string; socketName: string; }> = {};
    let changed = false;

    for (const [socketName, attachment] of Object.entries(socketAttachments)) {
        const normalizedSocketName = String(socketName ?? '').trim();
        if (!normalizedSocketName || !attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
            changed = true;
            continue;
        }

        const targetNodeId = String((attachment as { nodeId?: unknown; }).nodeId ?? '').trim();
        const targetSocketName = String((attachment as { socketName?: unknown; }).socketName ?? '').trim();
        if (!targetNodeId || !targetSocketName) {
            changed = true;
            continue;
        }

        const remappedNodeId = idMap.get(targetNodeId);
        if (!remappedNodeId) {
            changed = true;
            continue;
        }

        if (remappedNodeId !== targetNodeId || normalizedSocketName !== socketName) {
            changed = true;
        }

        next[normalizedSocketName] = {
            nodeId: remappedNodeId,
            socketName: targetSocketName,
        };
    }

    return { next, changed };
}

function remapEndpointAttachment(
    attachment: unknown,
    idMap: ReadonlyMap<string, string>,
): { next: { nodeId: string; socketName: string; } | null; changed: boolean; } {
    if (attachment == null) {
        return { next: null, changed: false };
    }

    if (typeof attachment !== 'object' || Array.isArray(attachment)) {
        return { next: null, changed: true };
    }

    const targetNodeId = String((attachment as { nodeId?: unknown; }).nodeId ?? '').trim();
    const targetSocketName = String((attachment as { socketName?: unknown; }).socketName ?? '').trim();
    if (!targetNodeId || !targetSocketName) {
        return { next: null, changed: true };
    }

    const remappedNodeId = idMap.get(targetNodeId);
    if (!remappedNodeId) {
        return { next: null, changed: true };
    }

    return {
        next: {
            nodeId: remappedNodeId,
            socketName: targetSocketName,
        },
        changed: remappedNodeId !== targetNodeId,
    };
}

export function remapFoxholeStructureSnapshotCloneReferences(
    snapshot: { state?: unknown; },
    idMap: ReadonlyMap<string, string>,
): void {
    const state = snapshot.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return;
    }

    const remapped = remapSocketAttachmentMap(
        (state as { socketAttachments?: unknown; }).socketAttachments,
        idMap,
    );
    if (!remapped?.changed) {
        return;
    }

    snapshot.state = {
        ...state,
        socketAttachments: remapped.next,
    };
}

export function remapFoxholeConnectorSnapshotCloneReferences(
    snapshot: { state?: unknown; },
    idMap: ReadonlyMap<string, string>,
): void {
    const state = snapshot.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return;
    }

    const start = remapEndpointAttachment((state as { startAttachment?: unknown; }).startAttachment, idMap);
    const end = remapEndpointAttachment((state as { endAttachment?: unknown; }).endAttachment, idMap);
    const sockets = remapSocketAttachmentMap(
        (state as { socketAttachments?: unknown; }).socketAttachments,
        idMap,
    );

    const changed = start.changed || end.changed || Boolean(sockets?.changed);
    if (!changed) {
        return;
    }

    const nextState: Record<string, unknown> = { ...state };
    if (start.changed || 'startAttachment' in state) {
        nextState.startAttachment = start.next;
    }
    if (end.changed || 'endAttachment' in state) {
        nextState.endAttachment = end.next;
    }
    if (sockets?.changed) {
        nextState.socketAttachments = sockets.next;
    }

    snapshot.state = nextState;
}
