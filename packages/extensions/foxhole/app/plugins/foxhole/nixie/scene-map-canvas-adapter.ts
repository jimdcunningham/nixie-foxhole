import { subscribeSceneViewpointRestore } from '#nixie/plugins/nixie/scene-viewpoints.ts';
import { beginShellProgressJob, finishShellProgressJob, updateShellProgressJob } from '#nixie/utils/nixie-shell-progress-queue.ts';
import { dismissNxToast, showNxToast } from '#nixie/composables/useNxToast.ts';
import { preserveViewpointRegionCamera, consumeViewpointRegionCamera } from './map/viewpoint-region-camera.mjs';
import { createPlannerRoadTour } from './map/planner-road-tour.mjs';
import { plannerRoadTourActions, plannerRoadTourOptions, plannerRoadTourStatus } from './map/road-tour-state.ts';
import { resolveFoxholeMapFitCamera } from './map/camera-fit.ts';
import { foxholeWorldAssetDelivery } from '#foxhole/utils/asset-delivery.ts';
import { FOXHOLE_MAP_REGIONS, getFoxholeRegionPosition } from './map/constants.ts';
import { FoxholeRegionSceneController, regionIdForKey, selectedSpatialRegions } from './map/region-scene-controller.mjs';
import { computed, shallowRef } from 'vue';
import type { NixieSceneV2CanvasContributionContext, NixieSceneV2CanvasContribution } from '#nixie/plugins/nixie/scene-v2/canvas-contributions.ts';
import { FOXHOLE_MAP_SETTING_KEYS, readFoxholeMapSettings } from './map-settings.ts';
import { getFoxholeMapRegionBillboardGroups } from './map/region-annotations.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { getFoxholeMapActiveBounds, FoxholeMapViewportPlugin } from './map/controller.ts';

