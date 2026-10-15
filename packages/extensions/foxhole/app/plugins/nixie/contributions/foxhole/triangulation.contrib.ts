import * as PIXI from 'pixi.js';
import FoxholeTriangulationToolbarContribution from '#foxhole/components/nixie/foxhole/FoxholeTriangulationToolbarContribution.vue';
import { foxholeTriangulationStateSchema } from '#foxhole/plugins/foxhole/nixie/triangulation-schema.ts';
import { createFoxholeTriangulationSnapshot } from '#foxhole/plugins/foxhole/nixie/triangulation-snapshot.ts';
import {
    createTriangulationStatePatchFromOptions,
    createTriangulationToolOptionsFromDefaults,

} from '#foxhole/plugins/foxhole/nixie/triangulation-tool-options.ts';
import type { TriangulationToolOptions } from '#foxhole/plugins/foxhole/nixie/triangulation-tool-options.ts';
import {
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,
    FOXHOLE_TRIANGULATION_NODE_TYPE,
    normalizeFoxholeTriangulationState,
    resolveFoxholeTriangulationFit,
} from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import type { FoxholeTriangulationState } from '#foxhole/plugins/foxhole/nixie/triangulation.ts';
import {
    FoxholeTriangulationNode,
    renderFoxholeTriangulationTrackingLines,
    renderFoxholeTriangulationVisuals,
} from '#foxhole/plugins/nixie/board/types/foxhole-triangulation.ts';
import { NixieToolBase } from '#nixie/plugins/nixie/contributions/tools/base.ts';
import {
    commitGraphicsShapeCreation,
    ensureRemoteToolPreviewGraphic,
    getToolViewportCameraSignature,
    maybeSnapToolPointerWorldPoint,
    resolveCurrentToolPointerWorld,
    softenPresenceColor,
    toRealtimePointer,
} from '#nixie/plugins/nixie/contributions/tools/shared/graphics-shape.ts';
import type { ToolDraftPointerModifiers } from '#nixie/plugins/nixie/contributions/tools/shared/graphics-shape.ts';
import { normalizeFlatPointsToLocalOrigin } from '#nixie/plugins/nixie/board/utils/polyline-points.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import type {
    NixieToolKeyboardContext,
    NixieToolMetadata,
    NixieToolPointerContext,
    NixieRemotePresenceSession,
    NixieToolRemotePresenceRenderHelpers,
} from '#nixie/plugins/nixie/contributions/tools/types.ts';

const TRIANGULATION_TOOL_METADATA = {
    id: 'foxhole-triangulation',
    name: 'Triangulation',
    icon: 'ph:compass',
    description: 'Plot edge points to fit a circle.',
    order: 68,
    requiresEdit: true,
    inputSupport: {
        pointerTypes: ['mouse', 'pen'],
        requiresFinePointer: true,
        requiresKeyboard: true,
    },
} satisfies NixieToolMetadata;

class FoxholeTriangulationTool extends NixieToolBase<TriangulationToolOptions> {
    private draftPoints: number[] = [];
    private hoverPoint: PIXI.Point | null = null;
    private draftModifiers: ToolDraftPointerModifiers | null = null;
    private previewOverlay: PIXI.Container | null = null;
    private previewWorldGraphics: PIXI.Graphics | null = null;
    private previewCircleLayer: PIXI.Container | null = null;
    private previewGraphics: PIXI.Graphics | null = null;
    private previewLabelLayer: PIXI.Container | null = null;
    private previewTickHandler: ((ticker: PIXI.Ticker) => void) | null = null;
    private previewRenderSignature = '';
    private lastPreviewCameraSignature = '';

    constructor(context: ConstructorParameters<typeof NixieToolBase<TriangulationToolOptions>>[1]) {
        super(TRIANGULATION_TOOL_METADATA, context);
        this.registerDefaults(this.getOptionsDefaults());
    }

    override getOptionsDefaults(): TriangulationToolOptions {
        return createTriangulationToolOptionsFromDefaults();
    }

    override async onActivate(): Promise<void> {
        this.context.presence.setCursor('crosshair');
        this.redrawPreview();
        this.startPreviewTicker();
    }

