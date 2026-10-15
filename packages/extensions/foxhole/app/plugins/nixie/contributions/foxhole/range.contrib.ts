import * as PIXI from 'pixi.js';
import FoxholeRangeToolbarContribution from '#foxhole/components/nixie/foxhole/FoxholeRangeToolbarContribution.vue';
import { foxholeRangeStateSchema } from '#foxhole/plugins/foxhole/nixie/range-schema.ts';
import { createFoxholeRangeSnapshot } from '#foxhole/plugins/foxhole/nixie/range-snapshot.ts';
import {
    createRangeStatePatchFromOptions,
    createRangeToolOptionsFromDefaults,

} from '#foxhole/plugins/foxhole/nixie/range-tool-options.ts';
import type { RangeToolOptions } from '#foxhole/plugins/foxhole/nixie/range-tool-options.ts';
import {
    FOXHOLE_RANGE_NODE_TYPE,
    getFoxholeRangeMetrics,
    normalizeFoxholeRangePointsToLocalOrigin,
    normalizeFoxholeRangeState,

} from '#foxhole/plugins/foxhole/nixie/range.ts';
import type { FoxholeRangeState } from '#foxhole/plugins/foxhole/nixie/range.ts';
import {
    FoxholeRangeNode,
    renderFoxholeRangeGraphics,
    renderFoxholeRangeVisuals,
} from '#foxhole/plugins/nixie/board/types/foxhole-range.ts';
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
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import type {
    NixieToolContext,
    NixieToolKeyboardContext,
    NixieToolMetadata,
    NixieToolPointerContext,
    NixieRemotePresenceSession,
    NixieToolRemotePresenceRenderHelpers,
} from '#nixie/plugins/nixie/contributions/tools/types.ts';

type RangeCreationMode = 'idle' | 'pointer-primed' | 'drag-creating' | 'anchor-pending';

const MIN_COMMIT_RADIUS_WORLD = 8;
const MIN_PREVIEW_RADIUS_WORLD = 0;

const RANGE_TOOL_METADATA = {
    id: 'foxhole-range',
    name: 'Range',
    icon: 'ph:crosshair-simple',
    description: 'Draw Foxhole planning circles and pie-slice ranges with distance and angle labels.',
    order: 67,
    requiresEdit: true,
    inputSupport: {
        pointerTypes: ['mouse', 'pen'],
        requiresFinePointer: true,
    },
} satisfies NixieToolMetadata;

function getPreviewWorldPoints(center: PIXI.Point, end: PIXI.Point): number[] {
    return [center.x, center.y, end.x, end.y];
}

function getPreviewRadius(center: PIXI.Point, end: PIXI.Point | null): number {
    if (!end) {
        return 0;
    }

    return Math.hypot(end.x - center.x, end.y - center.y);
}

function createPreviewStateFromWorldPoints(
    center: PIXI.Point,
    end: PIXI.Point,
    options: Partial<RangeToolOptions>,
): FoxholeRangeState {
    const anchored = normalizeFoxholeRangePointsToLocalOrigin(getPreviewWorldPoints(center, end));
    return normalizeFoxholeRangeState({
        ...createRangeStatePatchFromOptions(options),
        x: anchored.x,
        y: anchored.y,
        points: anchored.points,
        visible: true,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
    });
}

class FoxholeRangeTool extends NixieToolBase<RangeToolOptions> {
    private mode: RangeCreationMode = 'idle';
    private pointerId: number | null = null;
    private centerWorld: PIXI.Point | null = null;
    private startClient: PIXI.Point | null = null;
    private previewEndWorld: PIXI.Point | null = null;
    private draftModifiers: ToolDraftPointerModifiers | null = null;
    private previewOverlay: PIXI.Container | null = null;
    private previewGraphics: PIXI.Graphics | null = null;
    private previewLabelLayer: PIXI.Container | null = null;
    private previewTickHandler: ((ticker: PIXI.Ticker) => void) | null = null;
    private previewRenderSignature = '';
    private lastPreviewCameraSignature = '';

    constructor(context: ConstructorParameters<typeof NixieToolBase<RangeToolOptions>>[1]) {
        super(RANGE_TOOL_METADATA, context);
        this.registerDefaults(this.getOptionsDefaults());
    }

    override getOptionsDefaults(): RangeToolOptions {
        return createRangeToolOptionsFromDefaults();
    }

    override async onActivate(): Promise<void> {
        this.context.presence.setCursor('crosshair');
        this.redrawPreview();
        this.startPreviewTicker();
    }

    override async onDeactivate(): Promise<void> {
        this.stopPreviewTicker();
        this.destroyPreviewOverlay();
        await this.clearCreationState(true);
    }

