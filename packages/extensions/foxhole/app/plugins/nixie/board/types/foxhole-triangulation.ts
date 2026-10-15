import * as PIXI from 'pixi.js';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeEditableHandle, BoardNodeEditableHandleContext, BoardNodeEditableHandleProvider, BoardNodeEditableMutation, BoardNodeEditableSegmentTarget, BoardNodeLiveTransformOverlayProvider, BoardNodeOptions, BoardNodeSelectionBounds, BoardNodeSelectionBoundsProvider, BoardNodeWorldHitTester } from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import {
    applyPolylineVertexDrag,
    buildPolylineEditableHandles,
    buildPolylineSegmentInsertMutation,
    buildPolylineVertexDeleteMutation,
    cloneFlatPoints,
    flatPointsToPixiPoints,
    getClosedPolylineEditableSegmentTarget,
} from '#nixie/plugins/nixie/board/utils/polyline-points.ts';
import {
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,
    getFoxholeTriangulationCircleCenterLocal,
    getFoxholeTriangulationFit,
    getFoxholeTriangulationRadiusMeters,
    normalizeFoxholeTriangulationState,
    resolveFoxholeTriangulationState,

} from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import type { FoxholeTriangulationState } from '#foxhole/plugins/foxhole/nixie/triangulation.ts';

interface TriangulationEditableSession {
    handleIndex: number;
    initialEdgePoints: number[];
}

const MIN_TRIANGULATION_POINTS = 3;
const EDGE_POINTS_FIELD = 'edgePoints';
const SELECTION_VERTEX_HANDLE_RADIUS_PX = 7;

const MIN_LABEL_SCALE = 0.2;

function toLocalPoints(points: readonly number[]): PIXI.Point[] {
    return flatPointsToPixiPoints(points);
}

function unionSelectionBounds(
    left: BoardNodeSelectionBounds | null,
    right: BoardNodeSelectionBounds | null,
): BoardNodeSelectionBounds | null {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }

    return {
        minX: Math.min(left.minX, right.minX),
        minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX),
        maxY: Math.max(left.maxY, right.maxY),
    };
}

function getHandleMarkerRadius(state: FoxholeTriangulationState, renderScale: number): number {
    const scale = getEffectiveRenderScale(state, renderScale);
    return Math.max(
        state.strokeWidth * 0.5,
        state.centerMarkerRadius,
        state.edgeMarkerRadius,
        SELECTION_VERTEX_HANDLE_RADIUS_PX,
    ) * scale;
}

