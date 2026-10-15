import * as PIXI from 'pixi.js';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeEditableHandle, BoardNodeEditableHandleContext, BoardNodeEditableHandleProvider, BoardNodeEditableMutation, BoardNodeLiveTransformOverlayProvider, BoardNodeOptions, BoardNodeSelectionBounds, BoardNodeSelectionBoundsProvider, BoardNodeSelectionTransformOriginProvider, BoardNodeWorldHitTester } from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { getPolylineEditableLocalHandles, movePolylineLocalVertex } from '#nixie/plugins/nixie/board/utils/polyline-editing.ts';
import {
    DEFAULT_FOXHOLE_RANGE_STATE,
    getFoxholeRangeMetrics,
    getRangeArcRadians,
    isFullRangeSweep,
    normalizeFoxholeRangePoints,
    normalizeFoxholeRangeState,
    resolveFoxholeRangeState,

} from '#foxhole/plugins/foxhole/nixie/range.ts';
import type { FoxholeRangeMetrics, FoxholeRangeState } from '#foxhole/plugins/foxhole/nixie/range.ts';

interface RangeEditableSession {
    handleIndex: number;
    initialPoints: number[];
}

function clonePoints(points: readonly number[]): number[] {
    return points.slice();
}

const MIN_LABEL_SCALE = 0.2;

function getEffectiveRenderScale(state: FoxholeRangeState, rawRenderScale: number): number {
    if (!state.scaleWithZoom) {
        return 1;
    }
    return Math.max(0.05, rawRenderScale);
}

function sampleArcPoints(
    centerX: number,
    centerY: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    steps = 64,
): PIXI.Point[] {
    const points: PIXI.Point[] = [];
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const angle = startAngle + ((endAngle - startAngle) * t);
        points.push(new PIXI.Point(
            centerX + (Math.cos(angle) * radius),
            centerY + (Math.sin(angle) * radius),
        ));
    }
    return points;
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
): PIXI.Point | null {
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
        return new PIXI.Point(
            from.x + ((to.x - from.x) * t),
            from.y + ((to.y - from.y) * t),
        );
    }

    return null;
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

function drawDashedPolylineStroke(
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
        drawPolylineStroke(graphics, [dashStart, dashEnd], color, width, alpha);
    }
}

function drawRangeStrokePath(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    state: FoxholeRangeState,
    strokeWidth: number,
    renderScale: number,
): void {
    if (state.strokeStyle === 'dashed') {
        drawDashedPolylineStroke(
            graphics,
            points,
            state.strokeColor,
            strokeWidth,
            state.strokeAlpha,
            state.strokeDashLength * renderScale,
            state.strokeDashGap * renderScale,
        );
        return;
    }

    drawPolylineStroke(graphics, points, state.strokeColor, strokeWidth, state.strokeAlpha);
}

function clearContainerChildren(container: PIXI.Container): void {
    for (const child of container.removeChildren()) {
        child.destroy({ children: true });
    }
}

function formatRangeLabelText(state: FoxholeRangeState, radius: number): string {
    const parts: string[] = [];
    const decimals = Math.max(0, Math.min(4, Math.round(state.decimals)));
    const meterPixels = Math.max(1, state.meterPixels);

    if (state.showRadius) {
        parts.push(`${(radius / meterPixels).toFixed(decimals)}m`);
    }
    if (state.showAngle && !isFullRangeSweep(state.sweepAngle)) {
        parts.push(`${state.sweepAngle.toFixed(decimals)}°`);
    }

    return parts.join('\n');
}

function shouldRenderRangeLabel(state: FoxholeRangeState): boolean {
    return state.showRadius || (state.showAngle && !isFullRangeSweep(state.sweepAngle));
}

export function getFoxholeRangeLabelTextStyle(state: FoxholeRangeState): Partial<PIXI.TextStyleOptions> {
    return {
        fontFamily: 'Jost, Arial, sans-serif',
        fontSize: state.labelFontSize,
        fontWeight: 'normal',
        fill: state.labelColor,
        align: 'center',
        lineHeight: state.labelFontSize + 2,
    };
}