    override async onDestroy(): Promise<void> {
        this.stopPreviewTicker();
        this.destroyPreviewOverlay();
        await this.clearCreationState(true);
    }

    override async onKeyDown(context: NixieToolKeyboardContext): Promise<void> {
        if (context.event.key !== 'Escape' || this.mode === 'idle') {
            return;
        }

        context.event.preventDefault();
        await this.clearCreationState(true);
    }

    override async onPointerDown(context: NixieToolPointerContext): Promise<void> {
        if (!context.isPrimaryButton) {
            return;
        }

        if (this.mode === 'anchor-pending' && this.centerWorld) {
            await this.finalizeRange(context, 'foxhole-range-create-click');
            return;
        }

        if (this.pointerId !== null) {
            return;
        }

        this.mode = 'pointer-primed';
        this.pointerId = context.event.pointerId;
        this.centerWorld = maybeSnapToolPointerWorldPoint(this.context, context);
        this.startClient = new PIXI.Point(context.event.clientX, context.event.clientY);
        this.draftModifiers = {
            shift: context.shift,
            alt: context.alt,
            ctrlOrMeta: context.ctrlOrMeta,
        };
        this.previewEndWorld = null;
        this.clearPreviewOverlay();
    }

    override async onPointerMove(context: NixieToolPointerContext): Promise<void> {
        this.draftModifiers = {
            shift: context.shift,
            alt: context.alt,
            ctrlOrMeta: context.ctrlOrMeta,
        };

        if (this.mode === 'anchor-pending' && this.centerWorld) {
            const currentWorld = maybeSnapToolPointerWorldPoint(this.context, context);
            this.previewEndWorld = currentWorld;
            this.redrawPreview();
            await this.context.presence.updatePreview({
                centerWorld: { x: this.centerWorld.x, y: this.centerWorld.y },
                previewPoints: getPreviewWorldPoints(this.centerWorld, currentWorld),
            }, {
                phase: 'dragging',
                pointer: toRealtimePointer(context),
            });
            return;
        }

        if (
            this.pointerId === null
            || this.centerWorld === null
            || this.startClient === null
            || context.event.pointerId !== this.pointerId
        ) {
            return;
        }

        if ((context.event.buttons & 1) === 0) {
            await this.onPointerUp(context);
            return;
        }

        const clientDistance = Math.hypot(
            context.event.clientX - this.startClient.x,
            context.event.clientY - this.startClient.y,
        );

        const currentWorld = maybeSnapToolPointerWorldPoint(this.context, context);
        this.previewEndWorld = currentWorld;
        const previewRadius = getPreviewRadius(this.centerWorld, currentWorld);

        if (this.mode === 'pointer-primed' && clientDistance >= Math.max(0, this.getOptions().dragThresholdPx)) {
            this.mode = 'drag-creating';
            await this.context.presence.beginPreview({
                centerWorld: { x: this.centerWorld.x, y: this.centerWorld.y },
                previewPoints: getPreviewWorldPoints(this.centerWorld, currentWorld),
            }, {
                phase: 'dragging',
                pointer: toRealtimePointer(context),
            });
        }

        if (this.mode !== 'drag-creating' && this.mode !== 'pointer-primed') {
            return;
        }

        if (previewRadius > MIN_PREVIEW_RADIUS_WORLD) {
            this.redrawPreview();
        }

        if (this.mode !== 'drag-creating') {
            return;
        }

        await this.context.presence.updatePreview({
            centerWorld: { x: this.centerWorld.x, y: this.centerWorld.y },
            previewPoints: getPreviewWorldPoints(this.centerWorld, currentWorld),
        }, {
            phase: 'dragging',
            pointer: toRealtimePointer(context),
        });
    }

    override async onPointerUp(context: NixieToolPointerContext): Promise<void> {
        if (this.pointerId === null || context.event.pointerId !== this.pointerId) {
            return;
        }

        if (this.mode === 'drag-creating') {
            await this.finalizeRange(context, 'foxhole-range-create-drag');
            return;
        }

        if (this.mode !== 'pointer-primed') {
            return;
        }

        this.mode = 'anchor-pending';
        this.pointerId = null;
        this.startClient = null;
        this.previewEndWorld = null;
        this.draftModifiers = {
            shift: context.shift,
            alt: context.alt,
            ctrlOrMeta: context.ctrlOrMeta,
        };
        this.clearPreviewOverlay();

        if (!this.centerWorld) {
            await this.clearCreationState(false);
            return;
        }

        await this.context.presence.beginPreview({
            centerWorld: { x: this.centerWorld.x, y: this.centerWorld.y },
        }, {
            phase: 'preview',
            pointer: toRealtimePointer(context),
        });
    }

