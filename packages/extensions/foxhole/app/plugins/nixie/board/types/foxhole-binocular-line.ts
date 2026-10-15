import * as PIXI from 'pixi.js';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeEditableHandle, BoardNodeEditableHandleContext, BoardNodeEditableHandleProvider, BoardNodeEditableMutation, BoardNodeEditableSegmentTarget, BoardNodeLiveTransformOverlayProvider, BoardNodeOptions, BoardNodeWorldHitTester } from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import {
    applyPolylineVertexDrag,
    buildPolylineEditableHandles,
    buildPolylineSegmentInsertMutation,
    buildPolylineVertexDeleteMutation,
    cloneFlatPoints,
    flatPointsToPixiPoints,
    findNearestEditableSegmentTarget,
} from '#nixie/plugins/nixie/board/utils/polyline-points.ts';
import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
    normalizeFoxholeBinocularLinePoints,
    normalizeFoxholeBinocularLineState,

} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import type { FoxholeBinocularLineState } from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';

interface BinocularLineEditableSession {
    handleId: string;
    handleIndex: number;
    initialPoints: number[];
}

interface BinocularLineSegment {
    start: PIXI.Point;
    end: PIXI.Point;
    allowFlipping: boolean;
    insertIndex: number;
}

const METER_BOARD_PIXEL_SIZE = 32;
const MIN_LABEL_SCALE = 0.2;

function clonePoints(points: readonly number[]): number[] {
    return cloneFlatPoints(points);
}

function toLocalPoints(points: readonly number[]): PIXI.Point[] {
    return flatPointsToPixiPoints(points);
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

function getEffectiveRenderScale(state: FoxholeBinocularLineState, rawRenderScale: number): number {
    if (!state.scaleWithZoom) {
        return 1;
    }
    return Math.max(0.05, rawRenderScale);
}

function getLineSegments(points: readonly PIXI.Point[]): BinocularLineSegment[] {
    if (points.length < 2) {
        return [];
    }

    const anchor = points[0]!;
    const segments: BinocularLineSegment[] = [];
    for (let index = 1; index < points.length; index += 1) {
        segments.push({
            start: anchor,
            end: points[index]!,
            allowFlipping: false,
            insertIndex: index,
        });
    }

    if (points.length > 2) {
        for (let index = 2; index < points.length; index += 1) {
            segments.push({
                start: points[index - 1]!,
                end: points[index]!,
                allowFlipping: true,
                insertIndex: index,
            });
        }
    }

    return segments;
}

function drawLineSegment(
    graphics: PIXI.Graphics,
    start: PIXI.Point,
    end: PIXI.Point,
    color: number,
    width: number,
    alpha: number,
    startInset = 0,
    endInset = 0,
): void {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= Number.EPSILON) {
        return;
    }

    const maxInset = Math.max(0, length - Number.EPSILON);
    const resolvedStartInset = Math.min(Math.max(startInset, 0), maxInset);
    const resolvedEndInset = Math.min(Math.max(endInset, 0), maxInset - resolvedStartInset);
    const tangentX = (end.x - start.x) / length;
    const tangentY = (end.y - start.y) / length;
    graphics.moveTo(start.x + (tangentX * resolvedStartInset), start.y + (tangentY * resolvedStartInset));
    graphics.lineTo(end.x - (tangentX * resolvedEndInset), end.y - (tangentY * resolvedEndInset));
    // Legacy line stroke omits cap (PIXI default butt). Round was making non-arrow ends look bulbous.
    graphics.stroke({ color, width, alpha, pixelLine: false, cap: 'butt', join: 'round' });
}

function drawEndArrow(
    graphics: PIXI.Graphics,
    start: PIXI.Point,
    end: PIXI.Point,
    color: number,
    alpha: number,
    width: number,
    renderScale: number,
): void {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= Number.EPSILON) {
        return;
    }

    const tangent = new PIXI.Point((end.x - start.x) / length, (end.y - start.y) / length);
    const normal = new PIXI.Point(-tangent.y, tangent.x);
    const halfLength = Math.max(10 * renderScale, width * 2);
    const shoulder = new PIXI.Point(end.x - (tangent.x * halfLength), end.y - (tangent.y * halfLength));
    const tail = new PIXI.Point(end.x - (tangent.x * halfLength * 1.55), end.y - (tangent.y * halfLength * 1.55));

    graphics.poly([
        end.x,
        end.y,
        tail.x + (normal.x * halfLength),
        tail.y + (normal.y * halfLength),
        shoulder.x,
        shoulder.y,
        tail.x - (normal.x * halfLength),
        tail.y - (normal.y * halfLength),
    ], true);
    graphics.fill({ color, alpha });
}

