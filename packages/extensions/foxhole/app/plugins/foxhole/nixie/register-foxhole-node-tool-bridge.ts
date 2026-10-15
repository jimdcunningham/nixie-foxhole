import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { FOXHOLE_BINOCULAR_LINE_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import {
    createBinocularLineStatePatchFromOptions,
    createBinocularLineToolOptionsFromState,
} from '#foxhole/plugins/foxhole/nixie/binocular-line-tool-options.ts';
import { FOXHOLE_RANGE_NODE_TYPE, buildFoxholeRangeRadiusPatch, resolveFoxholeRangeState } from '#foxhole/plugins/foxhole/nixie/range.ts';
import {
    createRangeStatePatchFromOptions,
    createRangeToolOptionsFromState,

} from '#foxhole/plugins/foxhole/nixie/range-tool-options.ts';
import type { RangeToolOptions } from '#foxhole/plugins/foxhole/nixie/range-tool-options.ts';
import { FOXHOLE_TACTICAL_LINE_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import {
    createTacticalLineStatePatchFromOptions,
    createTacticalLineToolOptionsFromState,
} from '#foxhole/plugins/foxhole/nixie/tactical-line-tool-options.ts';
import { FOXHOLE_TRIANGULATION_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import {
    createTriangulationStatePatchFromOptions,
    createTriangulationToolOptionsFromState,
} from '#foxhole/plugins/foxhole/nixie/triangulation-tool-options.ts';
import {
    registerNodeToolBridgeExtension,

} from '#nixie/utils/nixie-node-tool-bridge.ts';
import type { NodeToolBridgeExtension } from '#nixie/utils/nixie-node-tool-bridge.ts';

const FOXHOLE_NODE_TYPE_TO_TOOL_ID: Record<string, string> = {
    [FOXHOLE_TACTICAL_LINE_NODE_TYPE]: 'foxhole-tactical-line',
    [FOXHOLE_RANGE_NODE_TYPE]: 'foxhole-range',
    [FOXHOLE_BINOCULAR_LINE_NODE_TYPE]: 'foxhole-binoculars',
    [FOXHOLE_TRIANGULATION_NODE_TYPE]: 'foxhole-triangulation',
};

const FOXHOLE_TOOL_ID_TO_NODE_TYPE = Object.fromEntries(
    Object.entries(FOXHOLE_NODE_TYPE_TO_TOOL_ID).map(([nodeType, toolId]) => [toolId, nodeType]),
) as Record<string, string>;

function resolveFoxholePresetToolIdForSnapshot(
    snapshot: BoardNodeSnapshot<Record<string, unknown>>,
): string | null {
    const type = String(snapshot.type ?? '').trim();
    return FOXHOLE_NODE_TYPE_TO_TOOL_ID[type] ?? null;
}

function readFoxholeToolOptionsFromSnapshot(
    toolId: string,
    snapshot: BoardNodeSnapshot<Record<string, unknown>>,
): Record<string, unknown> | null {
    const type = String(snapshot.type ?? '').trim();
    if (FOXHOLE_TOOL_ID_TO_NODE_TYPE[toolId] !== type) {
        return null;
    }

    const state = snapshot.state ?? {};
    if (toolId === 'foxhole-tactical-line') {
        return createTacticalLineToolOptionsFromState(state) as Record<string, unknown>;
    }
    if (toolId === 'foxhole-range') {
        return createRangeToolOptionsFromState(state) as Record<string, unknown>;
    }
    if (toolId === 'foxhole-binoculars') {
        return createBinocularLineToolOptionsFromState(state) as Record<string, unknown>;
    }
    if (toolId === 'foxhole-triangulation') {
        return createTriangulationToolOptionsFromState(state) as Record<string, unknown>;
    }

    return null;
}

function foxholeToolOptionsPatchToNodePatch(
    toolId: string,
    patch: Record<string, unknown>,
    snapshot: BoardNodeSnapshot<Record<string, unknown>>,
): Record<string, unknown> | null {
    const type = String(snapshot.type ?? '').trim();
    if (FOXHOLE_TOOL_ID_TO_NODE_TYPE[toolId] !== type) {
        return null;
    }

    if (toolId === 'foxhole-tactical-line') {
        return createTacticalLineStatePatchFromOptions(patch);
    }
    if (toolId === 'foxhole-range') {
        const { radiusMeters, ...stylePatch } = patch;
        const styleStatePatch = createRangeStatePatchFromOptions(stylePatch as Partial<RangeToolOptions>);
        const mergedState = {
            ...(snapshot.state ?? {}),
            ...styleStatePatch,
        };

        if (typeof radiusMeters === 'number' && Number.isFinite(radiusMeters)) {
            return {
                ...styleStatePatch,
                ...buildFoxholeRangeRadiusPatch(resolveFoxholeRangeState(mergedState), radiusMeters),
            };
        }

        return styleStatePatch;
    }
    if (toolId === 'foxhole-binoculars') {
        return createBinocularLineStatePatchFromOptions(patch);
    }
    if (toolId === 'foxhole-triangulation') {
        return createTriangulationStatePatchFromOptions(patch);
    }

    return null;
}

const foxholeNodeToolBridgeExtension: NodeToolBridgeExtension = {
    resolvePresetToolIdForSnapshot: resolveFoxholePresetToolIdForSnapshot,
    readToolOptionsFromSnapshot: readFoxholeToolOptionsFromSnapshot,
    toolOptionsPatchToNodePatch: foxholeToolOptionsPatchToNodePatch,
};

export function registerFoxholeNodeToolBridge(): void {
    registerNodeToolBridgeExtension(foxholeNodeToolBridgeExtension);
}
