import * as PIXI from 'pixi.js';
import FoxholeBinocularLineToolbarContribution from '#foxhole/components/nixie/foxhole/FoxholeBinocularLineToolbarContribution.vue';
import { foxholeBinocularLineStateSchema } from '#foxhole/plugins/foxhole/nixie/binocular-line-schema.ts';
import { createFoxholeBinocularLineSnapshot } from '#foxhole/plugins/foxhole/nixie/binocular-line-snapshot.ts';
import {
    createBinocularLineStatePatchFromOptions,
    createBinocularLineToolOptionsFromDefaults,

} from '#foxhole/plugins/foxhole/nixie/binocular-line-tool-options.ts';
import type { BinocularLineToolOptions } from '#foxhole/plugins/foxhole/nixie/binocular-line-tool-options.ts';
import {
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
    normalizeFoxholeBinocularLineState,

} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import {
    FoxholeBinocularLineNode,
    renderFoxholeBinocularLineVisuals,
} from '#foxhole/plugins/nixie/board/types/foxhole-binocular-line.ts';
import { NixieToolBase } from '#nixie/plugins/nixie/contributions/tools/base.ts';
import {
    commitGraphicsShapeCreation,
    drawGraphicsPolyline,
    getToolViewportCameraSignature,
    maybeSnapToolPointerWorldPoint,
    resolveCurrentToolPointerWorld,
    softenPresenceColor,
    toRealtimePointer,
} from '#nixie/plugins/nixie/contributions/tools/shared/graphics-shape.ts';
import type { ToolDraftPointerModifiers } from '#nixie/plugins/nixie/contributions/tools/shared/graphics-shape.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import type {
    NixieToolContext,
    NixieToolKeyboardContext,
    NixieToolMetadata,
    NixieToolPointerContext,
    NixieRemotePresenceSession,
    NixieToolRemotePresenceRenderHelpers,
} from '#nixie/plugins/nixie/contributions/tools/types.ts';

const BINOCULAR_LINE_TOOL_METADATA = {
    id: 'foxhole-binoculars',
    name: 'Binoculars',
    icon: 'ph:binoculars',
    description: 'Measure Foxhole distances and azimuths with the legacy binoculars line style.',
    order: 66,
    requiresEdit: true,
    inputSupport: {
        pointerTypes: ['mouse', 'pen'],
        requiresFinePointer: true,
        requiresKeyboard: true,
    },
} satisfies NixieToolMetadata;

class FoxholeBinocularLineTool extends NixieToolBase<BinocularLineToolOptions> {
    private draftPoints: number[] = [];
    private hoverPoint: PIXI.Point | null = null;
    private draftModifiers: ToolDraftPointerModifiers | null = null;
    private previewOverlay: PIXI.Container | null = null;
    private previewGraphics: PIXI.Graphics | null = null;
    private previewLabelLayer: PIXI.Container | null = null;
    private previewTickHandler: ((ticker: PIXI.Ticker) => void) | null = null;
    private previewRenderSignature = '';
    private lastPreviewCameraSignature = '';

    constructor(context: ConstructorParameters<typeof NixieToolBase<BinocularLineToolOptions>>[1]) {
        super(BINOCULAR_LINE_TOOL_METADATA, context);
        this.registerDefaults(this.getOptionsDefaults());
    }