function computeRangeLabelLayout(
    state: FoxholeRangeState,
    radius: number,
    renderScale: number,
): { halfWidth: number; halfHeight: number; width: number; height: number; scale: number; } | null {
    if (!shouldRenderRangeLabel(state)) {
        return null;
    }

    const textValue = formatRangeLabelText(state, radius);
    if (!textValue) {
        return null;
    }

    const text = new PIXI.Text({
        text: textValue,
        style: getFoxholeRangeLabelTextStyle(state),
    });
    const padding = state.labelPadding;
    const width = text.width + (padding * 2);
    const height = text.height + (padding * 2);
    text.destroy();

    const worldLabelSize = Math.max(width, height) * renderScale;
    const shrink = worldLabelSize > radius && worldLabelSize > Number.EPSILON
        ? Math.max(MIN_LABEL_SCALE, radius / worldLabelSize)
        : 1;
    const scale = renderScale * shrink;
    const strokePadding = state.labelStrokeWidth * scale * 0.5;

    return {
        width,
        height,
        scale,
        halfWidth: ((width * scale) / 2) + strokePadding,
        halfHeight: ((height * scale) / 2) + strokePadding,
    };
}

function drawRangeLabel(
    labelLayer: PIXI.Container,
    state: FoxholeRangeState,
    radius: number,
    renderScale: number,
): void {
    const layout = computeRangeLabelLayout(state, radius, renderScale);
    if (!layout) {
        return;
    }

    const textValue = formatRangeLabelText(state, radius)!;
    const label = new PIXI.Container();
    label.x = 0;
    label.y = 0;

    const background = new PIXI.Graphics();
    label.addChild(background);

    const text = new PIXI.Text();
    text.text = textValue;
    text.anchor.set(0.5);
    text.style = getFoxholeRangeLabelTextStyle(state);
    label.addChild(text);

    background
        .rect(-layout.width / 2, -layout.height / 2, layout.width, layout.height)
        .fill({ color: state.labelBackgroundColor, alpha: state.labelBackgroundAlpha })
        .stroke({ width: state.labelStrokeWidth, color: state.strokeColor, alpha: state.strokeAlpha });

    label.scale.set(layout.scale);
    labelLayer.addChild(label);
}

export function renderFoxholeRangeGraphics(
    graphics: PIXI.Graphics,
    sourceState: FoxholeRangeState,
    radius: number,
    rawRenderScale: number,
): void {
    const state = resolveFoxholeRangeState(sourceState);
    graphics.clear();

    const resolvedRadius = Math.max(1, radius);
    const renderScale = getEffectiveRenderScale(state, rawRenderScale);
    const strokeWidth = state.strokeWidth * renderScale;
    const markerRadius = Math.max(state.strokeWidth * 1.125, state.centerMarkerRadius) * renderScale;

    if (state.fillAlpha > 0) {
        if (isFullRangeSweep(state.sweepAngle)) {
            graphics.circle(0, 0, resolvedRadius);
            graphics.fill({ color: state.fillColor, alpha: state.fillAlpha });
        } else {
            const { start, end } = getRangeArcRadians(state.sweepAngle);
            graphics.moveTo(0, 0);
            graphics.arc(0, 0, resolvedRadius, start, end);
            graphics.lineTo(0, 0);
            graphics.fill({ color: state.fillColor, alpha: state.fillAlpha });
        }
    }

    if (isFullRangeSweep(state.sweepAngle)) {
        const circlePoints = sampleArcPoints(0, 0, resolvedRadius, 0, Math.PI * 2, 96);
        drawRangeStrokePath(graphics, circlePoints, state, strokeWidth, renderScale);
    } else {
        const { start, end } = getRangeArcRadians(state.sweepAngle);
        const arcPoints = sampleArcPoints(0, 0, resolvedRadius, start, end, 64);
        drawRangeStrokePath(graphics, arcPoints, state, strokeWidth, renderScale);
        drawRangeStrokePath(graphics, [new PIXI.Point(0, 0), arcPoints[0]!], state, strokeWidth, renderScale);
        drawRangeStrokePath(graphics, [new PIXI.Point(0, 0), arcPoints[arcPoints.length - 1]!], state, strokeWidth, renderScale);
    }

    if (state.showCenterAxis) {
        drawPolylineStroke(
            graphics,
            [new PIXI.Point(0, 0), new PIXI.Point(resolvedRadius, 0)],
            state.strokeColor,
            strokeWidth,
            state.strokeAlpha,
        );
    }

    graphics.circle(0, 0, markerRadius);
    graphics.fill({ color: state.strokeColor, alpha: state.strokeAlpha });
}

