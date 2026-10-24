import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk';
import type { NixieSceneV2PlacementContext } from '#nixie/utils/nixie-scene-v2-state-adapter-registry.ts';
import { getFoxholeManifest } from './manifest.ts';
import { resolveFoxholeBuildSocketPosition, resolveFoxholeEffectiveBuildSockets } from './structure-socket-resolution.ts';
import { normalizeFoxholeSocketTags, hasFoxholeSnapSocketTags, hasFoxholePowerSocketTag } from './structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint } from './structure-socket-snapping.ts';
import { isFoxholeSocketAvailableForAttachment } from './types.ts';
import type { FoxholeStructureSocketAttachmentMap } from './types.ts';
import { isFoxholePowerSocketConnectionAvailable } from './connector.ts';
import { isPowerlineConnector, normalizeFoxholeSplineConnectorState, usesSplineConnectorSocketSnapping, resolveEffectiveConnectorPathStyle, FOXHOLE_BOARD_SPRITE_SCALE } from './spline-connector.ts';
import { resolveFoxholeSplineConnectorSockets, resolveFoxholePointConnectorSockets } from './spline-connector-sockets.ts';
import { resolveConnectorPathStyle, resolveConnectorSpanCrossHalfWidth } from './pipe-connector-path.ts';
import { resolveFoxholeSplinePathConstraints } from './spline-connector-guides.ts';
import { getFoxholeStructureCatalog } from './catalog.ts';
import { resolveFoxholeSplineConnectorRenderLayers } from './spline-connector-upgrade-layers.ts';
import { resolveConnectorEndpointSocketNames } from './connector-behavior.ts';

const OWNER = 'nixie.foxhole-planner';
function data(entity: NixieExperimentalComponentEntitySnapshotV1, id: string) {
    return entity.components.find(component => component.ownerId === OWNER && component.componentId === id
        && component.version === 1 && component.definitionAvailable)?.data;
}

export function collectNixieSceneV2FoxholeSockets(context: NixieSceneV2PlacementContext): FoxholeSocketSnapPoint[] {
    const manifest = getFoxholeManifest('/foxhole/assets/');
    return context.entities.flatMap(entity => {
        const asset = data(entity, 'asset');
        const appearance = data(entity, 'appearance');
        const matrix = context.worldTransforms.get(entity.entityId);
        const spline = data(entity, 'spline-connector');
        const connector = data(entity, 'connector');
        if (matrix && (spline || connector)) {
            const source = spline ?? connector!;
            const key = String(source.foxholeKey ?? '');
            const structure = manifest.assets.find(candidate => candidate.id === key);
            if (!structure || (spline && !usesSplineConnectorSocketSnapping(key))) {
                return [];
            }
            let sockets;
            if (spline) {
                const state = normalizeFoxholeSplineConnectorState({ ...spline,
                    start: { x: Number(spline.startX), y: Number(spline.startY), rotation: Number(spline.startRotation) },
                    end: { x: Number(spline.endX), y: Number(spline.endY), rotation: Number(spline.endRotation) } });
                const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(structure.connector), key);
                const selections = data(entity, 'modification')?.selections;
                const variants = Object.fromEntries(Array.isArray(selections)
                    ? selections.flatMap(selection =>
                        selection && typeof selection === 'object' && !Array.isArray(selection)
                        && typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
                            ? [[selection.slotId, selection.variantId]]
                            : [])
                    : []);
                const layers = resolveFoxholeSplineConnectorRenderLayers({ asset: getFoxholeStructureCatalog('/foxhole/assets/').assetByKey[key],
                    modificationVariantIds: variants });
                const span = layers.find(layer => layer.id.toLowerCase() === 'span') ?? layers.find(layer => layer.id.toLowerCase() === 'underlay');
                sockets = resolveFoxholeSplineConnectorSockets({ structure, state, pathStyle,
                    constraints: resolveFoxholeSplinePathConstraints(state, pathStyle, structure.connector?.maxBufferCm ?? structure.connector?.minLengthCm ?? 0),
                    lateralOffset: resolveConnectorSpanCrossHalfWidth(span, FOXHOLE_BOARD_SPRITE_SCALE) });
            } else {
                sockets = resolveFoxholePointConnectorSockets(structure, { points: Array.isArray(source.points) ? source.points as number[] : [],
                    startSocketName: typeof source.startSocketName === 'string' ? source.startSocketName : undefined,
                    endSocketName: typeof source.endSocketName === 'string' ? source.endSocketName : undefined });
            }
            return sockets.filter(socket => hasFoxholeSnapSocketTags(socket.socketTags)).map(socket => ({ nodeId: entity.entityId,
                socketName: socket.name, x: matrix.a * socket.localX + matrix.c * socket.localY + matrix.tx,
                y: matrix.b * socket.localX + matrix.d * socket.localY + matrix.ty,
                rotation: Math.atan2(matrix.b * Math.cos(socket.rotationRadians) + matrix.d * Math.sin(socket.rotationRadians),
                    matrix.a * Math.cos(socket.rotationRadians) + matrix.c * Math.sin(socket.rotationRadians)), socketTags: socket.socketTags }));
        }
        const structure = asset?.catalogId === 'foxhole.structures'
            ? manifest.assets.find(candidate => candidate.id === asset.assetId)
            : null;
        if (!structure || !matrix || appearance?.destroyed === true || appearance?.packaged === true) {
            return [];
        }
        const selections = data(entity, 'modification')?.selections;
        const variants = Array.isArray(selections)
            ? selections.flatMap(selection => {
                if (!selection || typeof selection !== 'object' || Array.isArray(selection)
                    || typeof selection.slotId !== 'string' || typeof selection.variantId !== 'string') {
                    return [];
                }
                const variant = structure.modificationSlots.find(slot => slot.name === selection.slotId)?.variants[selection.variantId];
                return variant ? [variant] : [];
            })
            : [];
        return resolveFoxholeEffectiveBuildSockets(structure.buildSockets, variants, structure.railCouplers).flatMap(socket => {
            const position = resolveFoxholeBuildSocketPosition(socket);
            const tags = normalizeFoxholeSocketTags(socket.socketTags);
            if (!position || !socket.name || !hasFoxholeSnapSocketTags(tags)) {
                return [];
            }
            const localX = position.x / 100 * 32;
            const localY = position.y / 100 * 32;
            const angle = Number(socket.rotation ?? 0) * Math.PI / 180;
            return [{ nodeId: entity.entityId, socketName: socket.name,
                x: matrix.a * localX + matrix.c * localY + matrix.tx,
                y: matrix.b * localX + matrix.d * localY + matrix.ty,
                rotation: Math.atan2(matrix.b * Math.cos(angle) + matrix.d * Math.sin(angle),
                    matrix.a * Math.cos(angle) + matrix.c * Math.sin(angle)), socketTags: tags }];
        });
    });
}

