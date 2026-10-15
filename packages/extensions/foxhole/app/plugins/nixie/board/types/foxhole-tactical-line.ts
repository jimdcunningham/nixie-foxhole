import * as PIXI from 'pixi.js';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeEditableHandle, BoardNodeEditableHandleContext, BoardNodeEditableMutation, BoardNodeEditableSegmentTarget, BoardNodeOptions, BoardNodeSelectionBoxReshapeProvider, BoardNodeSelectionBoxReshapeTarget, BoardNodeWorldHitTester, BoardNodeEditableHandleProvider } from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { applyPolylineVertexDrag, buildPolylineEditableHandles } from '#nixie/plugins/nixie/board/utils/polyline-points.ts';
import {
    DEFAULT_FOXHOLE_TACTICAL_LINE_STATE,
    applyFoxholeTacticalLinePreset,
    normalizeTacticalLinePoints,

} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import type { FoxholeTacticalLineState } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import { getCapInset, getFoxholeTacticalLineEffectiveRenderScale } from '#foxhole/plugins/foxhole/nixie/tactical-line-render-scale.ts';

interface TacticalLineEditableSession {
    handleId: string;
    handleIndex: number;
    initialPoints: number[];
}

interface TacticalLineSelectionBoxReshapeSession {
    initialX: number;
    initialY: number;
    initialPoints: number[];
    localBounds: { minX: number; minY: number; maxX: number; maxY: number; };
}

function clonePoints(points: readonly number[]): number[] {
    return points.slice();
}

function getRenderedLocalBounds(container: PIXI.Container): { minX: number; minY: number; maxX: number; maxY: number; } | null {
    const bounds = container.getLocalBounds();
    return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY)
        ? {
            minX: bounds.minX,
            minY: bounds.minY,
            maxX: bounds.maxX,
            maxY: bounds.maxY,
        }
        : null;
}

function normalizeAxis(axis: PIXI.PointData): PIXI.Point {
    const length = Math.hypot(axis.x, axis.y);
    if (length <= Number.EPSILON) {
        return new PIXI.Point(1, 0);
    }
    return new PIXI.Point(axis.x / length, axis.y / length);
}

function getTargetMinWorld(target: BoardNodeSelectionBoxReshapeTarget, scaleX: number, scaleY: number): PIXI.Point {
    const xAxis = normalizeAxis(target.frameXAxisDir);
    const yAxis = normalizeAxis(target.frameYAxisDir);
    const anchorU = scaleX >= 0 ? target.minU : target.maxU;
    const anchorV = scaleY >= 0 ? target.maxV : target.minV;
    return new PIXI.Point(
        target.frameCenter.x + (xAxis.x * anchorU) + (yAxis.x * anchorV),
        target.frameCenter.y + (xAxis.y * anchorU) + (yAxis.y * anchorV),
    );
}

function toLocalPoints(points: readonly number[]): PIXI.Point[] {
    const result: PIXI.Point[] = [];
    for (let index = 0; index < points.length; index += 2) {
        result.push(new PIXI.Point(points[index]!, points[index + 1]!));
    }
    return result;
}

