import type { NixieComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/scene-v2';
import { readFoxholeSceneV2CoreTransform } from './scene-v2-core-transforms.ts';

export type FoxholeSpatialPoint = [number, number, number];
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const data = (entity: Entity, id: string) => entity.components.find(component => component.ownerId === 'nixie.core'
    && component.componentId === id && component.definitionAvailable)?.data;
function rotate(point: FoxholeSpatialPoint, axis: number, cos: number, sin: number): FoxholeSpatialPoint {
    if (cos === 1 && sin === 0) return point;
    const result: FoxholeSpatialPoint = [...point], a = (axis + 1) % 3, b = (axis + 2) % 3;
    result[a] = point[a]! * cos - point[b]! * sin;
    result[b] = point[a]! * sin + point[b]! * cos;
    return result;
}

function preparePose(subject: Entity) {
    const pose = readFoxholeSceneV2CoreTransform(subject);
    const rotation = [number(pose?.rotation.x), number(pose?.rotation.y), -number(pose?.rotation.z)];
    return {
        position: [number(pose?.position.x), -number(pose?.position.y), number(pose?.position.z)],
        scale: [number(pose?.scale.x, 1), number(pose?.scale.y, 1), number(pose?.scale.z, 1)],
        cos: rotation.map(Math.cos),
        sin: rotation.map(Math.sin),
    };
}

/** Detached planner XYZ transforms shared by socket rendering, targeting and attachment resolution. */
export function createFoxholeSpatialProjection(entities: readonly Entity[]) {
    const byId = new Map(entities.map(entity => [entity.entityId, entity]));
    const poses = new WeakMap<Entity, ReturnType<typeof preparePose>>();
    const chains = new WeakMap<Entity, readonly ReturnType<typeof preparePose>[]>();
    const chain = (subject: Entity) => {
        const root = byId.get(subject.entityId) ?? subject;
        const cached = chains.get(root);
        if (cached) return cached;
        const result: ReturnType<typeof preparePose>[] = [], seen = new Set<string>();
        let current: Entity | undefined = root;
        while (current && !seen.has(current.entityId)) {
            seen.add(current.entityId);
            let pose = poses.get(current);
            if (!pose) {
                pose = preparePose(current);
                poses.set(current, pose);
            }
            result.push(pose);
            current = byId.get(String(data(current, 'hierarchy')?.parentId ?? ''));
        }
        chains.set(root, result);
        return result;
    };
    const transform = ({ position, scale, cos, sin }: ReturnType<typeof preparePose>,
        input: FoxholeSpatialPoint, invert: boolean): FoxholeSpatialPoint => {
        let point = input;
        if (invert) {
            point = point.map((value, axis) => value - position[axis]!) as FoxholeSpatialPoint;
            for (let axis = 0; axis < 3; axis++) point = rotate(point, axis, cos[axis]!, -sin[axis]!);
            return point.map((value, axis) => value / scale[axis]!) as FoxholeSpatialPoint;
        }
        point = point.map((value, axis) => value * scale[axis]!) as FoxholeSpatialPoint;
        for (let axis = 2; axis >= 0; axis--) point = rotate(point, axis, cos[axis]!, sin[axis]!);
        return point.map((value, axis) => value + position[axis]!) as FoxholeSpatialPoint;
    };
    const project = (subject: Entity, input: FoxholeSpatialPoint, inverse: boolean): FoxholeSpatialPoint => {
        // Convert planner Y-down to the renderer's right-handed Z-up space once at each boundary.
        let point: FoxholeSpatialPoint = [input[0], -input[1], input[2]];
        const ancestors = chain(subject);
        for (let index = 0; index < ancestors.length; index++) {
            point = transform(ancestors[inverse ? ancestors.length - 1 - index : index]!, point, inverse);
        }
        return [point[0], -point[1], point[2]];
    };
    return {
        toWorld: (subject: Entity, point: FoxholeSpatialPoint) => project(subject, point, false),
        toLocal: (subject: Entity, point: FoxholeSpatialPoint) => project(subject, point, true),
    };
}