    override async onDeactivate(): Promise<void> {
        this.stopPreviewTicker();
        this.destroyPreviewOverlay();
        if (this.hasEnoughPointsToCommit()) {
            await this.finishDraft('foxhole-triangulation-create-tool-switch');
        } else {
            await this.clearDraft(true);
        }
    }

    override async onDestroy(): Promise<void> {
        this.stopPreviewTicker();
        this.destroyPreviewOverlay();
        await this.clearDraft(true);
    }

    override async onKeyDown(context: NixieToolKeyboardContext): Promise<void> {
        if (context.event.key === 'Escape') {
            context.event.preventDefault();
            await this.clearDraft(true);
            return;
        }

        if (context.event.key === 'Enter' && this.hasEnoughPointsToCommit()) {
            context.event.preventDefault();
            await this.finishDraft('foxhole-triangulation-create-enter');
        }
    }

    override async onPointerDown(context: NixieToolPointerContext): Promise<void> {
        if (context.event.button === 2) {
            if (!this.draftPoints.length) {
                return;
            }
            context.event.preventDefault();
            if (this.hasEnoughPointsToCommit()) {
                await this.finishDraft('foxhole-triangulation-create-right-click', context);
            } else {
                await this.clearDraft(true);
            }
            return;
        }

        if (!context.isPrimaryButton) {
            return;
        }

        const snapped = maybeSnapToolPointerWorldPoint(this.context, context);
        this.draftPoints.push(snapped.x, snapped.y);
        this.hoverPoint = snapped.clone();
        this.draftModifiers = {
            shift: context.shift,
            alt: context.alt,
            ctrlOrMeta: context.ctrlOrMeta,
        };
        this.redrawPreview();

        if (this.draftPoints.length === 2) {
            await this.context.presence.beginPreview({
                draftPoints: this.draftPoints.slice(),
                hoverPoint: { x: snapped.x, y: snapped.y },
            }, {
                phase: 'preview',
                pointer: toRealtimePointer(context),
            });
        } else {
            await this.context.presence.updatePreview({
                draftPoints: this.draftPoints.slice(),
                hoverPoint: { x: snapped.x, y: snapped.y },
            }, {
                phase: 'preview',
                pointer: toRealtimePointer(context),
            });
        }

        if (context.event.detail >= 2 && this.hasEnoughPointsToCommit()) {
            await this.finishDraft('foxhole-triangulation-create-double-click', context);
        }
    }

    override async onPointerMove(context: NixieToolPointerContext): Promise<void> {
        if (!this.draftPoints.length) {
            return;
        }

        this.draftModifiers = {
            shift: context.shift,
            alt: context.alt,
            ctrlOrMeta: context.ctrlOrMeta,
        };
        this.hoverPoint = maybeSnapToolPointerWorldPoint(this.context, context);
        this.redrawPreview();
        await this.context.presence.updatePreview({
            draftPoints: this.draftPoints.slice(),
            hoverPoint: this.hoverPoint ? { x: this.hoverPoint.x, y: this.hoverPoint.y } : null,
        }, {
            phase: 'preview',
            pointer: toRealtimePointer(context),
        });
    }

    override async onPointerCancel(): Promise<void> {
        await this.clearDraft(true);
    }

    override renderRemotePresence(
        graphics: PIXI.Graphics,
        remoteSession: NixieRemotePresenceSession,
        helpers: NixieToolRemotePresenceRenderHelpers,
    ): void {
        if (remoteSession.phase !== 'preview') {
            return;
        }

        const points = this.getRemotePreviewPoints(remoteSession);
        if (!points || points.length < 6) {
            return;
        }

        const anchored = normalizeFlatPointsToLocalOrigin(
            points,
            DEFAULT_FOXHOLE_TRIANGULATION_STATE.edgePoints,
            6,
        );
        const previewState = normalizeFoxholeTriangulationState({
            ...createTriangulationStatePatchFromOptions(this.getOptions()),
            x: anchored.x,
            y: anchored.y,
            edgePoints: anchored.points,
            strokeColor: softenPresenceColor(remoteSession.color),
            fillColor: softenPresenceColor(remoteSession.color),
            fillAlpha: 0.12,
        });
        if (!resolveFoxholeTriangulationFit(previewState)) {
            return;
        }

        const previewGraphic = ensureRemoteToolPreviewGraphic(
            graphics,
            TRIANGULATION_TOOL_METADATA.id,
            remoteSession.senderId,
        );
        previewGraphic.position.set(previewState.x, previewState.y);
        renderFoxholeTriangulationVisuals(previewGraphic, new PIXI.Container(), previewState, helpers.worldPerPx, undefined, {
            alwaysShowEdgeLines: true,
        });
    }