/** Reuse the complete War map on the ECS-owned viewport; no copied scene graph. */
export function createFoxholeSceneMapCanvas(context: NixieSceneV2CanvasContributionContext): NixieSceneV2CanvasContribution {
    const active = shallowRef(true);
    let lastSpatialRegion: string | null = null;
    const settingsStore = useNixieSettingsStore();
    // Frame callbacks share one reactive snapshot; Pinia action reads allocate.
    const mapSettings = computed(() => readFoxholeMapSettings(context.runtime.projectStore.settings, id => settingsStore.getValueOr(id, undefined)));
    let worldProgressJobId: string | null = null;
    let worldProgressErrorToastId: string | null = null;
    let worldProgressErrorKey: string | null = null;
    let worldProgressWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let worldProgressWaitToastId: string | null = null;
    let worldProgressWaitToastRetryable: boolean | null = null;
    let worldProgressWaitToastSubject: string | null = null;
    let worldProgressCanRetry = false;
    let worldProgressLoadIdentity: string | null = null;
    let worldProgressSubject = 'World Map';
    let world: FoxholeRegionSceneController;
    let worldRetirement: Promise<unknown> = Promise.resolve();
    let worldRetirementPending = false;
    let worldRetirementStatus: 'waiting' | 'idle' | null = null;
    let destroyed = false;
    const retireWorld = () => {
        const retired = world;
        retired.destroy();
        // All prior controller generations must drain too, even if catalogs
        // change repeatedly before an earlier generation has stopped.
        const barrier = Promise.all([worldRetirement, retired.whenDisposed()]);
        worldRetirement = barrier;
        worldRetirementPending = true;
        worldRetirementStatus = null;
        void barrier.then(() => {
            if (!destroyed && worldRetirement === barrier) worldRetirementPending = false;
        });
    };
    const clearWorldProgressWait = () => {
        if (worldProgressWaitTimer !== null) clearTimeout(worldProgressWaitTimer);
        if (worldProgressWaitToastId) dismissNxToast(worldProgressWaitToastId);
        worldProgressWaitTimer = null;
        worldProgressWaitToastId = null;
        worldProgressWaitToastRetryable = null;
        worldProgressWaitToastSubject = null;
    };
    const showWorldProgressWait = () => {
        if (!worldProgressJobId || worldProgressWaitToastId) return;
        const owner = world, jobId = worldProgressJobId, retryable = worldProgressCanRetry;
        let toastId: string | null = null;
        toastId = showNxToast({
            kind: 'warning', title: 'World Map Still Loading', persistent: true,
            message: retryable
                ? `${worldProgressSubject} is taking longer than expected. Select to retry loading; it may wait for the previous load to stop.`
                : `${worldProgressSubject} is taking longer than expected. The map is still loading.`,
            ...(retryable ? {
                actionLabel: 'Retry Loading',
                onClick: () => {
                    if (!toastId || worldProgressWaitToastId !== toastId || world !== owner || worldProgressJobId !== jobId || !worldProgressCanRetry) return false;
                    worldProgressWaitToastId = null;
                    worldProgressWaitToastRetryable = null;
                    worldProgressWaitToastSubject = null;
                    owner.retryLoading();
                    scheduleWorldProgressWait();
                },
            } : {}),
        });
        worldProgressWaitToastId = toastId || null;
        worldProgressWaitToastRetryable = worldProgressWaitToastId ? retryable : null;
        worldProgressWaitToastSubject = worldProgressWaitToastId ? worldProgressSubject : null;
    };
    const scheduleWorldProgressWait = () => {
        if (!worldProgressJobId || worldProgressWaitTimer !== null || worldProgressWaitToastId) return;
        const owner = world, jobId = worldProgressJobId;
        // This is an elapsed-time hint, not an assertion that network activity stopped.
        worldProgressWaitTimer = setTimeout(() => {
            worldProgressWaitTimer = null;
            if (!worldProgressJobId || worldProgressJobId !== jobId || world !== owner) return;
            showWorldProgressWait();
        }, 60_000);
    };
    const clearWorldProgressError = () => {
        if (worldProgressErrorToastId) dismissNxToast(worldProgressErrorToastId);
        worldProgressErrorToastId = null;
        worldProgressErrorKey = null;
    };
    const reportWorldProgress = (status: { phase?: string; region?: string; error?: string; retryableLoading?: boolean; retryableFailed?: boolean; selectionGeneration?: number; progress?: { completed: number; total: number; unit: string; }; }) => {
        const reportedPhase = status.phase?.trim() ?? '';
        // This initial phase also includes local cache and manifest work.
        const phase = reportedPhase === 'Downloading Region' ? 'Loading region data…' : reportedPhase;
        const region = status.region ? FOXHOLE_MAP_REGIONS.find(item => regionIdForKey(item.key) === status.region) : undefined;
        const subject = region?.name || 'World Map';
        worldProgressSubject = subject;
        worldProgressCanRetry = status.retryableLoading === true;
        if (phase && phase !== 'idle' && phase !== 'Ready' && phase !== 'error') {
            const identity = Number.isSafeInteger(status.selectionGeneration)
                ? `selection:${status.selectionGeneration}` : `region:${status.region || ''}`;
            if (worldProgressLoadIdentity !== null && worldProgressLoadIdentity !== identity) clearWorldProgressWait();
            worldProgressLoadIdentity = identity;
        }
        const reason = typeof status.error === 'string' ? status.error.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
        // A region can fail while another is still loading. Keep both the
        // error and the independent progress visible until recovery.
        const failed = phase === 'error' || (!!phase && phase !== 'idle' && phase !== 'Ready' && !!reason);
        if (failed) {
            const retryable = status.retryableFailed === true;
            const key = `${subject}\0${reason}\0${retryable}`;
            if (!worldProgressErrorToastId || worldProgressErrorKey !== key) {
                clearWorldProgressError();
                const owner = world;
                let toastId: string | null = null;
                toastId = showNxToast({
                    kind: 'error', title: retryable ? 'World Map Load Failed' : 'World Map Content Failed', persistent: true,
                    message: `${retryable ? subject : `Some ${subject} content`} could not load${reason ? `: ${reason.replace(/[.!?]$/, '')}` : ''}.${retryable ? ' Select to retry available regions.' : ''}`,
                    ...(retryable ? {
                        actionLabel: 'Retry',
                        onClick: () => {
                            if (!toastId || worldProgressErrorToastId !== toastId || world !== owner) return false;
                            worldProgressErrorToastId = null;
                            worldProgressErrorKey = null;
                            owner.retryFailed();
                        },
                    } : {}),
                });
                worldProgressErrorToastId = toastId || null;
                worldProgressErrorKey = worldProgressErrorToastId ? key : null;
            }
        } else {
            clearWorldProgressError();
        }
        if (!phase || phase === 'idle' || phase === 'Ready' || phase === 'error') {
            clearWorldProgressWait();
            worldProgressLoadIdentity = null;
            if (worldProgressJobId) finishShellProgressJob(worldProgressJobId);
            worldProgressJobId = null;
            return;
        }
        const progress = status.progress;
        const measurable = progress && ['asset records', 'layers', 'regions', 'terrain textures', 'surface geometry assets'].includes(progress.unit)
            && Number.isInteger(progress.completed) && Number.isInteger(progress.total)
            && progress.total > 0 && progress.completed >= 0 && progress.completed <= progress.total;
        const title = measurable
            ? progress.unit === 'layers' ? `Loading ${subject} Layers` : progress.unit === 'regions' ? `Loading ${subject} Regions` : progress.unit === 'terrain textures' ? `Loading ${subject} Terrain Textures` : progress.unit === 'surface geometry assets' ? `Preparing ${subject} Surface Geometry` : `Preparing ${subject} Cache`
            : `Loading ${subject}`;
        const currentFile = measurable ? `${phase} · ${progress.completed}/${progress.total} ${progress.unit}` : phase;
        const processed = measurable ? progress.completed : 0;
        const total = measurable ? progress.total : 0;
        const percent = measurable ? Math.round(processed / total * 100) : null;
        if (!worldProgressJobId) {
            worldProgressJobId = beginShellProgressJob({
                kind: 'foxhole-world-load', title, currentFile, processed, total, percent, cancellable: false,
            });
        } else {
            updateShellProgressJob(worldProgressJobId, { title, currentFile, processed, total, percent });
        }
        if (worldProgressWaitToastId && (worldProgressWaitToastRetryable !== worldProgressCanRetry || worldProgressWaitToastSubject !== worldProgressSubject)) {
            dismissNxToast(worldProgressWaitToastId);
            worldProgressWaitToastId = null;
            worldProgressWaitToastRetryable = null;
            worldProgressWaitToastSubject = null;
            showWorldProgressWait();
        }
        scheduleWorldProgressWait();
    };
    let delivery = foxholeWorldAssetDelivery();
    const createWorld = () => new FoxholeRegionSceneController({
        // Scene time of day owns the shared sky; a region must not install Noon Sky.
        manageEnvironment: false,
        onStatus: reportWorldProgress,
        baseUrl: delivery?.baseUrl ?? '',
        indexLoader: delivery?.loadIndex ?? (async () => {throw new Error('No selected world catalog.');}),
        loadRegion: async (options: Parameters<typeof import('@nixiejs/foxhole-world')['loadCompactRegion']>[0]) => { const scene = await (await import('@nixiejs/foxhole-world')).loadCompactRegion({...options,scheduleModelTask:context.scheduleModelTask,renderer:context.app.renderer,prepareTerrain:async source=>{if(context.prepareTextureSource)await context.prepareTextureSource(source);else if('gpu' in context.app.renderer)context.app.renderer.texture.initSource(source);}}); scene.prepareFirstFrame?.(context.app.renderer); return scene; },
    });
    world = createWorld();
    const roadTour = import.meta.dev && context.cameraPose && context.setCameraPose ? createPlannerRoadTour({
        canvas: context.app.canvas,
        getRegions: () => world.tourRegions().map(record => ({ ...record,
            label: FOXHOLE_MAP_REGIONS.find(region => regionIdForKey(region.key) === record.id)?.name ?? record.id })),
        getOptions: () => plannerRoadTourOptions.value,
        readPose: context.cameraPose, writePose: context.setCameraPose, setCameraShake: context.setCameraShake, walkingCamera: context.walkingCamera, setWalkingCamera: context.setWalkingCamera, setWalkingBob: context.setWalkingBob, requestWalkingPointer: context.requestWalkingPointer, releaseWalkingPointer: context.releaseWalkingPointer, viewMode: context.viewMode,
        onStatus: status => { plannerRoadTourStatus.value = status; },
    }) : null;
    if (roadTour) plannerRoadTourActions.value = roadTour;
    const unsubscribeViewpoints = subscribeSceneViewpointRestore(context.runtime, settings => {
        roadTour?.stop();
        if (plannerRoadTourStatus.value.shaking) roadTour?.toggleCameraShake();
        preserveViewpointRegionCamera(context.runtime, String(settings[FOXHOLE_MAP_SETTING_KEYS.regionKeys] ?? ''));
    });
    const plugin = new FoxholeMapViewportPlugin(context.viewport, {
        viewport: context.viewport,
        project: context.runtime.project,
        projectStore: context.runtime.projectStore,
        getSceneNodeCount: context.nodeCount,
        getZoom: context.zoom,
        resolveMapIconAsset: point => world.mapAssetAt(point.x, point.y),
        manualPresentation: true,
        isSpatialView: () => context.viewMode() !== 'flat',
        needsSpatialWorldData: () => context.viewMode() !== 'flat' && mapSettings.value.regionKeys.length === 1,
        session: {
            appRef: shallowRef(context.app),
            sceneLayerRef: shallowRef(context.before),
            sceneViewActive: active,
            federatedHitTestingPaused: computed(context.interacting),
            pointerTrackerRef: { value: { pointer: computed(() => ({ world: context.pointer() })) } },
            setGridOverlayRenderingSuppressed: context.suppressGrid,
            cameraTo: options => {
                if (!options?.position) return;
                const settings = mapSettings.value;
                if (context.viewMode() !== 'flat' && settings.regionKeys.length > 0) {
                    const camera = resolveFoxholeMapFitCamera(getFoxholeMapActiveBounds({ ...settings, background: false }), context.app.screen);
                    context.cameraTo(camera.position, camera.scale);
                } else context.cameraTo(options.position, options.scale);
            },
        },
    });
    return {
        documentRendererIds: ['planning-map', 'planning-grid'],
        ownsViewportConstraints: true,
        updatePresentation: () => plugin.updatePresentation(),
        hoverPresentation: (source, point) => plugin.hoverPresentation(source, point),
        get root() { return plugin.presentationRoot; },
        navigationBounds() {
            const settings = mapSettings.value;
            if (context.viewMode() === '3d' || !settings.enabled || !settings.background || !settings.lockCameraToMap) return null;
            const bounds = getFoxholeMapActiveBounds(settings);
            return { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom };
        },
        updateSpatialPresentation({ view, mode, deltaMS }) {
            if (destroyed) return;
            // Planning artwork and region bounds exist before remote world delivery.
            // Fit once before either can be displayed; catalog readiness must not
            // replace a camera the user already moved while the map was loading.
            const settings = mapSettings.value;
            // A spatial world is intentionally limited to one explicit region.
            const regions = settings.regionKeys.length === 1 ? FOXHOLE_MAP_REGIONS.filter(region => settings.regionKeys.includes(region.key)) : [];
            const selection = regions.map(region => region.key).sort().join('|');
            const viewpointCamera = consumeViewpointRegionCamera(context.runtime, selection);
            if (settings.enabled && regions.length && mode !== 'flat' && selection !== lastSpatialRegion) {
                const viewport = context.app.screen;
                if (viewpointCamera) {
                    lastSpatialRegion = selection;
                } else if (viewport?.width >= 2 && viewport.height >= 2) {
                    const camera = resolveFoxholeMapFitCamera(getFoxholeMapActiveBounds({ ...settings, background: false }), context.app.screen);
                    context.cameraTo(camera.position, camera.scale);
                    lastSpatialRegion = selection;
                }
            }
            if (!settings.enabled || !regions.length || mode === 'flat') lastSpatialRegion = null;
            const selected = foxholeWorldAssetDelivery();
            if (!selected) {
                if (delivery) {retireWorld(); delivery = null; world = createWorld(); roadTour?.stop();}
                return;
            }
            if (selected.revision !== delivery?.revision) {
                retireWorld();
                delivery = selected;
                world = createWorld();
                roadTour?.stop();
            }
            // Keep the replacement dormant until old scene resources and
            // shared-work reservations are fully retired.
            if (worldRetirementPending) {
                const status = settings.enabled && regions.length && mode !== 'flat' ? 'waiting' : 'idle';
                if (worldRetirementStatus !== status) {
                    worldRetirementStatus = status;
                    reportWorldProgress({ phase: status === 'waiting' ? 'Waiting for the previous map to stop\u2026' : 'idle' });
                }
                return;
            }
            worldRetirementStatus = null;
            world.sync({ view, mode, deltaMS, wind: context.wind?.(), settings: { ...settings, regionKeys: regions.map(region => region.key) }, regions: regions.map(region => ({
                id: regionIdForKey(region.key), position: getFoxholeRegionPosition(region), terrainMapImage: settings.terrainSurface === 'map' ? plugin.getSpatialMapImage?.(region.key) : null, warState: plugin.getSpatialWarState(region.key), planningOverlays: plugin.getSpatialPlanningOverlays?.(region.key),
            })) });
            roadTour?.update(deltaMS);
        },
        spatialGroundVisible() {
            const settings = mapSettings.value;
            // Selected regions own the ground even while loading or hidden.
            // Disabling Terrain must not reveal the editor's camera-following floor.
            return settings.regionKeys.length !== 1 || selectedSpatialRegions({ ...settings, mode: context.viewMode() }).length === 0;
        },
        groundAvailable: () => world.active,
        groundElevation: (x, y) => world.sampleGround(x, y),
        waterElevation: (x, y) => world.sampleWater(x, y),
        updateGroundCutouts: volumes => world.setGroundCutouts(volumes),
        spatialLayers() {
            const root = plugin.presentationRoot;
            if (!root?.visible || root.destroyed) return [];
            const settings = mapSettings.value;
            const clip = settings.cropEnabled && settings.cropWidth > 0 && settings.cropHeight > 0
                ? { minX: settings.cropX, minY: settings.cropY, maxX: settings.cropX + settings.cropWidth, maxY: settings.cropY + settings.cropHeight }
                : undefined;
            const billboardLabels = new Set(['foxhole-map-labels', 'foxhole-map-major-labels', 'foxhole-map-minor-labels',
                'foxhole-map-live-icons', 'foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels', 'foxhole-map-grid']);
            const pixelScale = context.zoom();
            const summaries = new Set(['foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels']);
            return root.children.filter(child => child !== root.mask && (context.viewMode() === 'flat' || child.label !== 'foxhole-map-background') && (!world.active || !['foxhole-map-regions', 'foxhole-map-background', 'foxhole-map-borders', 'foxhole-map-frontlines', 'foxhole-map-subregions'].includes(child.label))).map(content => ({
                content, liveGraphics: content.label === 'foxhole-map-borders', billboard: billboardLabels.has(content.label), billboardElevation: context.viewMode() === '3d' && billboardLabels.has(content.label) ? (x: number, y: number) => Math.max(0, world.sampleGround(x, y) ?? 0) : undefined, screenSizedBillboards: context.viewMode() === '3d' && billboardLabels.has(content.label) && !summaries.has(content.label), hoverable: content.label === 'foxhole-map-live-icons', pixelScale, clip,
                // Warm 2.5D keeps the layout ready for the first 3D display frame.
                billboardGroups: context.viewMode() !== 'flat' && summaries.has(content.label) ? getFoxholeMapRegionBillboardGroups(content) : undefined,
            }));
        },
        worldBounds() {
            const settings = mapSettings.value;
            if (!settings.enabled) return null;
            const bounds = getFoxholeMapActiveBounds(context.viewMode() !== 'flat' && settings.regionKeys.length > 0 ? { ...settings, background: false } : settings);
            return { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom };
        },
        diagnostics() {
            const cells = world.streamingStats(), terrain = world.terrainStats();
            return [
                ...(world.diagnostics?.() ?? []),
                ...(roadTour?.diagnostics?.() ?? []),
                `map cells:${cells.resident}  loading:${cells.loading}  available:${cells.total}`,
                `terrain chunks:${terrain.visible}/${terrain.chunks}  detail:${terrain.detail}  draws:${terrain.draws}`,
                `terrain:${terrain.triangles.toLocaleString()} tris  geometry:${(terrain.bytes / 1048576).toFixed(1)} MiB (CPU arrays)`,
                `terrain builds:${terrain.pending} pending  errors:${terrain.errors}`,
            ];
        },
        destroy() {
            unsubscribeViewpoints();
            roadTour?.destroy();
            if (plannerRoadTourActions.value === roadTour) {
                plannerRoadTourActions.value = null;
                plannerRoadTourStatus.value = { ...plannerRoadTourStatus.value, attached: false, canRun: false, canShake: false, shaking: false, walking: false, mouseCaptured: false, canWalk: false };
            }
            destroyed = true;
            world.destroy();
            reportWorldProgress({ phase: 'idle' });
            active.value = false;
            plugin.destroy();
            context.suppressGrid(false);
        },
    };
}