    override getOptionsDefaults(): BinocularLineToolOptions {
        return createBinocularLineToolOptionsFromDefaults();
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
            await this.finishDraft('foxhole-binoculars-create-tool-switch');
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
            await this.finishDraft('foxhole-binoculars-create-enter');
        }
    }

    override async onPointerDown(context: NixieToolPointerContext): Promise<void> {
        if (context.event.button === 2) {
            if (!this.draftPoints.length) {
                return;
            }
            context.event.preventDefault();
            if (this.hasEnoughPointsToCommit()) {
                await this.finishDraft('foxhole-binoculars-create-right-click', context);
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
            await this.finishDraft('foxhole-binoculars-create-double-click', context);
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
        if (remoteSession.phase !== 'dragging' && remoteSession.phase !== 'preview') {
            return;
        }

        const points = this.getRemotePreviewPoints(remoteSession);
        if (!points?.length) {
            return;
        }

        drawGraphicsPolyline(graphics, points, {
            stroke: {
                color: softenPresenceColor(remoteSession.color),
                width: Math.max(1.2 * helpers.worldPerPx, 0.8),
                alpha: 0.72,
            },
        }, false);
    }

    private hasEnoughPointsToCommit(): boolean {
        return (this.draftPoints.length / 2) >= 2;
    }

    private getPreviewPoints(): number[] | null {
        if (!this.draftPoints.length) {
            return null;
        }

        const points = this.draftPoints.slice();
        if (this.hoverPoint) {
            points.push(this.hoverPoint.x, this.hoverPoint.y);
        }
        return points;
    }

    private ensurePreviewOverlay(): { graphics: PIXI.Graphics; labelLayer: PIXI.Container; } {
        if (!this.previewOverlay) {
            this.previewOverlay = new PIXI.Container();
            this.previewOverlay.label = 'foxhole-binocular-line-tool-preview';
            this.previewOverlay.zIndex = 951;
            this.previewGraphics = new PIXI.Graphics();
            this.previewLabelLayer = new PIXI.Container();
            this.previewLabelLayer.eventMode = 'none';
            this.previewOverlay.addChild(this.previewGraphics);
            this.previewOverlay.addChild(this.previewLabelLayer);
        }

        const layer = this.context.session.sceneLayerRef.value;
        if (layer && this.previewOverlay.parent !== layer) {
            layer.addChild(this.previewOverlay);
        }

        return {
            graphics: this.previewGraphics!,
            labelLayer: this.previewLabelLayer!,
        };
    }

    private clearPreviewOverlay(): void {
        this.previewGraphics?.clear();
        if (this.previewLabelLayer) {
            for (const child of this.previewLabelLayer.removeChildren()) {
                child.destroy({ children: true });
            }
        }
        this.previewOverlay?.position.set(0, 0);
    }

    private destroyPreviewOverlay(): void {
        this.clearPreviewOverlay();
        this.previewOverlay?.destroy({ children: true });
        this.previewOverlay = null;
        this.previewGraphics = null;
        this.previewLabelLayer = null;
    }

    private redrawPreview(): void {
        const { graphics, labelLayer } = this.ensurePreviewOverlay();
        this.clearPreviewOverlay();
        this.previewRenderSignature = this.getPreviewRenderSignature();

        const points = this.getPreviewPoints();
        if (!points || points.length < 4) {
            return;
        }

        const previewState = normalizeFoxholeBinocularLineState({
            ...createBinocularLineStatePatchFromOptions(this.getOptions()),
            x: 0,
            y: 0,
            rotation: 0,
            points,
            visible: true,
            alpha: 1,
            scaleX: 1,
            scaleY: 1,
        });
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        renderFoxholeBinocularLineVisuals(graphics, labelLayer, previewState, 1 / viewportScale);
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

        const snapshot = createFoxholeBinocularLineSnapshot({
            points: this.draftPoints.slice(),
            state: createBinocularLineStatePatchFromOptions(this.getOptions()),
            key: 'Binoculars Tool',
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
            type: FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
            name: 'Foxhole Binoline',
            description: 'Legacy Foxhole binoculars planning line with distance and azimuth labels.',
            icon: 'ph:binoculars',
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
            type: FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
            stateSchema: foxholeBinocularLineStateSchema,
            // Geometry, styling and measurements are embedded in the snapshot.
            getSnapshotDependencies: () => [],
            create: (snapshot, context) => new FoxholeBinocularLineNode({
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
            metadata: BINOCULAR_LINE_TOOL_METADATA,
            sceneV2Authoring: {
                kind: 'polyline', minimumPoints: 2,
                getDefaults: () => ({ ...createBinocularLineToolOptionsFromDefaults() }),
                createSnapshot: ({ id, points, options }) => createFoxholeBinocularLineSnapshot({ id, points,
                    state: createBinocularLineStatePatchFromOptions(options) }),
                renderPreview: (snapshot, graphics, labels, scale) => renderFoxholeBinocularLineVisuals(graphics, labels,
                    normalizeFoxholeBinocularLineState(snapshot.state), scale),
            },
            create: context => new FoxholeBinocularLineTool(context),
        },
    ],
    toolbar: [
        {
            id: 'foxhole.toolbar.binocular-line.properties',
            tool: 'foxhole-binoculars',
            section: 'foxhole-binoculars',
            group: 'properties',
            order: 10,
            component: FoxholeBinocularLineToolbarContribution,
        },
    ],
});
