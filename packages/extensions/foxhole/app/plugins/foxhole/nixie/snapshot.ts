import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    FOXHOLE_ASSET_NODE_TYPE,
    createFoxholeStructureNodeId,

} from './types.ts';
import type { FoxholeFaction, FoxholeStructureState } from './types.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';

export interface CreateFoxholeStructureSnapshotOptions {
    id?: string;
    label?: string;
    foxholeKey: string;
    faction?: FoxholeFaction;
    colorHex?: string;
    destroyed?: boolean;
    modificationVariantIds?: FoxholeStructureModificationSelectionMap;
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
    alpha?: number;
    visible?: boolean;
    locked?: boolean;
}

export function createFoxholeStructureSnapshot(options: CreateFoxholeStructureSnapshotOptions): BoardNodeSnapshot<FoxholeStructureState> {
    return {
        id: options.id ?? createFoxholeStructureNodeId(),
        type: FOXHOLE_ASSET_NODE_TYPE,
        key: options.label ?? options.foxholeKey,
        state: {
            foxholeKey: String(options.foxholeKey ?? '').trim(),
            faction: options.faction ?? null,
            ...(options.colorHex ? { colorHex: String(options.colorHex).trim() } : {}),
            destroyed: options.destroyed === true,
            x: options.x ?? 0,
            y: options.y ?? 0,
            z: options.z,
            rotation: options.rotation ?? 0,
            visible: options.visible !== false,
            alpha: options.alpha ?? 1,
            scaleX: 1,
            scaleY: 1,
            locked: options.locked === true,
            anchorX: 0.5,
            anchorY: 0.5,
            modificationVariantIds: options.modificationVariantIds ?? {},
        },
        children: [],
    };
}