function sampleCatmullRom(points: readonly PIXI.Point[], stepsPerSegment = 16): PIXI.Point[] {
    if (points.length <= 2) {
        return points.map(point => point.clone());
    }

    const sampled: PIXI.Point[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const p0 = points[Math.max(0, index - 1)]!;
        const p1 = points[index]!;
        const p2 = points[index + 1]!;
        const p3 = points[Math.min(points.length - 1, index + 2)]!;

        for (let step = 0; step < stepsPerSegment; step += 1) {
            const t = step / stepsPerSegment;
            const t2 = t * t;
            const t3 = t2 * t;
            const x = 0.5 * (
                (2 * p1.x)
                + ((-p0.x + p2.x) * t)
                + (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2)
                + ((-p0.x + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)
            );
            const y = 0.5 * (
                (2 * p1.y)
                + ((-p0.y + p2.y) * t)
                + (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2)
                + ((-p0.y + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)
            );
            sampled.push(new PIXI.Point(x, y));
        }
    }

    sampled.push(points[points.length - 1]!.clone());
    return sampled;
}

function sampleLocalPath(state: FoxholeTacticalLineState): PIXI.Point[] {
    const base = toLocalPoints(state.points);
    if (state.curveMode === 'smooth') {
        return sampleCatmullRom(base);
    }
    return base;
}

function distanceToSegment(point: PIXI.PointData, start: PIXI.PointData, end: PIXI.PointData): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared <= Number.EPSILON) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const t = Math.max(0, Math.min(1, (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared));
    const px = start.x + (dx * t);
    const py = start.y + (dy * t);
    return Math.hypot(point.x - px, point.y - py);
}

function computePathMetrics(points: readonly PIXI.Point[]): { lengths: number[]; totalLength: number; } {
    const lengths: number[] = [0];
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

function samplePointAlongPath(
    points: readonly PIXI.Point[],
    lengths: readonly number[],
    distance: number,
): { point: PIXI.Point; tangent: PIXI.Point; } | null {
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
        const point = new PIXI.Point(
            from.x + ((to.x - from.x) * t),
            from.y + ((to.y - from.y) * t),
        );
        const tangentLength = Math.max(Number.EPSILON, Math.hypot(to.x - from.x, to.y - from.y));
        const tangent = new PIXI.Point(
            (to.x - from.x) / tangentLength,
            (to.y - from.y) / tangentLength,
        );
        return { point, tangent };
    }

    return null;
}

function trimPath(
    points: readonly PIXI.Point[],
    startInset: number,
    endInset: number,
): PIXI.Point[] {
    if (points.length < 2) {
        return points.map(point => point.clone());
    }

    const { lengths, totalLength } = computePathMetrics(points);
    if (totalLength <= Number.EPSILON) {
        return points.map(point => point.clone());
    }

    const startDistance = Math.max(0, Math.min(startInset, totalLength));
    const endDistance = Math.max(startDistance, Math.min(totalLength, totalLength - endInset));
    if (endDistance - startDistance <= Number.EPSILON) {
        return points.map(point => point.clone());
    }

    const startSample = samplePointAlongPath(points, lengths, startDistance);
    const endSample = samplePointAlongPath(points, lengths, endDistance);
    if (!startSample || !endSample) {
        return points.map(point => point.clone());
    }

    const trimmed: PIXI.Point[] = [startSample.point];
    for (let index = 1; index < points.length - 1; index += 1) {
        const length = lengths[index]!;
        if (length > startDistance && length < endDistance) {
            trimmed.push(points[index]!.clone());
        }
    }
    trimmed.push(endSample.point);
    return trimmed;
}

function drawPolylineStroke(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    color: number,
    width: number,
    alpha: number,
): void {
    if (points.length < 2) {
        return;
    }

    graphics.moveTo(points[0]!.x, points[0]!.y);
    for (let index = 1; index < points.length; index += 1) {
        graphics.lineTo(points[index]!.x, points[index]!.y);
    }
    graphics.stroke({
        color,
        width,
        alpha,
        pixelLine: false,
        cap: 'round',
        join: 'round',
    });
}

function drawDashedStroke(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    color: number,
    width: number,
    alpha: number,
    dashLength: number,
    gapLength: number,
): void {
    const { lengths, totalLength } = computePathMetrics(points);
    if (totalLength <= Number.EPSILON) {
        return;
    }

    const resolvedDashLength = Math.max(dashLength, width, 2);
    const resolvedGapLength = Math.max(gapLength, 1);
    for (let cursor = 0; cursor < totalLength; cursor += resolvedDashLength + resolvedGapLength) {
        const dashStart = samplePointAlongPath(points, lengths, cursor);
        const dashEnd = samplePointAlongPath(points, lengths, Math.min(totalLength, cursor + resolvedDashLength));
        if (!dashStart || !dashEnd) {
            continue;
        }
        drawPolylineStroke(graphics, [dashStart.point, dashEnd.point], color, width, alpha);
    }
}

function drawArrowCap(
    graphics: PIXI.Graphics,
    anchor: PIXI.Point,
    tangent: PIXI.Point,
    size: number,
    strokeColor: number,
    strokeAlpha: number,
    fillColor: number,
    fillAlpha: number,
    doubleArrow = false,
): void {
    const wing = size * 0.55;
    const normal = new PIXI.Point(-tangent.y, tangent.x);
    const drawOne = (offset: number): void => {
        const tip = new PIXI.Point(anchor.x + (tangent.x * offset), anchor.y + (tangent.y * offset));
        const base = new PIXI.Point(tip.x - (tangent.x * size), tip.y - (tangent.y * size));
        graphics.poly([
            base.x + (normal.x * wing),
            base.y + (normal.y * wing),
            tip.x,
            tip.y,
            base.x - (normal.x * wing),
            base.y - (normal.y * wing),
        ], true);
        graphics.fill({ color: fillColor, alpha: fillAlpha });
        graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.18), alpha: strokeAlpha, pixelLine: false, cap: 'round', join: 'round' });
    };

    drawOne(0);
    if (doubleArrow) {
        drawOne(-size * 1.28);
    }
}

function drawFlagCap(
    graphics: PIXI.Graphics,
    anchor: PIXI.Point,
    size: number,
    strokeColor: number,
    strokeAlpha: number,
    fillColor: number,
    fillAlpha: number,
    nodeRotation: number,
): void {
    const cos = Math.cos(-nodeRotation);
    const sin = Math.sin(-nodeRotation);
    const rotateOffset = (x: number, y: number): PIXI.Point => new PIXI.Point(
        (x * cos) - (y * sin),
        (x * sin) + (y * cos),
    );
    const mastHeight = size * 1.6;
    const mastBase = anchor;
    const mastOffset = rotateOffset(0, -mastHeight);
    const mastTop = new PIXI.Point(anchor.x + mastOffset.x, anchor.y + mastOffset.y);
    const flapWidth = size * 0.9;
    const flapHeight = size * 0.6;
    const flapOuter = rotateOffset(flapWidth, flapHeight * 0.3);
    const flapLower = rotateOffset(0, flapHeight);
    graphics.moveTo(mastBase.x, mastBase.y);
    graphics.lineTo(mastTop.x, mastTop.y);
    graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, cap: 'round' });
    graphics.poly([
        mastTop.x,
        mastTop.y,
        mastTop.x + flapOuter.x,
        mastTop.y + flapOuter.y,
        mastTop.x + flapLower.x,
        mastTop.y + flapLower.y,
    ], true);
    graphics.fill({ color: fillColor, alpha: fillAlpha });
    graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.12), alpha: strokeAlpha, pixelLine: false, join: 'round' });
}