export function renderFoxholeRangeLabels(
    labelLayer: PIXI.Container,
    sourceState: FoxholeRangeState,
    radius: number,
    rawRenderScale: number,
): void {
    const state = resolveFoxholeRangeState(sourceState);
    clearContainerChildren(labelLayer);
    if (!shouldRenderRangeLabel(state)) {
        return;
    }

    drawRangeLabel(labelLayer, state, radius, getEffectiveRenderScale(state, rawRenderScale));
}

export function renderFoxholeRangeVisuals(
    graphics: PIXI.Graphics,
    labelLayer: PIXI.Container,
    sourceState: FoxholeRangeState,
    rawRenderScale: number,
): void {
    const state = resolveFoxholeRangeState(sourceState);
    const metrics = getFoxholeRangeMetrics(state);
    graphics.position.set(metrics.centerX, metrics.centerY);
    graphics.rotation = metrics.baseAngle;
    labelLayer.position.set(metrics.centerX, metrics.centerY);
    labelLayer.rotation = -state.rotation;
    renderFoxholeRangeGraphics(graphics, state, metrics.radius, rawRenderScale);
    renderFoxholeRangeLabels(labelLayer, state, metrics.radius, rawRenderScale);
}

function toArcLocalPoint(nodeLocal: PIXI.Point, metrics: FoxholeRangeMetrics): PIXI.Point {
    const deltaX = nodeLocal.x - metrics.centerX;
    const deltaY = nodeLocal.y - metrics.centerY;
    const cos = Math.cos(-metrics.baseAngle);
    const sin = Math.sin(-metrics.baseAngle);
    return new PIXI.Point(
        (deltaX * cos) - (deltaY * sin),
        (deltaX * sin) + (deltaY * cos),
    );
}

function arcLocalToNodeLocal(point: PIXI.Point, metrics: FoxholeRangeMetrics): PIXI.Point {
    const cos = Math.cos(metrics.baseAngle);
    const sin = Math.sin(metrics.baseAngle);
    return new PIXI.Point(
        metrics.centerX + ((point.x * cos) - (point.y * sin)),
        metrics.centerY + ((point.x * sin) + (point.y * cos)),
    );
}

function isAngleInRangeSweep(angle: number, sweepAngleDegrees: number): boolean {
    if (isFullRangeSweep(sweepAngleDegrees)) {
        return true;
    }

    const { start, end } = getRangeArcRadians(sweepAngleDegrees);
    return angle >= start && angle <= end;
}

function isPointInRangeWedge(localPoint: PIXI.Point, radius: number, sweepAngleDegrees: number): boolean {
    const distance = Math.hypot(localPoint.x, localPoint.y);
    if (distance > radius) {
        return false;
    }

    if (isFullRangeSweep(sweepAngleDegrees)) {
        return true;
    }

    const angle = Math.atan2(localPoint.y, localPoint.x);
    return isAngleInRangeSweep(angle, sweepAngleDegrees);
}

function distanceToRangeOutline(localPoint: PIXI.Point, radius: number, sweepAngleDegrees: number): number {
    const distance = Math.hypot(localPoint.x, localPoint.y);
    if (isFullRangeSweep(sweepAngleDegrees)) {
        return Math.abs(distance - radius);
    }

    const angle = Math.atan2(localPoint.y, localPoint.x);
    const { start, end } = getRangeArcRadians(sweepAngleDegrees);
    const startPoint = new PIXI.Point(Math.cos(start) * radius, Math.sin(start) * radius);
    const endPoint = new PIXI.Point(Math.cos(end) * radius, Math.sin(end) * radius);

    if (isAngleInRangeSweep(angle, sweepAngleDegrees)) {
        return Math.abs(distance - radius);
    }

    const distanceToStartEdge = Math.hypot(localPoint.x, localPoint.y) <= Number.EPSILON
        ? 0
        : Math.min(
            Math.hypot(localPoint.x - startPoint.x, localPoint.y - startPoint.y),
            Math.hypot(localPoint.x, localPoint.y),
        );
    const distanceToEndEdge = Math.hypot(localPoint.x, localPoint.y) <= Number.EPSILON
        ? 0
        : Math.min(
            Math.hypot(localPoint.x - endPoint.x, localPoint.y - endPoint.y),
            Math.hypot(localPoint.x, localPoint.y),
        );

    return Math.min(distanceToStartEdge, distanceToEndEdge);
}