    private hasEnoughPointsToCommit(): boolean {
        return (this.draftPoints.length / 2) >= 3;
    }

    private getPreviewWorldPoints(): number[] | null {
        if (!this.draftPoints.length) {
            return null;
        }

        const points = this.draftPoints.slice();
        if (this.hoverPoint) {
            points.push(this.hoverPoint.x, this.hoverPoint.y);
        }
        return points;
    }

    private getPreviewState(): FoxholeTriangulationState | null {
        const worldPoints = this.getPreviewWorldPoints();
        if (!worldPoints || worldPoints.length < 6) {
            return null;
        }

        const anchored = normalizeFlatPointsToLocalOrigin(
            worldPoints,
            DEFAULT_FOXHOLE_TRIANGULATION_STATE.edgePoints,
            6,
        );
        const previewState = normalizeFoxholeTriangulationState({
            ...createTriangulationStatePatchFromOptions(this.getOptions()),
            x: anchored.x,
            y: anchored.y,
            edgePoints: anchored.points,
        });
        return resolveFoxholeTriangulationFit(previewState) ? previewState : null;
    }

    private ensurePreviewOverlay(): {
        worldGraphics: PIXI.Graphics;
        circleLayer: PIXI.Container;
        graphics: PIXI.Graphics;
        labelLayer: PIXI.Container;
    } {
        if (!this.previewOverlay) {
            this.previewOverlay = new PIXI.Container();
            this.previewOverlay.label = 'foxhole-triangulation-tool-preview';
            this.previewOverlay.zIndex = 951;
            this.previewWorldGraphics = new PIXI.Graphics();
            this.previewCircleLayer = new PIXI.Container();
            this.previewGraphics = new PIXI.Graphics();
            this.previewLabelLayer = new PIXI.Container();
            this.previewLabelLayer.eventMode = 'none';
            this.previewCircleLayer.addChild(this.previewGraphics);
            this.previewCircleLayer.addChild(this.previewLabelLayer);
            this.previewOverlay.addChild(this.previewWorldGraphics);
            this.previewOverlay.addChild(this.previewCircleLayer);
        }

        const layer = this.context.session.sceneLayerRef.value;
        if (layer && this.previewOverlay.parent !== layer) {
            layer.addChild(this.previewOverlay);
        }

        return {
            worldGraphics: this.previewWorldGraphics!,
            circleLayer: this.previewCircleLayer!,
            graphics: this.previewGraphics!,
            labelLayer: this.previewLabelLayer!,
        };
    }

    private clearPreviewOverlay(): void {
        this.previewWorldGraphics?.clear();
        this.previewGraphics?.clear();
        if (this.previewLabelLayer) {
            for (const child of this.previewLabelLayer.removeChildren()) {
                child.destroy({ children: true });
            }
        }
        this.previewOverlay?.position.set(0, 0);
        this.previewCircleLayer?.position.set(0, 0);
    }

    private destroyPreviewOverlay(): void {
        this.clearPreviewOverlay();
        this.previewOverlay?.destroy({ children: true });
        this.previewOverlay = null;
        this.previewWorldGraphics = null;
        this.previewCircleLayer = null;
        this.previewGraphics = null;
        this.previewLabelLayer = null;
    }

    private getPlotMarkerRadius(
        previewState: ReturnType<typeof normalizeFoxholeTriangulationState>,
        renderScale: number,
    ): number {
        return Math.max(previewState.strokeWidth * 1.125, previewState.edgeMarkerRadius) * renderScale;
    }

