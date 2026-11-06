import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalInspectorRequestV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2ModificationSlotMetadata, FoxholeSceneV2ModificationVariantMetadata } from './scene-v2-asset-metadata.ts';
import { computeModificationSlotConnectionMask, isSocketConnectionMaskSatisfied, toSocketConnectionMask } from './modification-connection-mask.ts';
import { isFoxholeModificationSlotTierEligible } from './modification-tier.ts';
import { resolveConnectorEndpointSocketNames } from './connector-behavior.ts';

const OWNER = 'nixie.foxhole-planner';

function data(entity: NixieExperimentalComponentEntitySnapshotV1, id: string) {
    return entity.components.find(component => component.ownerId === OWNER && component.componentId === id)?.data;
}

function socketNode(entity: NixieExperimentalComponentEntitySnapshotV1, assets: Readonly<Record<string, FoxholeSceneV2AssetMetadata>>) {
    const spline = data(entity, 'spline-connector');
    const key = data(entity, 'asset')?.assetId ?? spline?.foxholeKey;
    if (typeof key !== 'string' || !Object.hasOwn(assets, key)) {
        return null;
    }
    const asset = assets[key]!;
    const raw = data(entity, 'socket-attachments')?.attachments;
    const socketAttachments: Record<string, { nodeId: string; socketName: string; }> = Object.fromEntries(Array.isArray(raw)
        ? raw.flatMap(row => row && typeof row === 'object' && !Array.isArray(row) && typeof row.localSocketName === 'string'
            && typeof row.targetEntityId === 'string' && typeof row.targetSocketName === 'string'
            ? [[row.localSocketName, { nodeId: row.targetEntityId, socketName: row.targetSocketName }]]
            : [])
        : []);
    if (spline) {
        const connector = resolveConnectorEndpointSocketNames(key, asset.connector);
        for (const prefix of ['start', 'end'] as const) {
            const nodeId = spline[prefix + 'AttachmentNodeId'];
            const socketName = spline[prefix + 'AttachmentSocketName'];
            const local = spline[prefix + 'SocketName'] ?? (prefix === 'start' ? connector.backSocketName : connector.frontSocketName);
            if (typeof local === 'string' && typeof nodeId === 'string' && typeof socketName === 'string' && !Object.hasOwn(socketAttachments, local)) {
                Object.defineProperty(socketAttachments, local, { value: { nodeId, socketName }, enumerable: true });
            }
        }
    }
    return { nodeId: entity.entityId, buildSockets: asset.overlaySockets ?? asset.buildSockets, socketAttachments, asset };
}

export function buildFoxholeInspectorModificationAvailability(request: NixieExperimentalInspectorRequestV1,
    assets: Readonly<Record<string, FoxholeSceneV2AssetMetadata>>) {
    const subject = socketNode(request.subject, assets);
    const related = (request.related?.entities ?? []).flatMap(entity => {
        const node = socketNode(entity, assets);
        return node ? [node] : [];
    });
    const context = subject ? { ...subject, asset: { foxholeKey: subject.asset.codeName }, sceneNodes: [subject, ...related] } : null;
    const masks = new Map<FoxholeSceneV2ModificationSlotMetadata, bigint>();
    return (slot: FoxholeSceneV2ModificationSlotMetadata, variant: FoxholeSceneV2ModificationVariantMetadata): boolean => {
        if (!isFoxholeModificationSlotTierEligible(slot.componentType, subject?.asset.tier)) {
            return false;
        }
        const required = toSocketConnectionMask(variant.requiredSocketConnectionMask);
        const hidden = toSocketConnectionMask(variant.hiddenBySocketConnectionMask);
        if (required === null && hidden === null) {
            return true;
        }
        if (!context || request.related?.truncated || (!request.related && Object.keys(context.socketAttachments).length)) {
            return false;
        }
        let mask = masks.get(slot);
        if (mask === undefined) {
            mask = computeModificationSlotConnectionMask(context, slot);
            masks.set(slot, mask);
        }
        return (required === null || isSocketConnectionMaskSatisfied(mask, required))
            && (hidden === null || !isSocketConnectionMaskSatisfied(mask, hidden));
    };
}