function drawCircleCap(
    graphics: PIXI.Graphics,
    anchor: PIXI.Point,
    size: number,
    strokeColor: number,
    strokeAlpha: number,
    fillColor: number,
    fillAlpha: number,
): void {
    graphics.circle(anchor.x, anchor.y, size * 0.36);
    graphics.fill({ color: fillColor, alpha: fillAlpha });
    graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false });
}

function dotPoints(a: PIXI.PointData, b: PIXI.PointData): number {
    return (a.x * b.x) + (a.y * b.y);
}

function shouldDrawDecoratorAtDistance(
    points: readonly PIXI.Point[],
    lengths: readonly number[],
    totalLength: number,
    distance: number,
    probeDistance: number,
    maxTurnDegrees: number,
): boolean {
    if (probeDistance <= Number.EPSILON) {
        return true;
    }

    const before = samplePointAlongPath(points, lengths, Math.max(0, distance - probeDistance));
    const after = samplePointAlongPath(points, lengths, Math.min(totalLength, distance + probeDistance));
    if (!before || !after) {
        return true;
    }

    return dotPoints(before.tangent, after.tangent) >= Math.cos((maxTurnDegrees * Math.PI) / 180);
}

function drawDecorator(
    graphics: PIXI.Graphics,
    mode: FoxholeTacticalLineState['decoratorMode'],
    point: PIXI.Point,
    tangent: PIXI.Point,
    normal: PIXI.Point,
    size: number,
    strokeColor: number,
    strokeAlpha: number,
    fillColor: number,
    fillAlpha: number,
    fill: boolean,
): void {
    switch (mode) {
        case 'semicircle': {
            const radius = size * 0.5;
            const arcPoints: PIXI.Point[] = [];
            const segments = 12;
            for (let index = 0; index <= segments; index += 1) {
                const phi = Math.PI - ((index / segments) * Math.PI);
                arcPoints.push(new PIXI.Point(
                    point.x + (tangent.x * Math.cos(phi) * radius) + (normal.x * Math.sin(phi) * radius),
                    point.y + (tangent.y * Math.cos(phi) * radius) + (normal.y * Math.sin(phi) * radius),
                ));
            }
            if (fill) {
                graphics.poly(arcPoints.flatMap(entry => [entry.x, entry.y]), true);
                graphics.fill({ color: fillColor, alpha: fillAlpha });
            }
            drawPolylineStroke(
                graphics,
                arcPoints,
                strokeColor,
                Math.max(2, size * 0.14),
                strokeAlpha,
            );
            return;
        }
        case 'triangle': {
            const trianglePoints = [
                point.x + (normal.x * size),
                point.y + (normal.y * size),
                point.x - (tangent.x * size * 0.45),
                point.y - (tangent.y * size * 0.45),
                point.x + (tangent.x * size * 0.45),
                point.y + (tangent.y * size * 0.45),
            ];
            graphics.poly(trianglePoints, true);
            if (fill) {
                graphics.fill({ color: fillColor, alpha: fillAlpha });
                graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, join: 'round' });
            } else {
                graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, join: 'round' });
            }
            return;
        }
        case 'tick': {
            graphics.moveTo(point.x, point.y);
            graphics.lineTo(point.x + (normal.x * size), point.y + (normal.y * size));
            graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, cap: 'round' });
            return;
        }
        case 'block': {
            const along = size * 0.34;
            const blockPoints = [
                point.x - (tangent.x * along),
                point.y - (tangent.y * along),
                point.x + (tangent.x * along),
                point.y + (tangent.y * along),
                point.x + (tangent.x * along) + (normal.x * size * 0.72),
                point.y + (tangent.y * along) + (normal.y * size * 0.72),
                point.x - (tangent.x * along) + (normal.x * size * 0.72),
                point.y - (tangent.y * along) + (normal.y * size * 0.72),
            ];
            graphics.poly(blockPoints, true);
            if (fill) {
                graphics.fill({ color: fillColor, alpha: fillAlpha });
                graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, join: 'round' });
            } else {
                graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.14), alpha: strokeAlpha, pixelLine: false, join: 'round' });
            }
            return;
        }
        case 'cross': {
            const tip = point;
            const backCenter = new PIXI.Point(
                point.x + (normal.x * size * 0.78),
                point.y + (normal.y * size * 0.78),
            );
            const leftTail = new PIXI.Point(
                backCenter.x - (tangent.x * size * 0.42),
                backCenter.y - (tangent.y * size * 0.42),
            );
            const rightTail = new PIXI.Point(
                backCenter.x + (tangent.x * size * 0.42),
                backCenter.y + (tangent.y * size * 0.42),
            );
            graphics.moveTo(leftTail.x, leftTail.y);
            graphics.lineTo(tip.x, tip.y);
            graphics.lineTo(rightTail.x, rightTail.y);
            graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.16), alpha: strokeAlpha, pixelLine: false, cap: 'round', join: 'round' });
            return;
        }
        case 'arrow': {
            const baseCenter = point;
            const tip = new PIXI.Point(
                baseCenter.x + (tangent.x * size * 0.92),
                baseCenter.y + (tangent.y * size * 0.92),
            );
            const baseLeft = new PIXI.Point(
                baseCenter.x + (normal.x * size * 0.56),
                baseCenter.y + (normal.y * size * 0.56),
            );
            const baseRight = new PIXI.Point(
                baseCenter.x - (normal.x * size * 0.56),
                baseCenter.y - (normal.y * size * 0.56),
            );
            graphics.poly([
                baseLeft.x,
                baseLeft.y,
                tip.x,
                tip.y,
                baseRight.x,
                baseRight.y,
            ], true);
            graphics.fill({ color: fillColor, alpha: fillAlpha });
            graphics.stroke({ color: strokeColor, width: Math.max(2, size * 0.16), alpha: strokeAlpha, pixelLine: false, cap: 'round', join: 'round' });
            return;
        }
        case 'none':
        default:
            return;
    }
}

