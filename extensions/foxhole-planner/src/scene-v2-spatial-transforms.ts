import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';

export type FoxholeSpatialPoint = [number, number, number];
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const data = (entity: Entity, id: string) => entity.components.find(component => component.ownerId === 'nixie.core'
    && component.componentId === id && component.definitionAvailable)?.data;
function rotate(point: FoxholeSpatialPoint, axis: number, angle: number): FoxholeSpatialPoint {
    const result: FoxholeSpatialPoint = [...point], a = (axis + 1) % 3, b = (axis + 2) % 3;
    result[a] = point[a]! * Math.cos(angle) - point[b]! * Math.sin(angle);
    result[b] = point[a]! * Math.sin(angle) + point[b]! * Math.cos(angle);
    return result;
}

/** Detached planner XYZ transforms shared by socket rendering, targeting and attachment resolution. */
export function createFoxholeSpatialProjection(entities: readonly Entity[]) {
    const byId = new Map(entities.map(entity => [entity.entityId, entity]));
    const chain = (subject: Entity): Entity[] => {
        const result: Entity[] = [], seen = new Set<string>();
        let current: Entity | undefined = byId.get(subject.entityId) ?? subject;
        while (current && !seen.has(current.entityId)) {
            seen.add(current.entityId);
            result.push(current);
            current = byId.get(String(data(current, 'hierarchy')?.parentId ?? ''));
        }
        return result;
    };
    const transform = (subject: Entity, input: FoxholeSpatialPoint, invert: boolean): FoxholeSpatialPoint => {
        const planar = data(subject, 'transform'), spatial = data(subject, 'spatial-transform');
        const position = [number(planar?.x), -number(planar?.y), number(spatial?.elevation)];
        const scale = [number(planar?.scaleX, 1), number(planar?.scaleY, 1), number(spatial?.scaleZ, 1)];
        const rotation = [number(spatial?.rotationX), number(spatial?.rotationY), -number(planar?.rotation)];
        let point = input;
        if (invert) {
            point = point.map((value, axis) => value - position[axis]!) as FoxholeSpatialPoint;
            for (const axis of [0, 1, 2]) point = rotate(point, axis, -rotation[axis]!);
            return point.map((value, axis) => value / scale[axis]!) as FoxholeSpatialPoint;
        }
        point = point.map((value, axis) => value * scale[axis]!) as FoxholeSpatialPoint;
        for (const axis of [2, 1, 0]) point = rotate(point, axis, rotation[axis]!);
        return point.map((value, axis) => value + position[axis]!) as FoxholeSpatialPoint;
    };
    const project = (subject: Entity, input: FoxholeSpatialPoint, inverse: boolean): FoxholeSpatialPoint => {
        // Convert planner Y-down to the renderer's right-handed Z-up space once at each boundary.
        let point: FoxholeSpatialPoint = [input[0], -input[1], input[2]];
        for (const ancestor of inverse ? chain(subject).reverse() : chain(subject)) point = transform(ancestor, point, inverse);
        return [point[0], -point[1], point[2]];
    };
    return {
        toWorld: (subject: Entity, point: FoxholeSpatialPoint) => project(subject, point, false),
        toLocal: (subject: Entity, point: FoxholeSpatialPoint) => project(subject, point, true),
    };
}
