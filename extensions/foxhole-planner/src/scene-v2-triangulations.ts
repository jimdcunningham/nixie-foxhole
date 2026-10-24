import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderNodeV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';

export interface FoxholeSceneV2TriangulationData {
    edgePoints: number[];
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: 'solid' | 'dashed';
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number;
    fillAlpha: number;
    spokeAlpha: number;
    edgeLineAlpha: number;
    showSpokes: boolean;
    showRadius: boolean;
    showEdgeMarkers: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    edgeMarkerRadius: number;
    meterPixels: number;
    decimals: number;
}

interface Point {
    x: number;
    y: number;
}

interface CircleFit {
    centerX: number;
    centerY: number;
    radius: number;
}

const MINIMUM_RADIUS = 1;
const MAXIMUM_RADIUS = 500_000;
const MAX_RADIUS_TO_SPREAD_RATIO = 32;

function pointsFromNumbers(points: readonly number[]): Point[] {
    const result: Point[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
        result.push({ x: points[index]!, y: points[index + 1]! });
    }
    return result;
}

function pointSpread(points: readonly Point[]): number {
    let maximum = 0;
    for (let left = 0; left < points.length; left += 1) {
        for (let right = left + 1; right < points.length; right += 1) {
            maximum = Math.max(maximum, Math.hypot(
                points[left]!.x - points[right]!.x,
                points[left]!.y - points[right]!.y,
            ));
        }
    }
    return maximum;
}

function finalizeCircleFit(centerX: number, centerY: number, radius: number, points: readonly Point[]): CircleFit | null {
    const spread = pointSpread(points);
    if (!Number.isFinite(centerX)
        || !Number.isFinite(centerY)
        || !Number.isFinite(radius)
        || radius < MINIMUM_RADIUS
        || radius > MAXIMUM_RADIUS
        || (spread > Number.EPSILON && radius > spread * MAX_RADIUS_TO_SPREAD_RATIO)) {
        return null;
    }
    return { centerX, centerY, radius };
}

function fitCircle(points: readonly Point[]): CircleFit | null {
    if (points.length < 3) {
        return null;
    }
    if (points.length === 3) {
        const [first, second, third] = points;
        const determinant = 2 * (
            (first!.x * (second!.y - third!.y))
            + (second!.x * (third!.y - first!.y))
            + (third!.x * (first!.y - second!.y))
        );
        if (Math.abs(determinant) < Number.EPSILON) {
            return null;
        }
        const firstSquared = (first!.x * first!.x) + (first!.y * first!.y);
        const secondSquared = (second!.x * second!.x) + (second!.y * second!.y);
        const thirdSquared = (third!.x * third!.x) + (third!.y * third!.y);
        const centerX = (
            (firstSquared * (second!.y - third!.y))
            + (secondSquared * (third!.y - first!.y))
            + (thirdSquared * (first!.y - second!.y))
        ) / determinant;
        const centerY = (
            (firstSquared * (third!.x - second!.x))
            + (secondSquared * (first!.x - third!.x))
            + (thirdSquared * (second!.x - first!.x))
        ) / determinant;
        return finalizeCircleFit(centerX, centerY, Math.hypot(first!.x - centerX, first!.y - centerY), points);
    }

    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let sumX3 = 0;
    let sumY3 = 0;
    let sumX1Y2 = 0;
    let sumX2Y1 = 0;
    for (const point of points) {
        const x2 = point.x * point.x;
        const y2 = point.y * point.y;
        sumX += point.x;
        sumY += point.y;
        sumX2 += x2;
        sumY2 += y2;
        sumXY += point.x * point.y;
        sumX3 += x2 * point.x;
        sumY3 += y2 * point.y;
        sumX1Y2 += point.x * y2;
        sumX2Y1 += x2 * point.y;
    }
    const count = points.length;
    const matrixA = (count * sumX2) - (sumX * sumX);
    const matrixB = (count * sumXY) - (sumX * sumY);
    const matrixC = (count * sumY2) - (sumY * sumY);
    const vectorD = 0.5 * ((count * sumX3) + (count * sumX1Y2) - (sumX * (sumX2 + sumY2)));
    const vectorE = 0.5 * ((count * sumY3) + (count * sumX2Y1) - (sumY * (sumX2 + sumY2)));
    const denominator = (matrixA * matrixC) - (matrixB * matrixB);
    if (Math.abs(denominator) < Number.EPSILON) {
        return null;
    }
    const centerX = ((vectorD * matrixC) - (vectorE * matrixB)) / denominator;
    const centerY = ((matrixA * vectorE) - (matrixB * vectorD)) / denominator;
    const radius = points.reduce(
        (total, point) => total + Math.hypot(point.x - centerX, point.y - centerY),
        0,
    ) / count;
    return finalizeCircleFit(centerX, centerY, radius, points);
}

