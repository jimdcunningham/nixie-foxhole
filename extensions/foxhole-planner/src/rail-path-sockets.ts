import { samplePointAlongSplinePath } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2BuildSocketMetadata } from './scene-v2-asset-metadata.ts';
import type { ConnectorSplinePathSample } from './spline-ribbon-mesh.ts';

const FRACTION_STEPS = 10_000;
const UNITS_PER_CM = .32;
const NAME_PATTERN = /^RailPath-(\d{1,4})-([fb])$/i;

// Blueprint path socket CDOs specify each gauge's reciprocal mask and separation.
export function railPathSocketPolicy(key: string) {
    if (!/^(?:small)?railtrackspline(?:biarc|foundation|town)?$/i.test(key)) return undefined;
    return key.toLowerCase().startsWith('small')
        ? { mask: 2097152, category: 4194304, minimumSeparation: 100 * UNITS_PER_CM }
        : { mask: 32768, category: 524288, minimumSeparation: 300 * UNITS_PER_CM };
}

export function readRailPathSocket(name: string) {
    const match = NAME_PATTERN.exec(name);
    if (!match) return undefined;
    const step = Number(match[1]);
    return step > 0 ? { fraction: step / FRACTION_STEPS, reverse: match[2]!.toLowerCase() === 'b' } : undefined;
}

export function railPathSocketHasBranch(hostId: string, name: string, branch: NixieComponentEntitySnapshotV1 | undefined): boolean {
    const spline = branch?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector' && component.definitionAvailable)?.data;
    return !!spline && (['start', 'end'] as const).some(role => spline[`${role}AttachmentNodeId`] === hostId
        && spline[`${role}AttachmentSocketName`] === name);
}

export function railSwitchStations(key: string, attachments: Record<string, unknown> | undefined) {
    if (!railPathSocketPolicy(key) || !attachments) return [];
    return Object.keys(attachments).flatMap(name => {
        const location = readRailPathSocket(name);
        return location ? [{ name, ...location }] : [];
    });
}

export function railPathSocket(key: string, path: ConnectorSplinePathSample, name: string,
    { startZ = 0, endZ = 0 }: { startZ?: number; endZ?: number } = {}): FoxholeSceneV2BuildSocketMetadata | undefined {
    const policy = railPathSocketPolicy(key);
    const location = readRailPathSocket(name);
    if (!policy || !location || path.totalLength <= 0) return undefined;
    const point = samplePointAlongSplinePath(path.points, path.lengths, location.fraction * path.totalLength);
    if (!point) return undefined;
    return { name, x: point.x, y: point.y, z: startZ + (endZ - startZ) * location.fraction,
        rotation: point.tangent + (location.reverse ? Math.PI : 0),
        socketTags: [{ mask: policy.mask, category: policy.category, tag: 'None' }] };
}

export function nearestRailPathSocket(key: string, path: ConnectorSplinePathSample,
    pointer: { x: number; y: number }, branchDirection: { x: number; y: number }, occupied: readonly string[], endpointClearance: number) {
    const policy = railPathSocketPolicy(key);
    if (!policy || path.totalLength <= endpointClearance * 2) return undefined;
    let bestDistance = Infinity;
    let station = 0;
    for (let index = 1; index < path.points.length; index++) {
        const from = path.points[index - 1]!, to = path.points[index]!;
        const dx = to.x - from.x, dy = to.y - from.y, lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) continue;
        const t = Math.max(0, Math.min(1, ((pointer.x - from.x) * dx + (pointer.y - from.y) * dy) / lengthSquared));
        const distance = Math.hypot(pointer.x - from.x - t * dx, pointer.y - from.y - t * dy);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        station = path.lengths[index - 1]! + t * (path.lengths[index]! - path.lengths[index - 1]!);
    }
    const step = Math.round(station / path.totalLength * FRACTION_STEPS);
    const distance = step / FRACTION_STEPS * path.totalLength;
    if (distance < endpointClearance || path.totalLength - distance < endpointClearance) return undefined;
    if (occupied.some(name => {
        const location = readRailPathSocket(name);
        return location && Math.abs(location.fraction * path.totalLength - distance) < policy.minimumSeparation;
    })) return undefined;
    const forward = railPathSocket(key, path, `RailPath-${step}-f`);
    if (!forward) return undefined;
    const opposite = branchDirection.x * Math.cos(forward.rotation) + branchDirection.y * Math.sin(forward.rotation) < 0;
    return opposite ? railPathSocket(key, path, `RailPath-${step}-b`) : forward;
}
