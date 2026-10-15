import { allowsConnectorRotationHandles } from './pipe-connector-path.ts';
import { usesSocketFacingEndRotation } from './spline-connector.ts';
import type { FoxholeSplineConnectorState } from './spline-connector.ts';

export function resolveEndGizmoStemRotation(rotation: number, endpointRole: 'start' | 'end', foxholeKey: string): number {
    return endpointRole === 'end' && !usesSocketFacingEndRotation(foxholeKey) ? rotation + Math.PI : rotation;
}

export function getFoxholeSplineLocalEditableHandles(state: FoxholeSplineConnectorState, pathStyle?: string, maxArcAngleDeg?: number) {
    const handles = [
        { id: 'start', index: 0, kind: 'vertex' as const, local: { x: state.start.x, y: state.start.y }, canDelete: false },
        { id: 'end', index: 1, kind: 'vertex' as const, local: { x: state.end.x, y: state.end.y }, canDelete: false },
    ];
    if (allowsConnectorRotationHandles(pathStyle, state.foxholeKey, { maxArcAngleDeg })) {
        for (const [index, role] of (['start', 'end'] as const).entries()) {
            const endpoint = state[role];
            const rotation = resolveEndGizmoStemRotation(endpoint.rotation, role, state.foxholeKey);
            handles.push({ id: `${role}-rotation`, index: index + 2, kind: 'vertex',
                local: { x: endpoint.x + Math.cos(rotation) * 36, y: endpoint.y + Math.sin(rotation) * 36 }, canDelete: false });
        }
    }
    return handles;
}