export function renderFoxholeTacticalLineGraphics(
    graphics: PIXI.Graphics,
    sourceState: FoxholeTacticalLineState,
    renderScale: number,
): void {
    const state = {
        ...sourceState,
        points: normalizeTacticalLinePoints(sourceState.points),
    };
    graphics.clear();

    const sampled = sampleLocalPath(state);
    if (sampled.length < 2) {
        return;
    }

    const { totalLength } = computePathMetrics(sampled);
    const effectiveRenderScale = getFoxholeTacticalLineEffectiveRenderScale(state, renderScale, totalLength);
    const strokeWidth = state.strokeWidth * effectiveRenderScale;
    const dashLength = state.strokeDashLength * effectiveRenderScale;
    const dashGap = state.strokeDashGap * effectiveRenderScale;
    const capSize = Math.max(strokeWidth * 1.15, 16 * effectiveRenderScale);
    const strokedPath = trimPath(
        sampled,
        getCapInset(state.startCap, capSize),
        getCapInset(state.endCap, capSize),
    );

    switch (state.strokeStyle) {
        case 'dashed':
            drawDashedStroke(
                graphics,
                strokedPath,
                state.strokeColor,
                strokeWidth,
                state.strokeAlpha,
                dashLength,
                dashGap,
            );
            break;
        case 'solid':
        default:
            drawPolylineStroke(
                graphics,
                strokedPath,
                state.strokeColor,
                strokeWidth,
                state.strokeAlpha,
            );
            break;
    }

    drawTacticalLineCaps(graphics, state, sampled, capSize);
    drawTacticalLineDecorators(graphics, state, strokedPath, strokeWidth, effectiveRenderScale);
}

function drawTacticalLineCaps(
    graphics: PIXI.Graphics,
    state: FoxholeTacticalLineState,
    sampled: readonly PIXI.Point[],
    size: number,
): void {
    const first = sampled[0]!;
    const second = sampled[1]!;
    const last = sampled[sampled.length - 1]!;
    const beforeLast = sampled[sampled.length - 2]!;

    const startBase = new PIXI.Point(first.x, first.y);
    const endBase = new PIXI.Point(last.x, last.y);
    const startTangent = buildDirectionalTangent(first, second, true);
    const endTangent = buildDirectionalTangent(beforeLast, last, false);

    drawTacticalLineCap(graphics, state, state.startCap, startBase, startTangent, size);
    drawTacticalLineCap(graphics, state, state.endCap, endBase, endTangent, size);
}

function drawTacticalLineCap(
    graphics: PIXI.Graphics,
    state: FoxholeTacticalLineState,
    cap: FoxholeTacticalLineState['startCap'],
    anchor: PIXI.Point,
    tangent: PIXI.Point,
    size: number,
): void {
    switch (cap) {
        case 'arrow':
            drawArrowCap(
                graphics,
                anchor,
                tangent,
                size,
                state.strokeColor,
                state.strokeAlpha,
                state.decoratorColor,
                state.decoratorAlpha,
            );
            return;
        case 'flag':
            drawFlagCap(graphics, anchor, size, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha, state.rotation);
            return;
        case 'circle':
            drawCircleCap(graphics, anchor, size, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha);
            return;
        case 'none':
        default:
            return;
    }
}

