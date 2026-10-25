import { resolveFoxholePointConnectorSockets } from '#foxhole/plugins/foxhole/nixie/spline-connector-sockets.ts';
import * as PIXI from 'pixi.js';
import { resolveFoxholePowerlineStroke } from '#foxhole/plugins/foxhole/nixie/powerline-stroke.ts';
import { watch } from 'vue';
import type { WatchStopHandle } from 'vue';
import BoardNodeBase from '#nixie/plugins/nixie/board/types/node.ts';
import type { BoardNodeEditableHandle, BoardNodeEditableHandleContext, BoardNodeEditableHandleProvider, BoardNodeEditableMutation, BoardNodePlacementProvider, BoardNodePlacementSessionContext, BoardNodeMoveCommitContext, BoardNodeMoveSnapProvider, BoardNodeMoveSnapResult, BoardNodeEditableSegmentTarget, BoardNodeOptions, BoardNodeSelectionBoxReshapeProvider, BoardNodeSelectionBoxReshapeTarget, BoardNodeSelectionBounds, BoardNodeSelectionBoundsProvider, BoardNodeWorldHitTester, BoardRenderParticipant } from '#nixie/plugins/nixie/board/types/node.ts';
import { applyTransform } from '#nixie/plugins/nixie/board/types/primitives/shared.ts';
import { BoardSpriteNode } from '#nixie/plugins/nixie/board/types/primitives/index.ts';
import {
    subscribeToNixieSelectionState,
} from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    buildFoxholeConnectorTargetAttachmentsFromEndpoints,
    DEFAULT_FOXHOLE_CONNECTOR_STATE,
    normalizeFoxholeConnectorPoints,
    normalizeFoxholeConnectorState,
    reconcileFoxholeConnectorAttachments,
    resolveFoxholeConnectorEndpointAttachmentsFromTargets,
    resolveFoxholeConnectorEndpointSockets,
    resolveFoxholeStraightConnectorGeometry,

} from '#foxhole/plugins/foxhole/nixie/connector.ts';
import type { FoxholeConnectorEndpointAttachment, FoxholeConnectorState } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import { FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE, resolveFoxholeConnectorRenderLane } from '#foxhole/plugins/foxhole/nixie/render-lanes.ts';
import type {
    FoxholeManifestBuildSocket,
    FoxholeManifestStructure,
} from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import type { FoxholeStructureAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
    FOXHOLE_SOCKET_SNAPPING_SETTING_ID,
    findBestFoxholeSocketSnap,
    hasFoxholePowerSocketTag,
    hasFoxholeSnapSocketTags,
    normalizeFoxholeSocketTags,

} from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import type { FoxholeSocketSnapPoint, FoxholeSocketTagBitfield } from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import {
    createFoxholePipeSocketVisual,
    createFoxholePowerSocketVisual,
    resolveFoxholeSocketKind,
} from '#foxhole/plugins/foxhole/nixie/structure-socket-visuals.ts';
import {
    normalizeFoxholeStructureSocketAttachmentMap,

} from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureSocketAttachmentMap } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FoxholeStructureNode } from './foxhole-structure.ts';

const FOXHOLE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS = [
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels,
] as const;

interface FoxholeConnectorEditableSession {
    handleId: string;
    handleIndex: number;
    initialPoints: number[];
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewStartAttachment?: FoxholeConnectorEndpointAttachment;
    previewEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
    previewTargets?: FoxholeConnectorTargetStructureSnapshot[];
}

interface FoxholeConnectorSelectionBoxReshapeSession {
    initialX: number;
    initialY: number;
    initialPoints: number[];
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewStartAttachment?: FoxholeConnectorEndpointAttachment;
    previewEndAttachment?: FoxholeConnectorEndpointAttachment;
    previewTargetAttachmentsByNode?: Map<string, FoxholeStructureSocketAttachmentMap>;
    previewTargets?: FoxholeConnectorTargetStructureSnapshot[];
    localBounds: { minX: number; minY: number; maxX: number; maxY: number; };
}

interface FoxholeConnectorPlacementSession {
    phase: 'pick-start' | 'pick-end';
    initialX: number;
    initialY: number;
    initialPoints: number[];
    initialStartAttachment?: FoxholeConnectorEndpointAttachment;
    initialEndAttachment?: FoxholeConnectorEndpointAttachment;
}

interface FoxholeConnectorDefinition {
    assetResolver?: (foxholeKey: string) => FoxholeStructureAsset | undefined;
    structureResolver?: (foxholeKey: string) => FoxholeManifestStructure | undefined;
}

interface FoxholeConnectorResolvedSocket {
    name: string;
    endpoint: 'start' | 'end';
    componentType?: string;
    pipeType?: string | null;
    socketTags: FoxholeSocketTagBitfield[];
    localX: number;
    localY: number;
    rotationRadians: number;
}

interface FoxholeConnectorDebugOverlaySettings {
    showAllSockets: boolean;
    showPowerSockets: boolean;
    showPipeSockets: boolean;
    showSocketLabels: boolean;
}

interface FoxholeConnectorSocketMoveSnapData {
    kind: 'foxhole:connector-socket-snap';
    match: ReturnType<typeof findBestFoxholeSocketSnap>;
}

interface FoxholeConnectorTargetStructureSnapshot {
    nodeId: string;
    node: FoxholeStructureNode;
    sockets: FoxholeSocketSnapPoint[];
    attachments: FoxholeStructureSocketAttachmentMap;
}

interface FoxholeConnectorTransientPreviewGeometry {
    x: number;
    y: number;
    points: number[];
    key: string;
}

const DEFAULT_CONNECTOR_STROKE_COLOR = 0xD9F6FF;
const DEFAULT_CONNECTOR_HANDLE_COLOR = 0x5BC0FF;

function toLocalPoints(points: readonly number[]): PIXI.Point[] {
    const result: PIXI.Point[] = [];
    for (let index = 0; index < points.length; index += 2) {
        result.push(new PIXI.Point(points[index]!, points[index + 1]!));
    }
    return result;
}