    override async onPointerCancel(_context: NixieToolPointerContext): Promise<void> {
        await this.clearCreationState(true);
    }

    override renderRemotePresence(
        graphics: PIXI.Graphics,
        remoteSession: NixieRemotePresenceSession,
        helpers: NixieToolRemotePresenceRenderHelpers,
    ): void {
        if (remoteSession.phase !== 'dragging' && remoteSession.phase !== 'preview') {
            return;
        }

        const payload = remoteSession.preview?.payload;
        const centerWorld = payload?.centerWorld;
        if (
            !centerWorld
            || typeof centerWorld !== 'object'
            || !Number.isFinite((centerWorld as { x: number; y: number; }).x)
            || !Number.isFinite((centerWorld as { x: number; y: number; }).y)
        ) {
            return;
        }

        const center = centerWorld as { x: number; y: number; };
        const pointerWorld = remoteSession.renderedPointer?.world ?? remoteSession.pointer?.world;
        const previewPoints = Array.isArray(payload?.previewPoints)
            ? payload.previewPoints.map(value => Number(value))
            : null;
        const hasPreviewPoints = previewPoints
            && previewPoints.length >= 4
            && previewPoints.every(Number.isFinite);
        const worldPoints = hasPreviewPoints
            ? previewPoints
            : pointerWorld
                ? getPreviewWorldPoints(new PIXI.Point(center.x, center.y), new PIXI.Point(pointerWorld.x, pointerWorld.y))
                : null;
        if (!worldPoints) {
            return;
        }

        const metrics = getFoxholeRangeMetrics({ points: worldPoints });
        if (metrics.radius <= 0) {
            return;
        }

        const previewState = normalizeFoxholeRangeState({
            ...createRangeStatePatchFromOptions(this.getOptions()),
            ...normalizeFoxholeRangePointsToLocalOrigin(worldPoints),
            strokeColor: softenPresenceColor(remoteSession.color),
            fillColor: softenPresenceColor(remoteSession.color),
            fillAlpha: 0.12,
        });
        const anchoredMetrics = getFoxholeRangeMetrics(previewState);
        // Draw into a child so we don't clear/transform the shared presence overlay
        // (that would offset remote cursors and selection outlines once the range angles).
        const previewGraphic = ensureRemoteToolPreviewGraphic(graphics, RANGE_TOOL_METADATA.id, remoteSession.senderId);
        previewGraphic.position.set(previewState.x + anchoredMetrics.centerX, previewState.y + anchoredMetrics.centerY);
        previewGraphic.rotation = anchoredMetrics.baseAngle;
        renderFoxholeRangeGraphics(previewGraphic, previewState, anchoredMetrics.radius, helpers.worldPerPx);
    }

    private async finalizeRange(context: NixieToolPointerContext, reason: string): Promise<void> {
        const center = this.centerWorld;
        if (!center) {
            await this.clearCreationState(true);
            return;
        }

        const currentWorld = maybeSnapToolPointerWorldPoint(this.context, context);
        if (getPreviewRadius(center, currentWorld) < MIN_COMMIT_RADIUS_WORLD) {
            await this.clearCreationState(true);
            return;
        }

        const snapshot = createFoxholeRangeSnapshot({
            points: getPreviewWorldPoints(center, currentWorld),
            state: createRangeStatePatchFromOptions(this.getOptions()),
            key: 'Range Tool',
        });
        const id = String(snapshot.id);

        await this.clearCreationState(true);

        await commitGraphicsShapeCreation({
            context: this.context,
            id,
            snapshot,
            reason,
            pointer: toRealtimePointer(context),
        });
    }

    private async clearCreationState(broadcastEnd: boolean): Promise<void> {
        const shouldBroadcast = broadcastEnd && (this.mode === 'drag-creating' || this.mode === 'anchor-pending');

        this.mode = 'idle';
        this.pointerId = null;
        this.centerWorld = null;
        this.startClient = null;
        this.previewEndWorld = null;
        this.draftModifiers = null;
        this.lastPreviewCameraSignature = '';
        this.clearPreviewOverlay();

        if (shouldBroadcast) {
            await this.context.presence.endPreview();
        }
    }

