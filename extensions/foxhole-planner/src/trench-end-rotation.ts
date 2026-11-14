import type { NixieComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/scene-v2';
import { normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import { isTrenchConnector } from './trench-connector.ts';

type End = 'start' | 'end';

export function trenchEndRotationTarget(entity: Entity, end: End, entities: readonly Entity[]) {
    const data = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector' && component.definitionAvailable)?.data;
    if (typeof data?.foxholeKey !== 'string' || !isTrenchConnector(data.foxholeKey)) return null;
    const normalizeSocket = (value: unknown) => normalizeFoxholeBuildSocketName(value).toLowerCase();
    const socketName = normalizeSocket(data[`${end}SocketName`] ?? (end === 'start' ? 'BackSocket' : 'FrontSocket'));
    const occupancy = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    const reverse = Array.isArray(occupancy) ? occupancy.find(row => row && typeof row === 'object' && !Array.isArray(row)
        && normalizeSocket(row.localSocketName) === socketName) : undefined;
    const reverseLink = reverse && typeof reverse === 'object' && !Array.isArray(reverse) ? reverse : undefined;
    const targetId = data[`${end}AttachmentNodeId`] ?? reverseLink?.targetEntityId;
    if (typeof targetId !== 'string') return null;
    const target = entities.find(candidate => candidate.entityId === targetId);
    const connector = target?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.definitionAvailable && (component.componentId === 'spline-connector' || component.componentId === 'connector'));
    const targetSocket = normalizeSocket(data[`${end}AttachmentSocketName`] ?? reverseLink?.targetSocketName);
    const peerEnd = (['start', 'end'] as const).find(role => targetSocket && targetSocket === normalizeSocket(
        connector?.data[`${role}SocketName`] ?? (role === 'start' ? 'BackSocket' : 'FrontSocket')));
    return { target, connector, peerEnd, targetSocket };
}
