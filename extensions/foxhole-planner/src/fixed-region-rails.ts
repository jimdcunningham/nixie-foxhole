import type { NixieEntityRendererContextV1 } from '@nixiejs/extension-sdk/scene-v2';
import maps from '#foxhole-scene-v2-maps';
import centerlines from './fixed-region-rail-centerlines.json' with { type: 'json' };
import { FOXHOLE_BOARD_UNITS_PER_METRE } from './scene-v2-footprints.ts';
import { railPathSocketPolicy } from './rail-path-sockets.ts';
import type { FoxholeSpatialPoint } from './scene-v2-spatial-transforms.ts';

const regions = new Map(Object.entries(centerlines).flatMap(([id, source]) => {
    const map = maps.regions.find(row => row.key === source.mapKey);
    return map ? [[id, { map, source }] as const] : [];
}));

const policy = railPathSocketPolicy('railtrackspline')!;

function buildNetwork(region: NonNullable<ReturnType<typeof regions.get>>, regionId: string) {
    const { map, source } = region;
    const rails = source.rails.map(rail => ({ id: `${regionId}:${rail.id}`,
        points: rail.points.map(([x, height, z]): FoxholeSpatialPoint => [
            map.x + x! * FOXHOLE_BOARD_UNITS_PER_METRE,
            map.y - z! * FOXHOLE_BOARD_UNITS_PER_METRE,
            height! * FOXHOLE_BOARD_UNITS_PER_METRE,
        ]) }));
    const sockets = rails.flatMap(rail => (['start', 'end'] as const).map(end => {
        const first = end === 'start';
        const point = first ? rail.points[0]! : rail.points.at(-1)!;
        const neighbor = first ? rail.points[1]! : rail.points.at(-2)!;
        const rotation = Math.atan2(point[1] - neighbor[1], point[0] - neighbor[0]);
        return { id: `${rail.id}:${end}`, railId: rail.id, end, point, rotation,
            socket: { name: end, x: point[0], y: point[1], z: point[2], rotation,
                socketTags: [{ category: policy.category, mask: policy.mask, tag: 'None' }] } };
    }));
    const endpoints = sockets.filter(endpoint => !sockets.some(other => other.railId !== endpoint.railId
        && Math.hypot(other.point[0] - endpoint.point[0], other.point[1] - endpoint.point[1], other.point[2] - endpoint.point[2]) <= 3));
    return { rails, endpoints };
}

const networks = new Map<string, ReturnType<typeof buildNetwork>>();

export function fixedRailNetwork(id: string) {
    const region = regions.get(id);
    if (!region) return undefined;
    let network = networks.get(id);
    if (!network) {
        network = buildNetwork(region, id);
        networks.set(id, network);
    }
    return network;
}

export function nearbyFixedRailRegions(context: NixieEntityRendererContextV1, x: number, y: number): string[] {
    return [...regions].filter(([id, { map }]) => context.settings?.[`foxhole.map.fixedRails.${id}`] === true
        && Math.abs(x - map.x) <= maps.regionWidth / 2 + 64
        && Math.abs(y - map.y) <= maps.regionHeight / 2 + 64).map(([id]) => id);
}

export function fixedRailRegionId(id: unknown): string | undefined {
    if (typeof id !== 'string' || !id.includes(':')) return undefined;
    const region = id.slice(0, id.indexOf(':'));
    return regions.has(region) ? region : undefined;
}

export function readFixedRailEndpoint(id: unknown) {
    const region = fixedRailRegionId(id);
    return region ? fixedRailNetwork(region)?.endpoints.find(endpoint => endpoint.id === id) : undefined;
}