function getHandlePointsLocalBounds(
    state: FoxholeTriangulationState,
    renderScale: number,
): BoardNodeSelectionBounds | null {
    const markerRadius = getHandleMarkerRadius(state, renderScale);
    const points = toLocalPoints(state.edgePoints);
    const center = getFoxholeTriangulationCircleCenterLocal(state);
    if (!points.length && !center) {
        return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const includePoint = (x: number, y: number) => {
        minX = Math.min(minX, x - markerRadius);
        minY = Math.min(minY, y - markerRadius);
        maxX = Math.max(maxX, x + markerRadius);
        maxY = Math.max(maxY, y + markerRadius);
    };

    for (const point of points) {
        includePoint(point.x, point.y);
    }
    if (center) {
        includePoint(center.x, center.y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
    }

    return { minX, minY, maxX, maxY };
}

function getEdgePointsLocalBounds(state: FoxholeTriangulationState): BoardNodeSelectionBounds | null {
    return getHandlePointsLocalBounds(state, 1);
}

function getCircleLocalBounds(
    state: FoxholeTriangulationState,
    renderScale: number,
): BoardNodeSelectionBounds | null {
    const fit = getFoxholeTriangulationFit(state);
    const center = getFoxholeTriangulationCircleCenterLocal(state);
    if (!fit || !center) {
        return null;
    }

    const padding = getHandleMarkerRadius(state, renderScale);
    const radius = fit.radius + padding;
    return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
    };
}

function getTriangulationSelectionLocalBounds(
    state: FoxholeTriangulationState,
    renderScale: number,
): BoardNodeSelectionBounds | null {
    return unionSelectionBounds(
        getCircleLocalBounds(state, renderScale),
        getHandlePointsLocalBounds(state, renderScale),
    ) ?? getEdgePointsLocalBounds(state);
}

function getEffectiveRenderScale(state: FoxholeTriangulationState, rawRenderScale: number): number {
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
    steps = 96,
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

function drawStrokePath(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    state: FoxholeTriangulationState,
    strokeWidth: number,
    renderScale: number,
    alpha = state.strokeAlpha,
): void {
    if (state.strokeStyle === 'dashed') {
        drawDashedPolylineStroke(
            graphics,
            points,
            state.strokeColor,
            strokeWidth,
            alpha,
            state.strokeDashLength * renderScale,
            state.strokeDashGap * renderScale,
        );
        return;
    }

    drawPolylineStroke(graphics, points, state.strokeColor, strokeWidth, alpha);
}

function clearContainerChildren(container: PIXI.Container): void {
    for (const child of container.removeChildren()) {
        child.destroy({ children: true });
    }
}

function formatTriangulationLabelText(state: FoxholeTriangulationState, radius: number): string {
    const meterPixels = Math.max(1, state.meterPixels);
    const decimals = Math.max(0, Math.min(4, Math.round(state.decimals)));
    return `${(radius / meterPixels).toFixed(decimals)}m`;
}

function drawRadiusLabel(
    labelLayer: PIXI.Container,
    state: FoxholeTriangulationState,
    centerX: number,
    centerY: number,
    radius: number,
    renderScale: number,
): void {
    if (!state.showRadius) {
        return;
    }

    const textValue = formatTriangulationLabelText(state, radius);
    const label = new PIXI.Container();
    label.position.set(centerX + (radius * 0.5), centerY);
    label.rotation = -state.rotation;

    const background = new PIXI.Graphics();
    label.addChild(background);

    const text = new PIXI.Text();
    text.text = textValue;
    text.anchor.set(0.5);
    text.style = {
        fontFamily: 'Jost, Arial, sans-serif',
        fontSize: state.labelFontSize,
        fontWeight: 'normal',
        fill: state.labelColor,
        align: 'center',
        lineHeight: state.labelFontSize + 2,
    } satisfies Partial<PIXI.TextStyleOptions>;
    label.addChild(text);

    const padding = state.labelPadding;
    const width = text.width + (padding * 2);
    const height = text.height + (padding * 2);
    background
        .rect(-width / 2, -height / 2, width, height)
        .fill({ color: state.labelBackgroundColor, alpha: state.labelBackgroundAlpha })
        .stroke({ width: state.labelStrokeWidth, color: state.strokeColor, alpha: state.strokeAlpha });

    const worldLabelSize = Math.max(width, height) * renderScale;
    const shrink = worldLabelSize > radius && worldLabelSize > Number.EPSILON
        ? Math.max(MIN_LABEL_SCALE, radius / worldLabelSize)
        : 1;
    label.scale.set(renderScale * shrink);
    labelLayer.addChild(label);
}

export interface FoxholeTriangulationRenderOptions {
    alwaysShowEdgeLines?: boolean;
}

export function renderFoxholeTriangulationVisuals(
    graphics: PIXI.Graphics,
    labelLayer: PIXI.Container,
    sourceState: FoxholeTriangulationState,
    rawRenderScale: number,
    radiusOverride?: number,
    renderOptions?: FoxholeTriangulationRenderOptions,
): void {
    const state = resolveFoxholeTriangulationState(sourceState);
    const fit = getFoxholeTriangulationFit(state);
    graphics.clear();
    clearContainerChildren(labelLayer);

    if (!fit && !Number.isFinite(radiusOverride)) {
        return;
    }

    const radius = Math.max(1, radiusOverride ?? fit?.radius ?? 0);
    const renderScale = getEffectiveRenderScale(state, rawRenderScale);
    const strokeWidth = state.strokeWidth * renderScale;
    const centerMarkerRadius = Math.max(state.strokeWidth * 1.125, state.centerMarkerRadius) * renderScale;
    const edgeMarkerRadius = Math.max(state.strokeWidth * 1.125, state.edgeMarkerRadius) * renderScale;
    const edgePoints = toLocalPoints(state.edgePoints);
    const circleCenter = getFoxholeTriangulationCircleCenterLocal(state) ?? { x: 0, y: 0 };
    const shouldDrawEdgeLines = renderOptions?.alwaysShowEdgeLines === true;

    if (shouldDrawEdgeLines && edgePoints.length >= 2) {
        const perimeter = edgePoints.slice();
        if (edgePoints.length >= 3) {
            perimeter.push(edgePoints[0]!);
        }
        drawStrokePath(graphics, perimeter, state, strokeWidth, renderScale, state.edgeLineAlpha);
    }

    if (state.fillAlpha > 0) {
        graphics.circle(circleCenter.x, circleCenter.y, radius);
        graphics.fill({ color: state.fillColor, alpha: state.fillAlpha });
    }

    const circlePoints = sampleArcPoints(circleCenter.x, circleCenter.y, radius, 0, Math.PI * 2, 96);
    drawStrokePath(graphics, circlePoints, state, strokeWidth, renderScale);

    if (state.showSpokes) {
        for (const edgePoint of edgePoints) {
            drawStrokePath(
                graphics,
                [new PIXI.Point(circleCenter.x, circleCenter.y), edgePoint],
                state,
                strokeWidth,
                renderScale,
                state.spokeAlpha,
            );
        }
    }

    if (state.showEdgeMarkers) {
        for (const edgePoint of edgePoints) {
            graphics.circle(edgePoint.x, edgePoint.y, edgeMarkerRadius);
            graphics.fill({ color: state.strokeColor, alpha: state.strokeAlpha });
        }
    }

    graphics.circle(circleCenter.x, circleCenter.y, centerMarkerRadius);
    graphics.fill({ color: state.strokeColor, alpha: state.strokeAlpha });

    drawRadiusLabel(labelLayer, state, circleCenter.x, circleCenter.y, radius, renderScale);
}

export function renderFoxholeTriangulationTrackingLines(
    graphics: PIXI.Graphics,
    draftPoints: readonly number[],
    hoverPoint: PIXI.Point | null,
    state: FoxholeTriangulationState,
    rawRenderScale: number,
): void {
    if (draftPoints.length < 2) {
        return;
    }

    const renderScale = getEffectiveRenderScale(state, rawRenderScale);
    const strokeWidth = state.strokeWidth * renderScale;
    const polylinePoints: PIXI.Point[] = [];
    for (let index = 0; index + 1 < draftPoints.length; index += 2) {
        polylinePoints.push(new PIXI.Point(draftPoints[index]!, draftPoints[index + 1]!));
    }
    if (hoverPoint) {
        polylinePoints.push(hoverPoint);
    }

    for (let index = 1; index < polylinePoints.length; index += 1) {
        drawStrokePath(
            graphics,
            [polylinePoints[index - 1]!, polylinePoints[index]!],
            state,
            strokeWidth,
            renderScale,
            state.edgeLineAlpha,
        );
    }
}

export class FoxholeTriangulationNode extends BoardNodeBase<FoxholeTriangulationState> implements BoardNodeEditableHandleProvider, BoardNodeLiveTransformOverlayProvider, BoardNodeSelectionBoundsProvider, BoardNodeWorldHitTester {
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

    constructor(options: BoardNodeOptions<FoxholeTriangulationState>) {
        super({
            ...options,
            state: normalizeFoxholeTriangulationState({
                ...DEFAULT_FOXHOLE_TRIANGULATION_STATE,
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
        const fit = getFoxholeTriangulationFit(this.boardState);
        if (!fit) {
            return false;
        }

        const circleCenter = getFoxholeTriangulationCircleCenterLocal(this.boardState) ?? { x: 0, y: 0 };
        const localPoint = this.toLocal(context.viewport.toGlobal(world));
        const distance = Math.hypot(localPoint.x - circleCenter.x, localPoint.y - circleCenter.y);
        const hitRadius = Math.max(
            (this.boardState.strokeWidth * 0.5) + this.boardState.centerMarkerRadius,
            context.worldPerPx * 10,
        );

        if (distance <= fit.radius) {
            return true;
        }

        return Math.abs(distance - fit.radius) <= hitRadius;
    }

    getSelectionLocalBounds(): BoardNodeSelectionBounds | null {
        return getTriangulationSelectionLocalBounds(this.boardState, this.renderScale);
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return buildPolylineEditableHandles(this, this.boardState.edgePoints, context, {
            idPrefix: 'edge',
            minimumPointCount: MIN_TRIANGULATION_POINTS,
        });
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): TriangulationEditableSession | null {
        if (handle.kind !== 'vertex') {
            return null;
        }

        return {
            handleIndex: handle.index,
            initialEdgePoints: cloneFlatPoints(this.boardState.edgePoints),
        };
    }

    applyEditableHandleDrag(session: TriangulationEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const nextEdgePoints = applyPolylineVertexDrag(
            this.boardState.edgePoints,
            session.handleIndex,
            pointerWorld,
            this,
            context,
        );
        if (!nextEdgePoints) {
            return false;
        }

        const nextFit = getFoxholeTriangulationFit({
            ...this.boardState,
            edgePoints: nextEdgePoints,
        });
        if (!nextFit) {
            return false;
        }

        this.patchBoardState({
            edgePoints: nextEdgePoints,
        }, {
            reason: 'selection-reshape-triangulation-preview',
            recordHistory: false,
        });
        return true;
    }

    buildEditableHandleCommit(session: TriangulationEditableSession): BoardNodeEditableMutation | null {
        const nextEdgePoints = cloneFlatPoints(this.boardState.edgePoints);
        const initialEdgePoints = cloneFlatPoints(session.initialEdgePoints);
        if (JSON.stringify(nextEdgePoints) === JSON.stringify(initialEdgePoints)) {
            return null;
        }

        return {
            patch: {
                edgePoints: nextEdgePoints,
            },
            inversePatch: {
                edgePoints: initialEdgePoints,
            },
            reason: 'selection-reshape-triangulation',
            label: 'Reshape Triangulation',
        };
    }

    cancelEditableHandleDrag(session: TriangulationEditableSession): void {
        this.patchBoardState({
            edgePoints: cloneFlatPoints(session.initialEdgePoints),
        }, {
            reason: 'selection-reshape-triangulation-revert',
            recordHistory: false,
        });
    }

    getEditableSegmentTarget(
        world: PIXI.Point,
        maxDistance: number,
        context: BoardNodeEditableHandleContext,
    ): BoardNodeEditableSegmentTarget | null {
        return getClosedPolylineEditableSegmentTarget(
            this,
            this.boardState.edgePoints,
            world,
            maxDistance,
            context,
        );
    }

    buildEditableSegmentInsertMutation(
        target: BoardNodeEditableSegmentTarget,
        context: BoardNodeEditableHandleContext,
    ): BoardNodeEditableMutation | null {
        return buildPolylineSegmentInsertMutation(
            this,
            this.boardState.edgePoints,
            target,
            context,
            {
                reason: 'selection-insert-triangulation-point',
                label: 'Insert Triangulation Point',
                pointsField: EDGE_POINTS_FIELD,
            },
        );
    }

    buildEditableHandleDeleteMutation(handle: BoardNodeEditableHandle): BoardNodeEditableMutation | null {
        return buildPolylineVertexDeleteMutation(
            this.boardState.edgePoints,
            handle,
            MIN_TRIANGULATION_POINTS,
            {
                reason: 'selection-delete-triangulation-point',
                label: 'Delete Triangulation Point',
                pointsField: EDGE_POINTS_FIELD,
            },
        );
    }

    syncLiveTransformOverlays(): void {
        const counterRotation = -this.rotation;
        for (const child of this.labelLayer.children) {
            child.rotation = counterRotation;
        }
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
        applyTransform(this, this.boardState);
        renderFoxholeTriangulationVisuals(this.graphicsObject, this.labelLayer, this.boardState, this.renderScale);
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
        if (elapsed >= FoxholeTriangulationNode.ZOOM_SYNC_INTERVAL_MS) {
            this.flushPendingZoomSync();
            return;
        }

        if (this.zoomSyncTimeout !== null) {
            return;
        }

        this.zoomSyncTimeout = setTimeout(() => {
            this.zoomSyncTimeout = null;
            this.flushPendingZoomSync();
        }, FoxholeTriangulationNode.ZOOM_SYNC_INTERVAL_MS - elapsed);
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

export function getFoxholeTriangulationSelectionLocalBounds(
    state: FoxholeTriangulationState,
    rawRenderScale: number,
): BoardNodeSelectionBounds | null {
    return getTriangulationSelectionLocalBounds(resolveFoxholeTriangulationState(state), rawRenderScale);
}

export function formatFoxholeTriangulationSummary(state: Partial<FoxholeTriangulationState>): string {
    const radiusMeters = getFoxholeTriangulationRadiusMeters(state);
    return radiusMeters > 0 ? `${radiusMeters}m radius` : 'Triangulation';
}