function drawCircleCap(
    graphics: PIXI.Graphics,
    point: PIXI.Point,
    state: FoxholeBinocularLineState,
    renderScale: number,
): void {
    // Legacy multi-mode: Math.max(lineWidth * 1.125, 5) / camera.zoom
    const radius = Math.max(state.strokeWidth * 1.125, 5) * renderScale;
    graphics.circle(point.x, point.y, radius);
    graphics.fill({ color: state.strokeColor, alpha: state.strokeAlpha });
}

function drawEndpointMarkers(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    state: FoxholeBinocularLineState,
    renderScale: number,
): void {
    if (!(state.endpointRadius > 0)) {
        return;
    }
    const radius = Math.max(state.strokeWidth * 1.125, state.endpointRadius) * renderScale;
    for (const point of points) {
        graphics.circle(point.x, point.y, radius);
        graphics.fill({ color: state.strokeColor, alpha: state.strokeAlpha });
    }
}

/**
 * Legacy binoline (lineMode multi) draws filled circles on every point that does not
 * have an arrow cap. For 2-point lines, startCap/endCap === 'circle' drives that.
 * Extra vertices always get circles in multi/hub layouts.
 */
function drawLegacyStyleEndpointCircles(
    graphics: PIXI.Graphics,
    points: readonly PIXI.Point[],
    state: FoxholeBinocularLineState,
    renderScale: number,
): void {
    for (let index = 0; index < points.length; index += 1) {
        if (index === 0 && state.startCap === 'arrow') {
            continue;
        }
        if (index === 1 && state.endCap === 'arrow') {
            continue;
        }
        const wantsCircle = index === 0
            ? state.startCap === 'circle'
            : index === 1
                ? state.endCap === 'circle'
                : true;
        if (!wantsCircle) {
            continue;
        }
        drawCircleCap(graphics, points[index]!, state, renderScale);
    }
}

function normalizeAngleRadians(radians: number): number {
    const twoPi = Math.PI * 2;
    return radians - (twoPi * Math.floor(radians / twoPi));
}

function formatMeasurementText(
    state: FoxholeBinocularLineState,
    start: PIXI.Point,
    end: PIXI.Point,
): string {
    const parts: string[] = [];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const decimals = Math.max(0, Math.min(4, Math.round(state.decimals)));
    if (state.showDistance) {
        const meterPixels = Math.max(1, state.meterPixels || METER_BOARD_PIXEL_SIZE);
        parts.push(`${(distance / meterPixels).toFixed(decimals)}m`);
    }
    if (state.showAzimuth) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const azimuth = normalizeAngleRadians(state.rotation + angle + (Math.PI / 2));
        parts.push(`${(azimuth * 180 / Math.PI).toFixed(decimals)}°`);
    }
    return parts.join('\n');
}

function transformSegmentLocalPoint(
    midpoint: PIXI.Point,
    tangent: PIXI.Point,
    normal: PIXI.Point,
    localX: number,
    localY: number,
): PIXI.Point {
    return new PIXI.Point(
        midpoint.x + (tangent.x * localX) + (normal.x * localY),
        midpoint.y + (tangent.y * localX) + (normal.y * localY),
    );
}

function drawMeasurementArrowPair(
    graphics: PIXI.Graphics,
    segment: BinocularLineSegment,
    state: FoxholeBinocularLineState,
    renderScale: number,
): void {
    if (!state.showAzimuth || !state.showAzimuthArrows) {
        return;
    }

    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    if (length <= Number.EPSILON) {
        return;
    }

    const tangent = new PIXI.Point((segment.end.x - segment.start.x) / length, (segment.end.y - segment.start.y) / length);
    const normal = new PIXI.Point(-tangent.y, tangent.x);
    const midpoint = new PIXI.Point((segment.start.x + segment.end.x) / 2, (segment.start.y + segment.end.y) / 2);
    const arrowLength = 12 * renderScale;
    const arrowHalfWidth = 10 * renderScale;
    const color = segment.allowFlipping ? state.labelBackgroundColor : state.strokeColor;
    const alpha = segment.allowFlipping ? 0.75 : state.strokeAlpha;

    for (const position of [length / 4, -length / 4]) {
        const tipA = transformSegmentLocalPoint(midpoint, tangent, normal, position, 0);
        const baseA1 = transformSegmentLocalPoint(midpoint, tangent, normal, position - arrowLength, arrowHalfWidth);
        const baseA2 = transformSegmentLocalPoint(midpoint, tangent, normal, position - arrowLength, -arrowHalfWidth);
        graphics.poly([tipA.x, tipA.y, baseA1.x, baseA1.y, baseA2.x, baseA2.y], true);
        graphics.fill({ color, alpha });

        const tipB = transformSegmentLocalPoint(midpoint, tangent, normal, position + arrowLength, 0);
        const baseB1 = transformSegmentLocalPoint(midpoint, tangent, normal, position, arrowHalfWidth);
        const baseB2 = transformSegmentLocalPoint(midpoint, tangent, normal, position, -arrowHalfWidth);
        graphics.poly([tipB.x, tipB.y, baseB1.x, baseB1.y, baseB2.x, baseB2.y], true);
        graphics.fill({ color, alpha });
    }
}