export function getFoxholeRangeSelectionLocalBounds(
    sourceState: FoxholeRangeState,
    rawRenderScale = 1,
): BoardNodeSelectionBounds {
    const state = resolveFoxholeRangeState(sourceState);
    const metrics = getFoxholeRangeMetrics(state);
    const radius = metrics.radius;
    const padding = Math.max(state.strokeWidth * 0.5, state.centerMarkerRadius);
    const samplePoints: PIXI.Point[] = [new PIXI.Point(0, 0)];

    if (isFullRangeSweep(state.sweepAngle)) {
        for (let index = 0; index <= 64; index += 1) {
            const angle = (index / 64) * Math.PI * 2;
            samplePoints.push(new PIXI.Point(Math.cos(angle) * radius, Math.sin(angle) * radius));
        }
    } else {
        const { start, end } = getRangeArcRadians(state.sweepAngle);
        for (let index = 0; index <= 32; index += 1) {
            const angle = start + ((end - start) * (index / 32));
            samplePoints.push(new PIXI.Point(Math.cos(angle) * radius, Math.sin(angle) * radius));
        }
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of samplePoints) {
        const nodeLocal = arcLocalToNodeLocal(point, metrics);
        minX = Math.min(minX, nodeLocal.x);
        minY = Math.min(minY, nodeLocal.y);
        maxX = Math.max(maxX, nodeLocal.x);
        maxY = Math.max(maxY, nodeLocal.y);
    }

    const labelLayout = computeRangeLabelLayout(state, radius, getEffectiveRenderScale(state, rawRenderScale));
    if (labelLayout) {
        minX = Math.min(minX, metrics.centerX - labelLayout.halfWidth);
        minY = Math.min(minY, metrics.centerY - labelLayout.halfHeight);
        maxX = Math.max(maxX, metrics.centerX + labelLayout.halfWidth);
        maxY = Math.max(maxY, metrics.centerY + labelLayout.halfHeight);
    }

    return {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding,
    };
}

export class FoxholeRangeNode extends BoardNodeBase<FoxholeRangeState> implements BoardNodeEditableHandleProvider, BoardNodeLiveTransformOverlayProvider, BoardNodeSelectionBoundsProvider, BoardNodeSelectionTransformOriginProvider, BoardNodeWorldHitTester {
    override getBoardRenderParticipants() {
        return super.getBoardRenderParticipants().map(participant => ({ ...participant, laneId: 'foxhole:overlay:range', laneOrder: 200 }));
    }
    private static readonly ZOOM_SYNC_INTERVAL_MS = 50;

    readonly graphicsObject: PIXI.Graphics;
    readonly labelLayer: PIXI.Container;
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

    constructor(options: BoardNodeOptions<FoxholeRangeState>) {
        super({
            ...options,
            state: normalizeFoxholeRangeState({
                ...DEFAULT_FOXHOLE_RANGE_STATE,
                ...(options.state ?? {}),
            }),
        });

        this.graphicsObject = new PIXI.Graphics();
        this.addBoardVisualChild(this.graphicsObject);
        this.labelLayer = new PIXI.Container();
        this.labelLayer.eventMode = 'none';
        this.addBoardVisualChild(this.labelLayer);
        this.syncFromState();
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const nodeLocal = this.toLocal(context.viewport.toGlobal(world));
        const metrics = getFoxholeRangeMetrics(this.boardState);
        const arcLocal = toArcLocalPoint(nodeLocal, metrics);
        const hitRadius = Math.max(
            (this.boardState.strokeWidth * 0.5) + this.boardState.centerMarkerRadius,
            context.worldPerPx * 10,
        );

        if (isPointInRangeWedge(arcLocal, metrics.radius, this.boardState.sweepAngle) && this.boardState.fillAlpha > 0) {
            return true;
        }

        return distanceToRangeOutline(arcLocal, metrics.radius, this.boardState.sweepAngle) <= hitRadius;
    }