    private ensurePreviewOverlay(): { graphics: PIXI.Graphics; labelLayer: PIXI.Container; } {
        if (!this.previewOverlay) {
            this.previewOverlay = new PIXI.Container();
            this.previewOverlay.label = 'foxhole-range-tool-preview';
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

        if (this.previewOverlay) {
            this.previewOverlay.position.set(0, 0);
        }
        if (this.previewGraphics) {
            this.previewGraphics.position.set(0, 0);
            this.previewGraphics.rotation = 0;
        }
        if (this.previewLabelLayer) {
            this.previewLabelLayer.position.set(0, 0);
            this.previewLabelLayer.rotation = 0;
        }
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

        if (!this.centerWorld || !this.previewEndWorld || getPreviewRadius(this.centerWorld, this.previewEndWorld) <= MIN_PREVIEW_RADIUS_WORLD) {
            return;
        }

        const previewState = createPreviewStateFromWorldPoints(
            this.centerWorld,
            this.previewEndWorld,
            this.getOptions(),
        );
        this.previewOverlay!.position.set(previewState.x, previewState.y);
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        renderFoxholeRangeVisuals(graphics, labelLayer, previewState, 1 / viewportScale);
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
            const hasDraft = this.mode === 'drag-creating'
                || this.mode === 'anchor-pending'
                || (this.mode === 'pointer-primed' && !!this.previewEndWorld);
            if (!hasDraft || !this.centerWorld) {
                this.lastPreviewCameraSignature = '';
                return;
            }

            const cameraSignature = getToolViewportCameraSignature(this.context.session);
            if (cameraSignature !== this.lastPreviewCameraSignature) {
                this.lastPreviewCameraSignature = cameraSignature;
                this.syncPreviewEndForViewport();
                if (
                    this.previewEndWorld
                    && getPreviewRadius(this.centerWorld, this.previewEndWorld) > MIN_PREVIEW_RADIUS_WORLD
                ) {
                    this.redrawPreview();
                }
                return;
            }

            if (!this.previewEndWorld || getPreviewRadius(this.centerWorld, this.previewEndWorld) <= MIN_PREVIEW_RADIUS_WORLD) {
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

    private syncPreviewEndForViewport(): void {
        if (
            (this.mode !== 'drag-creating' && this.mode !== 'anchor-pending' && this.mode !== 'pointer-primed')
            || !this.centerWorld
        ) {
            return;
        }

        const modifiers = this.draftModifiers;
        if (!modifiers) {
            return;
        }

        const active = resolveCurrentToolPointerWorld(this.context, modifiers);
        if (!active) {
            return;
        }

        this.previewEndWorld = active.world;
        if (this.mode === 'pointer-primed') {
            return;
        }

        this.context.presence.updatePreview({
            centerWorld: { x: this.centerWorld.x, y: this.centerWorld.y },
            previewPoints: getPreviewWorldPoints(this.centerWorld, active.world),
        }, {
            phase: this.mode === 'anchor-pending' ? 'preview' : 'dragging',
            pointer: active.pointer,
        });
    }

    private getPreviewRenderSignature(): string {
        const viewportScale = Math.max(0.0001, this.context.session.viewportRef.value?.scale.x ?? 1);
        return `${viewportScale}:${this.centerWorld?.x ?? ''}:${this.centerWorld?.y ?? ''}:${this.previewEndWorld?.x ?? ''}:${this.previewEndWorld?.y ?? ''}:${JSON.stringify(this.getOptions())}`;
    }
}

export default defineContribution({
    nodes: [
        {
            type: FOXHOLE_RANGE_NODE_TYPE,
            name: 'Foxhole Range',
            description: 'Planning circle or pie-slice range with distance and angle labels.',
            icon: 'ph:crosshair-simple',
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
            type: FOXHOLE_RANGE_NODE_TYPE,
            stateSchema: foxholeRangeStateSchema,
            // Geometry, styling and measurements are embedded in the snapshot.
            getSnapshotDependencies: () => [],
            create: (snapshot, context) => new FoxholeRangeNode({
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
            metadata: RANGE_TOOL_METADATA,
            sceneV2Authoring: {
                kind: 'two-point', minimumPoints: 2, minimumLength: MIN_COMMIT_RADIUS_WORLD,
                getDefaults: () => ({ ...createRangeToolOptionsFromDefaults() }),
                createSnapshot: ({ id, points, options }) => createFoxholeRangeSnapshot({ id, points,
                    state: createRangeStatePatchFromOptions(options) }),
                renderPreview: (snapshot, graphics, labels, scale) => renderFoxholeRangeVisuals(graphics, labels,
                    normalizeFoxholeRangeState(snapshot.state), scale),
            },
            create: context => new FoxholeRangeTool(context),
        },
    ],
    toolbar: [
        {
            id: 'foxhole.toolbar.range.properties',
            tool: 'foxhole-range',
            section: 'foxhole-range',
            group: 'properties',
            order: 10,
            component: FoxholeRangeToolbarContribution,
        },
    ],
});
