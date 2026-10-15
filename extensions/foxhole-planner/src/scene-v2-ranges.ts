import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderNodeV1,
} from '@nixie/extension-sdk/experimental/scene-v2';

export interface FoxholeSceneV2RangeData {
    points: number[];
    sweepAngle: number;
    scaleWithZoom: boolean;
    strokeColor: number;
    strokeWidth: number;
    strokeAlpha: number;
    strokeStyle: 'solid' | 'dashed';
    strokeDashLength: number;
    strokeDashGap: number;
    fillColor: number;
    fillAlpha: number;
    showCenterAxis: boolean;
    showRadius: boolean;
    showAngle: boolean;
    labelColor: number;
    labelFontSize: number;
    labelBackgroundColor: number;
    labelBackgroundAlpha: number;
    labelPadding: number;
    labelStrokeWidth: number;
    centerMarkerRadius: number;
    meterPixels: number;
    decimals: number;
}

interface Point {
    x: number;
    y: number;
}

function isFullSweep(sweepAngle: number): boolean {
    return sweepAngle >= 359.9;
}

function arcRadians(sweepAngle: number): { start: number; end: number; } {
    const halfSweep = (Math.max(1, Math.min(360, sweepAngle)) * Math.PI) / 360;
    return { start: -halfSweep, end: halfSweep };
}

