import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { isTrenchConnector } from './trench-connector.ts';
import {
    FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
    centimetersToFoxholeBoardPixels,
    createFoxholeSplineConnectorNodeId,
    normalizeFoxholeSplineConnectorState,
    resolveDefaultEndRotation,
} from './spline-connector.ts';
import type { FoxholeSplineConnectorEndpoint, FoxholeSplineConnectorState } from './spline-connector.ts';
import type { FoxholeManifestConnector, FoxholeManifestStructure } from './manifest.ts';
import type { FoxholeStructureModificationSelectionMap } from './modification-slots.ts';
import { DEFAULT_PIPE_CURVE_T } from './pipe-spline-constraints.ts';

export interface CreateFoxholeSplineConnectorSnapshotOptions {
    id?: string;
    label?: string;
    foxholeKey: string;
    structure?: FoxholeManifestStructure | null;
    x?: number;
    y?: number;
    z?: number;
    rotation?: number;
    alpha?: number;
    visible?: boolean;
    locked?: boolean;
    startSocketName?: string;
    endSocketName?: string;
    start?: Partial<FoxholeSplineConnectorEndpoint>;
    end?: Partial<FoxholeSplineConnectorEndpoint>;
    curveT?: number;
    modificationVariantIds?: FoxholeStructureModificationSelectionMap;
}

export function createFoxholeSplineConnectorSnapshot(
    options: CreateFoxholeSplineConnectorSnapshotOptions,
): BoardNodeSnapshot<FoxholeSplineConnectorState> {
    const connector = options.structure?.connector;
    const trench = isTrenchConnector(options.foxholeKey);
    const minLength = Math.max(1, centimetersToFoxholeBoardPixels(connector?.minLengthCm ?? (trench ? 250 : 300)));
    const maxLength = Math.max(minLength, centimetersToFoxholeBoardPixels(connector?.maxLengthCm ?? (trench ? 800 : 2000)));
    const minRadius = Math.max(1, centimetersToFoxholeBoardPixels(connector?.minRadiusCm ?? 50));
    const maxRadiusCm = connector?.maxRadiusCm;
    const maxRadius = maxRadiusCm != null && maxRadiusCm > 0
        ? Math.max(minRadius, centimetersToFoxholeBoardPixels(maxRadiusCm))
        : Math.max(minRadius, maxLength);
    const maxBuffer = Math.max(0, centimetersToFoxholeBoardPixels(connector?.maxBufferCm ?? connector?.minLengthCm ?? 300));
    const start = {
        x: 0, y: 0, rotation: 0,
        ...(options.start ?? {}),
    };
    const end = {
        x: start.x + Math.cos(start.rotation) * minLength,
        y: start.y + Math.sin(start.rotation) * minLength,
        rotation: 0,
        ...(options.end ?? {}),
    };
    end.rotation = options.end?.rotation ?? resolveDefaultEndRotation(start, end, options.foxholeKey);

    const state = normalizeFoxholeSplineConnectorState({
        foxholeKey: options.foxholeKey,
        x: options.x ?? 0,
        y: options.y ?? 0,
        z: options.z,
        rotation: options.rotation ?? 0,
        visible: options.visible !== false,
        alpha: options.alpha ?? 1,
        locked: options.locked === true,
        minLength,
        maxLength,
        minRadius,
        maxRadius,
        maxBuffer,
        curveT: DEFAULT_PIPE_CURVE_T,
        maxTargetAngleDeg: connector?.maxTargetAngleDeg,
        maxArcAngleDeg: connector?.maxArcAngleDeg,
        startSocketName: options.startSocketName ?? connector?.backSocketName
            ?? (trench ? options.structure?.buildSockets.find(socket => /(?:^|:)BackSocket$/.test(socket.name))?.name : undefined),
        endSocketName: options.endSocketName ?? connector?.frontSocketName
            ?? (trench ? options.structure?.buildSockets.find(socket => /(?:^|:)FrontSocket$/.test(socket.name))?.name : undefined),
        modificationVariantIds: options.modificationVariantIds,
        start,
        end,
        ...(options.curveT !== undefined ? { curveT: options.curveT } : {}),
    });

    return {
        id: options.id ?? createFoxholeSplineConnectorNodeId(),
        type: FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
        key: options.label ?? options.foxholeKey,
        state,
        children: [],
    };
}