    private drawPlotMarker(
        graphics: PIXI.Graphics,
        x: number,
        y: number,
        previewState: ReturnType<typeof normalizeFoxholeTriangulationState>,
        renderScale: number,
        alpha = previewState.strokeAlpha,
    ): void {
        graphics.circle(x, y, this.getPlotMarkerRadius(previewState, renderScale));
        graphics.fill({ color: previewState.strokeColor, alpha });
    }

    private drawDraftPlotMarkersWorld(
        graphics: PIXI.Graphics,
        previewState: ReturnType<typeof normalizeFoxholeTriangulationState>,
        renderScale: number,
    ): void {
        for (let index = 0; index + 1 < this.draftPoints.length; index += 2) {
            this.drawPlotMarker(
                graphics,
                this.draftPoints[index]!,
                this.draftPoints[index + 1]!,
                previewState,
                renderScale,
            );
        }

        if (this.hoverPoint) {
            this.drawPlotMarker(
                graphics,
                this.hoverPoint.x,
                this.hoverPoint.y,
                previewState,
                renderScale,
                Math.min(1, previewState.strokeAlpha * 0.75),
            );
        }
    }

    private redrawPreview(): void {
        const { worldGraphics, circleLayer, graphics, labelLayer } = this.ensurePreviewOverlay();
        this.clearPreviewOverlay();
        this.previewRenderSignature = this.getPreviewRenderSignature();

        if (!this.draftPoints.length) {
            return;
        }

        const styleState = normalizeFoxholeTriangulationState(createTriangulationStatePatchFromOptions(this.getOptions()));
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        const renderScale = styleState.scaleWithZoom ? (1 / viewportScale) : 1;

        this.previewOverlay!.position.set(0, 0);

        const previewState = this.getPreviewState();
        if (!previewState) {
            renderFoxholeTriangulationTrackingLines(
                worldGraphics,
                this.draftPoints,
                this.hoverPoint,
                styleState,
                renderScale,
            );
            this.drawDraftPlotMarkersWorld(worldGraphics, styleState, renderScale);
            return;
        }

        circleLayer.position.set(previewState.x, previewState.y);
        renderFoxholeTriangulationVisuals(
            graphics,
            labelLayer,
            previewState,
            renderScale,
            undefined,
            { alwaysShowEdgeLines: true },
        );
    }

    private startPreviewTicker(): void {
        if (this.previewTickHandler) {
            return;
        }

        const app = this.context.session.appRef.value;
        if (!app) {
            return;
        }

        this.previewTickHandler = () => {
            if (!this.draftPoints.length) {
                this.lastPreviewCameraSignature = '';
                return;
            }

            const cameraSignature = getToolViewportCameraSignature(this.context.session);
            if (cameraSignature !== this.lastPreviewCameraSignature) {
                this.lastPreviewCameraSignature = cameraSignature;
                this.syncHoverPointForViewport();
                this.redrawPreview();
                return;
            }

            const signature = this.getPreviewRenderSignature();
            if (signature !== this.previewRenderSignature) {
                this.redrawPreview();
            }
        };
        app.ticker.add(this.previewTickHandler);
    }

    private stopPreviewTicker(): void {
        if (!this.previewTickHandler) {
            return;
        }

        const app = this.context.session.appRef.value;
        if (app) {
            app.ticker.remove(this.previewTickHandler);
        }
        this.previewTickHandler = null;
    }

    private syncHoverPointForViewport(): void {
        const modifiers = this.draftModifiers;
        if (!modifiers || !this.draftPoints.length) {
            return;
        }

        const active = resolveCurrentToolPointerWorld(this.context, modifiers);
        if (!active) {
            return;
        }

        this.hoverPoint = active.world.clone();
        this.context.presence.updatePreview({
            draftPoints: this.draftPoints.slice(),
            hoverPoint: { x: this.hoverPoint.x, y: this.hoverPoint.y },
        }, {
            phase: 'preview',
            pointer: active.pointer,
        });
    }

