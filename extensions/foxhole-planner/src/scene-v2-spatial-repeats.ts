import type { NixieSpatialNodeV1, NixieSpatialPlanV1,
    NixieSpatialEndpointBindingsV1 } from '@nixiejs/extension-sdk/scene-v2';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { resolveIntervalMarkerDistances, resolveMeshConfigIntervalMarkerDistances } from './interval-marker-distances.ts';
import { resolveMineSplineMarkerSample } from './interval-connector-path.ts';
import { resolveIntervalMarkerVariantIds } from './interval-marker-variants.ts';
import { isFoxholeReferenceRoad, resolveConnectorBehavior } from './connector-behavior.ts';
import { resolveBarbedWireFencePosts } from './barbed-wire-fence.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

/** The same authored path and interval rules as the planar presentation, using actual mesh prototypes. */
export function renderFoxholeSpatialRepeats(data: FoxholeSceneV2SplineConnectorData & { startZ?: number; endZ?: number;
    endpointBindings?: NixieSpatialEndpointBindingsV1; }, asset?: FoxholeSceneV2AssetMetadata): NixieSpatialPlanV1 | undefined {
    const profile = asset?.model?.pathProfile;
    const road = data.foxholeKey === 'facilityroad';
    const referenceRoad = isFoxholeReferenceRoad(data.foxholeKey.toLowerCase());
    if (!asset?.model || (!road && !referenceRoad && !profile)) return undefined;
    const path = sampleFoxholeSceneV2Connector(data, asset);
    if (path.totalLength <= 1e-6) return undefined;
    const points = path.points.flatMap((point, i) => [point.x, point.y,
        (data.startZ ?? 0) + ((data.endZ ?? 0) - (data.startZ ?? 0)) * path.lengths[i]! / path.totalLength]);
    const length = Math.hypot(path.totalLength, (data.endZ ?? 0) - (data.startZ ?? 0));
    const distance3D = (distance: number) => Math.max(0, Math.min(length, distance / path.totalLength * length));
    const common = { kind: 'model-path' as const, resourceId: asset.model.resourceId, unitsPerMetre: 32, points,
        ...(data.endpointBindings && Object.keys(data.endpointBindings).length ? { endpointBindings: data.endpointBindings } : {}) };
    if (referenceRoad) {
        // The bounds include the sloped shoulders and the texture fades at the
        // ends. Overlap a quarter of the tile when the authored pitch is wider.
        const tileLength = asset.model.width;
        const pitch = asset.connector?.meshConfigs[0]?.interval ?? tileLength;
        const step = Math.min(tileLength * 0.75, Math.max(1, pitch));
        // Overlong saved paths can exceed the spatial plan's 64-node limit.
        // Render those with the ordinary single-node sweep.
        if (length > tileLength + 63 * step) {
            return { contractVersion: 1, nodes: [{ ...common, id: 'reference-road-0', meshIndex: 0 }] };
        }
        const nodes: NixieSpatialNodeV1[] = [];
        for (let start = 0; start < length; start += step) {
            const end = Math.min(length, start + tileLength);
            nodes.push({ ...common, id: `reference-road-${nodes.length}`, meshIndex: 0, startInset: start, endInset: length - end });
            if (end === length) break;
        }
        return { contractVersion: 1, nodes };
    }
    if (road) {
        // The original exported road GLB already contains the back cap, body and front cap in this order.
        const back = profile?.parts.start?.meshIndex ?? 0;
        const body = profile?.parts.span?.meshIndex ?? 1;
        const front = profile?.parts.end?.meshIndex ?? 2;
        const capLength = Math.min(450 * .32, length / 2);
        const nodes: NixieSpatialNodeV1[] = [
            { ...common, id: 'road-start', meshIndex: back, endInset: length - capLength },
            { ...common, id: 'road-end', meshIndex: front, startInset: length - capLength },
        ];
        if (length - 2 * capLength > 1e-6) {
            nodes.push({ ...common, id: 'road-body', meshIndex: body, startInset: capLength, endInset: capLength });
        }
        return { contractVersion: 1, nodes };
    }
    if (!profile) return undefined;
    const nodes: NixieSpatialNodeV1[] = [];
    const span = (id: string, role: string, extra = {}) => {
        const part = profile.parts[role];
        if (part) nodes.push({ ...common, id, meshIndex: part.meshIndex, ...extra });
    };
    const rigid = (id: string, role: string, instances: Array<{ distance: number; rotation?: number; offset?: [number,number,number]; }>) => {
        const part = profile.parts[role];
        if (part && instances.length) nodes.push({ ...common, id, meshIndex: part.meshIndex, sourceOrigin: part.origin, instances });
    };
    const rawIntervalConfig = (index: number) => {
        const config = asset.connector?.meshConfigs[index];
        return config && { ...config, interval: config.interval / .32,
            startOffset: config.startOffset / .32, endOffset: config.endOffset / .32 };
    };
    const interval = (index: number) => {
        const config = rawIntervalConfig(index);
        if (!config) return [];
        return resolveMeshConfigIntervalMarkerDistances(config, path.totalLength)
            .filter(sample => sample.distance <= path.totalLength).map(sample => ({ distance: distance3D(sample.distance) }));
    };
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset.connector);
    const sandbag = /^sandbag(?:half|full)spline$/u.test(data.foxholeKey);
    if ((behavior.tankStop || sandbag) && asset.connector) {
        const roles = ['marker1', 'marker2', 'marker3', 'marker4'];
        if (!roles.every(role => profile.parts[role])) return undefined;
        const meshConfigs = asset.connector.meshConfigs.map((_config, index) => rawIntervalConfig(index)!);
        const markers = resolveIntervalMarkerDistances({ meshConfigs }, path.totalLength, asset.connector.pathStyle, roles.length)
            .filter(marker => marker.distance <= path.totalLength + .001);
        const prefix = sandbag ? 'sandbag' : 'tank-stop';
        if (sandbag && profile.parts.start && markers.length) {
            // The full wall starts with a half-height lead-in on the first station.
            rigid('sandbag-start', 'start', [{ distance: distance3D(markers.shift()!.distance) }]);
            for (const [index, marker] of markers.entries()) marker.meshIndex = index % roles.length;
        }
        for (const [index, role] of roles.entries()) {
            rigid(`${prefix}-${index + 1}`, role, markers.filter(marker => marker.meshIndex === index)
                .map(marker => ({ distance: distance3D(marker.distance) })));
        }
    } else if (behavior.mineSpline && asset.connector?.pathStyle === 'interval') {
        const layers = resolveIntervalMarkerVariantIds(Object.keys(asset.renderLayers), false);
        const roles = layers.map((_layer, index) => `marker${index + 1}`);
        if (!roles.every(role => profile.parts[role])) return undefined;
        for (const [index, role] of roles.entries()) {
            const config = rawIntervalConfig(index) ?? rawIntervalConfig(0);
            const part = profile.parts[role]!;
            const markers = resolveMeshConfigIntervalMarkerDistances(config, path.totalLength)
                .filter(marker => marker.distance <= path.totalLength + .001);
            rigid(`mine-marker-${index + 1}`, role, markers.map(({ distance, meshIndex }, markerIndex) => {
                const placement = resolveMineSplineMarkerSample({ x: 0, y: 0, rotation: 0, meshIndex }, config, markerIndex);
                return { distance: distance3D(distance), rotation: placement.rotation,
                    offset: [placement.x, placement.y, part.origin[2]] };
            }));
        }
    } else if (/^(?:small)?railtrackspline(?:biarc|foundation|town)?$/.test(data.foxholeKey)) {
        span('rail-bed', 'bed'); span('rail-span', 'rail');
        rigid('rail-sleepers', 'sleeper', [...interval(0), ...interval(1)]);
    } else if (data.foxholeKey === 'barbedwirespline') {
        for (const index of [0,1]) {
            const location = asset.connector?.meshConfigs[index]?.relativeLocation ?? [0, index ? -30 : 30, 0];
            rigid(`wire-coils-${index}`, 'coil', interval(index).map(instance => ({ ...instance,
                offset: [0, -Number(location[1] ?? 0) * .32, Number(location[2] ?? 0) * .32] })));
        }
        rigid('wire-posts', 'post', [{ distance: 0 }, { distance: length }]);
    } else if (data.foxholeKey === 'barbedwirewallspline') {
        // Separate straight sections retain real corners instead of bending panels through the posts.
        for (let i = 1; i < path.points.length; i++) {
            if (path.lengths[i]! - path.lengths[i - 1]! < 1e-6) continue;
            span(`fence-section-${i}`, i === 1 ? 'startWire' : i === path.points.length - 1 ? 'endWire' : 'wire', {
                points: [...points.slice((i - 1) * 3, i * 3), ...points.slice(i * 3, (i + 1) * 3)],
                deformationRange: [path.lengths[i - 1]! / path.totalLength, path.lengths[i]! / path.totalLength],
            });
        }
        const headings = path.points.map((_, i) => {
            const direction = (a: number, b: number) => { const x = path.points[b]!.x - path.points[a]!.x, y = path.points[b]!.y - path.points[a]!.y;
                const length = Math.max(1e-9, Math.hypot(x,y)); return [x / length, y / length]; };
            const a = direction(Math.max(0,i - 1), i || 1), b = direction(i === path.points.length - 1 ? i - 1 : i, Math.min(i + 1,path.points.length - 1));
            const x = a[0]! + b[0]!, y = a[1]! + b[1]!, length = Math.max(1e-9,Math.hypot(x,y)); return [x / length,y / length];
        });
        const locate = (point: { x: number; y: number; rotation: number; }) => {
            let best = { error: Infinity, distance: 0, rotation: 0 };
            for (let i = 1; i < path.points.length; i++) {
                const a = path.points[i - 1]!, b = path.points[i]!, dx = b.x - a.x, dy = b.y - a.y;
                const t = Math.max(0,Math.min(1, ((point.x - a.x)*dx + (point.y - a.y)*dy) / Math.max(1e-9, dx*dx + dy*dy)));
                const error = Math.hypot(point.x - a.x - t*dx, point.y - a.y - t*dy);
                if (error < best.error) best = { error, distance: path.lengths[i - 1]! + t * (path.lengths[i]! - path.lengths[i - 1]!),
                    rotation: Math.atan2(headings[i - 1]![1]!*(1 - t) + headings[i]![1]!*t, headings[i - 1]![0]!*(1 - t) + headings[i]![0]!*t) };
            }
            return { distance: distance3D(best.distance), rotation: point.rotation - best.rotation };
        };
        const posts = resolveBarbedWireFencePosts(path, { interval: (asset.connector?.meshConfigs[2]?.interval ?? 70.4) / .32 });
        rigid('fence-bend-posts', 'post', [{ distance: 0 }, ...posts.filter(post => post.bend).map(locate), { distance: length }]);
        rigid('fence-middle-posts', 'middle', posts.filter(post => !post.bend).map(locate));
    }
    return nodes.length ? { contractVersion: 1, nodes } : undefined;
}