function clearContainerChildren(container: PIXI.Container): void {
    for (const child of container.removeChildren()) {
        child.destroy({ children: true });
    }
}

function drawMeasurementLabel(
    labelLayer: PIXI.Container,
    segment: BinocularLineSegment,
    state: FoxholeBinocularLineState,
    renderScale: number,
): void {
    const textValue = formatMeasurementText(state, segment.start, segment.end);
    if (!textValue) {
        return;
    }

    const distance = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    if (distance <= Number.EPSILON) {
        return;
    }

    const label = new PIXI.Container();
    label.x = (segment.start.x + segment.end.x) / 2;
    label.y = (segment.start.y + segment.end.y) / 2;
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
    const halfDistance = distance / 2;
    const shrink = worldLabelSize > halfDistance && worldLabelSize > Number.EPSILON
        ? Math.max(MIN_LABEL_SCALE, halfDistance / worldLabelSize)
        : 1;
    label.scale.set(renderScale * shrink);
    labelLayer.addChild(label);
}

export function renderFoxholeBinocularLineGraphics(
    graphics: PIXI.Graphics,
    sourceState: FoxholeBinocularLineState,
    rawRenderScale: number,
): void {
    const state = normalizeFoxholeBinocularLineState(sourceState);
    const points = toLocalPoints(state.points);
    graphics.clear();
    if (points.length < 2) {
        return;
    }

    const renderScale = getEffectiveRenderScale(state, rawRenderScale);
    // Measurement chevrons always screen-scale in legacy, independent of scaleToZoom.
    const labelScale = Math.max(0.05, rawRenderScale);
    const strokeWidth = state.strokeWidth * renderScale;
    const lineAlpha = points.length > 2 ? state.multiSegmentAlpha : state.strokeAlpha;
    const segments = getLineSegments(points);

    for (const segment of segments) {
        const isPrimary = points.length === 2 && !segment.allowFlipping;
        const shouldInsetStart = isPrimary && state.startCap === 'arrow';
        const shouldInsetEnd = isPrimary && state.endCap === 'arrow';
        drawLineSegment(
            graphics,
            segment.start,
            segment.end,
            state.strokeColor,
            strokeWidth,
            lineAlpha,
            shouldInsetStart ? strokeWidth * 2 : 0,
            shouldInsetEnd ? strokeWidth * 2 : 0,
        );
    }

    if (points.length === 2 && state.startCap === 'arrow') {
        drawEndArrow(graphics, points[1]!, points[0]!, state.strokeColor, state.strokeAlpha, strokeWidth, renderScale);
    }
    if (points.length === 2 && state.endCap === 'arrow') {
        drawEndArrow(graphics, points[0]!, points[1]!, state.strokeColor, state.strokeAlpha, strokeWidth, renderScale);
    }

    for (const segment of segments) {
        drawMeasurementArrowPair(graphics, segment, state, labelScale);
    }

    drawLegacyStyleEndpointCircles(graphics, points, state, renderScale);
    drawEndpointMarkers(graphics, points, state, renderScale);
}

export function renderFoxholeBinocularLineLabels(
    labelLayer: PIXI.Container,
    sourceState: FoxholeBinocularLineState,
    rawRenderScale: number,
): void {
    const state = normalizeFoxholeBinocularLineState(sourceState);
    const points = toLocalPoints(state.points);
    clearContainerChildren(labelLayer);
    if (points.length < 2 || (!state.showDistance && !state.showAzimuth)) {
        return;
    }

    // Legacy always screen-scales dist/azimuth labels (÷ camera.zoom), even when
    // stroke width is world-sized (scaleToZoom false).
    const labelScale = Math.max(0.05, rawRenderScale);
    for (const segment of getLineSegments(points)) {
        drawMeasurementLabel(labelLayer, segment, state, labelScale);
    }
}

export function renderFoxholeBinocularLineVisuals(
    graphics: PIXI.Graphics,
    labelLayer: PIXI.Container,
    sourceState: FoxholeBinocularLineState,
    rawRenderScale: number,
): void {
    renderFoxholeBinocularLineGraphics(graphics, sourceState, rawRenderScale);
    renderFoxholeBinocularLineLabels(labelLayer, sourceState, rawRenderScale);
}

export class FoxholeBinocularLineNode extends BoardNodeBase<FoxholeBinocularLineState> implements BoardNodeEditableHandleProvider, BoardNodeLiveTransformOverlayProvider, BoardNodeWorldHitTester {
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

