import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderGraphicsV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';
import { foxholeRenderLane, NIXIE_DEFAULT_RENDER_LANE } from './render-lanes.ts';

export interface FoxholeSceneV2TacticalLineData {
    points: number[];
    scaleWithZoom: boolean;
    curveMode: 'polyline' | 'smooth';
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: 'solid' | 'dashed';
    strokeDashLength: number;
    strokeDashGap: number;
    startCap: 'none' | 'arrow' | 'flag' | 'circle';
    endCap: 'none' | 'arrow' | 'flag' | 'circle';
    decoratorMode: 'none' | 'semicircle' | 'triangle' | 'tick' | 'block' | 'cross' | 'arrow';
    decoratorSide: 'left' | 'right' | 'both';
    decoratorSize: number;
    decoratorSpacing: number;
    decoratorFill: boolean;
    decoratorColor: number;
    decoratorAlpha: number;
    presetId: 'frontline' | 'advance' | 'fallback' | 'fortified' | 'cross';
}

interface Point {
    x: number;
    y: number;
}

function pointsFromNumbers(points: readonly number[]): Point[] {
    const result: Point[] = [];
    for (let index = 0; index < points.length; index += 2) {
        result.push({ x: points[index]!, y: points[index + 1]! });
    }
    return result;
}

function sampleCatmullRom(points: readonly Point[], stepsPerSegment = 16): Point[] {
    if (points.length <= 2) {
        return points.map(point => ({ ...point }));
    }
    const sampled: Point[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = points[Math.max(0, index - 1)]!;
        const p1 = points[index]!;
        const p2 = points[index + 1]!;
        const p3 = points[Math.min(points.length - 1, index + 2)]!;
        for (let step = 0; step < stepsPerSegment; step += 1) {
            const t = step / stepsPerSegment;
            const t2 = t * t;
            const t3 = t2 * t;
            sampled.push({
                x: 0.5 * ((2 * p1.x) + ((-p0.x + p2.x) * t) + (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2) + ((-p0.x + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)),
                y: 0.5 * ((2 * p1.y) + ((-p0.y + p2.y) * t) + (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2) + ((-p0.y + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)),
            });
        }
    }
    sampled.push({ ...points[points.length - 1]! });
    return sampled;
}

function pathMetrics(points: readonly Point[]): { lengths: number[]; totalLength: number; } {
    const lengths = [0];
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
        totalLength += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
        lengths.push(totalLength);
    }
    return { lengths, totalLength };
}

function sampleAlongPath(
    points: readonly Point[],
    lengths: readonly number[],
    distance: number,
): { point: Point; tangent: Point; } | null {
    if (points.length < 2) {
        return null;
    }
    const clamped = Math.max(0, Math.min(distance, lengths[lengths.length - 1] ?? 0));
    for (let index = 1; index < lengths.length; index += 1) {
        const startDistance = lengths[index - 1]!;
        const endDistance = lengths[index]!;
        if (clamped > endDistance && index < lengths.length - 1) {
            continue;
        }
        const from = points[index - 1]!;
        const to = points[index]!;
        const segmentLength = Math.max(Number.EPSILON, endDistance - startDistance);
        const t = Math.max(0, Math.min(1, (clamped - startDistance) / segmentLength));
        const tangentLength = Math.max(Number.EPSILON, Math.hypot(to.x - from.x, to.y - from.y));
        return {
            point: { x: from.x + ((to.x - from.x) * t), y: from.y + ((to.y - from.y) * t) },
            tangent: { x: (to.x - from.x) / tangentLength, y: (to.y - from.y) / tangentLength },
        };
    }
    return null;
}

function trimPath(points: readonly Point[], startInset: number, endInset: number): Point[] {
    const { lengths, totalLength } = pathMetrics(points);
    const startDistance = Math.max(0, Math.min(startInset, totalLength));
    const endDistance = Math.max(startDistance, Math.min(totalLength, totalLength - endInset));
    if (points.length < 2 || endDistance - startDistance <= Number.EPSILON) {
        return points.map(point => ({ ...point }));
    }
    const start = sampleAlongPath(points, lengths, startDistance);
    const end = sampleAlongPath(points, lengths, endDistance);
    if (!start || !end) {
        return points.map(point => ({ ...point }));
    }
    return [
        start.point,
        ...points.slice(1, -1).filter((_, index) => {
            const length = lengths[index + 1]!;
            return length > startDistance && length < endDistance;
        }),
        end.point,
    ];
}

function capInset(cap: FoxholeSceneV2TacticalLineData['startCap'], size: number): number {
    if (cap === 'arrow') {
        return size * 0.96;
    }
    return cap === 'circle' ? size * 0.4 : 0;
}

function minimumUsefulVisibleLength(data: FoxholeSceneV2TacticalLineData): number {
    if (data.strokeStyle === 'dashed' || data.decoratorMode === 'none') {
        const capAllowance = Math.max(
            capInset(data.startCap, 16),
            capInset(data.endCap, 16),
            data.strokeWidth * 2,
            24,
        );
        return capAllowance * 4;
    }
    const spacing = Math.max(data.decoratorSpacing, data.decoratorSize * 0.8, 12);
    const offset = Math.max(spacing * 0.65, data.strokeWidth * 1.4);
    return ((offset * 2) + spacing) * 1.5;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const ratio = edge0 === edge1
        ? (value >= edge1 ? 1 : 0)
        : Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return ratio * ratio * (3 - (2 * ratio));
}

function effectiveRenderScale(
    data: FoxholeSceneV2TacticalLineData,
    rawRenderScale: number,
    totalLength: number,
): number {
    if (!data.scaleWithZoom) {
        return 1;
    }
    const zoomScale = Math.max(0.1, rawRenderScale);
    if (!Number.isFinite(totalLength) || totalLength <= Number.EPSILON) {
        return zoomScale;
    }
    const minimumLength = minimumUsefulVisibleLength(data);
    if (zoomScale <= 1) {
        const visibleLength = totalLength / Math.max(zoomScale, Number.EPSILON);
        const zoomInBlend = 0.2 + (0.8 * (1 - smoothstep(
            minimumLength * 4,
            minimumLength * 24,
            visibleLength,
        )));
        return 1 + ((zoomScale - 1) * zoomInBlend);
    }
    return Math.min(zoomScale, Math.max(1, totalLength / Math.max(minimumLength, 1)));
}

function pushPolyline(
    commands: NixieExtensionGraphicsCommandV1[],
    points: readonly Point[],
    data: FoxholeSceneV2TacticalLineData,
): void {
    if (points.length < 2) {
        return;
    }
    commands.push({ op: 'move-to', ...points[0]! });
    for (const point of points.slice(1)) {
        commands.push({ op: 'line-to', ...point });
    }
    commands.push({
        op: 'stroke',
        color: data.strokeColor,
        width: data.strokeWidth,
        alpha: data.strokeAlpha,
        cap: 'round',
        join: 'round',
    });
}

function strokeCommands(points: readonly Point[], data: FoxholeSceneV2TacticalLineData): NixieExtensionGraphicsCommandV1[] {
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    if (data.strokeStyle === 'solid') {
        pushPolyline(commands, points, data);
        return commands;
    }
    const { lengths, totalLength } = pathMetrics(points);
    const dashLength = Math.max(data.strokeDashLength, data.strokeWidth, 2);
    const dashGap = Math.max(data.strokeDashGap, 1);
    for (let cursor = 0; cursor < totalLength; cursor += dashLength + dashGap) {
        const start = sampleAlongPath(points, lengths, cursor);
        const end = sampleAlongPath(points, lengths, Math.min(totalLength, cursor + dashLength));
        if (start && end) {
            pushPolyline(commands, [start.point, end.point], data);
        }
    }
    return commands;
}

function polygonCommands(
    points: readonly Point[],
    data: FoxholeSceneV2TacticalLineData,
    fill = true,
    strokeWidth = Math.max(2, data.decoratorSize * 0.14),
): NixieExtensionGraphicsCommandV1[] {
    return [
        { op: 'polygon', points: [...points], close: true },
        ...(fill ? [{ op: 'fill', color: data.decoratorColor, alpha: data.decoratorAlpha } as const] : []),
        {
            op: 'stroke',
            color: data.strokeColor,
            width: strokeWidth,
            alpha: data.strokeAlpha,
            cap: 'round',
            join: 'round',
        },
    ];
}

function capCommands(
    cap: FoxholeSceneV2TacticalLineData['startCap'],
    anchor: Point,
    tangent: Point,
    data: FoxholeSceneV2TacticalLineData,
    nodeRotation: number,
): NixieExtensionGraphicsCommandV1[] {
    const size = Math.max(data.strokeWidth * 1.15, 16);
    const normal = { x: -tangent.y, y: tangent.x };
    if (cap === 'arrow') {
        const base = { x: anchor.x - (tangent.x * size), y: anchor.y - (tangent.y * size) };
        return polygonCommands([
            { x: base.x + (normal.x * size * 0.55), y: base.y + (normal.y * size * 0.55) },
            anchor,
            { x: base.x - (normal.x * size * 0.55), y: base.y - (normal.y * size * 0.55) },
        ], data, true, Math.max(2, size * 0.18));
    }
    if (cap === 'circle') {
        return [
            { op: 'circle', x: anchor.x, y: anchor.y, radius: size * 0.36 },
            { op: 'fill', color: data.decoratorColor, alpha: data.decoratorAlpha },
            { op: 'stroke', color: data.strokeColor, width: Math.max(2, size * 0.14), alpha: data.strokeAlpha },
        ];
    }
    if (cap === 'flag') {
        const cosine = Math.cos(-nodeRotation);
        const sine = Math.sin(-nodeRotation);
        const rotate = (x: number, y: number): Point => ({ x: (x * cosine) - (y * sine), y: (x * sine) + (y * cosine) });
        const mastOffset = rotate(0, -size * 1.6);
        const mastTop = { x: anchor.x + mastOffset.x, y: anchor.y + mastOffset.y };
        const flapOuter = rotate(size * 0.9, size * 0.18);
        const flapLower = rotate(0, size * 0.6);
        return [
            { op: 'move-to', ...anchor },
            { op: 'line-to', ...mastTop },
            { op: 'stroke', color: data.strokeColor, width: Math.max(2, size * 0.14), alpha: data.strokeAlpha, cap: 'round' },
            ...polygonCommands([
                mastTop,
                { x: mastTop.x + flapOuter.x, y: mastTop.y + flapOuter.y },
                { x: mastTop.x + flapLower.x, y: mastTop.y + flapLower.y },
            ], data, true, Math.max(2, size * 0.12)),
        ];
    }
    return [];
}

function decoratorCommands(
    point: Point,
    tangent: Point,
    normal: Point,
    data: FoxholeSceneV2TacticalLineData,
): NixieExtensionGraphicsCommandV1[] {
    const size = data.decoratorSize;
    if (data.decoratorMode === 'triangle') {
        return polygonCommands([
            { x: point.x + (normal.x * size), y: point.y + (normal.y * size) },
            { x: point.x - (tangent.x * size * 0.45), y: point.y - (tangent.y * size * 0.45) },
            { x: point.x + (tangent.x * size * 0.45), y: point.y + (tangent.y * size * 0.45) },
        ], data, data.decoratorFill);
    }
    if (data.decoratorMode === 'tick') {
        return [
            { op: 'move-to', ...point },
            { op: 'line-to', x: point.x + (normal.x * size), y: point.y + (normal.y * size) },
            { op: 'stroke', color: data.strokeColor, width: Math.max(2, size * 0.14), alpha: data.strokeAlpha, cap: 'round' },
        ];
    }
    if (data.decoratorMode === 'block') {
        const along = size * 0.34;
        return polygonCommands([
            { x: point.x - (tangent.x * along), y: point.y - (tangent.y * along) },
            { x: point.x + (tangent.x * along), y: point.y + (tangent.y * along) },
            { x: point.x + (tangent.x * along) + (normal.x * size * 0.72), y: point.y + (tangent.y * along) + (normal.y * size * 0.72) },
            { x: point.x - (tangent.x * along) + (normal.x * size * 0.72), y: point.y - (tangent.y * along) + (normal.y * size * 0.72) },
        ], data, data.decoratorFill);
    }
    if (data.decoratorMode === 'cross') {
        const back = { x: point.x + (normal.x * size * 0.78), y: point.y + (normal.y * size * 0.78) };
        return [
            { op: 'move-to', x: back.x - (tangent.x * size * 0.42), y: back.y - (tangent.y * size * 0.42) },
            { op: 'line-to', ...point },
            { op: 'line-to', x: back.x + (tangent.x * size * 0.42), y: back.y + (tangent.y * size * 0.42) },
            { op: 'stroke', color: data.strokeColor, width: Math.max(2, size * 0.16), alpha: data.strokeAlpha, cap: 'round', join: 'round' },
        ];
    }
    if (data.decoratorMode === 'arrow') {
        return polygonCommands([
            { x: point.x + (normal.x * size * 0.56), y: point.y + (normal.y * size * 0.56) },
            { x: point.x + (tangent.x * size * 0.92), y: point.y + (tangent.y * size * 0.92) },
            { x: point.x - (normal.x * size * 0.56), y: point.y - (normal.y * size * 0.56) },
        ], data);
    }
    if (data.decoratorMode === 'semicircle') {
        const arc: Point[] = [];
        for (let index = 0; index <= 12; index += 1) {
            const angle = Math.PI - ((index / 12) * Math.PI);
            arc.push({
                x: point.x + (tangent.x * Math.cos(angle) * size * 0.5) + (normal.x * Math.sin(angle) * size * 0.5),
                y: point.y + (tangent.y * Math.cos(angle) * size * 0.5) + (normal.y * Math.sin(angle) * size * 0.5),
            });
        }
        const commands: NixieExtensionGraphicsCommandV1[] = [];
        if (data.decoratorFill) {
            commands.push({ op: 'polygon', points: arc, close: true });
            commands.push({ op: 'fill', color: data.decoratorColor, alpha: data.decoratorAlpha });
        }
        commands.push({ op: 'move-to', ...arc[0]! });
        for (const arcPoint of arc.slice(1)) {
            commands.push({ op: 'line-to', ...arcPoint });
        }
        commands.push({ op: 'stroke', color: data.strokeColor, width: Math.max(2, size * 0.14), alpha: data.strokeAlpha, cap: 'round', join: 'round' });
        return commands;
    }
    return [];
}

function decorations(
    points: readonly Point[],
    data: FoxholeSceneV2TacticalLineData,
    renderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    if (data.strokeStyle === 'dashed' || data.decoratorMode === 'none') {
        return [];
    }
    const { lengths, totalLength } = pathMetrics(points);
    const spacing = Math.max(data.decoratorSpacing, data.decoratorSize * 0.8, 12 * renderScale);
    const startOffset = Math.max(spacing * 0.65, data.strokeWidth * 1.4);
    const usableLength = totalLength - (startOffset * 2);
    if (usableLength <= Number.EPSILON) {
        return [];
    }
    const count = Math.max(1, Math.floor(usableLength / spacing) + 1);
    const start = startOffset + Math.max(0, (usableLength - ((count - 1) * spacing)) * 0.5);
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    for (let index = 0; index < count; index += 1) {
        const cursor = start + (index * spacing);
        const probeDistance = Math.max(data.decoratorSize * 0.9, spacing * 0.42, data.strokeWidth * 2.5);
        const before = sampleAlongPath(points, lengths, Math.max(0, cursor - probeDistance));
        const after = sampleAlongPath(points, lengths, Math.min(totalLength, cursor + probeDistance));
        const maximumTurn = data.decoratorMode === 'tick' ? 26 : 34;
        if (before && after
            && ((before.tangent.x * after.tangent.x) + (before.tangent.y * after.tangent.y))
            < Math.cos((maximumTurn * Math.PI) / 180)) {
            continue;
        }
        const sample = sampleAlongPath(points, lengths, cursor);
        if (!sample) {
            continue;
        }
        const normal = { x: -sample.tangent.y, y: sample.tangent.x };
        if (data.decoratorSide === 'left' || data.decoratorSide === 'both') {
            commands.push(...decoratorCommands(sample.point, data.decoratorMode === 'arrow'
                ? { x: -sample.tangent.x, y: -sample.tangent.y }
                : sample.tangent, normal, data));
        }
        if (data.decoratorSide === 'right' || data.decoratorSide === 'both') {
            commands.push(...decoratorCommands(sample.point, sample.tangent, { x: -normal.x, y: -normal.y }, data));
        }
    }
    return commands;
}

export function renderFoxholeSceneV2TacticalLine(
    data: FoxholeSceneV2TacticalLineData,
    nodeRotation = 0,
    rawRenderScale = 1,
): NixieExtensionRenderGraphicsV1[] {
    const sampled = data.curveMode === 'smooth'
        ? sampleCatmullRom(pointsFromNumbers(data.points))
        : pointsFromNumbers(data.points);
    const { totalLength } = pathMetrics(sampled);
    const renderScale = effectiveRenderScale(data, rawRenderScale, totalLength);
    const renderedData: FoxholeSceneV2TacticalLineData = {
        ...data,
        strokeWidth: data.strokeWidth * renderScale,
        strokeDashLength: data.strokeDashLength * renderScale,
        strokeDashGap: data.strokeDashGap * renderScale,
        decoratorSize: data.decoratorSize * renderScale,
        decoratorSpacing: data.decoratorSpacing * renderScale,
    };
    const capSize = Math.max(renderedData.strokeWidth * 1.15, 16 * renderScale);
    const stroked = trimPath(sampled, capInset(data.startCap, capSize), capInset(data.endCap, capSize));
    const start = sampled[0]!;
    const second = sampled[1]!;
    const end = sampled[sampled.length - 1]!;
    const beforeEnd = sampled[sampled.length - 2]!;
    const direction = (from: Point, to: Point): Point => {
        const length = Math.max(Number.EPSILON, Math.hypot(to.x - from.x, to.y - from.y));
        return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    };
    return [{
        id: 'tactical-line-stroke',
        kind: 'graphics',
        ...foxholeRenderLane(NIXIE_DEFAULT_RENDER_LANE),
        commands: strokeCommands(stroked, renderedData),
    }, {
        id: 'tactical-line-decorators',
        kind: 'graphics',
        ...foxholeRenderLane(NIXIE_DEFAULT_RENDER_LANE),
        commands: decorations(stroked, renderedData, renderScale),
    }, {
        id: 'tactical-line-caps',
        kind: 'graphics',
        ...foxholeRenderLane(NIXIE_DEFAULT_RENDER_LANE),
        commands: [
            ...capCommands(data.startCap, start, direction(second, start), renderedData, nodeRotation),
            ...capCommands(data.endCap, end, direction(beforeEnd, end), renderedData, nodeRotation),
        ],
    }];
}
