export interface FoxholePowerlineEndpointLink {
    socketName: string;
    attachment: { nodeId: string; socketName: string; } | null | undefined;
}

export interface FoxholePowerlineAttachmentSource {
    nodeId: string;
    endpoints: readonly FoxholePowerlineEndpointLink[];
}

type Attachment = { nodeId: string; socketName: string; };
type AttachmentMap = Record<string, Attachment>;

/** Power lines stretch with a moved structure; only their length, not their links, becomes invalid. */
export function retainFoxholePowerlineAttachments(
    movedStructureIds: ReadonlySet<string>,
    powerlines: readonly FoxholePowerlineAttachmentSource[],
    movingAttachmentsByNode: Map<string, AttachmentMap>,
    stationaryAttachmentsByNode: Map<string, AttachmentMap>,
): void {
    for (const powerline of powerlines) {
        const lineAttachments = stationaryAttachmentsByNode.get(powerline.nodeId);
        if (!lineAttachments) {
            continue;
        }

        for (const endpoint of powerline.endpoints) {
            const attachment = endpoint.attachment;
            if (!endpoint.socketName || !attachment?.socketName || !movedStructureIds.has(attachment.nodeId)) {
                continue;
            }

            const structureAttachments = movingAttachmentsByNode.get(attachment.nodeId);
            if (!structureAttachments) {
                continue;
            }

            lineAttachments[endpoint.socketName] = { ...attachment };
            // Power sockets can accept several lines, while this map holds one reciprocal
            // link. Keep the existing occupant and let each connector retain its own end.
            structureAttachments[attachment.socketName] ??= {
                nodeId: powerline.nodeId,
                socketName: endpoint.socketName,
            };
        }
    }
}