function pathMetrics(points: readonly Point[]): { lengths: number[]; totalLength: number; } {
    const lengths = [0];
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
        totalLength += Math.hypot(
            points[index]!.x - points[index - 1]!.x,
            points[index]!.y - points[index - 1]!.y,
        );
        lengths.push(totalLength);
    }
    return { lengths, totalLength };
}

function pointAlongPath(points: readonly Point[], lengths: readonly number[], distance: number): Point | null {
    const clamped = Math.max(0, Math.min(distance, lengths[lengths.length - 1] ?? 0));
    for (let index = 1; index < lengths.length; index += 1) {
        if (clamped > lengths[index]! && index < lengths.length - 1) {
            continue;
        }
        const start = points[index - 1]!;
        const end = points[index]!;
        const ratio = (clamped - lengths[index - 1]!)
            / Math.max(Number.EPSILON, lengths[index]! - lengths[index - 1]!);
        return {
            x: start.x + ((end.x - start.x) * ratio),
            y: start.y + ((end.y - start.y) * ratio),
        };
    }
    return null;
}

function pushStroke(
    commands: NixieExtensionGraphicsCommandV1[],
    points: readonly Point[],
    data: FoxholeSceneV2TriangulationData,
    alpha = data.strokeAlpha,
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
        alpha,
        cap: 'round',
        join: 'round',
    });
}

function pushStyledStroke(
    commands: NixieExtensionGraphicsCommandV1[],
    points: readonly Point[],
    data: FoxholeSceneV2TriangulationData,
    renderScale: number,
    alpha = data.strokeAlpha,
): void {
    if (data.strokeStyle === 'solid') {
        pushStroke(commands, points, data, alpha);
        return;
    }
    const { lengths, totalLength } = pathMetrics(points);
    const dashLength = Math.max(data.strokeDashLength * renderScale, data.strokeWidth, 2);
    const gapLength = Math.max(data.strokeDashGap * renderScale, 1);
    for (let cursor = 0; cursor < totalLength; cursor += dashLength + gapLength) {
        const start = pointAlongPath(points, lengths, cursor);
        const end = pointAlongPath(points, lengths, Math.min(totalLength, cursor + dashLength));
        if (start && end) {
            pushStroke(commands, [start, end], data, alpha);
        }
    }
}

function graphicsCommands(
    data: FoxholeSceneV2TriangulationData,
    edgePoints: readonly Point[],
    fit: CircleFit,
    renderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    const renderedData = { ...data, strokeWidth: data.strokeWidth * renderScale };
    if (data.fillAlpha > 0) {
        commands.push({ op: 'circle', x: fit.centerX, y: fit.centerY, radius: fit.radius });
        commands.push({ op: 'fill', color: data.fillColor, alpha: data.fillAlpha });
    }
    const circlePoints = Array.from({ length: 97 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 96;
        return {
            x: fit.centerX + (Math.cos(angle) * fit.radius),
            y: fit.centerY + (Math.sin(angle) * fit.radius),
        };
    });
    pushStyledStroke(commands, circlePoints, renderedData, renderScale);
    if (data.showSpokes) {
        for (const edgePoint of edgePoints) {
            pushStyledStroke(
                commands,
                [{ x: fit.centerX, y: fit.centerY }, edgePoint],
                renderedData,
                renderScale,
                data.spokeAlpha,
            );
        }
    }
    if (data.showEdgeMarkers) {
        for (const edgePoint of edgePoints) {
            commands.push({
                op: 'circle',
                ...edgePoint,
                radius: Math.max(data.strokeWidth * 1.125, data.edgeMarkerRadius) * renderScale,
            });
            commands.push({ op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha });
        }
    }
    commands.push({
        op: 'circle',
        x: fit.centerX,
        y: fit.centerY,
        radius: Math.max(data.strokeWidth * 1.125, data.centerMarkerRadius) * renderScale,
    });
    commands.push({ op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha });
    return commands;
}

