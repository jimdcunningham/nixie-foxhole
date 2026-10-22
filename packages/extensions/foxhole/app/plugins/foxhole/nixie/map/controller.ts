import * as PIXI from 'pixi.js';
import { useRuntimeConfig } from '#imports';
import { Plugin } from '#nixie/utils/nixie-pixi-viewport.ts';
import type { Viewport } from 'pixi-viewport';
import { computed, watch } from 'vue';
import type { WatchStopHandle } from 'vue';
import { createFoxholeAssetsBaseUrl } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import {
    getFoxholeMapAssistantHighlightsRef,
} from '#foxhole/plugins/foxhole/nixie/map/assistant-highlights.ts';
import {
    getFoxholeMapPlaybackPreviewRef,

} from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import type { FoxholeMapPlaybackPreviewState, FoxholePlaybackPreviewReportEntry } from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import { foxholeWarApiStorage } from '#foxhole/plugins/foxhole/nixie/map/storage.ts';
import type { FoxholeMapContext } from './context.ts';
import { FoxholeMapRenderer } from './renderer.ts';
import { FoxholeMapTexturePool } from './texture-leases.ts';
import { FoxholeRealtimeSocket } from './live-socket.ts';
import { resolveFoxholeRealtimeSocketEndpoint } from './realtime-origin.ts';
import type { NixieViewportPluginContext } from '#nixie/plugins/nixie/registry/types.ts';
import {
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_HEIGHT,
    FOXHOLE_REGION_WIDTH,
    FOXHOLE_WORLD_BACKGROUND_SIZE,
    getFoxholeRegionPosition,
} from './constants.ts';
import { buildFoxholePublishedMapFallbackCache } from './data.ts';
import {
    clearFoxholeMapSearchCache,
    publishFoxholeMapSearchCache,
} from './search.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { resolveNxAssetIconTileTheme, resolveNxCanvasLabelTheme } from '#nixie/utils/nx-design-tokens.ts';
import { NIXIE_COLOR_THEME_SETTING_ID, resolveNxTheme } from '#nixie/utils/nx-theme.ts';
import {
    resolveFoxholeMapFitCamera,
    shouldFitFoxholeMapOnEnable,
} from './camera-fit.ts';

const FOXHOLE_MAP_FONT_LOADS = [
    '400 16px Jost',
    '600 16px Jost',
    '700 16px Jost',
] as const;

const mapTexturePool = new FoxholeMapTexturePool<PIXI.Texture>(
    url => PIXI.Assets.load(url.startsWith('blob:') ? { src: url, parser: 'texture' } : url),
    url => PIXI.Assets.unload(url),
);

let foxholeMapFontLoad: Promise<void> | null = null;

function ensureFoxholeMapFontLoaded(): Promise<void> {
    if (foxholeMapFontLoad) {
        return foxholeMapFontLoad;
    }

    if (typeof document === 'undefined' || !document.fonts) {
        return Promise.resolve();
    }

    foxholeMapFontLoad = Promise.all(
        FOXHOLE_MAP_FONT_LOADS.map(font => document.fonts.load(font)),
    ).then(() => undefined).catch(() => undefined);

    return foxholeMapFontLoad;
}

interface FoxholeMapCacheEntry {
    reports?: FoxholePlaybackPreviewReportEntry;
    labels?: {
        version?: number;
        items?: any[];
    };
    icons?: {
        version?: number;
        items?: any[];
    };
}

interface FoxholeMapWarCacheEntry {
    shardId?: string;
    warId?: string;
    warNumber?: number;
    warStart?: number;
    conquestEndTime?: number | null;
    resistanceStart?: number;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns?: number;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
}

interface FoxholeMapServerUpdate extends FoxholeMapWarCacheEntry {
    reports?: Record<string, FoxholeMapCacheEntry['reports']>;
    labels?: Record<string, FoxholeMapCacheEntry['labels']>;
    icons?: Record<string, FoxholeMapCacheEntry['icons']>;
}

export interface FoxholeMapActiveBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
}