export function isNixieSceneV2FoxholeSocketAvailable(context: NixieSceneV2PlacementContext,
    socket: FoxholeSocketSnapPoint, entityId: string, localSocketName: string): boolean {
    const entity = context.entities.find(candidate => candidate.entityId === socket.nodeId);
    if (!entity) {
        return false;
    }
    if (hasFoxholePowerSocketTag(socket.socketTags)) {
        const asset = data(entity, 'asset');
        const structure = asset?.catalogId === 'foxhole.structures'
            ? getFoxholeManifest('/foxhole/assets/').assets.find(candidate => candidate.id === asset.assetId)
            : null;
        return isFoxholePowerSocketConnectionAvailable({ targetNodeId: socket.nodeId, targetSocketName: socket.socketName,
            maxConnections: structure?.powerGridInfo?.maxConnections, movingConnectorNodeId: entityId,
            movingConnectorSocketName: localSocketName, connections: context.entities.flatMap(candidate => {
                const spline = data(candidate, 'spline-connector');
                if (!spline || !isPowerlineConnector(String(spline.foxholeKey ?? ''))) {
                    return [];
                }
                return (['start', 'end'] as const).flatMap(role => {
                    const name = spline[`${role}SocketName`];
                    const targetId = spline[`${role}AttachmentNodeId`];
                    const targetName = spline[`${role}AttachmentSocketName`];
                    return typeof name === 'string'
                        ? [{ connectorNodeId: candidate.entityId, connectorSocketName: name,
                            attachment: typeof targetId === 'string' && typeof targetName === 'string'
                                ? { nodeId: targetId, socketName: targetName }
                                : undefined }]
                        : [];
                });
            }) });
    }
    const attachments = data(entity, 'socket-attachments')?.attachments;
    const map: FoxholeStructureSocketAttachmentMap = Object.fromEntries(Array.isArray(attachments)
        ? attachments.flatMap(attachment => attachment && typeof attachment === 'object' && !Array.isArray(attachment)
            && typeof attachment.localSocketName === 'string' && typeof attachment.targetEntityId === 'string'
            && typeof attachment.targetSocketName === 'string'
            ? [[attachment.localSocketName, { nodeId: attachment.targetEntityId, socketName: attachment.targetSocketName }]]
            : [])
        : []);
    const spline = data(entity, 'spline-connector');
    const connector = data(entity, 'connector');
    const endpointNames = resolveConnectorEndpointSocketNames(String((spline ?? connector)?.foxholeKey ?? ''));
    for (const role of ['start', 'end'] as const) {
        const source = spline ?? connector;
        const name = source?.[`${role}SocketName`]
            || (role === 'start' ? endpointNames.backSocketName : endpointNames.frontSocketName);
        const attachment = connector?.[`${role}Attachment`];
        const target = spline
            ? { nodeId: spline[`${role}AttachmentNodeId`], socketName: spline[`${role}AttachmentSocketName`] }
            : attachment && typeof attachment === 'object' && !Array.isArray(attachment) ? attachment : null;
        if (typeof name === 'string' && typeof target?.nodeId === 'string' && typeof target.socketName === 'string') {
            map[name] = { nodeId: target.nodeId, socketName: target.socketName };
        }
    }
    return isFoxholeSocketAvailableForAttachment(socket, map, { nodeId: entityId, socketName: localSocketName });
}