function radiusLabel(
    data: FoxholeSceneV2TriangulationData,
    fit: CircleFit,
    nodeRotation: number,
    renderScale: number,
): NixieExtensionRenderNodeV1[] {
    if (!data.showRadius) {
        return [];
    }
    const text = `${(fit.radius / Math.max(1, data.meterPixels)).toFixed(data.decimals)}m`;
    return [{ id: 'triangulation-radius-label', kind: 'group', x: fit.centerX + fit.radius * 0.5, y: fit.centerY,
        rotation: -nodeRotation, experimentalPresentation: { contractVersion: 1, worldUpright: true },
        children: [{ id: 'triangulation-radius-label-text', kind: 'text', text, anchorX: 0.5, anchorY: 0.5,
            experimentalBox: { contractVersion: 1, padding: data.labelPadding, backgroundColor: data.labelBackgroundColor,
                backgroundAlpha: data.labelBackgroundAlpha, strokeColor: data.strokeColor, strokeWidth: data.labelStrokeWidth,
                strokeAlpha: data.strokeAlpha, renderScale, maximumSize: fit.radius, minimumScale: 0.2 },
            style: { fontFamily: 'Jost, Arial, sans-serif', fontSize: data.labelFontSize, fontWeight: 'normal',
                fill: data.labelColor, align: 'center', lineHeight: data.labelFontSize + 2 },
        }] }];
}

export function resolveFoxholeTriangulationSelectionGeometry(data: FoxholeSceneV2TriangulationData, rawRenderScale = 1) {
    const points = pointsFromNumbers(data.edgePoints);
    const fit = fitCircle(points);
    const scale = data.scaleWithZoom ? Math.max(0.05, rawRenderScale) : 1;
    const padding = Math.max(data.strokeWidth * 0.5, data.centerMarkerRadius, data.edgeMarkerRadius, 7) * scale;
    const xs = [...points.map(point => point.x), ...(fit ? [fit.centerX - fit.radius, fit.centerX + fit.radius] : [])];
    const ys = [...points.map(point => point.y), ...(fit ? [fit.centerY - fit.radius, fit.centerY + fit.radius] : [])];
    if (!xs.length) {
        return undefined;
    }
    return { contractVersion: 1 as const, localBounds: { minX: Math.min(...xs) - padding, minY: Math.min(...ys) - padding,
        maxX: Math.max(...xs) + padding, maxY: Math.max(...ys) + padding } };
}

export function renderFoxholeSceneV2Triangulation(
    data: FoxholeSceneV2TriangulationData,
    nodeRotation = 0,
    rawRenderScale = 1,
): NixieExtensionRenderNodeV1[] {
    const edgePoints = pointsFromNumbers(data.edgePoints);
    const fit = fitCircle(edgePoints);
    if (!fit) {
        return [];
    }
    const renderScale = data.scaleWithZoom ? Math.max(0.05, rawRenderScale) : 1;
    return [{
        id: 'triangulation-graphics',
        kind: 'graphics',
        laneId: 'line',
        commands: graphicsCommands(data, edgePoints, fit, renderScale),
    }, {
        id: 'triangulation-labels',
        kind: 'group',
        laneId: 'details',
        children: radiusLabel(data, fit, nodeRotation, renderScale),
    }];
}