export function getFoxholeMapActiveBounds(
    settings: ReturnType<typeof readFoxholeMapSettings>,
): FoxholeMapActiveBounds {
    if (settings.background) {
        const halfWidth = FOXHOLE_WORLD_BACKGROUND_SIZE.width / 2;
        const halfHeight = FOXHOLE_WORLD_BACKGROUND_SIZE.height / 2;
        return {
            left: -halfWidth,
            right: halfWidth,
            top: -halfHeight,
            bottom: halfHeight,
            width: FOXHOLE_WORLD_BACKGROUND_SIZE.width,
            height: FOXHOLE_WORLD_BACKGROUND_SIZE.height,
        };
    }

    const selectedRegions = new Set(settings.regionKeys);
    const regions = selectedRegions.size > 0
        ? FOXHOLE_MAP_REGIONS.filter(region => selectedRegions.has(region.key))
        : [...FOXHOLE_MAP_REGIONS];

    if (!regions.length) {
        const halfWidth = FOXHOLE_REGION_WIDTH / 2;
        const halfHeight = FOXHOLE_REGION_HEIGHT / 2;
        return {
            left: -halfWidth,
            right: halfWidth,
            top: -halfHeight,
            bottom: halfHeight,
            width: FOXHOLE_REGION_WIDTH,
            height: FOXHOLE_REGION_HEIGHT,
        };
    }

    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const region of regions) {
        const position = getFoxholeRegionPosition(region);
        left = Math.min(left, position.x - (FOXHOLE_REGION_WIDTH / 2));
        right = Math.max(right, position.x + (FOXHOLE_REGION_WIDTH / 2));
        top = Math.min(top, position.y - (FOXHOLE_REGION_HEIGHT / 2));
        bottom = Math.max(bottom, position.y + (FOXHOLE_REGION_HEIGHT / 2));
    }

    return {
        left,
        right,
        top,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

/** The map needs a canvas surface, not the V1 board implementation. */
export interface FoxholeMapViewportContext extends Omit<NixieViewportPluginContext, 'session'> {
    getSceneNodeCount?: () => number;
    getZoom?: () => number;
    manualPresentation?: boolean;
    needsSpatialWorldData?(): boolean;
    session: Pick<NixieViewportPluginContext['session'], 'appRef' | 'sceneLayerRef' | 'sceneViewActive' | 'federatedHitTestingPaused' | 'cameraTo' | 'setGridOverlayRenderingSuppressed'> & {
        pointerTrackerRef: { readonly value: { pointer: { readonly value: { world: PIXI.PointData | null; }; }; } | null; };
    };
}

export class FoxholeMapViewportPlugin extends Plugin {
    private static readonly DEFAULT_MIN_SCALE = 0.0025;
    private static readonly DEFAULT_MAX_SCALE = 2;
    private static readonly BACKGROUND_FILL_OVERSCAN_FACTOR = 1.0005;
    private static readonly NO_BACKGROUND_FIT_REGION_PADDING_FACTOR = 0.15;
    private static readonly NO_BACKGROUND_FIT_BOUNDS_PADDING_FACTOR = 0.045;

    private renderer: FoxholeMapRenderer | null = null;
    private readonly textureOwner = mapTexturePool.createOwner();
    private syncPending = false;
    private cacheLoadPromise: Promise<void> | null = null;
    private cachedMaps: Record<string, FoxholeMapCacheEntry> = {};
    private warData: FoxholeMapWarCacheEntry | null = null;
    private apiSocket: FoxholeRealtimeSocket<ReturnType<FoxholeMapViewportPlugin['createClientRequest']>, FoxholeMapServerUpdate> | null = null;
    private lastRequestSignature = '';
    private forceFullLiveRefreshOnNextPacket = false;
    private liveDataRevision = 0;
    private appliedLiveDataRevision = -1;
    private lastSettingsSignature = '';
    private stopSettingsWatch: WatchStopHandle | null = null;
    private stopPlaybackPreviewWatch: WatchStopHandle | null = null;
    private stopAssistantHighlightsWatch: WatchStopHandle | null = null;
    private stopPointerInteractionWatch: WatchStopHandle | null = null;
    private stopSceneViewWatch: WatchStopHandle | null = null;
    private playbackPreviewWarData: FoxholeMapWarCacheEntry | null = null;
    private lastConstraintSignature = '';
    private constraintsApplied = false;
    private fitMapOnNextSync = false;
    private rendererCreation: Promise<void> | null = null;
    private isDestroyed = false;
    private readonly pluginContext: FoxholeMapViewportContext;
    private readonly warAPIStorage = foxholeWarApiStorage;
    private readonly playbackPreviewRef = getFoxholeMapPlaybackPreviewRef();
    private readonly assistantHighlightsRef = getFoxholeMapAssistantHighlightsRef();
    private readonly settingsStore = useNixieSettingsStore();
    private readonly mapSettings = computed(() => readFoxholeMapSettings(
        this.pluginContext.projectStore.settings,
        settingId => this.settingsStore.getValue(settingId),
    ));

    readonly updatePresentation = (): void => {
        if (!this.readMapSettings().enabled || !this.pluginContext.session.sceneViewActive.value) {
            return;
        }

        this.renderer?.tick();
        this.refreshViewportConstraints();
    };

    constructor(parent: Viewport, pluginContext: FoxholeMapViewportContext) {
        super(parent);
        this.pluginContext = pluginContext;
        void this.ensureRenderer();
        if (!pluginContext.manualPresentation) this.pluginContext.session.appRef.value?.ticker.add(this.updatePresentation);
        this.stopSettingsWatch = watch(
            () => ({ ...this.readMapSettings(), spatialWorldData: this.pluginContext.needsSpatialWorldData?.() === true }),
            (settings, previousSettings) => {
                const project = this.pluginContext.project ?? this.pluginContext.projectStore.project;
                const sceneNodeCount = this.pluginContext.getSceneNodeCount?.() ?? project?.getSelectableNodeIds({
                    includeHidden: true,
                    includeLocked: true,
                }).length;
                if (
                    typeof sceneNodeCount === 'number'
                    && shouldFitFoxholeMapOnEnable(previousSettings.enabled, settings.enabled, sceneNodeCount)
                ) {
                    this.fitMapOnNextSync = true;
                    this.refreshViewportConstraints(true);
                    this.fitMapToBoundsIfPending(settings);
                }
                void this.syncRenderer();
            },
            { deep: true },
        );
        this.stopPlaybackPreviewWatch = watch(
            this.playbackPreviewRef,
            () => {
                void this.syncRenderer();
            },
        );
        this.stopAssistantHighlightsWatch = watch(
            this.assistantHighlightsRef,
            state => {
                void this.ensureRenderer().then(() => {
                    if (!this.renderer) {
                        return;
                    }
                    if (!state?.entries.length) {
                        this.renderer.clearAssistantHighlights();
                        return;
                    }
                    this.renderer.setAssistantHighlights(state.entries);
                });
            },
            { deep: true },
        );
        this.stopPointerInteractionWatch = watch(
            () => this.pluginContext.session.federatedHitTestingPaused.value,
            () => {
                this.syncPointerInteractions();
            },
        );
        this.stopSceneViewWatch = watch(
            () => this.pluginContext.session.sceneViewActive.value,
            () => {
                this.syncViewportGridSuppression();
                this.refreshViewportConstraints(true);
                this.renderer?.sync();
                void this.syncRenderer();
            },
        );
        void this.ensureCacheLoaded();
        void this.syncRenderer();
    }

    hoverPresentation(source: PIXI.Container | null, point: PIXI.PointData): void {
        this.renderer?.hoverPresentation(source, point);
    }

    get presentationRoot(): PIXI.Container | null {
        return this.renderer?.root ?? null;
    }

    override update(): void {
        // Intentionally no-op. pixi-viewport invokes this frequently during camera
        // interaction, and running orchestration here caused heavy frame spikes.
    }

    override destroy(): void {
        this.isDestroyed = true;
        this.pluginContext.session.appRef.value?.ticker.remove(this.updatePresentation);
        this.stopSettingsWatch?.();
        this.stopSettingsWatch = null;
        this.stopPlaybackPreviewWatch?.();
        this.stopPlaybackPreviewWatch = null;
        this.stopAssistantHighlightsWatch?.();
        this.stopAssistantHighlightsWatch = null;
        this.stopPointerInteractionWatch?.();
        this.stopPointerInteractionWatch = null;
        this.stopSceneViewWatch?.();
        this.stopSceneViewWatch = null;
        this.disconnectLiveUpdates();
        this.resetViewportConstraints();
        clearFoxholeMapSearchCache();
        this.renderer?.clearAssistantHighlights();
        this.renderer?.destroy();
        this.renderer = null;
        void this.textureOwner.releaseAll().catch(() => {});
    }

    private async ensureRenderer(): Promise<void> {
        if (this.isDestroyed || this.renderer) {
            return;
        }

        if (this.rendererCreation) {
            return await this.rendererCreation;
        }

        const createRenderer = async (): Promise<void> => {
            const app = this.pluginContext.session.appRef.value;
            const sceneLayer = this.pluginContext.session.sceneLayerRef.value;
            if (!app || !sceneLayer?.parent) {
                return;
            }

            await ensureFoxholeMapFontLoaded();

            if (this.isDestroyed || this.renderer) {
                return;
            }

            const readyApp = this.pluginContext.session.appRef.value;
            const readySceneLayer = this.pluginContext.session.sceneLayerRef.value;
            const pointerTracker = this.pluginContext.session.pointerTrackerRef.value;
            if (!readyApp || !readySceneLayer?.parent) {
                return;
            }

            const world = readySceneLayer.parent;
            const runtimeConfig = useRuntimeConfig();
            const assetsBaseUrl = createFoxholeAssetsBaseUrl((runtimeConfig.app as { baseURL: string; }).baseURL);

            const context: FoxholeMapContext = {
                app: readyApp,
                viewport: this.parent,
                world,
                getProjectSettings: () => this.pluginContext.projectStore.settings,
                patchProjectSettings: (patch, reason) => this.pluginContext.projectStore.patchSettings(patch, reason),
                readMapSettings: () => ({ ...this.readMapSettings(), spatialWorldData: this.pluginContext.needsSpatialWorldData?.() === true }),
                getWarData: () => this.playbackPreviewWarData ?? this.warData,
                getPlaybackTimestamp: () => {
                    const preview = this.getActivePlaybackPreview();
                    if (!preview?.capturedAt) {
                        return null;
                    }

                    const parsed = Date.parse(preview.capturedAt);
                    return Number.isFinite(parsed) ? parsed : null;
                },
                getAssetsBaseUrl: () => assetsBaseUrl,
                getWorldPointer: () => pointerTracker?.pointer.value.world ?? null,
                getZoom: () => this.pluginContext.getZoom?.() ?? this.parent.scale.x,
                getCanvasLabelTheme: () => resolveNxCanvasLabelTheme(
                    resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as 'light' | 'dark' | 'system'),
                ),
                getAssetIconTileTheme: () => resolveNxAssetIconTileTheme(
                    resolveNxTheme(this.settingsStore.getValue(NIXIE_COLOR_THEME_SETTING_ID) as 'light' | 'dark' | 'system'),
                ),
                hasActiveSceneView: () => this.pluginContext.session.sceneViewActive.value,
                loadTexture: url => this.textureOwner.load(url),
                releaseTexture: url => this.textureOwner.release(url),
                releaseAllTextures: () => this.textureOwner.releaseAll(),
            };

            this.renderer = new FoxholeMapRenderer(context);
        };

        this.rendererCreation = createRenderer();
        try {
            await this.rendererCreation;
        } finally {
            this.rendererCreation = null;
        }
    }

    private async mountRendererIfNeeded(): Promise<void> {
        await this.ensureRenderer();
        const sceneLayer = this.pluginContext.session.sceneLayerRef.value;
        if (!this.renderer || !sceneLayer || this.renderer.isMounted) {
            return;
        }

        this.renderer.mount(sceneLayer);
        this.syncPointerInteractions();
    }

    private syncPointerInteractions(): void {
        this.renderer?.setPointerInteractionsEnabled(
            !this.pluginContext.session.federatedHitTestingPaused.value,
        );
    }

    private teardownRenderer(): void {
        this.syncPending = false;
        this.disconnectLiveUpdates();
        this.renderer?.teardown();
        this.lastSettingsSignature = '';
        this.appliedLiveDataRevision = -1;
        this.syncViewportGridSuppression();
        this.refreshViewportConstraints(true);
    }

    private syncViewportGridSuppression(): void {
        const settings = this.readMapSettings();
        const suppressGrid = settings.enabled
            && settings.background
            && this.pluginContext.session.sceneViewActive.value;
        this.pluginContext.session.setGridOverlayRenderingSuppressed(suppressGrid);
    }

    private async syncRenderer(): Promise<void> {
        if (this.isDestroyed || this.syncPending) {
            return;
        }

        const settings = this.readMapSettings();
        const settingsSignature = JSON.stringify(settings);
        const needsLiveData = this.needsLiveData(settings);
        this.syncViewportGridSuppression();
        if (!settings.enabled) {
            this.fitMapOnNextSync = false;
            this.teardownRenderer();
            return;
        }
        if (!this.pluginContext.session.sceneViewActive.value) {
            this.disconnectLiveUpdates();
            this.renderer?.sync();
            return;
        }

        await this.mountRendererIfNeeded();
        if (!this.renderer) {
            return;
        }

        await this.ensureCacheLoaded();
        if (this.isDestroyed || !this.renderer) return;

        if (!this.renderer.hasInitialized) {
            this.syncPending = true;
            try {
                await this.renderer.ensureInitialized();
                this.lastSettingsSignature = settingsSignature;
            } finally {
                this.syncPending = false;
            }
        }

        if (this.isDestroyed || !this.renderer) return;
        if (settingsSignature !== this.lastSettingsSignature) {
            this.renderer.sync();
            this.lastSettingsSignature = settingsSignature;
        }

        const playbackPreview = this.getActivePlaybackPreview();
        if (playbackPreview) {
            this.disconnectLiveUpdates();
            if (needsLiveData) {
                await this.renderer.applyLiveData(this.buildPlaybackPreviewCache(playbackPreview));
            } else {
                this.renderer.clearLiveDisplayData();
            }
            this.appliedLiveDataRevision = -1;
            this.refreshViewportConstraints(true);
            this.fitMapToBoundsIfPending(settings);
            return;
        }

        this.playbackPreviewWarData = null;

        if (!needsLiveData) {
            this.disconnectLiveUpdates();
            this.renderer.clearLiveDisplayData();
            this.appliedLiveDataRevision = -1;
            this.refreshViewportConstraints(true);
            this.fitMapToBoundsIfPending(settings);
            return;
        }

        if (this.appliedLiveDataRevision !== this.liveDataRevision) {
            await this.renderer.applyLiveData(this.cachedMaps);
            this.appliedLiveDataRevision = this.liveDataRevision;
        }
        this.refreshViewportConstraints(true);
        this.fitMapToBoundsIfPending(settings);
        this.connectLiveUpdatesIfNeeded();
    }

    private fitMapToBoundsIfPending(settings: ReturnType<typeof readFoxholeMapSettings>): void {
        if (!this.fitMapOnNextSync) {
            return;
        }

        const project = this.pluginContext.project ?? this.pluginContext.projectStore.project;
        if (!project || (this.pluginContext.getSceneNodeCount?.() ?? project.getSelectableNodeIds({ includeHidden: true, includeLocked: true }).length) > 0) {
            this.fitMapOnNextSync = false;
            return;
        }

        if (this.parent.screenWidth < 2 || this.parent.screenHeight < 2) {
            return;
        }

        const camera = resolveFoxholeMapFitCamera(this.getActiveBounds(settings), {
            width: this.parent.screenWidth,
            height: this.parent.screenHeight,
        });
        this.fitMapOnNextSync = false;
        this.pluginContext.session.cameraTo({
            position: camera.position,
            scale: camera.scale,
            time: 0,
        });
    }

    private readMapSettings() {
        return this.mapSettings.value;
    }

    private async ensureCacheLoaded(): Promise<void> {
        if (this.cacheLoadPromise) {
            await this.cacheLoadPromise;
            return;
        }

        this.cacheLoadPromise = this.loadCachedMaps();
        try {
            await this.cacheLoadPromise;
        } finally {
            this.cacheLoadPromise = null;
        }
    }

    private async loadCachedMaps(): Promise<void> {
        const cachedMaps: Record<string, FoxholeMapCacheEntry> = buildFoxholePublishedMapFallbackCache();
        let warData: FoxholeMapWarCacheEntry | null = null;

        await this.warAPIStorage.iterate((value: unknown, key: string) => {
            if (key === 'war') {
                warData = (value as FoxholeMapWarCacheEntry | null) ?? null;
                return;
            }

            if (value && typeof value === 'object') {
                cachedMaps[key] = {
                    ...(cachedMaps[key] ?? {}),
                    ...(value as FoxholeMapCacheEntry),
                };
            }
        });

        if (this.isDestroyed) return;
        this.cachedMaps = cachedMaps;
        this.warData = warData;
        this.liveDataRevision += 1;
        publishFoxholeMapSearchCache(this.cachedMaps);
    }

    private updateCachedMap(
        key: string,
        value: FoxholeMapCacheEntry | FoxholeMapWarCacheEntry,
        options: { invalidateRenderer?: boolean; } = {},
    ): void {
        const invalidateRenderer = options.invalidateRenderer !== false;
        if (key === 'war') {
            this.warData = value as FoxholeMapWarCacheEntry;
            if (invalidateRenderer) {
                this.liveDataRevision += 1;
            }
            void this.warAPIStorage.setItem('war', this.warData);
            return;
        }

        const previous = this.cachedMaps[key] ?? {};
        const nextValue = {
            ...previous,
            ...value,
        } as FoxholeMapCacheEntry;
        this.cachedMaps[key] = nextValue;
        if (invalidateRenderer) {
            this.liveDataRevision += 1;
        }
        publishFoxholeMapSearchCache(this.cachedMaps);
        void this.warAPIStorage.setItem(key, nextValue);
    }

    private createClientRequest(): {
        shardId?: string;
        warId?: string;
        maps: Record<string, { labels?: number; icons?: number; }>;
        layers: {
            reports: boolean;
            labels: boolean;
            icons: boolean;
        };
        realtime: true;
    } {
        const settings = this.readMapSettings();
        const needsLiveLabels = this.needsLiveLabels(settings);
        const needsLiveIcons = this.needsLiveIcons(settings);
        const needsLiveReports = this.needsLiveReports(settings);
        const maps: Record<string, { labels?: number; icons?: number; }> = {};
        const regionKeys = settings.regionKeys.length > 0
            ? settings.regionKeys
            : FOXHOLE_MAP_REGIONS.map(region => region.key);

        for (const regionKey of regionKeys) {
            maps[regionKey] = {
                labels: this.cachedMaps[regionKey]?.labels?.version,
                icons: this.cachedMaps[regionKey]?.icons?.version,
            };
        }

        return {
            shardId: settings.shardId || undefined,
            warId: this.warData?.warId,
            maps,
            layers: {
                reports: needsLiveReports,
                labels: needsLiveLabels,
                icons: needsLiveIcons,
            },
            realtime: true,
        };
    }

    private getSocketEndpoint(): string {
        return resolveFoxholeRealtimeSocketEndpoint();
    }

    private connectLiveUpdatesIfNeeded(): void {
        if (this.isDestroyed || !this.pluginContext.session.sceneViewActive.value) return;
        const settings = this.readMapSettings();
        if (!settings.enabled || !this.needsLiveData(settings) || this.getActivePlaybackPreview()) {
            this.disconnectLiveUpdates();
            return;
        }

        const request = this.createClientRequest();
        const signature = JSON.stringify(request);
        if (!this.apiSocket) {
            this.apiSocket = new FoxholeRealtimeSocket({
                endpoint: this.getSocketEndpoint(),
                onUpdate: data => {
                    void this.handleServerUpdate(data);
                },
                onOpen: () => {
                    // Keep cached live data visible until a fresh packet arrives.
                    // Clearing here causes a visible reset during service startup.
                    this.forceFullLiveRefreshOnNextPacket = true;
                },
            });
            this.apiSocket.connect();
            this.apiSocket.sendRequest(request);
            this.lastRequestSignature = signature;
            return;
        }

        if (signature !== this.lastRequestSignature || !this.apiSocket.connected) {
            this.lastRequestSignature = signature;
            this.apiSocket.sendRequest(request);
        }
    }

    private disconnectLiveUpdates(): void {
        if (this.apiSocket) {
            this.apiSocket.close();
            this.apiSocket = null;
            this.lastRequestSignature = '';
            this.forceFullLiveRefreshOnNextPacket = false;
        }
    }

    private async handleServerUpdate(serverData: FoxholeMapServerUpdate): Promise<void> {
        if (!serverData) {
            return;
        }

        let shouldApplyRenderer = false;
        let shouldApplyFullRenderer = false;
        const dirtyRegionKeys = new Set<string>();

        const nextWarData: FoxholeMapWarCacheEntry = {
            shardId: serverData.shardId ?? this.warData?.shardId,
            warId: serverData.warId ?? this.warData?.warId,
            warNumber: serverData.warNumber ?? this.warData?.warNumber,
            warStart: serverData.warStart ?? this.warData?.warStart,
            conquestEndTime: serverData.conquestEndTime ?? this.warData?.conquestEndTime,
            resistanceStart: serverData.resistanceStart ?? this.warData?.resistanceStart,
            scheduledConquestEndTime: serverData.scheduledConquestEndTime ?? this.warData?.scheduledConquestEndTime,
            requiredVictoryTowns: serverData.requiredVictoryTowns ?? this.warData?.requiredVictoryTowns,
            shortRequiredVictoryTowns: serverData.shortRequiredVictoryTowns ?? this.warData?.shortRequiredVictoryTowns,
            winner: serverData.winner ?? this.warData?.winner,
        };
        const warDataChanged = JSON.stringify(nextWarData) !== JSON.stringify(this.warData ?? {});
        if (warDataChanged) {
            this.updateCachedMap('war', nextWarData);
            shouldApplyRenderer = true;
            shouldApplyFullRenderer = true;
        }

        for (const [regionKey, labels] of Object.entries(serverData.labels ?? {})) {
            this.updateCachedMap(regionKey, { labels });
            shouldApplyRenderer = true;
            dirtyRegionKeys.add(regionKey);
        }
        for (const [regionKey, icons] of Object.entries(serverData.icons ?? {})) {
            this.updateCachedMap(regionKey, { icons });
            shouldApplyRenderer = true;
            dirtyRegionKeys.add(regionKey);
        }
        for (const [regionKey, reports] of Object.entries(serverData.reports ?? {})) {
            this.updateCachedMap(regionKey, { reports });
            shouldApplyRenderer = true;
            dirtyRegionKeys.add(regionKey);
        }

        if (this.getActivePlaybackPreview()) {
            this.forceFullLiveRefreshOnNextPacket = true;
            this.appliedLiveDataRevision = -1;
            return;
        }

        if (shouldApplyRenderer && this.renderer?.hasInitialized) {
            const didFullApply = shouldApplyFullRenderer || this.forceFullLiveRefreshOnNextPacket || dirtyRegionKeys.size === 0;
            if (didFullApply) {
                await this.renderer.applyLiveData(this.cachedMaps);
            } else {
                await this.renderer.applyLiveDataForRegions(this.cachedMaps, dirtyRegionKeys);
            }
            this.forceFullLiveRefreshOnNextPacket = false;
            this.appliedLiveDataRevision = this.liveDataRevision;
        }
    }

    private needsLiveLabels(settings: ReturnType<typeof readFoxholeMapSettings>): boolean {
        return settings.voronoi || settings.faction || settings.frontline || settings.frontAlt || settings.majorLabels || settings.minorLabels;
    }

    getSpatialWarState(regionKey: string) {
        const preview = this.getActivePlaybackPreview();
        return preview ? preview.icons?.[regionKey] ?? null : this.cachedMaps[regionKey]?.icons ?? null;
    }

    private needsLiveIcons(settings: ReturnType<typeof readFoxholeMapSettings>): boolean {
        return settings.icons || (settings.enabled && settings.regionKeys.length > 0 && this.pluginContext.needsSpatialWorldData?.() === true);
    }

    private needsLiveReports(settings: ReturnType<typeof readFoxholeMapSettings>): boolean {
        return settings.hotspots || settings.frontline || settings.frontAlt || settings.hourlyCasualties || settings.totalCasualties;
    }

    private needsLiveData(settings: ReturnType<typeof readFoxholeMapSettings>): boolean {
        return this.needsLiveLabels(settings) || this.needsLiveIcons(settings) || this.needsLiveReports(settings);
    }

    private getActivePlaybackPreview(): FoxholeMapPlaybackPreviewState | null {
        const playbackPreview = this.playbackPreviewRef.value;
        if (!playbackPreview) {
            return null;
        }

        const shardId = String(this.readMapSettings().shardId ?? '').trim();
        if (playbackPreview.shardId && shardId && playbackPreview.shardId !== shardId) {
            return null;
        }

        return playbackPreview;
    }

    private buildPlaybackPreviewCache(preview: FoxholeMapPlaybackPreviewState): Record<string, FoxholeMapCacheEntry> {
        const previewCache: Record<string, FoxholeMapCacheEntry> = buildFoxholePublishedMapFallbackCache();
        const settings = this.readMapSettings();
        const includeLabels = this.needsLiveLabels(settings);
        const includeIcons = this.needsLiveIcons(settings);
        const includeReports = this.needsLiveReports(settings);

        if (includeReports) {
            for (const [regionKey, reports] of Object.entries(preview.reports ?? {})) {
                previewCache[regionKey] = {
                    ...(previewCache[regionKey] ?? {}),
                    reports: reports
                        ? {
                            version: reports.version ?? undefined,
                            totalEnlistments: reports.totalEnlistments ?? undefined,
                            factions: reports.factions ?? undefined,
                            dayOfWar: reports.dayOfWar ?? undefined,
                        }
                        : undefined,
                };
            }
        }

        if (includeLabels) {
            for (const [regionKey, labels] of Object.entries(preview.labels ?? {})) {
                previewCache[regionKey] = {
                    ...(previewCache[regionKey] ?? {}),
                    labels: labels
                        ? {
                            version: labels.version ?? undefined,
                            items: Array.isArray(labels.items) ? labels.items : [],
                        }
                        : undefined,
                };
            }
        }

        if (includeIcons) {
            for (const [regionKey, icons] of Object.entries(preview.icons ?? {})) {
                previewCache[regionKey] = {
                    ...(previewCache[regionKey] ?? {}),
                    icons: icons
                        ? {
                            version: icons.version ?? undefined,
                            items: Array.isArray(icons.items) ? icons.items : [],
                        }
                        : undefined,
                };
            }
        }

        this.playbackPreviewWarData = {
            shardId: preview.shardId,
            warId: preview.warId ?? undefined,
            warNumber: preview.warNumber ?? undefined,
            warStart: preview.warStart ?? undefined,
            conquestEndTime: preview.conquestEndTime ?? undefined,
            resistanceStart: preview.resistanceStart ?? undefined,
            scheduledConquestEndTime: preview.scheduledConquestEndTime ?? undefined,
            requiredVictoryTowns: preview.requiredVictoryTowns ?? undefined,
            shortRequiredVictoryTowns: preview.shortRequiredVictoryTowns ?? undefined,
            winner: preview.winner ?? undefined,
        };

        return previewCache;
    }

    private refreshViewportConstraints(force = false): void {
        const settings = this.readMapSettings();
        const signature = JSON.stringify({
            enabled: settings.enabled,
            sceneViewActive: this.pluginContext.session.sceneViewActive.value,
            background: settings.background,
            regionKeys: settings.regionKeys,
            lockCameraToMap: settings.lockCameraToMap,
            screenWidth: this.parent.screenWidth,
            screenHeight: this.parent.screenHeight,
        });
        if (!force && signature === this.lastConstraintSignature) {
            return;
        }

        this.lastConstraintSignature = signature;

        if (!settings.enabled) {
            this.resetViewportConstraints();
            return;
        }
        // The shared viewport is hidden for document and spreadsheet tabs. Keep
        // its map zoom limits until the scene returns so a low map zoom is not
        // clamped to the generic scene minimum during the tab transition.
        if (!this.pluginContext.session.sceneViewActive.value) {
            return;
        }

        const activeBounds = this.getActiveBounds(settings);
        const zoomConstraintActiveBounds = settings.background
            ? this.getActiveBounds({
                ...settings,
                background: false,
            })
            : activeBounds;
        const zoomConstraintBounds = this.getNoBackgroundFitBounds(zoomConstraintActiveBounds);
        const viewportWidth = Math.max(1, this.parent.screenWidth);
        const viewportHeight = Math.max(1, this.parent.screenHeight);
        const fitScaleX = viewportWidth / Math.max(1, zoomConstraintBounds.width);
        const fitScaleY = viewportHeight / Math.max(1, zoomConstraintBounds.height);
        const noBackgroundMinScale = Math.min(fitScaleX, fitScaleY);
        const backgroundFillMinScale = settings.background
            ? Math.max(
                viewportWidth / Math.max(1, activeBounds.width),
                viewportHeight / Math.max(1, activeBounds.height),
            ) * FoxholeMapViewportPlugin.BACKGROUND_FILL_OVERSCAN_FACTOR
            : noBackgroundMinScale;
        const minScale = settings.background
            ? Math.max(noBackgroundMinScale, backgroundFillMinScale)
            : noBackgroundMinScale;
        const maxScale = Math.max(FoxholeMapViewportPlugin.DEFAULT_MAX_SCALE, minScale);

        this.parent.clampZoom({
            minScale,
            maxScale,
        });

        if (settings.lockCameraToMap && settings.background) {
            this.parent.clamp({
                left: activeBounds.left,
                right: activeBounds.right,
                top: activeBounds.top,
                bottom: activeBounds.bottom,
                underflow: 'none',
            });
        } else if (this.constraintsApplied) {
            this.parent.plugins.remove('clamp');
        }
        this.constraintsApplied = true;
    }

    private resetViewportConstraints(): void {
        if (!this.constraintsApplied) {
            return;
        }

        this.parent.plugins.remove('clamp');
        this.parent.clampZoom({
            minScale: FoxholeMapViewportPlugin.DEFAULT_MIN_SCALE,
            maxScale: FoxholeMapViewportPlugin.DEFAULT_MAX_SCALE,
        });
        this.constraintsApplied = false;
    }

    private getActiveBounds(settings: ReturnType<typeof readFoxholeMapSettings>): FoxholeMapActiveBounds {
        return getFoxholeMapActiveBounds(settings);
    }

    private getNoBackgroundFitBounds(
        activeBounds: FoxholeMapActiveBounds,
    ): FoxholeMapActiveBounds {
        const horizontalPadding = Math.max(
            FOXHOLE_REGION_WIDTH * FoxholeMapViewportPlugin.NO_BACKGROUND_FIT_REGION_PADDING_FACTOR,
            activeBounds.width * FoxholeMapViewportPlugin.NO_BACKGROUND_FIT_BOUNDS_PADDING_FACTOR,
        );
        const verticalPadding = Math.max(
            FOXHOLE_REGION_HEIGHT * FoxholeMapViewportPlugin.NO_BACKGROUND_FIT_REGION_PADDING_FACTOR,
            activeBounds.height * FoxholeMapViewportPlugin.NO_BACKGROUND_FIT_BOUNDS_PADDING_FACTOR,
        );

        return {
            left: activeBounds.left - horizontalPadding,
            right: activeBounds.right + horizontalPadding,
            top: activeBounds.top - verticalPadding,
            bottom: activeBounds.bottom + verticalPadding,
            width: activeBounds.width + (horizontalPadding * 2),
            height: activeBounds.height + (verticalPadding * 2),
        };
    }
}