function drawTacticalLineDecorators(
    graphics: PIXI.Graphics,
    state: FoxholeTacticalLineState,
    sampled: readonly PIXI.Point[],
    strokeWidth: number,
    renderScale: number,
): void {
    if (state.strokeStyle === 'dashed' || state.decoratorMode === 'none') {
        return;
    }

    const { lengths, totalLength } = computePathMetrics(sampled);
    if (totalLength <= Number.EPSILON) {
        return;
    }

    const decoratorSize = state.decoratorSize * renderScale;
    const spacing = Math.max(state.decoratorSpacing * renderScale, decoratorSize * 0.8, 12 * renderScale);
    const startOffset = Math.max(spacing * 0.65, strokeWidth * 1.4);
    const endOffset = Math.max(spacing * 0.65, strokeWidth * 1.4);
    const usableLength = totalLength - startOffset - endOffset;
    if (usableLength <= Number.EPSILON) {
        return;
    }

    const decoratorCount = Math.max(1, Math.floor(usableLength / spacing) + 1);
    const usedLength = (decoratorCount - 1) * spacing;
    const centeredStart = startOffset + Math.max(0, (usableLength - usedLength) * 0.5);
    const turnProbeDistance = Math.max(decoratorSize * 0.9, spacing * 0.42, strokeWidth * 2.5);
    const maxTurnDegrees = state.decoratorMode === 'tick' ? 26 : 34;
    for (let index = 0; index < decoratorCount; index += 1) {
        const cursor = centeredStart + (index * spacing);
        if (!shouldDrawDecoratorAtDistance(sampled, lengths, totalLength, cursor, turnProbeDistance, maxTurnDegrees)) {
            continue;
        }
        const sample = samplePointAlongPath(sampled, lengths, cursor);
        if (!sample) {
            continue;
        }

        const tangent = sample.tangent;
        const normal = new PIXI.Point(-tangent.y, tangent.x);
        if (state.decoratorMode === 'arrow') {
            if (state.decoratorSide === 'left' || state.decoratorSide === 'both') {
                drawDecorator(graphics, state.decoratorMode, sample.point, new PIXI.Point(-tangent.x, -tangent.y), normal, decoratorSize, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha, state.decoratorFill);
            }
            if (state.decoratorSide === 'right' || state.decoratorSide === 'both') {
                drawDecorator(graphics, state.decoratorMode, sample.point, tangent, normal, decoratorSize, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha, state.decoratorFill);
            }
            continue;
        }
        if (state.decoratorSide === 'left' || state.decoratorSide === 'both') {
            drawDecorator(graphics, state.decoratorMode, sample.point, tangent, normal, decoratorSize, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha, state.decoratorFill);
        }
        if (state.decoratorSide === 'right' || state.decoratorSide === 'both') {
            drawDecorator(graphics, state.decoratorMode, sample.point, tangent, new PIXI.Point(-normal.x, -normal.y), decoratorSize, state.strokeColor, state.strokeAlpha, state.decoratorColor, state.decoratorAlpha, state.decoratorFill);
        }
    }
}

function buildDirectionalTangent(from: PIXI.Point, to: PIXI.Point, reverse: boolean): PIXI.Point {
    const dx = reverse ? from.x - to.x : to.x - from.x;
    const dy = reverse ? from.y - to.y : to.y - from.y;
    const length = Math.max(Number.EPSILON, Math.hypot(dx, dy));
    return new PIXI.Point(dx / length, dy / length);
}

export class FoxholeTacticalLineNode extends BoardNodeBase<FoxholeTacticalLineState> implements BoardNodeEditableHandleProvider, BoardNodeSelectionBoxReshapeProvider, BoardNodeWorldHitTester {
    private static readonly ZOOM_SYNC_INTERVAL_MS = 50;

    readonly graphicsObject: PIXI.Graphics;
    private renderScale = 1;
    private pendingRenderScale: number | null = null;
    private lastZoomSyncAt = 0;
    private zoomSyncTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly zoomSyncTicker = (): void => {
        const nextScale = this.getRenderScale();
        const comparisonScale = this.pendingRenderScale ?? this.renderScale;
        if (Math.abs(nextScale - comparisonScale) < 0.001) {
            return;
        }

        this.pendingRenderScale = nextScale;
        this.scheduleZoomSync();
    };

    constructor(options: BoardNodeOptions<FoxholeTacticalLineState>) {
        super({
            ...options,
            state: applyFoxholeTacticalLinePreset({
                ...DEFAULT_FOXHOLE_TACTICAL_LINE_STATE,
                ...(options.state ?? {}),
            }, options.state?.presetId ?? 'frontline'),
        });

        this.graphicsObject = new PIXI.Graphics();
        this.addBoardVisualChild(this.graphicsObject);
        this.syncFromState();
    }

    override patchBoardState(patch: Parameters<BoardNodeBase<FoxholeTacticalLineState>['patchBoardState']>[0], options = {}): void {
        super.patchBoardState(patch, options);
        this.syncFromState();
    }

    override replaceBoardState(nextState: FoxholeTacticalLineState, options = {}): void {
        super.replaceBoardState(applyFoxholeTacticalLinePreset(nextState, nextState.presetId), options);
        this.syncFromState();
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const sampled = this.getSampledWorldPath(context);
        if (sampled.length < 2) {
            return false;
        }

        const hitRadius = Math.max(
            (this.boardState.strokeWidth * 0.5) + (this.boardState.decoratorSize * 0.45),
            context.worldPerPx * 10,
        );
        for (let index = 1; index < sampled.length; index += 1) {
            if (distanceToSegment(world, sampled[index - 1]!, sampled[index]!) <= hitRadius) {
                return true;
            }
        }
        return false;
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return buildPolylineEditableHandles(this, this.boardState.points, context);
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): TacticalLineEditableSession | null {
        if (handle.kind !== 'vertex') {
            return null;
        }

        return {
            handleId: handle.id,
            handleIndex: handle.index,
            initialPoints: clonePoints(this.boardState.points),
        };
    }

