import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import type { NixieSpatialEndpointBindingsV1 } from '@nixiejs/extension-sdk/scene-v2';
import { resolveWaterWallBuoys } from './water-wall-spline.ts';

type ModelPath = Extract<NixieSpatialPlanV1['nodes'][number], { kind: 'model-path'; }>;

// Mesh indices and socket origins from the existing FoxWatch GLBs. The useful
// meshes are baked into the model at its sample length, in Blueprint space.
const fieldSpans = {
    fieldbridge: { deck: 2, pillars: [3, 4], ramps: [0, 1], sockets: [0, 128] },
    fieldpier: { deck: 0, pillars: [1, 2], ramps: [3, 4], sockets: [96, 208] },
} as const;

export function renderFoxholeStraightSpatialSpan(
    data: FoxholeSceneV2SplineConnectorData & {
        startZ?: number;
        endZ?: number;
        endpointBindings?: NixieSpatialEndpointBindingsV1;
    },
    asset?: FoxholeSceneV2AssetMetadata,
): NixieSpatialPlanV1 | undefined {
    const model = asset?.model;
    if (!model) return undefined;
    const start = { x: data.startX, y: data.startY };
    const end = { x: data.endX, y: data.endY };
    const length2D = Math.hypot(end.x - start.x, end.y - start.y);
    const startZ = data.startZ ?? 0;
    const endZ = data.endZ ?? 0;
    const length = Math.hypot(length2D, endZ - startZ);
    if (length2D < 1e-6) return undefined;

    const nodes: ModelPath[] = [];
    const common = {
        kind: 'model-path' as const, resourceId: model.resourceId, unitsPerMetre: 32,
        points: [start.x, start.y, startZ, end.x, end.y, endZ],
        ...(data.endpointBindings?.start || data.endpointBindings?.end ? { endpointBindings: data.endpointBindings } : {}),
    };
    const span = (id: string, meshIndex: number) => nodes.push({ ...common, id, meshIndex });
    const rigid = (id: string, meshIndex: number, sourceX: number, distances: number[]) => {
        if (distances.length) {
            nodes.push({ ...common, id, meshIndex, sourceOrigin: [sourceX, 0, 0],
                instances: distances.map(distance => ({ distance: distance * length / length2D })) });
        }
    };
    const atIntervals = (step: number, endInset: number) => Array.from({
        length: Math.min(512, Math.max(0, Math.floor((length2D - endInset) / step))),
    }, (_, index) => (index + 1) * step);

    const key = data.foxholeKey;
    if (key === 'fieldbridge' || key === 'fieldpier') {
        const profile = fieldSpans[key];
        span('deck', profile.deck);
        for (const [index, role] of (['start', 'end'] as const).entries()) {
            const distance = role === 'start' ? 0 : length2D;
            rigid(role + '-pillar', profile.pillars[index]!, profile.sockets[index]!, [distance]);
            const socket = role === 'start' ? data.startSocketName : data.endSocketName;
            const attached = data[role === 'start' ? 'startAttachmentNodeId' : 'endAttachmentNodeId']
                || (socket && data.socketAttachments?.[socket]);
            if (!attached) {
                rigid(role + '-ramp', profile.ramps[index]!, profile.sockets[index]!, [distance]);
            }
        }
    } else if (key === 'facilitycatwalkbridge') {
        span('deck', 6);
        const step = asset.connector?.meshConfigs[1]?.interval || 74.08;
        rigid('cross-braces', 7, 0, [0, ...atIntervals(step, step)].slice(0, 512));
    } else if (/^wallsplinet[123]$/.test(key)) {
        span('wall', 3);
        span('barbed-wire', 0);
        rigid('start-pillar', 5, 0, [0]);
        rigid('end-pillar', 6, 96, [length2D]);
        const step = asset.connector?.meshConfigs[2]?.interval || 64;
        rigid('supports', 4, 64, atIntervals(step, step / 2));
    } else if (key === 'waterwallsplinet1') {
        span('net', 0);
        const buoys = resolveWaterWallBuoys(start, end, { interval: (asset.connector?.meshConfigs[1]?.interval || 160) / 0.32 });
        rigid('start-buoy', 2, 0, [0]);
        rigid('buoys', 1, 160, buoys.slice(1).map(buoy => Math.min(length2D, Math.hypot(buoy.x - start.x, buoy.y - start.y))));
    } else if (key === 'cranerailtrackspline') {
        span('track', 0);
    }
    return nodes.length ? { contractVersion: 1, nodes } : undefined;
}