function sampleArc(radius: number, start: number, end: number, steps: number): Point[] {
    return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = start + ((end - start) * (index / steps));
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
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
        const start = points[index - 1]!;
        const end = points[index]!;
        const ratio = (clamped - startDistance) / Math.max(Number.EPSILON, endDistance - startDistance);
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
    data: FoxholeSceneV2RangeData,
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

function pushStyledStroke(
    commands: NixieExtensionGraphicsCommandV1[],
    points: readonly Point[],
    data: FoxholeSceneV2RangeData,
    renderScale: number,
): void {
    if (data.strokeStyle === 'solid') {
        pushStroke(commands, points, data);
        return;
    }
    const { lengths, totalLength } = pathMetrics(points);
    const dashLength = Math.max(
        data.strokeDashLength * renderScale,
        data.strokeWidth,
        2,
    );
    const gapLength = Math.max(data.strokeDashGap * renderScale, 1);
    for (let cursor = 0; cursor < totalLength; cursor += dashLength + gapLength) {
        const start = pointAlongPath(points, lengths, cursor);
        const end = pointAlongPath(points, lengths, Math.min(totalLength, cursor + dashLength));
        if (start && end) {
            pushStroke(commands, [start, end], data);
        }
    }
}

function graphicsCommands(
    data: FoxholeSceneV2RangeData,
    radius: number,
    renderScale: number,
): NixieExtensionGraphicsCommandV1[] {
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    const renderedData = { ...data, strokeWidth: data.strokeWidth * renderScale };
    const fullSweep = isFullSweep(data.sweepAngle);
    const { start, end } = arcRadians(data.sweepAngle);
    if (data.fillAlpha > 0) {
        if (fullSweep) {
            commands.push({ op: 'circle', x: 0, y: 0, radius });
        } else {
            commands.push({ op: 'move-to', x: 0, y: 0 });
            commands.push({ op: 'arc', x: 0, y: 0, radius, startAngle: start, endAngle: end });
            commands.push({ op: 'line-to', x: 0, y: 0 });
        }
        commands.push({ op: 'fill', color: data.fillColor, alpha: data.fillAlpha });
    }

    if (fullSweep) {
        pushStyledStroke(commands, sampleArc(radius, 0, Math.PI * 2, 96), renderedData, renderScale);
    } else {
        const points = sampleArc(radius, start, end, 64);
        pushStyledStroke(commands, points, renderedData, renderScale);
        pushStyledStroke(commands, [{ x: 0, y: 0 }, points[0]!], renderedData, renderScale);
        pushStyledStroke(commands, [{ x: 0, y: 0 }, points[points.length - 1]!], renderedData, renderScale);
    }
    if (data.showCenterAxis) {
        pushStroke(commands, [{ x: 0, y: 0 }, { x: radius, y: 0 }], renderedData);
    }
    commands.push({
        op: 'circle',
        x: 0,
        y: 0,
        radius: Math.max(data.strokeWidth * 1.125, data.centerMarkerRadius) * renderScale,
    });
    commands.push({ op: 'fill', color: data.strokeColor, alpha: data.strokeAlpha });
    return commands;
}

function labelText(data: FoxholeSceneV2RangeData, radius: number): string {
    const parts: string[] = [];
    if (data.showRadius) {
        parts.push(`${(radius / Math.max(1, data.meterPixels)).toFixed(data.decimals)}m`);
    }
    if (data.showAngle && !isFullSweep(data.sweepAngle)) {
        parts.push(`${data.sweepAngle.toFixed(data.decimals)}°`);
    }
    return parts.join('\n');
}

function labelNodes(
    data: FoxholeSceneV2RangeData,
    radius: number,
    nodeRotation: number,
    renderScale: number,
): NixieExtensionRenderNodeV1[] {
    const text = labelText(data, radius);
    if (!text) {
        return [];
    }
    return [{ id: 'range-label', kind: 'group', rotation: -nodeRotation,
        experimentalPresentation: { contractVersion: 1, worldUpright: true }, children: [{
            id: 'range-label-text', kind: 'text', text, anchorX: 0.5, anchorY: 0.5,
            experimentalBox: { contractVersion: 1, padding: data.labelPadding, backgroundColor: data.labelBackgroundColor,
                backgroundAlpha: data.labelBackgroundAlpha, strokeColor: data.strokeColor, strokeWidth: data.labelStrokeWidth,
                strokeAlpha: data.strokeAlpha, renderScale, maximumSize: radius, minimumScale: 0.2 },
            style: { fontFamily: 'Jost, Arial, sans-serif', fontSize: data.labelFontSize, fontWeight: 'normal',
                fill: data.labelColor, align: 'center', lineHeight: data.labelFontSize + 2 },
        }] }];
}

export function resolveFoxholeRangeSelectionGeometry(data: FoxholeSceneV2RangeData) {
    const centerX = data.points[0]!;
    const centerY = data.points[1]!;
    const deltaX = data.points[2]! - centerX;
    const deltaY = data.points[3]! - centerY;
    const radius = Math.max(1, Math.hypot(deltaX, deltaY));
    const angle = Math.atan2(deltaY, deltaX);
    const full = isFullSweep(data.sweepAngle);
    const arc = arcRadians(data.sweepAngle);
    const points = [{ x: centerX, y: centerY }, ...sampleArc(radius, full ? 0 : arc.start, full ? Math.PI * 2 : arc.end, full ? 64 : 32)
        .map(point => ({ x: centerX + point.x * Math.cos(angle) - point.y * Math.sin(angle),
            y: centerY + point.x * Math.sin(angle) + point.y * Math.cos(angle) }))];
    return { contractVersion: 1 as const, transformOrigin: { x: centerX, y: centerY },
        localBounds: { minX: Math.min(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)),
            maxX: Math.max(...points.map(point => point.x)), maxY: Math.max(...points.map(point => point.y)) },
        boundsPadding: Math.max(data.strokeWidth * 0.5, data.centerMarkerRadius),
        measuredTextBounds: labelText(data, radius) ? [{ nodeId: 'range-label-text', centerX, centerY }] : [] };
}

export function renderFoxholeSceneV2Range(
    data: FoxholeSceneV2RangeData,
    nodeRotation = 0,
    rawRenderScale = 1,
): NixieExtensionRenderNodeV1[] {
    const centerX = data.points[0]!;
    const centerY = data.points[1]!;
    const deltaX = data.points[2]! - centerX;
    const deltaY = data.points[3]! - centerY;
    const radius = Math.max(1, Math.hypot(deltaX, deltaY));
    const baseAngle = Math.atan2(deltaY, deltaX);
    const renderScale = data.scaleWithZoom ? Math.max(0.05, rawRenderScale) : 1;
    return [{
        id: 'range-graphics',
        kind: 'graphics',
        laneId: 'line',
        laneOrder: 200,
        x: centerX,
        y: centerY,
        rotation: baseAngle,
        commands: graphicsCommands(data, radius, renderScale),
    }, {
        id: 'range-label-layer',
        kind: 'group',
        laneId: 'details',
        laneOrder: 201,
        x: centerX,
        y: centerY,
        children: labelNodes(data, radius, nodeRotation, renderScale),
    }];
}
