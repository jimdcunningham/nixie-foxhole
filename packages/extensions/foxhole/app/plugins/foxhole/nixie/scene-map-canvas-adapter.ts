import { consumeViewpointRegionCamera } from './map/viewpoint-region-camera.mjs';
import { createPlannerRoadTour } from './map/planner-road-tour.mjs';
import { plannerRoadTourActions, plannerRoadTourOptions, plannerRoadTourStatus } from './map/road-tour-state.ts';
import { resolveFoxholeMapFitCamera } from './map/camera-fit.ts';
import { useRuntimeConfig } from '#imports';
import { createFoxholeAssetsBaseUrl } from './catalog.ts';
import { FOXHOLE_MAP_REGIONS, getFoxholeRegionPosition } from './map/constants.ts';
import { FoxholeRegionSceneController, regionIdForKey, selectedSpatialRegions } from './map/region-scene-controller.mjs';
import { computed, shallowRef } from 'vue';
import type { NixieSceneV2CanvasContributionContext, NixieSceneV2CanvasContribution } from '#nixie/plugins/nixie/scene-v2/canvas-contributions.ts';
import { readFoxholeMapSettings } from './map-settings.ts';
import { getFoxholeMapRegionBillboardGroups } from './map/region-annotations.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { getFoxholeMapActiveBounds, FoxholeMapViewportPlugin } from './map/controller.ts';

/** Reuse the complete War map on the ECS-owned viewport; no copied scene graph. */
export function createFoxholeSceneMapCanvas(context: NixieSceneV2CanvasContributionContext): NixieSceneV2CanvasContribution {
    const active = shallowRef(true);
    let lastSpatialRegion: string | null = null;
    const settingsStore = useNixieSettingsStore();
    // Frame callbacks share one reactive snapshot; Pinia action reads allocate.
    const mapSettings = computed(() => readFoxholeMapSettings(context.runtime.projectStore.settings, id => settingsStore.getValue(id)));
    const config = useRuntimeConfig();
    const world = new FoxholeRegionSceneController({
        // Scene time of day owns the shared sky; a region must not install Noon Sky.
        manageEnvironment: false,
        baseUrl: createFoxholeAssetsBaseUrl(config.app.baseURL) + 'world/',
        loadRegion: async (options: Parameters<typeof import('@nixie/foxhole-world')['loadCompactRegion']>[0]) => { const scene = await (await import('@nixie/foxhole-world')).loadCompactRegion({...options,scheduleModelTask:context.scheduleModelTask,renderer:context.app.renderer,prepareTerrain:async source=>{if(context.prepareTextureSource)await context.prepareTextureSource(source);else if('gpu' in context.app.renderer)context.app.renderer.texture.initSource(source);}}); scene.prepareFirstFrame?.(context.app.renderer); return scene; },
    });
    const roadTour = import.meta.dev && context.cameraPose && context.setCameraPose ? createPlannerRoadTour({
        canvas: context.app.canvas,
        getRegions: () => world.tourRegions().map(record => ({ ...record,
            label: FOXHOLE_MAP_REGIONS.find(region => regionIdForKey(region.key) === record.id)?.name ?? record.id })),
        getOptions: () => plannerRoadTourOptions.value,
        readPose: context.cameraPose, writePose: context.setCameraPose, setCameraShake: context.setCameraShake, viewMode: context.viewMode,
        onStatus: status => { plannerRoadTourStatus.value = status; },
    }) : null;
    if (roadTour) plannerRoadTourActions.value = roadTour;
    const plugin = new FoxholeMapViewportPlugin(context.viewport, {
        viewport: context.viewport,
        project: context.runtime.project,
        projectStore: context.runtime.projectStore,
        getSceneNodeCount: context.nodeCount,
        getZoom: context.zoom,
        manualPresentation: true,
        needsSpatialWorldData: () => context.viewMode() !== 'flat',
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
            const settings = mapSettings.value;
            const regions = FOXHOLE_MAP_REGIONS.filter(region => settings.regionKeys.includes(region.key));
            const selection = regions.map(region => region.key).sort().join('|');
            const viewpointCamera = consumeViewpointRegionCamera(context.runtime, selection);
            if (settings.enabled && regions.length && mode !== 'flat' && selection !== lastSpatialRegion) {
                lastSpatialRegion = selection;
                if (!viewpointCamera) {
                    const camera = resolveFoxholeMapFitCamera(getFoxholeMapActiveBounds({ ...settings, background: false }), context.app.screen);
                    context.cameraTo(camera.position, camera.scale);
                }
            }
            if (!settings.enabled || !regions.length || mode === 'flat') lastSpatialRegion = null;
            world.sync({ view, mode, deltaMS, wind: context.wind?.(), settings, regions: regions.map(region => ({
                id: regionIdForKey(region.key), position: getFoxholeRegionPosition(region), warState: plugin.getSpatialWarState(region.key),
            })) });
            roadTour?.update(deltaMS);
        },
        spatialGroundVisible() {
            const settings = mapSettings.value;
            // Selected regions own the ground even while loading or hidden.
            // Disabling Terrain must not reveal the editor's camera-following floor.
            return selectedSpatialRegions({ ...settings, mode: context.viewMode() }).length === 0;
        },
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
                'foxhole-map-live-icons', 'foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels']);
            const pixelScale = context.zoom();
            const summaries = new Set(['foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels']);
            return root.children.filter(child => child !== root.mask && (context.viewMode() !== '3d' || child.label !== 'foxhole-map-background') && (!world.active || !['foxhole-map-regions', 'foxhole-map-background'].includes(child.label))).map(content => ({
                content, billboard: billboardLabels.has(content.label), billboardElevation: context.viewMode() === '3d' && billboardLabels.has(content.label) ? (x: number, y: number) => Math.max(0, world.sampleGround(x, y) ?? 0) : undefined, screenSizedBillboards: context.viewMode() === '3d' && billboardLabels.has(content.label) && !summaries.has(content.label), hoverable: content.label === 'foxhole-map-live-icons', pixelScale, clip,
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
            roadTour?.destroy();
            if (plannerRoadTourActions.value === roadTour) {
                plannerRoadTourActions.value = null;
                plannerRoadTourStatus.value = { ...plannerRoadTourStatus.value, attached: false, canRun: false, canShake: false, shaking: false };
            }
            world.destroy();
            active.value = false;
            plugin.destroy();
            context.suppressGrid(false);
        },
    };
}