    constructor(options: BoardNodeOptions<FoxholeBinocularLineState>) {
        super({
            ...options,
            state: normalizeFoxholeBinocularLineState({
                ...DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
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

    override patchBoardState(patch: Parameters<BoardNodeBase<FoxholeBinocularLineState>['patchBoardState']>[0], options = {}): void {
        super.patchBoardState(patch, options);
        this.syncFromState();
    }

    override replaceBoardState(nextState: FoxholeBinocularLineState, options = {}): void {
        super.replaceBoardState(normalizeFoxholeBinocularLineState(nextState), options);
        this.syncFromState();
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const hitRadius = Math.max(
            (this.boardState.strokeWidth * 0.5) + this.boardState.endpointRadius,
            context.worldPerPx * 10,
        );
        for (const segment of this.getVisualWorldSegments(context)) {
            if (distanceToSegment(world, segment.start, segment.end) <= hitRadius) {
                return true;
            }
        }
        return false;
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return buildPolylineEditableHandles(this, this.boardState.points, context, {
            minimumPointCount: 2,
        });
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): BinocularLineEditableSession | null {
        if (handle.kind !== 'vertex') {
            return null;
        }

        return {
            handleId: handle.id,
            handleIndex: handle.index,
            initialPoints: clonePoints(this.boardState.points),
        };
    }

    applyEditableHandleDrag(session: BinocularLineEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const nextPoints = applyPolylineVertexDrag(
            this.boardState.points,
            session.handleIndex,
            pointerWorld,
            this,
            context,
        );
        if (!nextPoints) {
            return false;
        }

        this.patchBoardState({
            points: nextPoints,
        }, {
            reason: 'selection-reshape-binocular-line-preview',
            recordHistory: false,
        });
        return true;
    }

    buildEditableHandleCommit(session: BinocularLineEditableSession): BoardNodeEditableMutation | null {
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
            reason: 'selection-reshape-binocular-line',
            label: 'Reshape Binoculars Tool',
        };
    }

    cancelEditableHandleDrag(session: BinocularLineEditableSession): void {
        this.patchBoardState({
            points: clonePoints(session.initialPoints),
        }, {
            reason: 'selection-reshape-binocular-line-revert',
            recordHistory: false,
        });
    }

    getEditableSegmentTarget(
        world: PIXI.Point,
        maxDistance: number,
        context: BoardNodeEditableHandleContext,
    ): BoardNodeEditableSegmentTarget | null {
        const localPoints = toLocalPoints(this.boardState.points);
        return findNearestEditableSegmentTarget(
            this,
            getLineSegments(localPoints),
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
            this.boardState.points,
            target,
            context,
            {
                reason: 'selection-insert-binocular-line-point',
                label: 'Insert Binoculars Point',
            },
        );
    }

    buildEditableHandleDeleteMutation(handle: BoardNodeEditableHandle): BoardNodeEditableMutation | null {
        return buildPolylineVertexDeleteMutation(
            this.boardState.points,
            handle,
            2,
            {
                reason: 'selection-delete-binocular-line-point',
                label: 'Delete Binoculars Point',
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
        PIXI.Ticker.shared.add(this.zoomSyncTicker);
        this.syncFromState();
    }

    protected override onBoardUnmounted(): void {
        PIXI.Ticker.shared.remove(this.zoomSyncTicker);
        this.clearZoomSyncTimeout();
    }

    private syncFromState(): void {
        this.boardState.points = normalizeFoxholeBinocularLinePoints(this.boardState.points);
        renderFoxholeBinocularLineVisuals(this.graphicsObject, this.labelLayer, this.boardState, this.renderScale);
        applyTransform(this, this.boardState);
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

    private scheduleZoomSync(): void {
        const now = this.getNowMs();
        const elapsed = now - this.lastZoomSyncAt;
        if (elapsed >= FoxholeBinocularLineNode.ZOOM_SYNC_INTERVAL_MS) {
            this.flushPendingZoomSync();
            return;
        }

        if (this.zoomSyncTimeout !== null) {
            return;
        }

        this.zoomSyncTimeout = setTimeout(() => {
            this.zoomSyncTimeout = null;
            this.flushPendingZoomSync();
        }, FoxholeBinocularLineNode.ZOOM_SYNC_INTERVAL_MS - elapsed);
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

    private getVisualWorldSegments(context: BoardNodeEditableHandleContext): BinocularLineSegment[] {
        return getLineSegments(toLocalPoints(this.boardState.points)).map(segment => ({
            ...segment,
            start: context.viewport.toWorld(this.toGlobal(segment.start)),
            end: context.viewport.toWorld(this.toGlobal(segment.end)),
        }));
    }
}
