import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    FOXHOLE_CONNECTOR_NODE_TYPE,
    createFoxholeConnectorNodeId,
    normalizeFoxholeConnectorPoints,

} from './connector.ts';
import type { FoxholeConnectorState } from './connector.ts';

export interface CreateFoxholeConnectorSnapshotOptions {
    id?: string;
    label?: string;
    foxholeKey: string;
    points: number[];
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
    alpha?: number;
    visible?: boolean;
    locked?: boolean;
    startSocketName?: string;
    endSocketName?: string;
}

export function createFoxholeConnectorSnapshot(options: CreateFoxholeConnectorSnapshotOptions): BoardNodeSnapshot<FoxholeConnectorState> {
    return {
        id: options.id ?? createFoxholeConnectorNodeId(),
        type: FOXHOLE_CONNECTOR_NODE_TYPE,
        key: options.label ?? options.foxholeKey,
        state: {
            foxholeKey: String(options.foxholeKey ?? '').trim(),
            x: options.x ?? 0,
            y: options.y ?? 0,
            z: options.z,
            rotation: options.rotation ?? 0,
            visible: options.visible !== false,
            alpha: options.alpha ?? 1,
            scaleX: 1,
            scaleY: 1,
            locked: options.locked === true,
            points: normalizeFoxholeConnectorPoints(options.points),
            ...(options.startSocketName ? { startSocketName: options.startSocketName } : {}),
            ...(options.endSocketName ? { endSocketName: options.endSocketName } : {}),
        },
        children: [],
    };
}