function clonePoints(points: readonly number[]): number[] {
    return points.slice();
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

export class FoxholeConnectorNode extends BoardNodeBase<FoxholeConnectorState, FoxholeConnectorDefinition> implements BoardNodeEditableHandleProvider, BoardNodeSelectionBoxReshapeProvider, BoardNodePlacementProvider, BoardNodeWorldHitTester, BoardNodeMoveSnapProvider, BoardNodeSelectionBoundsProvider {
    declare readonly boardDefinition: Readonly<FoxholeConnectorDefinition>;
    readonly graphicsObject: PIXI.Graphics;
    private readonly socketOverlay: PIXI.Container;
    private readonly settingsStore = useNixieSettingsStore();
    private settingsWatcher: WatchStopHandle | null = null;
    private selectionStateWatcher: (() => void) | null = null;
    private recoveringStructureAttachments = false;
    private transientPreviewKey = '';
    private transientPreviewDisposed = false;
    private readonly transientPreviewTicker = () => {
        if (this.transientPreviewDisposed) {
            return;
        }

        const nextKey = this.resolveTransientPreviewGeometry()?.key ?? '';
        if (nextKey === this.transientPreviewKey) {
            return;
        }

        this.transientPreviewKey = nextKey;
        this.syncFromState();
    };

    constructor(options: BoardNodeOptions<FoxholeConnectorState, FoxholeConnectorDefinition>) {
        super({
            ...options,
            state: normalizeFoxholeConnectorState({
                ...DEFAULT_FOXHOLE_CONNECTOR_STATE,
                ...(options.state ?? {}),
            }),
        });

        this.graphicsObject = new PIXI.Graphics();
        this.addBoardVisualChild(this.graphicsObject);
        this.socketOverlay = new PIXI.Container();
        this.socketOverlay.eventMode = 'none';
        this.addBoardVisualChild(this.socketOverlay);
        this.bindDebugOverlaySettings();
        this.syncFromState();
    }

    protected override onBoardMounted(): void {
        PIXI.Ticker.shared.add(this.transientPreviewTicker);
    }

    protected override onBoardUnmounted(): void {
        PIXI.Ticker.shared.remove(this.transientPreviewTicker);
    }

    override patchBoardState(patch: Parameters<BoardNodeBase<FoxholeConnectorState>['patchBoardState']>[0], options = {}): void {
        super.patchBoardState(patch, options);
        this.syncFromState();
    }

    override replaceBoardState(nextState: FoxholeConnectorState, options = {}): void {
        super.replaceBoardState(normalizeFoxholeConnectorState(nextState), options);
        this.syncFromState();
    }

    override getBoardRenderParticipants(): BoardRenderParticipant[] {
        const lane = resolveFoxholeConnectorRenderLane(this.boardState.foxholeKey, FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE);
        return [{
            id: 'default',
            displayObject: this.boardVisual,
            scope: 'shared-lane',
            laneId: lane.laneId,
            laneOrder: lane.laneOrder,
            localOrder: this.getBoardRenderLocalOrder(),
            tieBreakOrder: 0,
        }];
    }

    containsWorldPoint(world: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const localPoints = toLocalPoints(this.boardState.points);
        if (localPoints.length < 2) {
            return false;
        }

        const hitRadius = Math.max(8, context.worldPerPx * 10);
        for (let index = 1; index < localPoints.length; index += 1) {
            const start = context.viewport.toWorld(this.toGlobal(localPoints[index - 1]!));
            const end = context.viewport.toWorld(this.toGlobal(localPoints[index]!));
            if (distanceToSegment(world, start, end) <= hitRadius) {
                return true;
            }
        }
        return false;
    }

    getSelectionLocalBounds(): BoardNodeSelectionBounds | null {
        const points = toLocalPoints(this.boardState.points);
        if (!points.length) {
            return null;
        }

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const point of points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
            ? { minX, minY, maxX, maxY }
            : null;
    }

    startPlacementSession(_context: BoardNodePlacementSessionContext): FoxholeConnectorPlacementSession | null {
        if (String(this.boardState.foxholeKey ?? '').trim() !== 'powerline') {
            return null;
        }

        return {
            phase: 'pick-start',
            initialX: Number(this.boardState.x ?? this.x ?? 0),
            initialY: Number(this.boardState.y ?? this.y ?? 0),
            initialPoints: clonePoints(this.boardState.points),
            initialStartAttachment: this.getNormalizedAttachment(this.boardState.startAttachment),
            initialEndAttachment: this.getNormalizedAttachment(this.boardState.endAttachment),
        };
    }

    updatePlacementSession(session: FoxholeConnectorPlacementSession, context: BoardNodePlacementSessionContext): void {
        if (session.phase === 'pick-start') {
            const target = this.resolveHoveredPowerSocketTarget(context);
            const anchorX = target?.x ?? context.world.x;
            const anchorY = target?.y ?? context.world.y;
            const nextStartAttachment = target
                ? { nodeId: target.nodeId, socketName: target.socketName }
                : undefined;

            this.patchBoardState(state => {
                state.x = anchorX;
                state.y = anchorY;
                state.points = clonePoints(session.initialPoints);
                state.startAttachment = nextStartAttachment;
                state.endAttachment = undefined;
            }, {
                reason: 'selection-place-foxhole-connector-preview-start',
                recordHistory: false,
            });
            return;
        }

        const startX = Number(this.boardState.x ?? this.x ?? 0);
        const startY = Number(this.boardState.y ?? this.y ?? 0);
        const startAttachment = this.getNormalizedAttachment(this.boardState.startAttachment);
        const target = this.resolveHoveredPowerSocketTarget(context, startAttachment);
        const endX = target?.x ?? context.world.x;
        const endY = target?.y ?? context.world.y;
        const nextEndAttachment = target
            ? { nodeId: target.nodeId, socketName: target.socketName }
            : undefined;

        this.patchBoardState(state => {
            state.points = [0, 0, endX - startX, endY - startY];
            state.endAttachment = nextEndAttachment;
        }, {
            reason: 'selection-place-foxhole-connector-preview-end',
            recordHistory: false,
        });
    }

    confirmPlacementSession(session: FoxholeConnectorPlacementSession, context: BoardNodePlacementSessionContext): 'continue' | 'complete' | 'cancel' {
        this.updatePlacementSession(session, context);

        if (session.phase === 'pick-start') {
            if (!this.getNormalizedAttachment(this.boardState.startAttachment)) {
                return 'continue';
            }

            session.phase = 'pick-end';
            this.patchBoardState(state => {
                state.points = [0, 0, 0, 0];
                state.endAttachment = undefined;
            }, {
                reason: 'selection-place-foxhole-connector-lock-start',
                recordHistory: false,
            });
            return 'continue';
        }

        return this.getNormalizedAttachment(this.boardState.endAttachment)
            ? 'complete'
            : 'continue';
    }

    buildPlacementCommit(session: FoxholeConnectorPlacementSession, context: BoardNodePlacementSessionContext): BoardNodeEditableMutation | null {
        const startAttachment = this.getNormalizedAttachment(this.boardState.startAttachment);
        const endAttachment = this.getNormalizedAttachment(this.boardState.endAttachment);
        if (!startAttachment || !endAttachment) {
            return null;
        }

        const currentX = Number(this.boardState.x ?? this.x ?? 0);
        const currentY = Number(this.boardState.y ?? this.y ?? 0);
        const currentPoints = clonePoints(this.boardState.points);
        const targets = this.getTargetStructureSnapshotsForViewport(context.viewport);
        const targetAttachmentsByNode = buildFoxholeConnectorTargetAttachmentsFromEndpoints({
            connectorNodeId: String(this.boardId),
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
            startAttachment,
            endAttachment,
            targets,
        });

        const extraPatches = targets.flatMap(target => {
            const nextAttachments = targetAttachmentsByNode.get(target.nodeId) ?? {};
            const patch = this.buildStructureAttachmentPatch(target, nextAttachments);
            return patch ? [patch] : [];
        });

        return {
            patch: {
                x: currentX,
                y: currentY,
                points: currentPoints,
                startAttachment,
                endAttachment,
            },
            inversePatch: {
                x: session.initialX,
                y: session.initialY,
                points: clonePoints(session.initialPoints),
                startAttachment: session.initialStartAttachment ?? null,
                endAttachment: session.initialEndAttachment ?? null,
            },
            reason: 'selection-place-foxhole-connector',
            label: 'Place Power Line',
            ...(extraPatches.length ? { extraPatches } : {}),
        };
    }

    cancelPlacementSession(session: FoxholeConnectorPlacementSession): void {
        this.patchBoardState(state => {
            state.x = session.initialX;
            state.y = session.initialY;
            state.points = clonePoints(session.initialPoints);
            state.startAttachment = session.initialStartAttachment;
            state.endAttachment = session.initialEndAttachment;
        }, {
            reason: 'selection-place-foxhole-connector-cancel',
            recordHistory: false,
        });
    }

    getEditableHandles(context: BoardNodeEditableHandleContext): BoardNodeEditableHandle[] {
        return toLocalPoints(this.boardState.points).map((localPoint, index) => ({
            id: `point-${index}`,
            index,
            kind: 'vertex',
            world: context.viewport.toWorld(this.toGlobal(localPoint)),
            canDelete: false,
        }));
    }

    startEditableHandleDrag(handle: BoardNodeEditableHandle): FoxholeConnectorEditableSession | null {
        if (handle.kind !== 'vertex') {
            return null;
        }

        return {
            handleId: handle.id,
            handleIndex: handle.index,
            initialPoints: clonePoints(this.boardState.points),
            initialStartAttachment: this.getNormalizedAttachment(this.boardState.startAttachment),
            initialEndAttachment: this.getNormalizedAttachment(this.boardState.endAttachment),
        };
    }

    applyEditableHandleDrag(session: FoxholeConnectorEditableSession, pointerWorld: PIXI.Point, context: BoardNodeEditableHandleContext): boolean {
        const globalPoint = context.viewport.toGlobal(pointerWorld);
        const localPoint = this.toLocal(globalPoint);
        const nextPoints = clonePoints(this.boardState.points);
        const pointOffset = session.handleIndex * 2;
        if ((pointOffset + 1) >= nextPoints.length) {
            return false;
        }

        nextPoints[pointOffset] = localPoint.x;
        nextPoints[pointOffset + 1] = localPoint.y;

        const targets = this.getTargetStructureSnapshotsForViewport(context.viewport);
        const movingSockets = this.getResolvedSocketsForPoints(nextPoints)
            .filter(socket => socket.name === this.getDraggedHandleSocketName(session.handleIndex))
            .flatMap(socket => {
                if (!hasFoxholeSnapSocketTags(socket.socketTags)) {
                    return [];
                }

                const socketWorld = context.viewport.toWorld(this.toGlobal(new PIXI.Point(socket.localX, socket.localY)));
                return [{
                    nodeId: String(this.boardId),
                    socketName: socket.name,
                    x: socketWorld.x,
                    y: socketWorld.y,
                    rotation: socket.rotationRadians,
                    socketTags: socket.socketTags,
                } satisfies FoxholeSocketSnapPoint];
            });

        const match = this.settingsStore.getValueOr(FOXHOLE_SOCKET_SNAPPING_SETTING_ID, false) !== false && movingSockets.length
            ? findBestFoxholeSocketSnap({
                movingSockets,
                targetSockets: targets.flatMap(target => target.sockets),
                moveX: 0,
                moveY: 0,
                maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
            })
            : null;
        if (match) {
            const endpointGlobal = this.toGlobal(new PIXI.Point(nextPoints[pointOffset]!, nextPoints[pointOffset + 1]!));
            const snappedEndpointLocal = this.toLocal(new PIXI.Point(
                endpointGlobal.x + match.moveX,
                endpointGlobal.y + match.moveY,
            ));
            nextPoints[pointOffset] = snappedEndpointLocal.x;
            nextPoints[pointOffset + 1] = snappedEndpointLocal.y;
        }

        const reconciliation = reconcileFoxholeConnectorAttachments({
            connectorNodeId: String(this.boardId),
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
            movingSockets: this.collectSnapSocketPointsForPoints(context.viewport, nextPoints),
            targets,
        });
        session.previewStartAttachment = reconciliation.startAttachment;
        session.previewEndAttachment = reconciliation.endAttachment;
        session.previewTargetAttachmentsByNode = reconciliation.targetAttachmentsByNode;
        session.previewTargets = targets;

        this.patchBoardState({ points: nextPoints }, {
            reason: 'selection-reshape-foxhole-connector-preview',
            recordHistory: false,
        });
        return true;
    }

    buildEditableHandleCommit(session: FoxholeConnectorEditableSession): BoardNodeEditableMutation | null {
        const nextPoints = clonePoints(this.boardState.points);
        const nextStartAttachment = session.previewStartAttachment;
        const nextEndAttachment = session.previewEndAttachment;
        const pointsUnchanged = JSON.stringify(nextPoints) === JSON.stringify(session.initialPoints);
        const startUnchanged = JSON.stringify(nextStartAttachment ?? null) === JSON.stringify(session.initialStartAttachment ?? null);
        const endUnchanged = JSON.stringify(nextEndAttachment ?? null) === JSON.stringify(session.initialEndAttachment ?? null);
        if (pointsUnchanged && startUnchanged && endUnchanged) {
            return null;
        }

        const extraPatches = (session.previewTargets ?? []).flatMap(target => {
            const nextAttachments = session.previewTargetAttachmentsByNode?.get(target.nodeId) ?? target.attachments;
            const patch = this.buildStructureAttachmentPatch(target, nextAttachments);
            return patch ? [patch] : [];
        });

        return {
            patch: {
                points: nextPoints,
                startAttachment: nextStartAttachment ?? null,
                endAttachment: nextEndAttachment ?? null,
            },
            inversePatch: {
                points: session.initialPoints,
                startAttachment: session.initialStartAttachment ?? null,
                endAttachment: session.initialEndAttachment ?? null,
            },
            reason: 'selection-reshape-foxhole-connector',
            label: 'Reshape Connector',
            ...(extraPatches.length ? { extraPatches } : {}),
        };
    }

    cancelEditableHandleDrag(session: FoxholeConnectorEditableSession): void {
        this.patchBoardState({ points: session.initialPoints }, {
            reason: 'selection-reshape-foxhole-connector-revert',
            recordHistory: false,
        });
        session.previewStartAttachment = session.initialStartAttachment;
        session.previewEndAttachment = session.initialEndAttachment;
    }

    startSelectionBoxReshape(_context: BoardNodeEditableHandleContext): FoxholeConnectorSelectionBoxReshapeSession | null {
        const localBounds = this.getSelectionLocalBounds();
        if (!localBounds) {
            return null;
        }
        return {
            initialX: Number(this.boardState.x ?? this.x),
            initialY: Number(this.boardState.y ?? this.y),
            initialPoints: clonePoints(this.boardState.points),
            initialStartAttachment: this.getNormalizedAttachment(this.boardState.startAttachment),
            initialEndAttachment: this.getNormalizedAttachment(this.boardState.endAttachment),
            localBounds,
        };
    }

    applySelectionBoxReshape(
        session: FoxholeConnectorSelectionBoxReshapeSession,
        target: BoardNodeSelectionBoxReshapeTarget,
        context: BoardNodeEditableHandleContext,
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
        const nextX = targetMinWorld.x - rotatedMinX;
        const nextY = targetMinWorld.y - rotatedMinY;
        const targets = this.getTargetStructureSnapshotsForViewport(context.viewport);
        const reconciliation = reconcileFoxholeConnectorAttachments({
            connectorNodeId: String(this.boardId),
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
            movingSockets: this.collectSnapSocketPointsForPoints(context.viewport, nextPoints, { x: nextX, y: nextY }),
            targets,
        });

        session.previewStartAttachment = reconciliation.startAttachment;
        session.previewEndAttachment = reconciliation.endAttachment;
        session.previewTargetAttachmentsByNode = reconciliation.targetAttachmentsByNode;
        session.previewTargets = targets;

        this.patchBoardState({
            x: nextX,
            y: nextY,
            points: nextPoints,
        }, {
            reason: 'selection-reshape-selection-preview',
            recordHistory: false,
        });
        return true;
    }

    buildSelectionBoxReshapeCommit(session: FoxholeConnectorSelectionBoxReshapeSession): BoardNodeEditableMutation | null {
        const nextPatch = {
            x: this.x,
            y: this.y,
            points: clonePoints(this.boardState.points),
            startAttachment: session.previewStartAttachment ?? null,
            endAttachment: session.previewEndAttachment ?? null,
        };
        const inversePatch = {
            x: session.initialX,
            y: session.initialY,
            points: clonePoints(session.initialPoints),
            startAttachment: session.initialStartAttachment ?? null,
            endAttachment: session.initialEndAttachment ?? null,
        };
        const changed = nextPatch.x !== inversePatch.x
            || nextPatch.y !== inversePatch.y
            || JSON.stringify(nextPatch.points) !== JSON.stringify(inversePatch.points)
            || JSON.stringify(nextPatch.startAttachment) !== JSON.stringify(inversePatch.startAttachment)
            || JSON.stringify(nextPatch.endAttachment) !== JSON.stringify(inversePatch.endAttachment);
        if (!changed) {
            return null;
        }

        const extraPatches = (session.previewTargets ?? []).flatMap(target => {
            const nextAttachments = session.previewTargetAttachmentsByNode?.get(target.nodeId) ?? target.attachments;
            const patch = this.buildStructureAttachmentPatch(target, nextAttachments);
            return patch ? [patch] : [];
        });

        return {
            patch: nextPatch,
            inversePatch,
            reason: 'selection-reshape-selection',
            label: 'Reshape Connector',
            ...(extraPatches.length ? { extraPatches } : {}),
        };
    }

    cancelSelectionBoxReshape(session: FoxholeConnectorSelectionBoxReshapeSession): void {
        this.patchBoardState({
            x: session.initialX,
            y: session.initialY,
            points: clonePoints(session.initialPoints),
            startAttachment: session.initialStartAttachment ?? null,
            endAttachment: session.initialEndAttachment ?? null,
        }, {
            reason: 'selection-reshape-selection-revert',
            recordHistory: false,
        });
        session.previewStartAttachment = session.initialStartAttachment;
        session.previewEndAttachment = session.initialEndAttachment;
    }

    getEditableSegmentTarget(world: PIXI.Point, maxDistance: number, context: BoardNodeEditableHandleContext): BoardNodeEditableSegmentTarget | null {
        return null;
    }

    buildEditableSegmentInsertMutation(target: BoardNodeEditableSegmentTarget, context: BoardNodeEditableHandleContext): BoardNodeEditableMutation | null {
        return null;
    }

    buildEditableHandleDeleteMutation(handle: BoardNodeEditableHandle): BoardNodeEditableMutation | null {
        return null;
    }

    resolveMoveSnap(context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0]): BoardNodeMoveSnapResult | null {
        if (this.settingsStore.getValueOr(FOXHOLE_SOCKET_SNAPPING_SETTING_ID, false) === false) {
            return null;
        }

        const startOrigin = context.selectedWorldOrigins.get(String(this.boardId));
        if (!startOrigin) {
            return null;
        }

        const movingSockets = this.collectSnapSocketPoints(context.viewport, startOrigin);
        if (!movingSockets.length) {
            return null;
        }

        const targetSockets = context.stationaryNodes.flatMap(node => {
            if (node instanceof FoxholeStructureNode) {
                return (node as unknown as {
                    collectSnapSocketPoints?: (viewport: BoardNodeEditableHandleContext['viewport']) => FoxholeSocketSnapPoint[];
                }).collectSnapSocketPoints?.(context.viewport) ?? [];
            }

            if (node instanceof FoxholeConnectorNode) {
                return node.collectSnapSocketPoints(context.viewport);
            }

            return [];
        });
        if (!targetSockets.length) {
            return null;
        }

        const match = findBestFoxholeSocketSnap({
            movingSockets,
            targetSockets,
            moveX: context.moveX,
            moveY: context.moveY,
            maxDistance: DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE,
        });
        if (!match) {
            return null;
        }

        return {
            moveX: match.moveX,
            moveY: match.moveY,
            rotationDelta: match.rotationDelta,
            score: match.distance,
            data: {
                kind: 'foxhole:connector-socket-snap',
                match,
            } satisfies FoxholeConnectorSocketMoveSnapData,
        };
    }

    buildMoveCommitPatches(context: BoardNodeMoveCommitContext) {
        const movedOrigin = this.getMovedOrigin(context);
        if (!movedOrigin) {
            return [];
        }

        const movingSockets = this.collectSnapSocketPoints(context.viewport, movedOrigin);
        const targets = this.getTargetStructureSnapshots(context);
        const reconciliation = reconcileFoxholeConnectorAttachments({
            connectorNodeId: String(this.boardId),
            startSocketName: this.boardState.startSocketName,
            endSocketName: this.boardState.endSocketName,
            movingSockets,
            targets,
        });

        const patches: Array<{
            nodeId: string;
            patch: Record<string, unknown>;
            inversePatch: Record<string, unknown>;
        }> = [];

        for (const target of targets) {
            const nextAttachments = reconciliation.targetAttachmentsByNode.get(target.nodeId) ?? {};
            const patch = this.buildStructureAttachmentPatch(target, nextAttachments);
            if (patch) {
                patches.push(patch);
            }
        }

        const connectorPatch = this.buildConnectorAttachmentPatch(reconciliation.startAttachment, reconciliation.endAttachment);
        if (connectorPatch) {
            patches.push(connectorPatch);
        }

        return patches;
    }

    override destroy(options?: Parameters<BoardNodeBase<FoxholeConnectorState>['destroy']>[0]): void {
        this.transientPreviewDisposed = true;
        PIXI.Ticker.shared.remove(this.transientPreviewTicker);
        this.settingsWatcher?.();
        this.settingsWatcher = null;
        this.selectionStateWatcher?.();
        this.selectionStateWatcher = null;
        super.destroy(options);
    }

    protected override onBoardStateChanged(): void {
        this.syncFromState();
    }

    collectSnapSocketPoints(
        viewport: BoardNodeEditableHandleContext['viewport'],
        originOverride?: { x: number; y: number; } | null,
    ): FoxholeSocketSnapPoint[] {
        return this.collectSnapSocketPointsForPoints(viewport, this.boardState.points, originOverride);
    }

    private collectSnapSocketPointsForPoints(
        viewport: BoardNodeEditableHandleContext['viewport'],
        pointsSource: readonly number[],
        originOverride?: { x: number; y: number; } | null,
    ): FoxholeSocketSnapPoint[] {
        return this.getResolvedSocketsForPoints(pointsSource).flatMap(socket => {
            if (!hasFoxholeSnapSocketTags(socket.socketTags)) {
                return [];
            }

            const socketWorld = originOverride
                ? { x: originOverride.x + socket.localX, y: originOverride.y + socket.localY }
                : viewport.toWorld(this.toGlobal(new PIXI.Point(socket.localX, socket.localY)));
            const directionWorld = originOverride
                ? {
                    x: socketWorld.x + Math.cos(socket.rotationRadians) * 8,
                    y: socketWorld.y + Math.sin(socket.rotationRadians) * 8,
                }
                : viewport.toWorld(this.toGlobal(new PIXI.Point(
                    socket.localX + (Math.cos(socket.rotationRadians) * 8),
                    socket.localY + (Math.sin(socket.rotationRadians) * 8),
                )));

            return [{
                nodeId: String(this.boardId),
                socketName: socket.name,
                x: socketWorld.x,
                y: socketWorld.y,
                rotation: Math.atan2(directionWorld.y - socketWorld.y, directionWorld.x - socketWorld.x),
                socketTags: socket.socketTags,
            } satisfies FoxholeSocketSnapPoint];
        });
    }

    private syncFromState(): void {
        const graphicsObject = this.graphicsObject as PIXI.Graphics | null | undefined;
        const socketOverlay = this.socketOverlay as PIXI.Container | null | undefined;
        if (!graphicsObject || !socketOverlay) {
            return;
        }

        this.boardState.points = normalizeFoxholeConnectorPoints(this.boardState.points);
        this.syncMissingAttachmentsFromStructures();
        const previewGeometry = this.resolveTransientPreviewGeometry();
        const renderedX = previewGeometry?.x ?? Number(this.boardState.x ?? 0);
        const renderedY = previewGeometry?.y ?? Number(this.boardState.y ?? 0);
        const renderedPoints = previewGeometry?.points ?? this.boardState.points;
        graphicsObject.clear();

        const points = toLocalPoints(renderedPoints);
        if (points.length < 2) {
            applyTransform(this, {
                ...this.boardState,
                x: renderedX,
                y: renderedY,
            });
            return;
        }

        graphicsObject.moveTo(points[0]!.x, points[0]!.y);
        for (let index = 1; index < points.length; index += 1) {
            graphicsObject.lineTo(points[index]!.x, points[index]!.y);
        }

        const isPowerline = String(this.boardState.foxholeKey ?? '').trim() === 'powerline';
        const strokeAlpha = Math.max(0, Math.min(1, this.boardState.alpha ?? 1));

        if (isPowerline) {
            graphicsObject.stroke({
                ...resolveFoxholePowerlineStroke(strokeAlpha),
                pixelLine: false,
            });
        } else {
            graphicsObject.stroke({
                color: DEFAULT_CONNECTOR_STROKE_COLOR,
                width: 6,
                alpha: strokeAlpha,
                pixelLine: false,
                cap: 'round',
                join: 'round',
            });
        }

        if (!isPowerline) {
            for (const point of points) {
                graphicsObject.circle(point.x, point.y, 7);
                graphicsObject.fill({ color: DEFAULT_CONNECTOR_HANDLE_COLOR, alpha: 0.95 });
            }
        }

        this.syncSocketOverlay(renderedPoints);
        applyTransform(this, {
            ...this.boardState,
            x: renderedX,
            y: renderedY,
        });
    }

    private hasTransientTransformPreview(): boolean {
        const stateX = Number(this.boardState.x ?? 0);
        const stateY = Number(this.boardState.y ?? 0);
        const stateRotation = Number(this.boardState.rotation ?? 0);

        try {
            return Math.abs(this.x - stateX) > 0.0001
                || Math.abs(this.y - stateY) > 0.0001
                || Math.abs(this.rotation - stateRotation) > 0.0001;
        } catch {
            return true;
        }
    }

    private bindDebugOverlaySettings(): void {
        if (this.settingsWatcher) {
            return;
        }

        this.settingsWatcher = watch(() => {
            return FOXHOLE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS.map(settingId => this.settingsStore.getValueOr(settingId, undefined));
        }, values => {
            if (!this.destroyed && values.every(value => typeof value !== 'undefined')) {
                this.syncSocketOverlay();
            }
        });

        this.selectionStateWatcher = subscribeToNixieSelectionState(String(this.boardId), () => {
            if (!this.destroyed) {
                this.syncSocketOverlay();
            }
        });
    }

    private getDebugOverlaySettings(): FoxholeConnectorDebugOverlaySettings {
        return {
            showAllSockets: this.settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets, undefined) === true,
            showPowerSockets: this.settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets, undefined) === true,
            showPipeSockets: this.settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets, undefined) === true,
            showSocketLabels: this.settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels, undefined) === true,
        };
    }

    private getResolvedAsset(): FoxholeStructureAsset | undefined {
        return this.boardDefinition.assetResolver?.(this.boardState.foxholeKey);
    }

    private getResolvedStructure(): FoxholeManifestStructure | undefined {
        return this.boardDefinition.structureResolver?.(this.boardState.foxholeKey);
    }

    private getResolvedSockets(pointsSource: readonly number[] = this.boardState.points): FoxholeConnectorResolvedSocket[] {
        return this.getResolvedSocketsForPoints(pointsSource);
    }

    private getResolvedSocketsForPoints(pointsSource: readonly number[]): FoxholeConnectorResolvedSocket[] {
        const structure = this.getResolvedStructure();
        if (!structure) {
            return [];
        }

        return resolveFoxholePointConnectorSockets(structure, { points: pointsSource,
            startSocketName: this.boardState.startSocketName, endSocketName: this.boardState.endSocketName });
    }

    private isConnectorEndpointOccupied(endpoint: 'start' | 'end'): boolean {
        const endpointAttachment = this.getNormalizedAttachment(
            endpoint === 'start' ? this.boardState.startAttachment : this.boardState.endAttachment,
        );
        if (endpointAttachment) {
            return true;
        }

        const socketName = String(
            endpoint === 'start' ? this.boardState.startSocketName : this.boardState.endSocketName,
        ).trim();
        const attachments = normalizeFoxholeStructureSocketAttachmentMap(this.boardState.socketAttachments);
        return Boolean(socketName && attachments[socketName]);
    }

    private createSocketVisual(socket: FoxholeConnectorResolvedSocket, showLabel: boolean): PIXI.Container {
        const placement = {
            localX: socket.localX,
            localY: socket.localY,
            rotationRadians: socket.rotationRadians,
            ancestorRotationRadians: this.rotation,
            label: showLabel ? socket.name : undefined,
        };
        const kind = resolveFoxholeSocketKind(socket);

        if (kind === 'pipe') {
            return createFoxholePipeSocketVisual(placement, socket.pipeType);
        }

        return createFoxholePowerSocketVisual(placement);
    }

    private syncSocketOverlay(pointsSource: readonly number[] = this.boardState.points): void {
        const socketOverlay = this.socketOverlay as PIXI.Container | null | undefined;
        if (!socketOverlay) {
            return;
        }

        socketOverlay.removeChildren().forEach(child => child.destroy());
        const overlaySettings = this.getDebugOverlaySettings();
        if (!overlaySettings.showAllSockets && !overlaySettings.showPowerSockets && !overlaySettings.showPipeSockets) {
            socketOverlay.visible = false;
            return;
        }

        for (const socket of this.getResolvedSockets(pointsSource)) {
            if (this.isConnectorEndpointOccupied(socket.endpoint)) {
                continue;
            }

            const kind = resolveFoxholeSocketKind(socket);
            if (overlaySettings.showAllSockets) {
                socketOverlay.addChild(this.createSocketVisual(socket, overlaySettings.showSocketLabels));
                continue;
            }

            if (kind === 'power' && overlaySettings.showPowerSockets) {
                socketOverlay.addChild(this.createSocketVisual(socket, overlaySettings.showSocketLabels));
                continue;
            }

            if (kind === 'pipe' && overlaySettings.showPipeSockets) {
                socketOverlay.addChild(this.createSocketVisual(socket, overlaySettings.showSocketLabels));
            }
        }

        socketOverlay.visible = socketOverlay.children.length > 0;
    }

    private getMovedOrigin(context: Parameters<BoardNodeMoveSnapProvider['resolveMoveSnap']>[0]) {
        const origin = context.selectedWorldOrigins.get(String(this.boardId));
        if (!origin) {
            return null;
        }

        return {
            x: origin.x + context.moveX,
            y: origin.y + context.moveY,
        };
    }

    private getActiveSocketSnapMatch(activeSnap: BoardNodeMoveSnapResult | null) {
        if (!activeSnap?.data || typeof activeSnap.data !== 'object') {
            return null;
        }

        const data = activeSnap.data as Partial<FoxholeConnectorSocketMoveSnapData>;
        return data.kind === 'foxhole:connector-socket-snap' && data.match ? data.match : null;
    }

    private getNormalizedAttachment(value: FoxholeConnectorEndpointAttachment | null | undefined): FoxholeConnectorEndpointAttachment | undefined {
        const nodeId = String(value?.nodeId ?? '').trim();
        const socketName = String(value?.socketName ?? '').trim();
        return nodeId && socketName
            ? { nodeId, socketName }
            : undefined;
    }

    private buildConnectorAttachmentPatch(
        nextStartAttachment: FoxholeConnectorEndpointAttachment | undefined,
        nextEndAttachment: FoxholeConnectorEndpointAttachment | undefined,
    ) {
        const previousStartAttachment = this.getNormalizedAttachment(this.boardState.startAttachment);
        const previousEndAttachment = this.getNormalizedAttachment(this.boardState.endAttachment);
        const sameStart = JSON.stringify(previousStartAttachment ?? null) === JSON.stringify(nextStartAttachment ?? null);
        const sameEnd = JSON.stringify(previousEndAttachment ?? null) === JSON.stringify(nextEndAttachment ?? null);
        if (sameStart && sameEnd) {
            return null;
        }

        return {
            nodeId: String(this.boardId),
            patch: {
                startAttachment: nextStartAttachment ?? null,
                endAttachment: nextEndAttachment ?? null,
            },
            inversePatch: {
                startAttachment: previousStartAttachment ?? null,
                endAttachment: previousEndAttachment ?? null,
            },
        };
    }

    private getTargetStructureSnapshots(context: BoardNodeMoveCommitContext): FoxholeConnectorTargetStructureSnapshot[] {
        return context.stationaryNodes.flatMap(node => {
            if (!(node instanceof FoxholeStructureNode)) {
                return [];
            }

            return [{
                nodeId: String(node.boardId),
                node,
                sockets: node.collectSnapSocketPoints(context.viewport),
                attachments: normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments),
            } satisfies FoxholeConnectorTargetStructureSnapshot];
        });
    }

    private buildStructureAttachmentPatch(
        target: FoxholeConnectorTargetStructureSnapshot,
        nextAttachments: FoxholeStructureSocketAttachmentMap,
    ) {
        const previousAttachments = normalizeFoxholeStructureSocketAttachmentMap(target.node.boardState.socketAttachments);
        if (JSON.stringify(previousAttachments) === JSON.stringify(nextAttachments)) {
            return null;
        }

        return {
            nodeId: target.nodeId,
            patch: { socketAttachments: nextAttachments },
            inversePatch: { socketAttachments: previousAttachments },
        };
    }

    private getDraggedHandleSocketName(handleIndex: number): string | undefined {
        if (handleIndex === 0) {
            return String(this.boardState.startSocketName ?? '').trim() || undefined;
        }

        const pointCount = Math.floor(this.boardState.points.length / 2);
        if (handleIndex === (pointCount - 1)) {
            return String(this.boardState.endSocketName ?? '').trim() || undefined;
        }

        return undefined;
    }

    private resolveHoveredPowerSocketTarget(
        context: BoardNodePlacementSessionContext,
        excludedAttachment?: FoxholeConnectorEndpointAttachment,
    ): FoxholeSocketSnapPoint | null {
        let bestTarget: FoxholeSocketSnapPoint | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const hoveredNode of context.hoveredNodes) {
            if (!(hoveredNode instanceof FoxholeStructureNode)) {
                continue;
            }

            const sockets = (hoveredNode as unknown as {
                collectSnapSocketPoints?: (viewport: BoardNodePlacementSessionContext['viewport']) => FoxholeSocketSnapPoint[];
            }).collectSnapSocketPoints?.(context.viewport) ?? [];

            for (const socket of sockets) {
                if (!hasFoxholePowerSocketTag(socket.socketTags)) {
                    continue;
                }
                if (
                    excludedAttachment
                    && String(socket.nodeId) === String(excludedAttachment.nodeId)
                    && String(socket.socketName) === String(excludedAttachment.socketName)
                ) {
                    continue;
                }

                const distance = Math.hypot(context.world.x - socket.x, context.world.y - socket.y);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestTarget = socket;
                }
            }
        }

        return bestTarget;
    }

    private syncMissingAttachmentsFromStructures(): void {
        if (this.recoveringStructureAttachments) {
            return;
        }
        if (this.hasTransientTransformPreview()) {
            return;
        }

        const currentStart = this.getNormalizedAttachment(this.boardState.startAttachment);
        const currentEnd = this.getNormalizedAttachment(this.boardState.endAttachment);
        if (currentStart && currentEnd) {
            return;
        }

        const targets = this.getSiblingStructurePreviewTargets();
        if (!targets.length) {
            return;
        }

        const recovered = resolveFoxholeConnectorEndpointAttachmentsFromTargets({
            connectorNodeId: String(this.boardId),
            startSocketName: String(this.boardState.startSocketName ?? '').trim() || undefined,
            endSocketName: String(this.boardState.endSocketName ?? '').trim() || undefined,
            targets,
        });
        const nextStart = currentStart ?? recovered.startAttachment;
        const nextEnd = currentEnd ?? recovered.endAttachment;
        if (
            JSON.stringify(currentStart ?? null) === JSON.stringify(nextStart ?? null)
            && JSON.stringify(currentEnd ?? null) === JSON.stringify(nextEnd ?? null)
        ) {
            return;
        }

        this.recoveringStructureAttachments = true;
        try {
            this.patchBoardState({
                startAttachment: nextStart ?? null,
                endAttachment: nextEnd ?? null,
            }, {
                reason: 'foxhole-connector-recover-attachments',
                recordHistory: false,
            });
        } finally {
            this.recoveringStructureAttachments = false;
        }
    }

    private resolveCurrentStraightConnectorEndpoints(): {
        currentStart?: { x: number; y: number; };
        currentEnd?: { x: number; y: number; };
    } {
        const points = toLocalPoints(this.boardState.points);
        const originX = Number(this.boardState.x ?? 0);
        const originY = Number(this.boardState.y ?? 0);
        return {
            currentStart: points[0]
                ? {
                    x: originX + points[0].x,
                    y: originY + points[0].y,
                }
                : undefined,
            currentEnd: points.length
                ? {
                    x: originX + points[points.length - 1]!.x,
                    y: originY + points[points.length - 1]!.y,
                }
                : undefined,
        };
    }

    private getSiblingStructurePreviewTargets(): Array<FoxholeConnectorTargetStructureSnapshot & { transient: boolean; }> {
        const container = this.getTopBoardContainer();
        if (!container) {
            return [];
        }

        const targets: Array<FoxholeConnectorTargetStructureSnapshot & { transient: boolean; }> = [];
        const visit = (node: PIXI.Container) => {
            if (node instanceof FoxholeStructureNode) {
                const attachments = normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments);
                const sockets = (node as unknown as {
                    collectSnapSocketGlobalPoints?: () => FoxholeSocketSnapPoint[];
                }).collectSnapSocketGlobalPoints?.() ?? [];
                const transient = (node as unknown as {
                    hasTransientTransformPreview?: () => boolean;
                }).hasTransientTransformPreview?.() === true;
                targets.push({
                    nodeId: String(node.boardId),
                    node,
                    sockets,
                    attachments,
                    transient,
                });
            }

            if (node instanceof PIXI.Container) {
                for (const child of node.children) {
                    if (child instanceof PIXI.Container) {
                        visit(child);
                    }
                }
            }
        };

        for (const child of container.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }

        return targets.filter(target => target.nodeId !== String(this.boardId));
    }

    private resolveTransientPreviewGeometry(): FoxholeConnectorTransientPreviewGeometry | null {
        if (String(this.boardState.foxholeKey ?? '').trim() !== 'powerline') {
            return null;
        }
        if (this.hasTransientTransformPreview()) {
            return null;
        }

        const targets = this.getSiblingStructurePreviewTargets();
        if (!targets.length) {
            return null;
        }

        const recoveredAttachments = resolveFoxholeConnectorEndpointAttachmentsFromTargets({
            connectorNodeId: String(this.boardId),
            startSocketName: String(this.boardState.startSocketName ?? '').trim() || undefined,
            endSocketName: String(this.boardState.endSocketName ?? '').trim() || undefined,
            targets,
        });
        const startAttachment = this.getNormalizedAttachment(this.boardState.startAttachment) ?? recoveredAttachments.startAttachment;
        const endAttachment = this.getNormalizedAttachment(this.boardState.endAttachment) ?? recoveredAttachments.endAttachment;
        const touchedTransient = [startAttachment, endAttachment].some(attachment => {
            if (!attachment) {
                return false;
            }
            return targets.some(target => target.transient && target.nodeId === attachment.nodeId);
        });
        if (!touchedTransient) {
            return null;
        }

        const socketPointsByKey = new Map<string, FoxholeSocketSnapPoint>();
        for (const target of targets) {
            for (const socket of target.sockets) {
                socketPointsByKey.set(`${socket.nodeId}:${socket.socketName}`, socket);
            }
        }

        const currentEndpoints = this.resolveCurrentStraightConnectorEndpoints();
        const geometry = resolveFoxholeStraightConnectorGeometry({
            currentStart: currentEndpoints.currentStart,
            currentEnd: currentEndpoints.currentEnd,
            attachedStart: startAttachment
                ? socketPointsByKey.get(`${startAttachment.nodeId}:${startAttachment.socketName}`)
                : undefined,
            attachedEnd: endAttachment
                ? socketPointsByKey.get(`${endAttachment.nodeId}:${endAttachment.socketName}`)
                : undefined,
        });
        if (!geometry) {
            return null;
        }

        return {
            ...geometry,
            key: JSON.stringify({
                x: geometry.x,
                y: geometry.y,
                points: geometry.points,
                startAttachment: startAttachment ?? null,
                endAttachment: endAttachment ?? null,
            }),
        };
    }

    private getTopBoardContainer(): PIXI.Container | null {
        let current = this as unknown as PIXI.Container;
        while (current.parent instanceof BoardSpriteNode) {
            current = current.parent;
        }

        return current.parent as PIXI.Container | null;
    }

    private getTargetStructureSnapshotsForViewport(viewport: BoardNodeEditableHandleContext['viewport']): FoxholeConnectorTargetStructureSnapshot[] {
        const container = this.getTopBoardContainer();
        if (!container) {
            return [];
        }

        const targets: FoxholeConnectorTargetStructureSnapshot[] = [];
        const visit = (node: PIXI.Container) => {
            if (node instanceof FoxholeStructureNode) {
                targets.push({
                    nodeId: String(node.boardId),
                    node,
                    sockets: node.collectSnapSocketPoints(viewport),
                    attachments: normalizeFoxholeStructureSocketAttachmentMap(node.boardState.socketAttachments),
                });
            }

            if (node instanceof PIXI.Container) {
                for (const child of node.children) {
                    if (child instanceof PIXI.Container) {
                        visit(child);
                    }
                }
            }
        };

        for (const child of container.children) {
            if (child instanceof PIXI.Container) {
                visit(child);
            }
        }

        return targets.filter(target => target.nodeId !== String(this.boardId));
    }
}