    applyEditableHandleDrag(session: TacticalLineEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const nextPoints = applyPolylineVertexDrag(this.boardState.points, session.handleIndex, pointerWorld, this, context);
        if (!nextPoints) {
            return false;
        }
        this.patchBoardState({
            points: nextPoints,
        }, {
            reason: 'selection-reshape-graphics-preview',
            recordHistory: false,
        });
        return true;
    }

    buildEditableHandleCommit(session: TacticalLineEditableSession): BoardNodeEditableMutation | null {
        const nextPoints = clonePoints(this.boardState.points);
        const initialPoints = clonePoints(session.initialPoints);
        if (JSON.stringify(nextPoints) === JSON.stringify(initialPoints)) {
            return null;
        }

        return {
            patch: {
                points: nextPoints,
            },
            inversePatch: {
                points: initialPoints,
            },
            reason: 'selection-reshape-graphics',
            label: 'Reshape Tactical Line',
        };
    }

    cancelEditableHandleDrag(session: TacticalLineEditableSession): void {
        this.patchBoardState({
            points: clonePoints(session.initialPoints),
        }, {
            reason: 'selection-reshape-graphics-revert',
            recordHistory: false,
        });
    }

    startSelectionBoxReshape(_context: BoardNodeEditableHandleContext): TacticalLineSelectionBoxReshapeSession | null {
        const localBounds = getRenderedLocalBounds(this.graphicsObject);
        if (!localBounds) {
            return null;
        }
        return {
            initialX: Number(this.boardState.x ?? this.x),
            initialY: Number(this.boardState.y ?? this.y),
            initialPoints: clonePoints(this.boardState.points),
            localBounds,
        };
    }

    applySelectionBoxReshape(
        session: TacticalLineSelectionBoxReshapeSession,
        target: BoardNodeSelectionBoxReshapeTarget,
        _context: BoardNodeEditableHandleContext,
    ): boolean {
        const localWidth = Math.max(0.0001, session.localBounds.maxX - session.localBounds.minX);
        const localHeight = Math.max(0.0001, session.localBounds.maxY - session.localBounds.minY);
        const scaleX = (target.maxU - target.minU) / (localWidth * Math.max(0.0001, Math.abs(this.scale.x)));
        const scaleY = (target.maxV - target.minV) / (localHeight * Math.max(0.0001, Math.abs(this.scale.y)));
        const nextPoints = clonePoints(session.initialPoints);
        for (let index = 0; index + 1 < nextPoints.length; index += 2) {
            nextPoints[index] = session.localBounds.minX + ((nextPoints[index]! - session.localBounds.minX) * scaleX);
            nextPoints[index + 1] = session.localBounds.minY + ((nextPoints[index + 1]! - session.localBounds.minY) * scaleY);
        }

        const targetMinWorld = getTargetMinWorld(target, this.scale.x, this.scale.y);
        const cos = Math.cos(this.rotation);
        const sin = Math.sin(this.rotation);
        const scaledMinX = session.localBounds.minX * this.scale.x;
        const scaledMinY = session.localBounds.minY * this.scale.y;
        const rotatedMinX = (scaledMinX * cos) - (scaledMinY * sin);
        const rotatedMinY = (scaledMinX * sin) + (scaledMinY * cos);

        this.patchBoardState({
            x: targetMinWorld.x - rotatedMinX,
            y: targetMinWorld.y - rotatedMinY,
            points: nextPoints,
        }, {
            reason: 'selection-reshape-selection-preview',
            recordHistory: false,
        });
        return true;
    }

    buildSelectionBoxReshapeCommit(session: TacticalLineSelectionBoxReshapeSession): BoardNodeEditableMutation | null {
        const nextPatch = {
            x: this.x,
            y: this.y,
            points: clonePoints(this.boardState.points),
        };
        const inversePatch = {
            x: session.initialX,
            y: session.initialY,
            points: clonePoints(session.initialPoints),
        };
        const changed = nextPatch.x !== inversePatch.x
            || nextPatch.y !== inversePatch.y
            || JSON.stringify(nextPatch.points) !== JSON.stringify(inversePatch.points);
        if (!changed) {
            return null;
        }
        return {
            patch: nextPatch,
            inversePatch,
            reason: 'selection-reshape-selection',
            label: 'Reshape Tactical Line',
        };
    }

    cancelSelectionBoxReshape(session: TacticalLineSelectionBoxReshapeSession): void {
        this.patchBoardState({
            x: session.initialX,
            y: session.initialY,
            points: clonePoints(session.initialPoints),
        }, {
            reason: 'selection-reshape-selection-revert',
            recordHistory: false,
        });
    }

    getEditableSegmentTarget(
        world: PIXI.Point,
        maxDistance: number,
        context: BoardNodeEditableHandleContext,
    ): BoardNodeEditableSegmentTarget | null {
        const localPoints = toLocalPoints(this.boardState.points);
        if (localPoints.length < 2) {
            return null;
        }

        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let index = 1; index < localPoints.length; index += 1) {
            const worldStart = context.viewport.toWorld(this.toGlobal(localPoints[index - 1]!));
            const worldEnd = context.viewport.toWorld(this.toGlobal(localPoints[index]!));
            const distance = distanceToSegment(world, worldStart, worldEnd);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }

        if (bestIndex < 0 || bestDistance > maxDistance) {
            return null;
        }

        return {
            index: bestIndex,
            world: world.clone(),
        };
    }

    buildEditableSegmentInsertMutation(
        target: BoardNodeEditableSegmentTarget,
        context: BoardNodeEditableHandleContext,
    ): BoardNodeEditableMutation | null {
        const globalPoint = context.viewport.toGlobal(target.world);
        const localPoint = this.toLocal(globalPoint);
        const currentPoints = clonePoints(this.boardState.points);
        const insertOffset = target.index * 2;
        currentPoints.splice(insertOffset, 0, localPoint.x, localPoint.y);
        return {
            patch: {
                points: currentPoints,
            },
            inversePatch: {
                points: clonePoints(this.boardState.points),
            },
            reason: 'selection-insert-tactical-line-point',
            label: 'Insert Tactical Line Point',
        };
    }

    buildEditableHandleDeleteMutation(handle: BoardNodeEditableHandle): BoardNodeEditableMutation | null {
        const pointCount = Math.floor(this.boardState.points.length / 2);
        if (handle.kind !== 'vertex' || pointCount <= 2) {
            return null;
        }

        const nextPoints = clonePoints(this.boardState.points);
        nextPoints.splice(handle.index * 2, 2);
        return {
            patch: {
                points: nextPoints,
            },
            inversePatch: {
                points: clonePoints(this.boardState.points),
            },
            reason: 'selection-delete-tactical-line-point',
            label: 'Delete Tactical Line Point',
        };
    }

    protected override onBoardStateChanged(): void {
        this.syncFromState();
    }

    protected override onBoardMounted(): void {
        this.renderScale = this.getRenderScale();
        this.lastZoomSyncAt = this.getNowMs();
        PIXI.Ticker.shared.add(this.zoomSyncTicker);
        this.syncFromState();
    }

    protected override onBoardUnmounted(): void {
        PIXI.Ticker.shared.remove(this.zoomSyncTicker);
        this.clearZoomSyncTimeout();
    }

    private syncFromState(): void {
        this.boardState.points = normalizeTacticalLinePoints(this.boardState.points);
        renderFoxholeTacticalLineGraphics(this.graphicsObject, this.boardState, this.renderScale);
        applyTransform(this, this.boardState);
    }

    private drawCaps(sampled: readonly PIXI.Point[], size: number): void {
        const first = sampled[0]!;
        const second = sampled[1]!;
        const last = sampled[sampled.length - 1]!;
        const beforeLast = sampled[sampled.length - 2]!;

        const startBase = new PIXI.Point(first.x, first.y);
        const endBase = new PIXI.Point(last.x, last.y);
        const startTangent = this.buildDirectionalTangent(first, second, true);
        const endTangent = this.buildDirectionalTangent(beforeLast, last, false);

        this.drawCap(this.boardState.startCap, startBase, startTangent, size);
        this.drawCap(this.boardState.endCap, endBase, endTangent, size);
    }

    private drawCap(
        cap: FoxholeTacticalLineState['startCap'],
        anchor: PIXI.Point,
        tangent: PIXI.Point,
        size: number,
    ): void {
        switch (cap) {
            case 'arrow':
                drawArrowCap(
                    this.graphicsObject,
                    anchor,
                    tangent,
                    size,
                    this.boardState.strokeColor,
                    this.boardState.strokeAlpha,
                    this.boardState.decoratorColor,
                    this.boardState.decoratorAlpha,
                );
                return;
            case 'flag':
                drawFlagCap(this.graphicsObject, anchor, size, this.boardState.strokeColor, this.boardState.strokeAlpha, this.boardState.decoratorColor, this.boardState.decoratorAlpha, this.boardState.rotation);
                return;
            case 'circle':
                drawCircleCap(this.graphicsObject, anchor, size, this.boardState.strokeColor, this.boardState.strokeAlpha, this.boardState.decoratorColor, this.boardState.decoratorAlpha);
                return;
            case 'none':
            default:
                return;
        }
    }

    private drawDecorators(sampled: readonly PIXI.Point[], strokeWidth: number, renderScale: number): void {
        if (this.boardState.strokeStyle === 'dashed' || this.boardState.decoratorMode === 'none') {
            return;
        }

        const { lengths, totalLength } = computePathMetrics(sampled);
        if (totalLength <= Number.EPSILON) {
            return;
        }

        const decoratorSize = this.boardState.decoratorSize * renderScale;
        const spacing = Math.max(this.boardState.decoratorSpacing * renderScale, decoratorSize * 0.8, 12 * renderScale);
        const startOffset = Math.max(spacing * 0.65, strokeWidth * 1.4);
        const endOffset = Math.max(spacing * 0.65, strokeWidth * 1.4);
        const usableLength = totalLength - startOffset - endOffset;
        if (usableLength <= Number.EPSILON) {
            return;
        }

        const decoratorCount = Math.max(1, Math.floor(usableLength / spacing) + 1);
        const usedLength = (decoratorCount - 1) * spacing;
        const centeredStart = startOffset + Math.max(0, (usableLength - usedLength) * 0.5);
        const turnProbeDistance = Math.max(decoratorSize * 0.9, spacing * 0.42, strokeWidth * 2.5);
        const maxTurnDegrees = this.boardState.decoratorMode === 'tick' ? 26 : 34;
        for (let index = 0; index < decoratorCount; index += 1) {
            const cursor = centeredStart + (index * spacing);
            if (!shouldDrawDecoratorAtDistance(sampled, lengths, totalLength, cursor, turnProbeDistance, maxTurnDegrees)) {
                continue;
            }
            const sample = samplePointAlongPath(sampled, lengths, cursor);
            if (!sample) {
                continue;
            }

            const tangent = sample.tangent;
            const normal = new PIXI.Point(-tangent.y, tangent.x);
            if (this.boardState.decoratorMode === 'arrow') {
                if (this.boardState.decoratorSide === 'left' || this.boardState.decoratorSide === 'both') {
                    drawDecorator(
                        this.graphicsObject,
                        this.boardState.decoratorMode,
                        sample.point,
                        new PIXI.Point(-tangent.x, -tangent.y),
                        normal,
                        decoratorSize,
                        this.boardState.strokeColor,
                        this.boardState.strokeAlpha,
                        this.boardState.decoratorColor,
                        this.boardState.decoratorAlpha,
                        this.boardState.decoratorFill,
                    );
                }
                if (this.boardState.decoratorSide === 'right' || this.boardState.decoratorSide === 'both') {
                    drawDecorator(
                        this.graphicsObject,
                        this.boardState.decoratorMode,
                        sample.point,
                        tangent,
                        normal,
                        decoratorSize,
                        this.boardState.strokeColor,
                        this.boardState.strokeAlpha,
                        this.boardState.decoratorColor,
                        this.boardState.decoratorAlpha,
                        this.boardState.decoratorFill,
                    );
                }
                continue;
            }
            if (this.boardState.decoratorSide === 'left' || this.boardState.decoratorSide === 'both') {
                drawDecorator(
                    this.graphicsObject,
                    this.boardState.decoratorMode,
                    sample.point,
                    tangent,
                    normal,
                    decoratorSize,
                    this.boardState.strokeColor,
                    this.boardState.strokeAlpha,
                    this.boardState.decoratorColor,
                    this.boardState.decoratorAlpha,
                    this.boardState.decoratorFill,
                );
            }
            if (this.boardState.decoratorSide === 'right' || this.boardState.decoratorSide === 'both') {
                drawDecorator(
                    this.graphicsObject,
                    this.boardState.decoratorMode,
                    sample.point,
                    tangent,
                    new PIXI.Point(-normal.x, -normal.y),
                    decoratorSize,
                    this.boardState.strokeColor,
                    this.boardState.strokeAlpha,
                    this.boardState.decoratorColor,
                    this.boardState.decoratorAlpha,
                    this.boardState.decoratorFill,
                );
            }
        }
    }

    private getRenderScale(): number {
        const scaleX = Math.hypot(this.worldTransform.a, this.worldTransform.b);
        const scaleY = Math.hypot(this.worldTransform.c, this.worldTransform.d);
        const resolved = (scaleX + scaleY) * 0.5;
        if (!Number.isFinite(resolved) || resolved <= 0) {
            return 1;
        }
        return 1 / resolved;
    }

    private getEffectiveRenderScale(totalLength: number): number {
        return getFoxholeTacticalLineEffectiveRenderScale(this.boardState, this.renderScale, totalLength);
    }

    private scheduleZoomSync(): void {
        const now = this.getNowMs();
        const elapsed = now - this.lastZoomSyncAt;
        if (elapsed >= FoxholeTacticalLineNode.ZOOM_SYNC_INTERVAL_MS) {
            this.flushPendingZoomSync();
            return;
        }

        if (this.zoomSyncTimeout !== null) {
            return;
        }

        this.zoomSyncTimeout = setTimeout(() => {
            this.zoomSyncTimeout = null;
            this.flushPendingZoomSync();
        }, FoxholeTacticalLineNode.ZOOM_SYNC_INTERVAL_MS - elapsed);
    }

    private flushPendingZoomSync(): void {
        if (this.pendingRenderScale === null) {
            return;
        }

        this.renderScale = this.pendingRenderScale;
        this.pendingRenderScale = null;
        this.lastZoomSyncAt = this.getNowMs();
        this.syncFromState();
    }

    private clearZoomSyncTimeout(): void {
        if (this.zoomSyncTimeout === null) {
            return;
        }

        clearTimeout(this.zoomSyncTimeout);
        this.zoomSyncTimeout = null;
    }

    private getNowMs(): number {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
    }

    private getSampledWorldPath(context: BoardNodeEditableHandleContext): PIXI.Point[] {
        return sampleLocalPath(this.boardState)
            .map(point => context.viewport.toWorld(this.toGlobal(point)));
    }

    private buildDirectionalTangent(from: PIXI.Point, to: PIXI.Point, isStart: boolean): PIXI.Point {
        const length = Math.max(Number.EPSILON, Math.hypot(to.x - from.x, to.y - from.y));
        const tangent = isStart
            ? new PIXI.Point(from.x - to.x, from.y - to.y)
            : new PIXI.Point(to.x - from.x, to.y - from.y);
        return new PIXI.Point(tangent.x / length, tangent.y / length);
    }
}