    getSelectionLocalBounds(): BoardNodeSelectionBounds | null {
        const scaleX = Math.hypot(this.worldTransform.a, this.worldTransform.b);
        const scaleY = Math.hypot(this.worldTransform.c, this.worldTransform.d);
        const resolved = (scaleX + scaleY) * 0.5;
        const rawRenderScale = Number.isFinite(resolved) && resolved > 0 ? 1 / resolved : 1;
        return getFoxholeRangeSelectionLocalBounds(this.boardState, rawRenderScale);
    }

    getSelectionTransformOriginLocal(): { x: number; y: number; } {
        const metrics = getFoxholeRangeMetrics(this.boardState);
        return {
            x: metrics.centerX,
            y: metrics.centerY,
        };
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return getPolylineEditableLocalHandles(this.boardState.points).map(handle => ({
            id: handle.id,
            index: handle.index,
            kind: handle.kind,
            world: context.viewport.toWorld(this.toGlobal(handle.local)),
            canDelete: false,
        }));
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): RangeEditableSession | null {
        if (handle.kind !== 'vertex') {
            return null;
        }

        return {
            handleIndex: handle.index,
            initialPoints: clonePoints(this.boardState.points),
        };
    }

    applyEditableHandleDrag(session: RangeEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const globalPoint = context.viewport.toGlobal(pointerWorld);
        const localPoint = this.toLocal(globalPoint);
        const nextPoints = movePolylineLocalVertex(this.boardState.points, session.handleIndex, localPoint);
        if (!nextPoints) {
            return false;
        }
        this.patchBoardState({
            points: nextPoints,
        }, {
            reason: 'selection-reshape-range-preview',
            recordHistory: false,
        });
        return true;
    }

    buildEditableHandleCommit(session: RangeEditableSession): BoardNodeEditableMutation | null {
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
            reason: 'selection-reshape-range',
            label: 'Reshape Range',
        };
    }

    cancelEditableHandleDrag(session: RangeEditableSession): void {
        this.patchBoardState({
            points: clonePoints(session.initialPoints),
        }, {
            reason: 'selection-reshape-range-revert',
            recordHistory: false,
        });
    }

    syncLiveTransformOverlays(): void {
        this.labelLayer.rotation = -this.rotation;
    }

    protected override onBoardStateChanged(): void {
        this.syncFromState();
    }

    protected override onBoardMounted(): void {
        this.renderScale = this.getRenderScale();
        this.lastZoomSyncAt = this.getNowMs();
        if (this.boardState.scaleWithZoom) {
            PIXI.Ticker.shared.add(this.zoomSyncTicker);
        }
        this.syncFromState();
    }

    protected override onBoardUnmounted(): void {
        PIXI.Ticker.shared.remove(this.zoomSyncTicker);
        this.clearZoomSyncTimeout();
    }

    private syncFromState(): void {
        this.boardState.points = normalizeFoxholeRangePoints(this.boardState.points);
        applyTransform(this, this.boardState);
        renderFoxholeRangeVisuals(this.graphicsObject, this.labelLayer, this.boardState, this.renderScale);
    }

    private getRenderScale(): number {
        const scaleX = Math.hypot(this.worldTransform.a, this.worldTransform.b);
        const scaleY = Math.hypot(this.worldTransform.c, this.worldTransform.d);
        const resolved = (scaleX + scaleY) * 0.5;
        if (!Number.isFinite(resolved) || resolved <= 0) {
            return 1;
        }
        return getEffectiveRenderScale(this.boardState, 1 / resolved);
    }

    private scheduleZoomSync(): void {
        if (!this.boardState.scaleWithZoom) {
            return;
        }

        const now = this.getNowMs();
        const elapsed = now - this.lastZoomSyncAt;
        if (elapsed >= FoxholeRangeNode.ZOOM_SYNC_INTERVAL_MS) {
            this.flushPendingZoomSync();
            return;
        }

        if (this.zoomSyncTimeout !== null) {
            return;
        }

        this.zoomSyncTimeout = setTimeout(() => {
            this.zoomSyncTimeout = null;
            this.flushPendingZoomSync();
        }, FoxholeRangeNode.ZOOM_SYNC_INTERVAL_MS - elapsed);
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
}
