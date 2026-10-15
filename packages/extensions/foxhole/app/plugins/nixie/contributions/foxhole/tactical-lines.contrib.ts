import type * as PIXI from 'pixi.js';
import FoxholeTacticalLineToolbarContribution from '#foxhole/components/nixie/foxhole/FoxholeTacticalLineToolbarContribution.vue';
import {
    FoxholeTacticalLineNode,
    renderFoxholeTacticalLineGraphics,
} from '#foxhole/plugins/nixie/board/types/foxhole-tactical-line.ts';
import { foxholeTacticalLineStateSchema } from '#foxhole/plugins/foxhole/nixie/tactical-line-schema.ts';
import { createFoxholeTacticalLineSnapshot } from '#foxhole/plugins/foxhole/nixie/tactical-line-snapshot.ts';
import {
    createTacticalLineStatePatchFromOptions,
    createTacticalLineToolOptionsFromPreset,

} from '#foxhole/plugins/foxhole/nixie/tactical-line-tool-options.ts';
import type { TacticalLineToolOptions } from '#foxhole/plugins/foxhole/nixie/tactical-line-tool-options.ts';
import {
    applyFoxholeTacticalLinePreset,
    FOXHOLE_TACTICAL_LINE_NODE_TYPE,

} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import { NixieToolBase } from '#nixie/plugins/nixie/contributions/tools/base.ts';
import {
    clearGraphicsToolPreview,
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
    NixieToolKeyboardContext,
    NixieToolMetadata,
    NixieToolPointerContext,
    NixieRemotePresenceSession,
    NixieToolRemotePresenceRenderHelpers,
} from '#nixie/plugins/nixie/contributions/tools/types.ts';

const TACTICAL_LINE_TOOL_METADATA = {
    id: 'foxhole-tactical-line',
    name: 'Tactical Line',
    icon: 'ph:strategy',
    description: 'Lay down foxhole tactical lines with multi-point authoring.',
    order: 65,
    requiresEdit: true,
    defaultKeybinding: {
        primary: { key: 'g', shift: true },
    },
    inputSupport: {
        pointerTypes: ['mouse', 'pen'],
        requiresFinePointer: true,
        requiresKeyboard: true,
    },
} satisfies NixieToolMetadata;

class FoxholeTacticalLineTool extends NixieToolBase<TacticalLineToolOptions> {
    private draftPoints: number[] = [];
    private hoverPoint: PIXI.Point | null = null;
    private draftModifiers: ToolDraftPointerModifiers | null = null;
    private previewTickHandler: ((ticker: PIXI.Ticker) => void) | null = null;
    private previewRenderSignature = '';
    private lastPreviewCameraSignature = '';

    constructor(context: ConstructorParameters<typeof NixieToolBase<TacticalLineToolOptions>>[1]) {
        super(TACTICAL_LINE_TOOL_METADATA, context);
        this.registerDefaults(this.getOptionsDefaults());
    }

    override getOptionsDefaults(): TacticalLineToolOptions {
        return createTacticalLineToolOptionsFromPreset('frontline');
    }

    override async onActivate(): Promise<void> {
        this.context.presence.setCursor('crosshair');
        this.redrawPreview();
        this.startPreviewTicker();
    }

    override async onDeactivate(): Promise<void> {
        this.stopPreviewTicker();
        if (this.hasEnoughPointsToCommit()) {
            await this.finishDraft('foxhole-tactical-line-create-tool-switch');
        } else {
            await this.clearDraft(true);
        }
    }

    override async onDestroy(): Promise<void> {
        this.stopPreviewTicker();
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
            await this.finishDraft('foxhole-tactical-line-create-enter');
        }
    }

    override async onPointerDown(context: NixieToolPointerContext): Promise<void> {
        if (context.event.button === 2) {
            if (!this.draftPoints.length) {
                return;
            }
            context.event.preventDefault();
            if (this.hasEnoughPointsToCommit()) {
                await this.finishDraft('foxhole-tactical-line-create-right-click', context);
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
            await this.finishDraft('foxhole-tactical-line-create-double-click', context);
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

    private redrawPreview(): void {
        const preview = this.context.session.toolPreviewRef.value;
        preview?.clear();
        if (preview) {
            preview.alpha = 1;
        }
        this.previewRenderSignature = this.getPreviewRenderSignature();

        const points = this.getPreviewPoints();
        if (!preview || !points || points.length < 4) {
            return;
        }

        const options = this.getOptions();
        const presetId = options.presetId ?? 'frontline';
        const previewState = applyFoxholeTacticalLinePreset({
            ...createTacticalLineStatePatchFromOptions(options),
            x: 0,
            y: 0,
            rotation: 0,
            points,
            visible: true,
            alpha: 1,
            scaleX: 1,
            scaleY: 1,
            presetId,
        }, presetId);
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        renderFoxholeTacticalLineGraphics(preview, previewState, 1 / viewportScale);
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
        return `${viewportScale}:${JSON.stringify(this.getOptions())}`;
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
        clearGraphicsToolPreview(this.context.session);
        if (broadcastEnd && hadDraft) {
            await this.context.presence.endPreview();
        }
    }

    private async finishDraft(reason: string, context?: NixieToolPointerContext): Promise<void> {
        if (!this.hasEnoughPointsToCommit()) {
            await this.clearDraft(true);
            return;
        }

        const options = this.getOptions();
        const presetId = options.presetId ?? 'frontline';
        const snapshot = createFoxholeTacticalLineSnapshot({
            points: this.draftPoints.slice(),
            presetId,
            state: createTacticalLineStatePatchFromOptions(options),
            key: `Tactical Line (${presetId})`,
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
            type: FOXHOLE_TACTICAL_LINE_NODE_TYPE,
            name: 'Foxhole Tactical Line',
            description: 'A procedural foxhole planning line with caps, decorators, and reshape handles.',
            icon: 'ph:bezier-curve',
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
            type: FOXHOLE_TACTICAL_LINE_NODE_TYPE,
            stateSchema: foxholeTacticalLineStateSchema,
            // Geometry, styling and decorations are embedded in the snapshot.
            getSnapshotDependencies: () => [],
            create: (snapshot, context) => new FoxholeTacticalLineNode({
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
            metadata: TACTICAL_LINE_TOOL_METADATA,
            sceneV2Authoring: {
                kind: 'polyline', minimumPoints: 2,
                getDefaults: () => ({ ...createTacticalLineToolOptionsFromPreset('frontline') }),
                createSnapshot: ({ id, points, options }) => createFoxholeTacticalLineSnapshot({ id, points,
                    state: createTacticalLineStatePatchFromOptions(options) }),
                renderPreview: (snapshot, graphics, _labels, scale) => renderFoxholeTacticalLineGraphics(graphics,
                    applyFoxholeTacticalLinePreset(snapshot.state), scale),
            },
            create: context => new FoxholeTacticalLineTool(context),
        },
    ],
    toolbar: [
        {
            id: 'foxhole.toolbar.tactical-line.properties',
            tool: 'foxhole-tactical-line',
            section: 'foxhole-tactical-line',
            group: 'properties',
            order: 10,
            component: FoxholeTacticalLineToolbarContribution,
        },
    ],
});
