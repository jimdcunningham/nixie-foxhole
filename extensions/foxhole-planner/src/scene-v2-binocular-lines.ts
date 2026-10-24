import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderNodeV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';

export interface FoxholeSceneV2BinocularLineData {
    points: number[];
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    multiSegmentAlpha: number;
    showDistance: boolean;
    showAzimuth: boolean;
    showAzimuthArrows: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    endpointRadius: number;
    startCap: 'none' | 'arrow' | 'circle';
    endCap: 'none' | 'arrow' | 'circle';
    meterPixels: number;
    decimals: number;
}

interface Point {
    x: number;
    y: number;
}

interface Segment {
    start: Point;
    end: Point;
    allowFlipping: boolean;
}

function pointsFromNumbers(points: readonly number[]): Point[] {
    const result: Point[] = [];
    for (let index = 0; index < points.length; index += 2) {
        result.push({ x: points[index]!, y: points[index + 1]! });
    }
    return result;
}

function segmentsFromPoints(points: readonly Point[]): Segment[] {
    if (points.length < 2) {
        return [];
    }
    const segments: Segment[] = points.slice(1).map(point => ({
        start: points[0]!,
        end: point,
        allowFlipping: false,
    }));
    if (points.length > 2) {
        for (let index = 2; index < points.length; index += 1) {
            segments.push({ start: points[index - 1]!, end: points[index]!, allowFlipping: true });
        }
    }
    return segments;
}

function lineCommands(
    start: Point,
    end: Point,
    data: FoxholeSceneV2BinocularLineData,
    alpha: number,
    startInset = 0,
    endInset = 0,
): NixieExtensionGraphicsCommandV1[] {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= Number.EPSILON) {
        return [];
    }
    const tangentX = (end.x - start.x) / length;
    const tangentY = (end.y - start.y) / length;
    const resolvedStartInset = Math.min(Math.max(startInset, 0), Math.max(0, length - Number.EPSILON));
    const resolvedEndInset = Math.min(Math.max(endInset, 0), Math.max(0, length - resolvedStartInset));
    return [{
        op: 'move-to',
        x: start.x + (tangentX * resolvedStartInset),
        y: start.y + (tangentY * resolvedStartInset),
    }, {
        op: 'line-to',
        x: end.x - (tangentX * resolvedEndInset),
        y: end.y - (tangentY * resolvedEndInset),
    }, {
        op: 'stroke',
        color: data.strokeColor,
        width: data.strokeWidth,
        alpha,
        cap: 'butt',
        join: 'round',
    }];
}

function arrowCommands(
    start: Point,
    end: Point,
    data: FoxholeSceneV2BinocularLineData,
    renderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= Number.EPSILON) {
        return [];
    }
    const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const normal = { x: -tangent.y, y: tangent.x };
    const halfLength = Math.max(10 * renderScale, data.strokeWidth * 2);
    const shoulder = { x: end.x - (tangent.x * halfLength), y: end.y - (tangent.y * halfLength) };
    const tail = { x: end.x - (tangent.x * halfLength * 1.55), y: end.y - (tangent.y * halfLength * 1.55) };
    return [{
        op: 'polygon',
        close: true,
        points: [
            end,
            { x: tail.x + (normal.x * halfLength), y: tail.y + (normal.y * halfLength) },
            shoulder,
            { x: tail.x - (normal.x * halfLength), y: tail.y - (normal.y * halfLength) },
        ],
    }, { op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha }];
}

function chevronCommands(
    segment: Segment,
    data: FoxholeSceneV2BinocularLineData,
    renderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    if (!data.showAzimuth || !data.showAzimuthArrows) {
        return [];
    }
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    if (length <= Number.EPSILON) {
        return [];
    }
    const tangent = { x: (segment.end.x - segment.start.x) / length, y: (segment.end.y - segment.start.y) / length };
    const normal = { x: -tangent.y, y: tangent.x };
    const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
    const transform = (localX: number, localY: number): Point => ({
        x: midpoint.x + (tangent.x * localX) + (normal.x * localY),
        y: midpoint.y + (tangent.y * localX) + (normal.y * localY),
    });
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    const color = segment.allowFlipping ? data.labelBackgroundColor : data.strokeColor;
    const alpha = segment.allowFlipping ? 0.75 : data.strokeAlpha;
    for (const position of [length / 4, -length / 4]) {
        commands.push({
            op: 'polygon',
            close: true,
            points: [
                transform(position, 0),
                transform(position - (12 * renderScale), 10 * renderScale),
                transform(position - (12 * renderScale), -10 * renderScale),
            ],
        }, { op: 'fill', color, alpha });
        commands.push({
            op: 'polygon',
            close: true,
            points: [
                transform(position + (12 * renderScale), 0),
                transform(position, 10 * renderScale),
                transform(position, -10 * renderScale),
            ],
        }, { op: 'fill', color, alpha });
    }
    return commands;
}

