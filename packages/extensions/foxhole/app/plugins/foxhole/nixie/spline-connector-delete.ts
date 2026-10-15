import { filterFoxholeStructureSocketAttachments, normalizeFoxholeStructureSocketAttachmentMap } from './types.ts';
import { isPowerlineConnector } from './spline-connector.ts';
import type { FoxholeSplineConnectorState } from './spline-connector.ts';
import { resolvePowerlineEndpointRotationsAfterDetach } from './connector.ts';

export function resolveFoxholeSplineDeleteMutation(state: FoxholeSplineConnectorState, deletedNodeIds: ReadonlySet<string>) {
    const patch: Record<string, unknown> = {};
    const inversePatch: Record<string, unknown> = {};
    const previousSocketAttachments = normalizeFoxholeStructureSocketAttachmentMap(state.socketAttachments);
    const nextSocketAttachments = filterFoxholeStructureSocketAttachments(previousSocketAttachments,
        attachment => !deletedNodeIds.has(String(attachment.nodeId ?? '').trim()));
    if (JSON.stringify(previousSocketAttachments) !== JSON.stringify(nextSocketAttachments)) {
        patch.socketAttachments = nextSocketAttachments;
        inversePatch.socketAttachments = previousSocketAttachments;
    }
    const previousStart = state.startAttachment ?? null;
    const previousEnd = state.endAttachment ?? null;
    const nextStart = previousStart && deletedNodeIds.has(previousStart.nodeId) ? null : previousStart;
    const nextEnd = previousEnd && deletedNodeIds.has(previousEnd.nodeId) ? null : previousEnd;
    const startSocketName = String(state.startSocketName ?? '').trim();
    const endSocketName = String(state.endSocketName ?? '').trim();
    const detachedStart = Boolean(previousStart && !nextStart)
        || Boolean(startSocketName && previousSocketAttachments[startSocketName] && !nextSocketAttachments[startSocketName]);
    const detachedEnd = Boolean(previousEnd && !nextEnd)
        || Boolean(endSocketName && previousSocketAttachments[endSocketName] && !nextSocketAttachments[endSocketName]);
    if (JSON.stringify(previousStart) !== JSON.stringify(nextStart) || JSON.stringify(previousEnd) !== JSON.stringify(nextEnd)) {
        patch.startAttachment = nextStart;
        patch.endAttachment = nextEnd;
        inversePatch.startAttachment = previousStart;
        inversePatch.endAttachment = previousEnd;
    }
    if (isPowerlineConnector(state.foxholeKey) && (detachedStart || detachedEnd)) {
        const { startRotation, endRotation } = resolvePowerlineEndpointRotationsAfterDetach({
            start: state.start, end: state.end, detachedStart, detachedEnd,
        });
        if (detachedStart) {
            patch.start = { ...state.start, rotation: startRotation };
            inversePatch.start = { ...state.start };
        }
        if (detachedEnd) {
            patch.end = { ...state.end, rotation: endRotation };
            inversePatch.end = { ...state.end };
        }
    }
    return { patch, inversePatch };
}
