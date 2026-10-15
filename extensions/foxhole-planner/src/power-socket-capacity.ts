export interface FoxholePowerSocketConnection {
    connectorNodeId: string;
    connectorSocketName: string;
    attachment?: { nodeId: string; socketName: string; } | null;
}

export function isFoxholePowerSocketConnectionAvailable(options: {
    targetNodeId: string;
    targetSocketName: string;
    maxConnections?: number | null;
    connections: readonly FoxholePowerSocketConnection[];
    movingConnectorNodeId: string;
    movingConnectorSocketName: string;
}): boolean {
    const targetNodeId = String(options.targetNodeId ?? '').trim();
    const targetSocketName = String(options.targetSocketName ?? '').trim().toLowerCase();
    const movingConnectorNodeId = String(options.movingConnectorNodeId ?? '').trim();
    const movingConnectorSocketName = String(options.movingConnectorSocketName ?? '').trim().toLowerCase();
    if (!targetNodeId || !targetSocketName) {
        return false;
    }
    const requestedLimit = Number(options.maxConnections ?? 1);
    const maxConnections = Number.isFinite(requestedLimit) ? Math.max(1, Math.trunc(requestedLimit)) : 1;
    let occupiedConnections = 0;
    for (const connection of options.connections) {
        if (String(connection.connectorNodeId ?? '').trim() === movingConnectorNodeId
            && String(connection.connectorSocketName ?? '').trim().toLowerCase() === movingConnectorSocketName) {
            // The endpoint currently being moved may retain its existing slot.
            continue;
        }
        const attachment = connection.attachment;
        if (String(attachment?.nodeId ?? '').trim() === targetNodeId
            && String(attachment?.socketName ?? '').trim().toLowerCase() === targetSocketName) {
            occupiedConnections += 1;
        }
    }
    return occupiedConnections < maxConnections;
}