function graphicsCommands(
    data: FoxholeSceneV2BinocularLineData,
    points: readonly Point[],
    rawRenderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    const segments = segmentsFromPoints(points);
    const renderScale = data.scaleWithZoom ? Math.max(0.05, rawRenderScale) : 1;
    const labelScale = Math.max(0.05, rawRenderScale);
    const renderedData = { ...data, strokeWidth: data.strokeWidth * renderScale };
    const lineAlpha = points.length > 2 ? data.multiSegmentAlpha : data.strokeAlpha;
    for (const segment of segments) {
        const primary = points.length === 2 && !segment.allowFlipping;
        commands.push(...lineCommands(
            segment.start,
            segment.end,
            renderedData,
            lineAlpha,
            primary && data.startCap === 'arrow' ? data.strokeWidth * 2 : 0,
            primary && data.endCap === 'arrow' ? data.strokeWidth * 2 : 0,
        ));
        commands.push(...chevronCommands(segment, data, labelScale));
    }
    if (points.length === 2 && data.startCap === 'arrow') {
        commands.push(...arrowCommands(points[1]!, points[0]!, renderedData, renderScale));
    }
    if (points.length === 2 && data.endCap === 'arrow') {
        commands.push(...arrowCommands(points[0]!, points[1]!, renderedData, renderScale));
    }
    for (let index = 0; index < points.length; index += 1) {
        const cap = index === 0 ? data.startCap : index === 1 ? data.endCap : 'circle';
        if (cap === 'circle') {
            commands.push({
                op: 'circle',
                ...points[index]!,
                radius: Math.max(data.strokeWidth * 1.125, 5) * renderScale,
            });
            commands.push({ op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha });
        }
        if (data.endpointRadius > 0) {
            commands.push({
                op: 'circle',
                ...points[index]!,
                radius: Math.max(data.strokeWidth * 1.125, data.endpointRadius) * renderScale,
            });
            commands.push({ op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha });
        }
    }
    return commands;
}

function normalizeAngleRadians(radians: number): number {
    const twoPi = Math.PI * 2;
    return radians - (twoPi * Math.floor(radians / twoPi));
}

function measurementText(segment: Segment, data: FoxholeSceneV2BinocularLineData, nodeRotation: number): string {
    const distance = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    const parts: string[] = [];
    if (data.showDistance) {
        parts.push(`${(distance / Math.max(1, data.meterPixels)).toFixed(data.decimals)}m`);
    }
    if (data.showAzimuth) {
        const angle = Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x);
        const azimuth = normalizeAngleRadians(nodeRotation + angle + (Math.PI / 2));
        parts.push(`${(azimuth * 180 / Math.PI).toFixed(data.decimals)}°`);
    }
    return parts.join('\n');
}

function labelNode(
    segment: Segment,
    data: FoxholeSceneV2BinocularLineData,
    nodeRotation: number,
    index: number,
    renderScale: number,
): NixieExtensionRenderNodeV1 | null {
    const text = measurementText(segment, data, nodeRotation);
    if (!text) {
        return null;
    }
    const distance = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    if (distance <= Number.EPSILON) {
        return null;
    }
    const lines = text.split('\n');
    const width = Math.max(...lines.map(line => line.length)) * data.labelFontSize * 0.58 + (data.labelPadding * 2);
    const height = (lines.length * (data.labelFontSize + 2)) + (data.labelPadding * 2);
    const maximumDimension = Math.max(width, height);
    const worldLabelSize = maximumDimension * renderScale;
    const scale = worldLabelSize > distance / 2
        ? Math.max(0.2, (distance / 2) / worldLabelSize)
        : 1;
    return {
        id: `measurement-${index}`,
        kind: 'group',
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
        rotation: -nodeRotation,
        experimentalPresentation: { contractVersion: 1, worldUpright: true },
        scaleX: renderScale * scale,
        scaleY: renderScale * scale,
        children: [{
            id: `measurement-${index}-background`,
            kind: 'graphics',
            commands: [
                { op: 'rect', x: -width / 2, y: -height / 2, width, height },
                { op: 'fill', color: data.labelBackgroundColor, alpha: data.labelBackgroundAlpha },
                { op: 'stroke', color: data.strokeColor, width: data.labelStrokeWidth, alpha: data.strokeAlpha },
            ],
        }, {
            id: `measurement-${index}-text`,
            kind: 'text',
            text,
            anchorX: 0.5,
            anchorY: 0.5,
            style: {
                fontFamily: 'Jost, Arial, sans-serif',
                fontSize: data.labelFontSize,
                fontWeight: 'normal',
                fill: data.labelColor,
                align: 'center',
                lineHeight: data.labelFontSize + 2,
            },
        }],
    };
}

export function renderFoxholeSceneV2BinocularLine(
    data: FoxholeSceneV2BinocularLineData,
    nodeRotation = 0,
    rawRenderScale = 1,
): NixieExtensionRenderNodeV1[] {
    const points = pointsFromNumbers(data.points);
    const labelScale = Math.max(0.05, rawRenderScale);
    const labels = segmentsFromPoints(points).map((segment, index) => (
        labelNode(segment, data, nodeRotation, index, labelScale)
    ));
    return [{
        id: 'binocular-line-graphics',
        kind: 'graphics',
        laneId: 'line',
        commands: graphicsCommands(data, points, rawRenderScale),
    }, {
        id: 'binocular-line-labels',
        kind: 'group',
        laneId: 'details',
        children: labels.filter((label): label is NixieExtensionRenderNodeV1 => label !== null),
    }];
}