    private getPreviewRenderSignature(): string {
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        return `${viewportScale}:${this.draftPoints.join(',')}:${this.hoverPoint?.x ?? ''}:${this.hoverPoint?.y ?? ''}:${JSON.stringify(this.getOptions())}`;
    }

    private getRemotePreviewPoints(remoteSession: NixieRemotePresenceSession): number[] | undefined {
        const payload = remoteSession.preview?.payload;
        const draftPoints = payload?.draftPoints;
        if (!Array.isArray(draftPoints) || !draftPoints.every(entry => typeof entry === 'number' && Number.isFinite(entry))) {
            return undefined;
        }

        const points = draftPoints.slice();
        const hoverPoint = payload?.hoverPoint;
        if (
            hoverPoint
            && typeof hoverPoint === 'object'
            && typeof hoverPoint.x === 'number'
            && Number.isFinite(hoverPoint.x)
            && typeof hoverPoint.y === 'number'
            && Number.isFinite(hoverPoint.y)
        ) {
            points.push(hoverPoint.x, hoverPoint.y);
        }
        return points;
    }

    private async clearDraft(broadcastEnd: boolean): Promise<void> {
        const hadDraft = this.draftPoints.length > 0;
        this.draftPoints = [];
        this.hoverPoint = null;
        this.draftModifiers = null;
        this.lastPreviewCameraSignature = '';
        this.clearPreviewOverlay();
        if (broadcastEnd && hadDraft) {
            await this.context.presence.endPreview();
        }
    }

    private async finishDraft(reason: string, context?: NixieToolPointerContext): Promise<void> {
        if (!this.hasEnoughPointsToCommit()) {
            await this.clearDraft(true);
            return;
        }

        const snapshot = createFoxholeTriangulationSnapshot({
            points: this.draftPoints.slice(),
            state: createTriangulationStatePatchFromOptions(this.getOptions()),
            key: 'Triangulation',
        });
        const id = String(snapshot.id);

        await this.clearDraft(true);
        await commitGraphicsShapeCreation({
            context: this.context,
            id,
            snapshot,
            reason,
            ...(context ? { pointer: toRealtimePointer(context) } : {}),
        });
    }
}

export default defineContribution({
    nodes: [
        {
            type: FOXHOLE_TRIANGULATION_NODE_TYPE,
            name: 'Triangulation',
            description: 'Circle fit from plotted edge points with radial spokes.',
            icon: 'ph:compass',
            capabilities: {
                move: true,
                rotate: true,
                scale: false,
                tint: false,
            },
        },
    ],
    boardNodes: [
        {
            type: FOXHOLE_TRIANGULATION_NODE_TYPE,
            stateSchema: foxholeTriangulationStateSchema,
            // Geometry, styling and measurements are embedded in the snapshot.
            getSnapshotDependencies: () => [],
            create: (snapshot, context) => new FoxholeTriangulationNode({
                id: snapshot.id,
                type: snapshot.type,
                key: snapshot.key,
                version: snapshot.version,
                state: snapshot.state,
                historyRecorder: context.historyRecorder,
                syncAdapter: context.syncAdapter,
            }),
        },
    ],
    tools: [
        {
            metadata: TRIANGULATION_TOOL_METADATA,
            sceneV2Authoring: {
                kind: 'polyline', minimumPoints: 3,
                getDefaults: () => ({ ...createTriangulationToolOptionsFromDefaults() }),
                createSnapshot: ({ id, points, options }) => createFoxholeTriangulationSnapshot({ id, points,
                    state: createTriangulationStatePatchFromOptions(options) }),
                renderPreview: (snapshot, graphics, labels, scale) => renderFoxholeTriangulationVisuals(graphics, labels,
                    normalizeFoxholeTriangulationState(snapshot.state), scale, undefined, { alwaysShowEdgeLines: true }),
            },
            create: context => new FoxholeTriangulationTool(context),
        },
    ],
    toolbar: [
        {
            id: 'foxhole.toolbar.triangulation.properties',
            tool: 'foxhole-triangulation',
            section: 'foxhole-triangulation',
            group: 'properties',
            order: 10,
            component: FoxholeTriangulationToolbarContribution,
        },
    ],
});
