import { computed, shallowRef } from 'vue';
import type { NixieSceneV2CanvasContributionContext, NixieSceneV2CanvasContribution } from '#nixie/plugins/nixie/scene-v2/canvas-contributions.ts';
import { readFoxholeMapSettings } from './map-settings.ts';
import { getFoxholeMapRegionBillboardGroups } from './map/region-annotations.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { getFoxholeMapActiveBounds, FoxholeMapViewportPlugin } from './map/controller.ts';

/** Reuse the complete War map on the ECS-owned viewport; no copied scene graph. */
export function createFoxholeSceneMapCanvas(context: NixieSceneV2CanvasContributionContext): NixieSceneV2CanvasContribution {
    const active = shallowRef(true);
    const settingsStore = useNixieSettingsStore();
    const plugin = new FoxholeMapViewportPlugin(context.viewport, {
        viewport: context.viewport,
        project: context.runtime.project,
        projectStore: context.runtime.projectStore,
        getSceneNodeCount: context.nodeCount,
        getZoom: context.zoom,
        manualPresentation: true,
        session: {
            appRef: shallowRef(context.app),
            sceneLayerRef: shallowRef(context.before),
            sceneViewActive: active,
            federatedHitTestingPaused: computed(context.interacting),
            pointerTrackerRef: { value: { pointer: computed(() => ({ world: context.pointer() })) } },
            setGridOverlayRenderingSuppressed: context.suppressGrid,
            cameraTo: options => { if (options?.position) context.cameraTo(options.position, options.scale); },
        },
    });
    return {
        documentRendererIds: ['planning-map', 'planning-grid'],
        ownsViewportConstraints: true,
        updatePresentation: () => plugin.updatePresentation(),
        hoverPresentation: (source, point) => plugin.hoverPresentation(source, point),
        get root() { return plugin.presentationRoot; },
        navigationBounds() {
            const settings = readFoxholeMapSettings(context.runtime.projectStore.settings, id => settingsStore.getValue(id));
            if (context.viewMode() === '3d' || !settings.enabled || !settings.background || !settings.lockCameraToMap) return null;
            const bounds = getFoxholeMapActiveBounds(settings);
            return { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom };
        },
        spatialLayers() {
            const root = plugin.presentationRoot;
            if (!root?.visible || root.destroyed) return [];
            const settings = readFoxholeMapSettings(context.runtime.projectStore.settings, id => settingsStore.getValue(id));
            const clip = settings.cropEnabled && settings.cropWidth > 0 && settings.cropHeight > 0
                ? { minX: settings.cropX, minY: settings.cropY, maxX: settings.cropX + settings.cropWidth, maxY: settings.cropY + settings.cropHeight }
                : undefined;
            const billboardLabels = new Set(['foxhole-map-labels', 'foxhole-map-major-labels', 'foxhole-map-minor-labels',
                'foxhole-map-live-icons', 'foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels']);
            const pixelScale = context.zoom();
            const summaries = new Set(['foxhole-map-victory-base-badges', 'foxhole-map-casualty-labels']);
            return root.children.filter(child => child !== root.mask && (context.viewMode() !== '3d' || child.label !== 'foxhole-map-background')).map(content => ({
                content, billboard: billboardLabels.has(content.label), hoverable: content.label === 'foxhole-map-live-icons', pixelScale, clip,
                billboardGroups: context.viewMode() === '3d' && summaries.has(content.label) ? getFoxholeMapRegionBillboardGroups(content) : undefined,
            }));
        },
        worldBounds() {
            const settings = readFoxholeMapSettings(context.runtime.projectStore.settings, id => settingsStore.getValue(id));
            if (!settings.enabled) return null;
            const bounds = getFoxholeMapActiveBounds(settings);
            return { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom };
        },
        destroy() {
            active.value = false;
            plugin.destroy();
            context.suppressGrid(false);
        },
    };
}
