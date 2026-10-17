import * as PIXI from 'pixi.js';
import Voronoi from 'voronoi';
import { polygon, featureCollection } from '@turf/helpers';
import intersect from '@turf/intersect';
import type { FoxholeMapContext } from './context.ts';
import { canvasHoverPopover, hideCanvasHoverPopover, moveCanvasHoverPopover, showCanvasHoverPopover } from '#nixie/plugins/nixie/board/utils/canvas-hover-popover.ts';
import {
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    FOXHOLE_MAP_ICONS,
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_HEIGHT,
    FOXHOLE_REGION_POLYGON,
    FOXHOLE_REGION_WIDTH,
    FOXHOLE_WORLD_BACKGROUND_SIZE,
    getFoxholeRegionPosition,
    resolveFoxholeMapActiveRegions,
    resolveFoxholeMapIconUrl,

} from './constants.ts';
import type { FoxholeMapRegionRecord } from './constants.ts';
import { getFoxholeMapModStore } from './mod-store.ts';
import { drawFoxholeMapHeatCircle } from './heat-geometry.ts';

type FoxholeMapSettingsSnapshot = ReturnType<FoxholeMapContext['readMapSettings']>;
type FoxholeFrontlineFactionTeamId = 'COLONIALS' | 'WARDENS';
type FoxholeFrontlineTeamId = FoxholeFrontlineFactionTeamId | 'NONE';
type FoxholeFrontlineSegmentKind = 'contested' | 'neutralized';

const FOXHOLE_GRID_CELL_SIZE = 125 * 32;
const FOXHOLE_GRID_LABEL_SCREEN_PADDING = 36;
const FOXHOLE_MAP_FLAG_IS_VICTORY_BASE = 0x01;
const FOXHOLE_MAP_FLAG_IS_SCORCHED = 0x10;
const FOXHOLE_MAP_SCORCHED_TINT = 0x9a4e52;

type FoxholeMapTextureLayerKey
    = | 'roads'
        | 'roads_tiers'
        | 'rdz'
        | 'dark_rdz'
        | 'glaciers'
        | 'bulwark'
        | 'rail_bridge'
        | 'rocks'
        | 'underwater_rocks_stripes';

const FOXHOLE_MAP_TEXTURE_LAYER_DEFINITIONS: ReadonlyArray<{
    key: FoxholeMapTextureLayerKey;
    directory: string;
}> = [
    { key: 'roads', directory: 'RoadsSingle' },
    { key: 'roads_tiers', directory: 'RoadsMulti' },
    { key: 'rdz', directory: 'RDZ' },
    { key: 'dark_rdz', directory: 'DarkRDZ' },
    { key: 'glaciers', directory: 'Glaciers' },
    { key: 'bulwark', directory: 'Bulwark' },
    { key: 'rail_bridge', directory: 'RailBridge' },
    { key: 'rocks', directory: 'Rocks' },
    { key: 'underwater_rocks_stripes', directory: 'UnderWaterRocksStripes' },
] as const;

interface FoxholeMapServerLayer<TItem = Record<string, any>> {
    version?: number;
    items?: TItem[];
}

interface FoxholeMapLabelData {
    x: number;
    y: number;
    text: string;
    mapMarkerType?: string;
    teamId?: string;
    capturedTimestamp?: number;
}

interface FoxholeMapReportData {
    version?: number | null;
    totalEnlistments?: number | null;
    factions?: Record<string, {
        totalHourlyCasualties?: number | null;
        totalCasualties?: number | null;
    }>;
    dayOfWar?: number | null;
}

interface FoxholeRegionHeatAnchor {
    x: number;
    y: number;
    weight: number;
}

interface FoxholeRegionHeatProjection {
    point: [number, number];
    distance: number;
    kind: FoxholeFrontlineSegmentKind;
}

interface FoxholeRegionHeatCandidate {
    anchorX: number;
    anchorY: number;
    score: number;
}

interface FoxholeMapServerRegionData {
    reports?: FoxholeMapReportData;
    labels?: FoxholeMapServerLayer<FoxholeMapLabelData>;
    icons?: FoxholeMapServerLayer<{
        x: number;
        y: number;
        iconType: string | number;
        teamId?: string;
        flags?: number;
    }>;
}

interface FoxholeLiveIconContainer extends PIXI.Container {
    data?: {
        iconType: string | number;
        teamId?: string;
        flags?: number;
    };
    sprite?: PIXI.Sprite;
    teamBackground?: PIXI.Graphics;
}

interface FoxholeVoronoiCell {
    key: string;
    points: number[][];
    teamId?: string;
    capturedTimestamp?: number;
}

interface FoxholeFrontlineSegment {
    start: number[];
    end: number[];
    kind: FoxholeFrontlineSegmentKind;
    casualtyIntensity: number;
    capturedTimestamp?: number;
}

interface FoxholeFrontlineWorldCell {
    key: string;
    regionKey: string;
    points: number[][];
    teamId?: string;
    casualtyIntensity: number;
    capturedTimestamp?: number;
}

interface FoxholeFrontlineRenderPath {
    centerline: number[][];
    closed: boolean;
}

interface FoxholeFrontlineSegmentEntry extends FoxholeFrontlineSegment {
    regionKey: string;
    teamId: FoxholeFrontlineTeamId;
}

interface FoxholeMapRegionView {
    region: FoxholeMapRegionRecord;
    container: PIXI.Container;
    sprite: PIXI.Sprite;
    textureLayers: Partial<Record<FoxholeMapTextureLayerKey, PIXI.Sprite>>;
    textureSignature: string;
    overlaySignature: string;
    textureSyncPromise: Promise<void> | null;
    revealOrder: number;
    revealStartAt: number;
    border: PIXI.Graphics;
    label: PIXI.Text;
    victoryBaseBadge: PIXI.Container;
    victoryBaseBadgeBackground: PIXI.Graphics;
    victoryBaseBadgeSprite: PIXI.Sprite | null;
    casualtyLabel: PIXI.Container;
    casualtyLabelBackground: PIXI.Graphics;
    colonialCasualtyLabel: PIXI.Text;
    wardenCasualtyLabel: PIXI.Text;
    subregions: PIXI.Container;
    subregionHeatGraphics: PIXI.Graphics;
    subregionFillGraphics: PIXI.Graphics;
    subregionLineGraphics: PIXI.Graphics;
    voronoiCells: FoxholeVoronoiCell[];
    voronoiLayoutSignature: string;
    voronoiStyleSignature: string;
    voronoiRenderSignature: string;
    voronoiFillSignature?: string;
    activityHeatSignature: string;
    activityHeatIntensity: number;
    liveIcons: PIXI.Container;
    majorLabels: PIXI.Container;
    minorLabels: PIXI.Container;
    victoryBaseBadgeSignature: string;
    hasVictoryBaseBadge: boolean;
    casualtyLabelSignature: string;
    hasCasualtyLabelData: boolean;
    liveLabelsVersion: number | null;
    liveIconsVersion: number | null;
}

interface FoxholeGridStickyLabel {
    label: PIXI.Text;
    baseX: number;
    baseY: number;
}

interface FoxholeMapHoverTooltipData {
    iconName: string;
    categoryLabel: string;
    factionLabel: string | null;
    factionColor: number | null;
    isScorched: boolean;
    iconUrl: string | null;
    previewUrl: string | null;
}

type FoxholeRegionCasualtyLabelMode = 'hourly' | 'total';

export class FoxholeMapRenderer {
    readonly root = new PIXI.Container();
    private static readonly LIVE_OVERLAY_MAX_BASE_ZOOM = 1200;
    private static readonly GRID_MAX_BASE_ZOOM = 100;
    private static readonly FRONTLINE_RENDER_VERSION = 'frontline-mask-v2';
    private static readonly FRONTLINE_WORLD_THICKNESS = 500;
    private static readonly FRONTLINE_TEXTURE_RESOLUTION = 0.004;
    private static readonly FRONTLINE_BLUR_BASE_STRENGTH = 12;
    private static readonly FRONTLINE_BLUR_REFERENCE_ZOOM = 0.01;
    private static readonly FRONTLINE_BLUR_MIN_STRENGTH = 4;
    private static readonly FRONTLINE_BLUR_MAX_STRENGTH = 20;
    private static readonly INITIAL_REGION_BATCH_SIZE = 6;
    private static readonly REGION_REVEAL_STEP = 0.14;
    private static readonly REGION_REVEAL_STAGGER_MS = 10;
    private static readonly FACTION_RENDER_BUCKET_MS = 60000;
    private static readonly ACTIVITY_HEAT_PULSE_PERIOD_MS = 3400;

    private readonly background = new PIXI.Sprite();
    private readonly gridBackground = new PIXI.Graphics();
    private readonly grid = new PIXI.Container();
    private readonly gridLines = new PIXI.Graphics();
    private readonly gridSublines = new PIXI.Container();
    private readonly gridSublineLines = new PIXI.Graphics();
    private readonly gridColumnLabels: FoxholeGridStickyLabel[] = [];
    private readonly gridRowLabels: FoxholeGridStickyLabel[] = [];
    private readonly regions = new PIXI.Container();
    private readonly borders = new PIXI.Container();
    private readonly subregions = new PIXI.Container();
    private readonly frontlines = new PIXI.Container();
    private readonly frontlineSource = new PIXI.Container();
    private readonly frontlineSprite = new PIXI.Sprite();
    private readonly frontlineShadow = new PIXI.Graphics();
    private readonly frontlineGlow = new PIXI.Graphics();
    private readonly frontlineCore = new PIXI.Graphics();
    private readonly frontlineBlurFilter = new PIXI.BlurFilter({
        strength: FoxholeMapRenderer.FRONTLINE_BLUR_BASE_STRENGTH,
        quality: 3,
        kernelSize: 9,
    });

    private readonly labels = new PIXI.Container();
    private readonly victoryBaseBadges = new PIXI.Container();
    private readonly casualtyLabels = new PIXI.Container();
    private readonly majorLabels = new PIXI.Container();
    private readonly minorLabels = new PIXI.Container();
    private readonly liveIcons = new PIXI.Container();
    private readonly assistantHighlights = new PIXI.Container();
    private readonly assistantHighlightGraphics = new PIXI.Graphics();
    private assistantHighlightEntries: Array<{
        id: string;
        label: string;
        worldPosition: { x: number; y: number; };
    }> = [];

    private readonly cropMask = new PIXI.Graphics();
    private readonly regionViews: FoxholeMapRegionView[] = [];
    private readonly regionViewByKey = new Map<string, FoxholeMapRegionView>();
    private readonly iconTextureCache = new Map<string, Promise<PIXI.Texture>>();
    private readonly regionTextureCache = new Map<string, Promise<PIXI.Texture>>();
    private readonly pendingOverlayRegionKeys = new Set<string>();
    private readonly resistanceSuppressedFilter = new PIXI.ColorMatrixFilter();
    private readonly regionPolygon = polygon([[
        [0, FOXHOLE_REGION_HEIGHT / 2],
        [FOXHOLE_REGION_WIDTH / 4, 0],
        [FOXHOLE_REGION_WIDTH * 3 / 4, 0],
        [FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT / 2],
        [FOXHOLE_REGION_WIDTH * 3 / 4, FOXHOLE_REGION_HEIGHT],
        [FOXHOLE_REGION_WIDTH / 4, FOXHOLE_REGION_HEIGHT],
        [0, FOXHOLE_REGION_HEIGHT / 2],
    ]]);

    private missingRegionSyncPromise: Promise<void> | null = null;
    private initialized = false;
    private initializationEpoch = 0;
    private lastZoom = Number.NaN;
    private lastLabelIconScale = Number.NaN;
    private lastRegionLabelScale = Number.NaN;
    private backgroundVariant: 'dark' | 'light' | null = null;
    private liveData: Record<string, FoxholeMapServerRegionData> = {};
    private overlaySyncScheduled = false;
    private isViewportDragging = false;
    private pointerInteractionsEnabled = true;
    private frontlineLayoutSignature = '';
    private frontlineStyleSignature = '';
    private frontlineRenderSignature = '';
    private frontlineTexture: PIXI.RenderTexture | null = null;
    private frontlineRenderMode: 'default' | 'front-alt' | null = null;
    private frontlineSegments: FoxholeFrontlineSegment[] = [];
    private lastGridTargetPosition: { x: number; y: number; } | null = null;
    private lastViewportTopLeft: { x: number; y: number; } | null = null;
    private readonly presentationHoverData = new WeakMap<PIXI.Container, FoxholeMapHoverTooltipData>();
    private hoveredIconName: string | null = null;
    private hoveredTooltipData: FoxholeMapHoverTooltipData | null = null;
    private readonly structureHoverAssetByName: Readonly<Record<string, { categoryName: string; previewUrl: string | null; }>>;
    private readonly itemHoverAssetByName: Readonly<Record<string, { categoryName: string; previewUrl: string | null; }>>;
    private readonly mapModStore = getFoxholeMapModStore();
    private mapModUnsubscribe: (() => void) | null = null;
    private mapModRevision = '';

    constructor(private readonly context: FoxholeMapContext) {
        this.resistanceSuppressedFilter.matrix = [
            0.16445, 0.32285, 0.0627, 0, 0,
            0.16445, 0.32285, 0.0627, 0, 0,
            0.16445, 0.32285, 0.0627, 0, 0,
            0, 0, 0, 1, 0,
        ];
        this.structureHoverAssetByName = this.buildStructureHoverAssetByName();
        this.itemHoverAssetByName = this.buildItemHoverAssetByName();
        this.root.label = 'foxhole-map-root';
        this.root.sortableChildren = true;
        this.root.zIndex = -100;
        this.root.eventMode = 'passive';
        this.root.interactiveChildren = true;
        this.root.cullableChildren = false;

        this.background.label = 'foxhole-map-background';
        this.background.anchor.set(0.5);
        this.background.visible = false;
        this.background.width = FOXHOLE_WORLD_BACKGROUND_SIZE.width;
        this.background.height = FOXHOLE_WORLD_BACKGROUND_SIZE.height;
        this.background.eventMode = 'none';

        this.gridBackground.label = 'foxhole-map-grid-background';
        this.gridBackground.visible = false;
        this.gridBackground.eventMode = 'none';
        this.gridBackground
            .rect(0, 0, FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT)
            .fill({ color: 0xFFFFFF, alpha: 0.05 });

        this.grid.label = 'foxhole-map-grid';
        this.grid.visible = false;
        this.grid.position.set(-FOXHOLE_REGION_WIDTH / 2, -FOXHOLE_REGION_HEIGHT / 2);
        this.grid.zIndex = 100;
        this.grid.eventMode = 'none';
        this.grid.interactiveChildren = false;

        this.gridLines.label = 'foxhole-map-grid-lines';
        this.grid.addChild(this.gridLines);

        this.gridSublines.label = 'foxhole-map-grid-sublines';
        this.gridSublines.eventMode = 'none';
        this.gridSublines.interactiveChildren = false;
        this.grid.addChild(this.gridSublines);

        this.gridSublineLines.label = 'foxhole-map-grid-subline-lines';
        this.gridSublines.addChild(this.gridSublineLines);

        for (let i = 0; i <= 17; i += 1) {
            this.gridLines.moveTo(i * FOXHOLE_GRID_CELL_SIZE, 0).lineTo(i * FOXHOLE_GRID_CELL_SIZE, FOXHOLE_REGION_HEIGHT);
            if (i > 0) {
                const letterLabel = new PIXI.Text({
                    text: String.fromCharCode(64 + i),
                    style: {
                        fill: 0xFFFFFF,
                        fontSize: 28,
                        fontFamily: 'Jost',
                    },
                });
                letterLabel.anchor.set(0.5, 1);
                letterLabel.position.set(i * FOXHOLE_GRID_CELL_SIZE - (FOXHOLE_GRID_CELL_SIZE / 2), -500);
                this.grid.addChild(letterLabel);
                this.gridColumnLabels.push({
                    label: letterLabel,
                    baseX: letterLabel.x,
                    baseY: letterLabel.y,
                });
            }
        }

        for (let i = 0; i <= 15; i += 1) {
            this.gridLines.moveTo(0, i * FOXHOLE_GRID_CELL_SIZE).lineTo(FOXHOLE_REGION_WIDTH, i * FOXHOLE_GRID_CELL_SIZE);
            if (i < 15) {
                const numberLabel = new PIXI.Text({
                    text: `${i + 1}`,
                    style: {
                        fill: 0xFFFFFF,
                        fontSize: 28,
                        fontFamily: 'Jost',
                    },
                });
                numberLabel.anchor.set(1, 0.5);
                numberLabel.position.set(-700, i * FOXHOLE_GRID_CELL_SIZE + (FOXHOLE_GRID_CELL_SIZE / 2));
                this.grid.addChild(numberLabel);
                this.gridRowLabels.push({
                    label: numberLabel,
                    baseX: numberLabel.x,
                    baseY: numberLabel.y,
                });
            }
        }
        this.gridLines.stroke({ width: 64, color: 0x000000, alpha: 0.1 });

        for (let i = 0; i <= 3; i += 1) {
            this.gridSublineLines.moveTo(0, i * (FOXHOLE_GRID_CELL_SIZE / 3)).lineTo(FOXHOLE_GRID_CELL_SIZE, i * (FOXHOLE_GRID_CELL_SIZE / 3));
            if (i < 3) {
                for (let j = 1; j <= 3; j += 1) {
                    const numberLabel = new PIXI.Text({
                        text: `${((2 - i) * 3) + j}`,
                        style: {
                            fill: 0xFFFFFF,
                            fontSize: 28,
                            fontFamily: 'Jost',
                        },
                    });
                    numberLabel.alpha = 0.85;
                    numberLabel.anchor.set(0.5);
                    numberLabel.position.set(
                        j * (FOXHOLE_GRID_CELL_SIZE / 3) - (FOXHOLE_GRID_CELL_SIZE / 6),
                        i * (FOXHOLE_GRID_CELL_SIZE / 3) + (FOXHOLE_GRID_CELL_SIZE / 6),
                    );
                    this.gridSublines.addChild(numberLabel);
                }
            }
        }
        for (let i = 0; i <= 3; i += 1) {
            this.gridSublineLines.moveTo(i * (FOXHOLE_GRID_CELL_SIZE / 3), 0).lineTo(i * (FOXHOLE_GRID_CELL_SIZE / 3), FOXHOLE_GRID_CELL_SIZE);
        }
        this.gridSublineLines.stroke({ width: 64, color: 0x000000, alpha: 0.1 });

        this.regions.label = 'foxhole-map-regions';
        this.regions.eventMode = 'none';
        this.regions.interactiveChildren = false;
        this.regions.sortableChildren = true;
        this.borders.label = 'foxhole-map-borders';
        this.borders.eventMode = 'none';
        this.borders.interactiveChildren = false;
        this.subregions.label = 'foxhole-map-subregions';
        this.subregions.eventMode = 'none';
        this.subregions.interactiveChildren = false;
        this.frontlines.label = 'foxhole-map-frontlines';
        this.frontlines.eventMode = 'none';
        this.frontlines.interactiveChildren = false;
        this.frontlineBlurFilter.repeatEdgePixels = true;
        this.frontlineSource.eventMode = 'none';
        this.frontlineSource.interactiveChildren = false;
        this.frontlineSprite.label = 'foxhole-map-frontline-sprite';
        this.frontlineSprite.visible = false;
        this.frontlineShadow.label = 'foxhole-map-frontline-shadow';
        this.frontlineGlow.label = 'foxhole-map-frontline-glow';
        this.frontlineCore.label = 'foxhole-map-frontline-core';
        this.setFrontlineRenderMode(false);
        this.labels.label = 'foxhole-map-labels';
        this.labels.eventMode = 'none';
        this.labels.interactiveChildren = false;
        this.victoryBaseBadges.label = 'foxhole-map-victory-base-badges';
        this.victoryBaseBadges.eventMode = 'none';
        this.victoryBaseBadges.interactiveChildren = false;
        this.casualtyLabels.label = 'foxhole-map-casualty-labels';
        this.casualtyLabels.eventMode = 'none';
        this.casualtyLabels.interactiveChildren = false;
        this.majorLabels.label = 'foxhole-map-major-labels';
        this.majorLabels.eventMode = 'none';
        this.majorLabels.interactiveChildren = false;
        this.minorLabels.label = 'foxhole-map-minor-labels';
        this.minorLabels.eventMode = 'none';
        this.minorLabels.interactiveChildren = false;
        this.liveIcons.label = 'foxhole-map-live-icons';
        this.liveIcons.eventMode = 'passive';
        this.liveIcons.interactiveChildren = true;
        this.assistantHighlights.label = 'foxhole-map-assistant-highlights';
        this.assistantHighlights.eventMode = 'none';
        this.assistantHighlights.interactiveChildren = false;
        this.assistantHighlights.zIndex = 250;
        this.assistantHighlightGraphics.label = 'foxhole-map-assistant-highlight-graphics';
        this.assistantHighlights.addChild(this.assistantHighlightGraphics);
        this.borders.alpha = 0.18;

        this.root.addChild(this.background);
        this.root.addChild(this.gridBackground);
        this.root.addChild(this.grid);
        this.root.addChild(this.regions);
        this.root.addChild(this.borders);
        this.root.addChild(this.subregions);
        this.root.addChild(this.frontlines);
        this.root.addChild(this.liveIcons);
        this.root.addChild(this.minorLabels);
        this.root.addChild(this.majorLabels);
        this.root.addChild(this.victoryBaseBadges);
        this.root.addChild(this.labels);
        this.root.addChild(this.casualtyLabels);
        this.root.addChild(this.assistantHighlights);
        this.root.addChild(this.cropMask);

        this.mapModRevision = this.mapModStore.revision;
        void this.mapModStore.ensureLoaded().catch(() => {});
        this.mapModUnsubscribe = this.mapModStore.subscribe(() => {
            this.mapModRevision = this.mapModStore.revision;
            if (this.initialized) {
                this.sync();
            }
        });
    }

    setAssistantHighlights(entries: ReadonlyArray<{
        id: string;
        label: string;
        worldPosition: { x: number; y: number; };
    }>): void {
        this.assistantHighlightEntries = entries.map(entry => ({
            id: String(entry.id ?? '').trim(),
            label: String(entry.label ?? '').trim(),
            worldPosition: {
                x: Number(entry.worldPosition?.x),
                y: Number(entry.worldPosition?.y),
            },
        })).filter(entry => (
            entry.id
            && Number.isFinite(entry.worldPosition.x)
            && Number.isFinite(entry.worldPosition.y)
        ));
        this.redrawAssistantHighlights();
    }

    clearAssistantHighlights(): void {
        this.assistantHighlightEntries = [];
        this.assistantHighlightGraphics.clear();
        this.assistantHighlights.removeChildren().forEach(child => {
            if (child !== this.assistantHighlightGraphics) {
                child.destroy();
            }
        });
        this.assistantHighlights.addChild(this.assistantHighlightGraphics);
    }

    private redrawAssistantHighlights(): void {
        this.assistantHighlightGraphics.clear();
        this.assistantHighlights.removeChildren().forEach(child => {
            if (child !== this.assistantHighlightGraphics) {
                child.destroy();
            }
        });
        this.assistantHighlights.addChild(this.assistantHighlightGraphics);

        const zoom = Math.max(this.context.getZoom(), 0.0001);
        const baseZoom = 1 / zoom;
        const radius = Math.min(2200, Math.max(420, baseZoom * 18));

        for (const entry of this.assistantHighlightEntries) {
            const { x, y } = entry.worldPosition;
            this.assistantHighlightGraphics
                .circle(x, y, radius)
                .stroke({ width: Math.max(48, radius * 0.12), color: 0xF0C070, alpha: 0.95 });
            this.assistantHighlightGraphics
                .circle(x, y, radius * 0.35)
                .fill({ color: 0xF0C070, alpha: 0.35 });

            const label = new PIXI.Text({
                text: entry.label,
                style: {
                    fill: 0xFFFFFF,
                    fontFamily: 'Jost',
                    fontSize: 22,
                    fontWeight: '600',
                    stroke: {
                        width: 4,
                        color: 0x2A160B,
                    },
                },
            });
            label.anchor.set(0.5, 1);
            label.position.set(x, y - (radius * 0.55));
            label.scale.set(Math.min(baseZoom, 180) * 0.65);
            label.eventMode = 'none';
            this.assistantHighlights.addChild(label);
        }
    }

    get hasInitialized(): boolean {
        return this.initialized;
    }

    get isMounted(): boolean {
        return Boolean(this.root.parent);
    }

    mount(beforeChild?: PIXI.Container | null): void {
        if (!this.root.parent) {
            if (beforeChild?.parent === this.context.world) {
                this.context.world.addChildAt(this.root, this.context.world.getChildIndex(beforeChild));
            } else {
                this.context.world.addChildAt(this.root, 0);
            }
        }
        this.context.viewport.on('drag-start', this.handleViewportDragStart);
        this.context.viewport.on('drag-end', this.handleViewportDragEnd);
        this.context.app.canvas.addEventListener('pointerleave', this.handleCanvasPointerLeave);

        this.sync();
    }

    async ensureInitialized(): Promise<void> {
        if (this.root.destroyed) return;
        if (this.initialized) {
            return;
        }

        await this.initialize();
        if (!this.initialized) {
            return;
        }

        this.sync();
    }

    teardown(): void {
        if (this.root.destroyed) return;
        this.initializationEpoch += 1;
        this.pendingOverlayRegionKeys.clear();
        this.overlaySyncScheduled = false;
        this.missingRegionSyncPromise = null;
        this.clearHoveredIcon();
        this.clearFrontlines();

        if (this.regionViews.length > 0) {
            this.clearLiveDisplayData();
            this.destroyRegionViews();
        }

        this.releaseLoadedTextures();
        this.liveData = {};
        this.initialized = false;
        this.resetTickState();

        this.root.visible = false;
        this.root.mask = null;
        this.cropMask.clear();
        this.background.texture = PIXI.Texture.EMPTY;
        this.background.visible = false;
        this.backgroundVariant = null;

        this.unmount();
    }

    sync(): void {
        if (this.root.destroyed) return;
        if (!this.context.readMapSettings().enabled) {
            return;
        }

        const settings = this.context.readMapSettings();
        const selectedRegions = new Set(settings.regionKeys);
        const showIconsAndLabels = this.getShowIconsAndLabels();
        const showGrid = this.getShowGrid();
        const showFrontlines = settings.frontline || settings.frontAlt;
        const textureSettingsSignature = this.getTextureSettingsSignature(settings);
        this.setFrontlineRenderMode(settings.frontAlt, this.context.getZoom());
        const showWorldContent = this.context.hasActiveSceneView();
        this.root.visible = showWorldContent;
        if (!showWorldContent) {
            this.clearHoveredIcon();
        }
        this.background.visible = settings.background;
        this.grid.visible = showGrid;
        this.gridBackground.visible = showGrid;
        this.subregions.visible = settings.voronoi || settings.faction || settings.hotspots;
        this.frontlines.visible = showFrontlines;
        this.labels.visible = settings.names;
        this.victoryBaseBadges.visible = settings.victoryTownBadges && !showIconsAndLabels;
        this.casualtyLabels.visible = settings.hourlyCasualties || settings.totalCasualties;
        this.majorLabels.visible = settings.majorLabels && showIconsAndLabels;
        this.minorLabels.visible = settings.minorLabels && showIconsAndLabels;
        this.liveIcons.visible = settings.icons && showIconsAndLabels;
        this.borders.visible = settings.borders;
        void this.loadBackgroundTexture(settings.darkBackground === false ? 'light' : 'dark');

        for (const view of this.regionViews) {
            const regionVisible = selectedRegions.size === 0 || selectedRegions.has(view.region.key);
            const canDisplayResistanceRegionData = this.canDisplayResistanceRegionData(view.region);
            this.syncRegionCasualtyLabel(view, this.liveData[view.region.key]?.reports, settings);
            view.container.visible = regionVisible;
            view.border.visible = settings.borders && regionVisible;
            view.label.visible = settings.names && regionVisible;
            view.victoryBaseBadge.visible = settings.victoryTownBadges && regionVisible && canDisplayResistanceRegionData && view.hasVictoryBaseBadge && !showIconsAndLabels;
            view.casualtyLabel.visible = (settings.hourlyCasualties || settings.totalCasualties) && regionVisible && canDisplayResistanceRegionData && view.hasCasualtyLabelData;
            view.subregions.visible = (settings.voronoi || settings.faction || settings.hotspots) && regionVisible;
            view.subregionHeatGraphics.visible = settings.hotspots && regionVisible && canDisplayResistanceRegionData && view.activityHeatIntensity > 0;
            if (!view.subregionHeatGraphics.visible) {
                view.subregionHeatGraphics.alpha = 0;
            }
            view.liveIcons.visible = settings.icons && regionVisible && showIconsAndLabels;
            view.majorLabels.visible = settings.majorLabels && regionVisible && showIconsAndLabels;
            view.minorLabels.visible = settings.minorLabels && regionVisible && showIconsAndLabels;
            this.updateRegionResistanceAppearance(view);
            this.updateRegionIconVisibility(view, settings, showIconsAndLabels);
            void this.syncRegionTextureLayers(view, settings, textureSettingsSignature);
        }

        if (settings.cropEnabled && settings.cropWidth > 0 && settings.cropHeight > 0) {
            this.cropMask.clear();
            this.cropMask
                .rect(settings.cropX, settings.cropY, settings.cropWidth, settings.cropHeight)
                .fill(0x000000);
            this.root.mask = this.cropMask;
        } else {
            this.cropMask.clear();
            this.root.mask = null;
        }

        this.tick(true);
        void this.ensureMissingRegionViews();
    }

    private sortRegionsForInitialization(
        regions: readonly FoxholeMapRegionRecord[],
    ): FoxholeMapRegionRecord[] {
        return [...regions].sort((left, right) => {
            const leftPosition = getFoxholeRegionPosition(left);
            const rightPosition = getFoxholeRegionPosition(right);
            const leftDistance = Math.hypot(leftPosition.x, leftPosition.y);
            const rightDistance = Math.hypot(rightPosition.x, rightPosition.y);
            if (leftDistance !== rightDistance) {
                return leftDistance - rightDistance;
            }
            if (left.gridCoord.y !== right.gridCoord.y) {
                return left.gridCoord.y - right.gridCoord.y;
            }
            return left.gridCoord.x - right.gridCoord.x;
        });
    }

    private ensureMissingRegionViews(): Promise<void> {
        if (!this.initialized) {
            return Promise.resolve();
        }

        if (this.missingRegionSyncPromise) {
            return this.missingRegionSyncPromise;
        }

        const activeRegions = resolveFoxholeMapActiveRegions(this.context.readMapSettings().regionKeys);
        const missingRegions = activeRegions.filter(region => !this.regionViewByKey.has(region.key));
        if (!missingRegions.length) {
            return Promise.resolve();
        }

        this.missingRegionSyncPromise = (async () => {
            for (const region of this.sortRegionsForInitialization(missingRegions)) {
                await this.createRegionView(region);
            }
            this.sync();
        })().finally(() => {
            this.missingRegionSyncPromise = null;
        });

        return this.missingRegionSyncPromise;
    }

    async applyLiveData(liveData: Record<string, FoxholeMapServerRegionData> | null | undefined): Promise<void> {
        this.liveData = liveData ?? {};
        if (!this.initialized) {
            return;
        }

        await Promise.all(this.regionViews.map(async view => {
            await this.syncRegionLiveData(view, this.liveData[view.region.key]);
        }));
        this.sync();
    }

    async applyLiveDataForRegions(
        liveData: Record<string, FoxholeMapServerRegionData> | null | undefined,
        regionKeys: Iterable<string>,
    ): Promise<void> {
        this.liveData = liveData ?? {};
        if (!this.initialized) {
            return;
        }

        const views = Array.from(regionKeys)
            .map(regionKey => this.regionViewByKey.get(regionKey))
            .filter((view): view is FoxholeMapRegionView => Boolean(view));

        await Promise.all(views.map(async view => {
            await this.syncRegionLiveData(view, this.liveData[view.region.key]);
        }));
        this.sync();
    }

    clearLiveDisplayData(): void {
        this.clearFrontlines();
        for (const view of this.regionViews) {
            view.liveIcons.removeChildren().forEach(child => child.destroy({ children: true }));
            view.majorLabels.removeChildren().forEach(child => child.destroy());
            view.minorLabels.removeChildren().forEach(child => child.destroy());
            view.victoryBaseBadgeSignature = '';
            view.hasVictoryBaseBadge = false;
            view.victoryBaseBadgeBackground.clear();
            if (view.victoryBaseBadgeSprite) {
                view.victoryBaseBadgeSprite.visible = false;
            }
            view.casualtyLabelSignature = '';
            view.hasCasualtyLabelData = false;
            view.casualtyLabelBackground.clear();
            view.colonialCasualtyLabel.text = '';
            view.wardenCasualtyLabel.text = '';
            view.voronoiCells = [];
            view.voronoiLayoutSignature = '';
            view.voronoiStyleSignature = '';
            view.voronoiRenderSignature = '';
            view.subregionFillGraphics.clear();
            view.subregionLineGraphics.clear();
            view.liveIconsVersion = null;
            view.liveLabelsVersion = null;
        }
    }

    destroy(): void {
        this.mapModUnsubscribe?.();
        this.mapModUnsubscribe = null;
        this.teardown();
        this.root.destroy({ children: true });
    }

    tick(force = false): void {
        if (!this.initialized || !this.context.readMapSettings().enabled) {
            return;
        }

        const currentTime = performance.now();
        const zoom = this.context.getZoom();
        const safeZoom = Math.max(zoom, 0.0001);
        const baseZoom = 1 / safeZoom;
        const labelIconScale = Math.min(baseZoom, 200) * 0.7;
        const regionLabelScale = Math.min(baseZoom, 240) * 0.85;
        const showIconsAndLabels = baseZoom < 350;
        const settings = this.context.readMapSettings();
        const showFrontlines = settings.frontline || settings.frontAlt;
        const showGrid = settings.grid && baseZoom < FoxholeMapRenderer.GRID_MAX_BASE_ZOOM;
        const hasRevealAnimation = this.regionViews.some(view => view.container.visible && view.container.alpha < 1);
        const gridTarget = showGrid ? this.context.getWorldPointer() : null;
        const viewportTopLeft = this.context.viewport.toWorld(0, 0);
        const hasViewportMoved = Boolean(
            this.lastViewportTopLeft === null
            || this.lastViewportTopLeft.x !== viewportTopLeft.x
            || this.lastViewportTopLeft.y !== viewportTopLeft.y,
        );
        const hasGridTargetMoved = Boolean(
            settings.grid
            && gridTarget
            && (
                this.lastGridTargetPosition === null
                || this.lastGridTargetPosition.x !== gridTarget.x
                || this.lastGridTargetPosition.y !== gridTarget.y
            ),
        );

        if (this.assistantHighlightEntries.length > 0 && (force || zoom !== this.lastZoom)) {
            this.redrawAssistantHighlights();
        }

        if (!force && zoom === this.lastZoom && !hasRevealAnimation && !hasGridTargetMoved && !hasViewportMoved) {
            return;
        }

        // Pointer-only grid follow: keep subcell highlight tracking the cursor without
        // rerunning region/frontline/scale work every mouse move.
        if (
            !force
            && zoom === this.lastZoom
            && !hasRevealAnimation
            && !hasViewportMoved
            && hasGridTargetMoved
            && gridTarget
        ) {
            this.updateGridFollowTarget(gridTarget);
            return;
        }

        this.setFrontlineRenderMode(settings.frontAlt, safeZoom);
        const labelIconScaleChanged = force
            || !Number.isFinite(this.lastLabelIconScale)
            || this.lastLabelIconScale !== labelIconScale;
        const regionLabelScaleChanged = force
            || !Number.isFinite(this.lastRegionLabelScale)
            || this.lastRegionLabelScale !== regionLabelScale;
        this.lastZoom = zoom;
        this.lastLabelIconScale = labelIconScale;
        this.lastRegionLabelScale = regionLabelScale;
        this.lastViewportTopLeft = { x: viewportTopLeft.x, y: viewportTopLeft.y };
        this.majorLabels.visible = settings.majorLabels && showIconsAndLabels;
        this.minorLabels.visible = settings.minorLabels && showIconsAndLabels;
        this.liveIcons.visible = settings.icons && showIconsAndLabels;
        this.victoryBaseBadges.visible = settings.victoryTownBadges && !showIconsAndLabels;
        this.casualtyLabels.visible = (settings.hourlyCasualties || settings.totalCasualties) && !showIconsAndLabels;
        this.subregions.visible = settings.voronoi || settings.faction || settings.hotspots;
        this.frontlines.visible = showFrontlines;
        this.grid.visible = showGrid;
        this.gridBackground.visible = showGrid;
        if (!this.liveIcons.visible) {
            this.clearHoveredIcon();
        }
        if (this.isViewportDragging) {
            this.clearHoveredIcon();
        }
        const majorLabelAlpha = baseZoom < 125 ? 1 : 1 - ((baseZoom - 125) / 15);
        this.labels.alpha = Math.max(0.35, (1 - majorLabelAlpha) / 2);
        this.victoryBaseBadges.alpha = this.victoryBaseBadges.visible ? 0.96 : 0;
        this.casualtyLabels.alpha = this.casualtyLabels.visible ? 0.96 : 0;
        this.minorLabels.alpha = Math.min(0.35, baseZoom < 75 ? 1 : 1 - (baseZoom - 75) / 15);
        this.majorLabels.alpha = Math.max(0.15, majorLabelAlpha);

        for (const view of this.regionViews) {
            const canDisplayResistanceRegionData = this.canDisplayResistanceRegionData(view.region);
            const borderLineThickness = 2 / safeZoom;
            if (view.container.visible && view.container.alpha < 1 && currentTime >= view.revealStartAt) {
                view.container.alpha = Math.min(1, view.container.alpha + FoxholeMapRenderer.REGION_REVEAL_STEP);
            }
            if (view.label.visible && regionLabelScaleChanged) {
                view.label.scale.set(regionLabelScale);
            }
            view.victoryBaseBadge.visible = this.victoryBaseBadges.visible && view.container.visible && canDisplayResistanceRegionData && view.hasVictoryBaseBadge;
            if (view.victoryBaseBadge.visible) {
                const victoryBaseBadgeOffset = FOXHOLE_REGION_HEIGHT * 0.23;
                view.victoryBaseBadge.position.set(view.container.x, view.container.y - victoryBaseBadgeOffset);
                if (regionLabelScaleChanged) {
                    view.victoryBaseBadge.scale.set(regionLabelScale * 1.6);
                }
            }
            view.casualtyLabel.visible = this.casualtyLabels.visible && view.container.visible && canDisplayResistanceRegionData && view.hasCasualtyLabelData;
            if (view.casualtyLabel.visible) {
                const casualtyOffset = FOXHOLE_REGION_HEIGHT * 0.275;
                view.casualtyLabel.position.set(view.container.x, view.container.y + casualtyOffset);
                if (regionLabelScaleChanged) {
                    view.casualtyLabel.scale.set(regionLabelScale);
                }
            }

            const borderInstructions = view.border.context?.instructions ?? [];
            for (const instruction of borderInstructions) {
                if (instruction?.data?.style) {
                    instruction.data.style.width = borderLineThickness;
                }
            }
            view.border.context?.onUpdate?.();

            const subregionsVisible = (settings.voronoi || settings.faction || settings.hotspots) && (view.container.visible ?? true);
            view.subregions.visible = subregionsVisible;
            view.subregionHeatGraphics.visible = settings.hotspots && subregionsVisible && canDisplayResistanceRegionData && view.activityHeatIntensity > 0;
            view.subregionHeatGraphics.alpha = view.subregionHeatGraphics.visible
                ? this.computeRegionHeatPulse(currentTime, view.activityHeatIntensity, view.revealOrder)
                : 0;
            if (subregionsVisible && (settings.voronoi || settings.faction)) {
                const lineThickness = Math.min(500, 2 / safeZoom);
                this.redrawRegionVoronoiIfNeeded(view, lineThickness, settings.voronoi, settings.faction);
            } else if (view.voronoiRenderSignature) {
                view.voronoiRenderSignature = '';
                view.subregionFillGraphics.clear();
                view.subregionLineGraphics.clear();
            }

            if (labelIconScaleChanged) {
                if (view.majorLabels.visible) {
                    for (const child of view.majorLabels.children) {
                        child.scale.set(labelIconScale);
                    }
                }

                if (view.minorLabels.visible) {
                    for (const child of view.minorLabels.children) {
                        child.scale.set(labelIconScale);
                    }
                }

                if (view.liveIcons.visible) {
                    for (const child of view.liveIcons.children) {
                        child.scale.set(labelIconScale);
                    }
                }
            }
        }

        if (this.frontlines.visible) {
            this.redrawFrontlinesIfNeeded(
                settings.frontAlt
                    ? FoxholeMapRenderer.FRONTLINE_WORLD_THICKNESS
                    : Math.min(500, 2 / safeZoom),
            );
        } else if (this.frontlineRenderSignature || this.frontlineSegments.length) {
            this.clearFrontlines();
        }

        if (this.grid.visible) {
            const gridLineThickness = Math.min(100, 2 / safeZoom);
            const gridLabelScale = Math.min(baseZoom, 240) * 0.85;
            const subgridLabelScale = Math.min(24, gridLabelScale);

            const gridLineInstructions = this.gridLines.context?.instructions ?? [];
            for (const instruction of gridLineInstructions) {
                if (instruction?.data?.style) {
                    instruction.data.style.width = gridLineThickness;
                }
            }
            this.gridLines.context?.onUpdate?.();

            const sublineInstructions = this.gridSublineLines.context?.instructions ?? [];
            for (const instruction of sublineInstructions) {
                if (instruction?.data?.style) {
                    instruction.data.style.width = gridLineThickness;
                }
            }
            this.gridSublineLines.context?.onUpdate?.();

            for (const child of this.grid.children) {
                if (child instanceof PIXI.Text) {
                    child.scale.set(gridLabelScale);
                }
            }
            for (const child of this.gridSublines.children) {
                if (child instanceof PIXI.Text) {
                    child.scale.set(subgridLabelScale);
                }
            }

            this.updateGridStickyLabels();

            if (gridTarget && hasGridTargetMoved) {
                this.updateGridFollowTarget(gridTarget);
            }
        } else {
            this.lastGridTargetPosition = null;
        }
    }

    private updateGridFollowTarget(gridTarget: { x: number; y: number; }): void {
        this.lastGridTargetPosition = { x: gridTarget.x, y: gridTarget.y };
        const closestRegionView = this.getClosestVisibleRegionView(gridTarget);
        if (!closestRegionView) {
            return;
        }

        const regionLeft = closestRegionView.container.x - (FOXHOLE_REGION_WIDTH / 2);
        const regionTop = closestRegionView.container.y - (FOXHOLE_REGION_HEIGHT / 2);
        this.grid.position.set(regionLeft, regionTop);
        this.gridBackground.position.set(regionLeft, regionTop);

        const relativeMousePosition = {
            x: gridTarget.x - regionLeft,
            y: gridTarget.y - regionTop,
        };
        const cellPosition = {
            x: Math.floor(relativeMousePosition.x / FOXHOLE_GRID_CELL_SIZE) * FOXHOLE_GRID_CELL_SIZE,
            y: Math.floor(relativeMousePosition.y / FOXHOLE_GRID_CELL_SIZE) * FOXHOLE_GRID_CELL_SIZE,
        };
        this.gridSublines.position.set(cellPosition.x, cellPosition.y);
    }

    private updateGridStickyLabels(): void {
        const stickyTop = this.context.viewport.toWorld(0, FOXHOLE_GRID_LABEL_SCREEN_PADDING).y - this.grid.y;
        const stickyLeft = this.context.viewport.toWorld(FOXHOLE_GRID_LABEL_SCREEN_PADDING, 0).x - this.grid.x;
        const maxLabelY = FOXHOLE_REGION_HEIGHT - (FOXHOLE_GRID_CELL_SIZE / 2);
        const maxLabelX = FOXHOLE_REGION_WIDTH - (FOXHOLE_GRID_CELL_SIZE / 2);

        for (const entry of this.gridColumnLabels) {
            const nextY = Math.min(
                Math.max(entry.baseY, stickyTop),
                maxLabelY,
            );
            entry.label.position.y = nextY;
        }

        for (const entry of this.gridRowLabels) {
            const nextX = Math.min(
                Math.max(entry.baseX, stickyLeft),
                maxLabelX,
            );
            entry.label.position.x = nextX;
        }
    }

    private getClosestVisibleRegionView(target: { x: number; y: number; }): FoxholeMapRegionView | null {
        let closestRegionView: FoxholeMapRegionView | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const view of this.regionViews) {
            if (!view.container.visible) {
                continue;
            }

            const dx = view.container.x - target.x;
            const dy = view.container.y - target.y;
            const distance = Math.hypot(dx, dy);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestRegionView = view;
            }
        }

        return closestRegionView;
    }

    private isInitializationStillActive(epoch: number): boolean {
        return !this.root.destroyed && epoch === this.initializationEpoch
            && this.context.readMapSettings().enabled;
    }

    private unmount(): void {
        this.context.viewport.off('drag-start', this.handleViewportDragStart);
        this.context.viewport.off('drag-end', this.handleViewportDragEnd);
        this.context.app.canvas.removeEventListener('pointerleave', this.handleCanvasPointerLeave);

        if (this.root.parent) {
            this.root.parent.removeChild(this.root);
        }
    }

    private resetTickState(): void {
        this.lastZoom = Number.NaN;
        this.lastLabelIconScale = Number.NaN;
        this.lastRegionLabelScale = Number.NaN;
        this.lastGridTargetPosition = null;
        this.lastViewportTopLeft = null;
    }

    private destroyRegionViews(): void {
        for (const view of this.regionViews) {
            view.container.destroy({ children: true });
            view.border.destroy();
            view.label.destroy();
            view.victoryBaseBadge.destroy({ children: true });
            view.casualtyLabel.destroy({ children: true });
            view.liveIcons.destroy({ children: true });
            view.subregions.destroy({ children: true });
            view.majorLabels.destroy({ children: true });
            view.minorLabels.destroy({ children: true });
        }

        this.regionViews.length = 0;
        this.regionViewByKey.clear();
    }

    private releaseLoadedTextures(): void {
        const unloadUrls = new Set<string>();

        for (const cacheKey of this.regionTextureCache.keys()) {
            unloadUrls.add(cacheKey);
        }

        for (const cacheKey of this.iconTextureCache.keys()) {
            const iconMeta = FOXHOLE_MAP_ICONS[cacheKey];
            const iconUrl = iconMeta
                ? resolveFoxholeMapIconUrl(this.context.getAssetsBaseUrl(), iconMeta)
                : null;
            if (iconUrl) {
                unloadUrls.add(iconUrl);
            }
        }

        if (this.backgroundVariant) {
            unloadUrls.add(
                `${this.context.getAssetsBaseUrl()}maps/WorldMap${this.backgroundVariant === 'light' ? '' : 'Dark'}BG.webp`,
            );
        }

        this.regionTextureCache.clear();
        this.iconTextureCache.clear();

        if (this.context.releaseAllTextures) {
            void this.context.releaseAllTextures().catch(() => {});
            return;
        }
        for (const url of unloadUrls) {
            if (!url) {
                continue;
            }

            void (this.context.releaseTexture?.(url) ?? PIXI.Assets.unload(url)).catch(() => {});
        }
    }

    private async initialize(): Promise<void> {
        const epoch = this.initializationEpoch;
        const backgroundVariant = this.context.readMapSettings().darkBackground === false ? 'light' : 'dark';
        await this.loadBackgroundTexture(backgroundVariant);
        if (!this.isInitializationStillActive(epoch)) {
            this.teardown();
            return;
        }

        const orderedRegions = this.sortRegionsForInitialization(
            resolveFoxholeMapActiveRegions(this.context.readMapSettings().regionKeys),
        );

        for (let index = 0; index < orderedRegions.length; index += FoxholeMapRenderer.INITIAL_REGION_BATCH_SIZE) {
            const batch = orderedRegions.slice(index, index + FoxholeMapRenderer.INITIAL_REGION_BATCH_SIZE);
            await Promise.all(batch.map(async region => {
                await this.createRegionView(region);
            }));
            if (!this.isInitializationStillActive(epoch)) {
                this.teardown();
                return;
            }

            this.tick(true);
            if (index + FoxholeMapRenderer.INITIAL_REGION_BATCH_SIZE < orderedRegions.length) {
                await this.waitForNextFrame();
            }
        }

        if (!this.isInitializationStillActive(epoch)) {
            this.teardown();
            return;
        }

        await this.applyLiveData(this.liveData);
        if (!this.isInitializationStillActive(epoch)) {
            this.teardown();
            return;
        }

        this.initialized = true;
        this.tick(true);
    }

    private async waitForNextFrame(): Promise<void> {
        await new Promise<void>(resolve => {
            window.setTimeout(resolve, 16);
        });
    }

    private async loadBackgroundTexture(variant: 'dark' | 'light' = 'dark'): Promise<void> {
        if (this.backgroundVariant === variant && this.background.texture && !this.background.texture.destroyed) {
            return;
        }

        const textureUrl = `${this.context.getAssetsBaseUrl()}maps/WorldMap${variant === 'light' ? '' : 'Dark'}BG.webp`;
        const texture = await this.context.loadTexture(textureUrl);
        if (this.background.destroyed || !texture || texture.destroyed) {
            return;
        }

        if (!this.context.readMapSettings().enabled) {
            void (this.context.releaseTexture?.(textureUrl) ?? PIXI.Assets.unload(textureUrl)).catch(() => {});
            return;
        }

        this.background.texture = texture;
        this.backgroundVariant = variant;
    }

    private async createRegionView(region: FoxholeMapRegionRecord): Promise<void> {
        const epoch = this.initializationEpoch;
        const position = getFoxholeRegionPosition(region);
        const settings = this.context.readMapSettings();
        const initialBaseTexturePath = this.resolveBaseRegionTexturePath(region, settings);
        const modTextureUrl = initialBaseTexturePath.startsWith('mapmod:')
            ? this.resolveModRegionTextureUrl(region)
            : null;
        const texture = await this.loadRegionTexture(initialBaseTexturePath, modTextureUrl);
        if (!this.isInitializationStillActive(epoch)) return;

        const container = new PIXI.Container();
        container.position.set(position.x, position.y);
        container.label = `foxhole-map-region:${region.key}`;
        container.eventMode = 'none';
        container.interactiveChildren = false;
        container.sortableChildren = true;
        container.alpha = 0;
        this.regions.addChild(container);

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = FOXHOLE_REGION_WIDTH;
        sprite.height = FOXHOLE_REGION_HEIGHT;
        sprite.zIndex = 0;
        sprite.label = initialBaseTexturePath;
        container.addChild(sprite);

        const border = new PIXI.Graphics();
        border.position.set(position.x, position.y);
        border.poly([...FOXHOLE_REGION_POLYGON]).stroke({ width: 500, color: 0x000000 });
        this.borders.addChild(border);

        const label = new PIXI.Text({
            text: region.name,
            style: {
                fill: 0xFFFFFF,
                fontFamily: 'Jost',
                fontSize: 40,
                stroke: {
                    width: 4,
                    color: 0x505050,
                },
            },
        });
        label.anchor.set(0.5);
        label.position.set(position.x, position.y);
        this.labels.addChild(label);

        const victoryBaseBadge = new PIXI.Container();
        victoryBaseBadge.position.set(position.x, position.y);
        victoryBaseBadge.eventMode = 'none';
        victoryBaseBadge.interactiveChildren = false;
        victoryBaseBadge.visible = false;
        this.victoryBaseBadges.addChild(victoryBaseBadge);

        const victoryBaseBadgeBackground = new PIXI.Graphics();
        victoryBaseBadge.addChild(victoryBaseBadgeBackground);

        const casualtyLabel = new PIXI.Container();
        casualtyLabel.position.set(position.x, position.y);
        casualtyLabel.eventMode = 'none';
        casualtyLabel.interactiveChildren = false;
        casualtyLabel.visible = false;
        this.casualtyLabels.addChild(casualtyLabel);

        const casualtyLabelBackground = new PIXI.Graphics();
        casualtyLabel.addChild(casualtyLabelBackground);

        const colonialCasualtyLabel = new PIXI.Text({
            text: '',
            style: {
                fill: 0xCFE7A0,
                fontFamily: 'Jost',
                fontSize: 32,
                fontWeight: '700',
                letterSpacing: 0.9,
                stroke: {
                    width: 3,
                    color: 0x505050,
                },
            },
        });
        colonialCasualtyLabel.anchor.set(0.5, 1);
        colonialCasualtyLabel.position.set(0, -2);
        casualtyLabel.addChild(colonialCasualtyLabel);

        const wardenCasualtyLabel = new PIXI.Text({
            text: '',
            style: {
                fill: 0xA9D7FF,
                fontFamily: 'Jost',
                fontSize: 32,
                fontWeight: '700',
                letterSpacing: 0.9,
                stroke: {
                    width: 3,
                    color: 0x505050,
                },
            },
        });
        wardenCasualtyLabel.anchor.set(0.5, 0);
        wardenCasualtyLabel.position.set(0, 2);
        casualtyLabel.addChild(wardenCasualtyLabel);

        const liveIcons = new PIXI.Container();
        liveIcons.position.set(position.x - (FOXHOLE_REGION_WIDTH / 2), position.y - (FOXHOLE_REGION_HEIGHT / 2));
        liveIcons.eventMode = 'passive';
        liveIcons.interactiveChildren = true;
        this.liveIcons.addChild(liveIcons);

        const subregions = new PIXI.Container();
        subregions.position.set(position.x - (FOXHOLE_REGION_WIDTH / 2), position.y - (FOXHOLE_REGION_HEIGHT / 2));
        subregions.eventMode = 'none';
        subregions.interactiveChildren = false;
        this.subregions.addChild(subregions);
        const subregionHeatGraphics = new PIXI.Graphics();
        const subregionFillGraphics = new PIXI.Graphics();
        const subregionLineGraphics = new PIXI.Graphics();
        subregions.addChild(subregionFillGraphics);
        subregions.addChild(subregionHeatGraphics);
        subregions.addChild(subregionLineGraphics);

        const majorLabels = new PIXI.Container();
        majorLabels.position.set(position.x - (FOXHOLE_REGION_WIDTH / 2), position.y - (FOXHOLE_REGION_HEIGHT / 2));
        majorLabels.eventMode = 'none';
        majorLabels.interactiveChildren = false;
        this.majorLabels.addChild(majorLabels);

        const minorLabels = new PIXI.Container();
        minorLabels.position.set(position.x - (FOXHOLE_REGION_WIDTH / 2), position.y - (FOXHOLE_REGION_HEIGHT / 2));
        minorLabels.eventMode = 'none';
        minorLabels.interactiveChildren = false;
        this.minorLabels.addChild(minorLabels);

        // Stable local footprints let spatial views skip whole offscreen regions.
        // Keep a generous gutter for labels and icons that straddle hex borders.
        container.cullArea = new PIXI.Rectangle(-FOXHOLE_REGION_WIDTH / 2, -FOXHOLE_REGION_HEIGHT / 2, FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT).pad(512);
        border.cullArea = container.cullArea;
        subregions.cullArea = new PIXI.Rectangle(0, 0, FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT).pad(512);
        for (const group of [liveIcons, majorLabels, minorLabels]) {
            group.cullArea = new PIXI.Rectangle(0, 0, FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT).pad(FOXHOLE_REGION_WIDTH / 2);
        }

        const view: FoxholeMapRegionView = {
            region,
            container,
            sprite,
            textureLayers: {},
            textureSignature: '',
            overlaySignature: '',
            textureSyncPromise: null,
            revealOrder: this.regionViews.length,
            revealStartAt: performance.now() + (this.regionViews.length * FoxholeMapRenderer.REGION_REVEAL_STAGGER_MS),
            border,
            label,
            victoryBaseBadge,
            victoryBaseBadgeBackground,
            victoryBaseBadgeSprite: null,
            casualtyLabel,
            casualtyLabelBackground,
            colonialCasualtyLabel,
            wardenCasualtyLabel,
            subregions,
            subregionHeatGraphics,
            subregionFillGraphics,
            subregionLineGraphics,
            voronoiCells: [],
            voronoiLayoutSignature: '',
            voronoiStyleSignature: '',
            voronoiRenderSignature: '',
            activityHeatSignature: '',
            activityHeatIntensity: 0,
            liveIcons,
            majorLabels,
            minorLabels,
            victoryBaseBadgeSignature: '',
            hasVictoryBaseBadge: false,
            casualtyLabelSignature: '',
            hasCasualtyLabelData: false,
            liveLabelsVersion: null,
            liveIconsVersion: null,
        };

        this.regionViews.push(view);
        this.regionViewByKey.set(region.key, view);
        await this.syncRegionTextureLayers(
            view,
            settings,
            this.getTextureSettingsSignature(settings),
        );
    }

    private async loadRegionTexture(relativePath: string, absoluteUrl?: string | null): Promise<PIXI.Texture> {
        const cacheKey = absoluteUrl || `${this.context.getAssetsBaseUrl()}${relativePath}`;
        const existing = this.regionTextureCache.get(cacheKey);
        if (existing) {
            return await existing;
        }

        // The shared loader also selects the texture parser for extensionless blob URLs.
        const promise = this.context.loadTexture(cacheKey).then(texture => {
            if (texture?.source) {
                texture.source.scaleMode = 'nearest';
            }
            return texture;
        });
        this.regionTextureCache.set(cacheKey, promise);
        return await promise;
    }

    private syncRegionCasualtyLabel(
        view: FoxholeMapRegionView,
        reports: FoxholeMapReportData | undefined,
        settings: FoxholeMapSettingsSnapshot,
    ): void {
        const mode = this.getRegionCasualtyLabelMode(settings);
        const colonialCasualties = mode ? this.getRegionCasualtyValue(reports, 'COLONIALS', mode) : null;
        const wardenCasualties = mode ? this.getRegionCasualtyValue(reports, 'WARDENS', mode) : null;
        const hasColonialCasualties = (colonialCasualties ?? 0) > 0;
        const hasWardenCasualties = (wardenCasualties ?? 0) > 0;
        const hasCasualtyData = hasColonialCasualties || hasWardenCasualties;
        const nextSignature = JSON.stringify({
            mode,
            colonialCasualties,
            wardenCasualties,
        });

        if (view.casualtyLabelSignature === nextSignature) {
            view.hasCasualtyLabelData = hasCasualtyData;
            return;
        }

        view.casualtyLabelSignature = nextSignature;
        view.hasCasualtyLabelData = hasCasualtyData;

        if (!mode || !hasCasualtyData) {
            view.casualtyLabelBackground.clear();
            view.colonialCasualtyLabel.text = '';
            view.colonialCasualtyLabel.visible = false;
            view.colonialCasualtyLabel.anchor.set(0.5, 1);
            view.colonialCasualtyLabel.position.set(0, -2);
            view.wardenCasualtyLabel.text = '';
            view.wardenCasualtyLabel.visible = false;
            view.wardenCasualtyLabel.anchor.set(0.5, 0);
            view.wardenCasualtyLabel.position.set(0, 2);
            return;
        }

        const suffix = mode === 'hourly' ? '/h' : '';
        view.colonialCasualtyLabel.visible = hasColonialCasualties;
        view.wardenCasualtyLabel.visible = hasWardenCasualties;
        view.colonialCasualtyLabel.text = hasColonialCasualties
            ? `COL ${this.formatRegionCasualtyValue(colonialCasualties ?? 0)}${suffix}`
            : '';
        view.wardenCasualtyLabel.text = hasWardenCasualties
            ? `WRD ${this.formatRegionCasualtyValue(wardenCasualties ?? 0)}${suffix}`
            : '';

        if (hasColonialCasualties && hasWardenCasualties) {
            view.colonialCasualtyLabel.anchor.set(0.5, 1);
            view.colonialCasualtyLabel.position.set(0, -2);
            view.wardenCasualtyLabel.anchor.set(0.5, 0);
            view.wardenCasualtyLabel.position.set(0, 2);
        } else if (hasColonialCasualties) {
            view.colonialCasualtyLabel.anchor.set(0.5);
            view.colonialCasualtyLabel.position.set(0, 0);
            view.wardenCasualtyLabel.anchor.set(0.5, 0);
            view.wardenCasualtyLabel.position.set(0, 2);
        } else {
            view.colonialCasualtyLabel.anchor.set(0.5, 1);
            view.colonialCasualtyLabel.position.set(0, -2);
            view.wardenCasualtyLabel.anchor.set(0.5);
            view.wardenCasualtyLabel.position.set(0, 0);
        }

        this.redrawRegionCasualtyLabelBackground(view);
    }

    private redrawRegionCasualtyLabelBackground(view: FoxholeMapRegionView): void {
        const visibleLabels = [view.colonialCasualtyLabel, view.wardenCasualtyLabel].filter(label => label.visible && label.text);
        if (!visibleLabels.length) {
            view.casualtyLabelBackground.clear();
            return;
        }

        const bounds = visibleLabels.reduce((currentBounds, label) => {
            const width = label.width;
            const height = label.height;
            const left = label.x - (width * label.anchor.x);
            const right = label.x + (width * (1 - label.anchor.x));
            const top = label.y - (height * label.anchor.y);
            const bottom = label.y + (height * (1 - label.anchor.y));

            return {
                left: Math.min(currentBounds.left, left),
                right: Math.max(currentBounds.right, right),
                top: Math.min(currentBounds.top, top),
                bottom: Math.max(currentBounds.bottom, bottom),
            };
        }, {
            left: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
            bottom: Number.NEGATIVE_INFINITY,
        });

        const paddingX = 16;
        const paddingY = 8;
        view.casualtyLabelBackground.clear();
        view.casualtyLabelBackground
            .roundRect(
                bounds.left - paddingX,
                bounds.top - paddingY,
                (bounds.right - bounds.left) + (paddingX * 2),
                (bounds.bottom - bounds.top) + (paddingY * 2),
                14,
            )
            .fill({
                color: 0x1B1815,
                alpha: 0.4,
            })
            .stroke({
                width: 2,
                color: 0xF3E4C8,
                alpha: 0.07,
            });
    }

    private getRegionCasualtyLabelMode(settings: FoxholeMapSettingsSnapshot): FoxholeRegionCasualtyLabelMode | null {
        if (settings.hourlyCasualties) {
            return 'hourly';
        }
        if (settings.totalCasualties) {
            return 'total';
        }

        return null;
    }

    private getRegionCasualtyValue(
        reports: FoxholeMapReportData | undefined,
        teamId: 'COLONIALS' | 'WARDENS',
        mode: FoxholeRegionCasualtyLabelMode,
    ): number | null {
        const property = mode === 'hourly' ? 'totalHourlyCasualties' : 'totalCasualties';
        const factionKeys = teamId === 'COLONIALS'
            ? ['colonial', 'colonials'] as const
            : ['warden', 'wardens'] as const;

        for (const factionKey of factionKeys) {
            const nextValue = Number(reports?.factions?.[factionKey]?.[property] ?? Number.NaN);
            if (Number.isFinite(nextValue)) {
                return Math.max(0, nextValue);
            }
        }

        return null;
    }

    private formatRegionCasualtyValue(value: number): string {
        const absoluteValue = Math.abs(value);
        if (absoluteValue >= 1_000_000) {
            const compactValue = absoluteValue >= 10_000_000
                ? Math.round(value / 1_000_000).toString()
                : (value / 1_000_000).toFixed(1).replace(/\.0$/, '');
            return `${compactValue}m`;
        }

        if (absoluteValue >= 1_000) {
            const compactValue = absoluteValue >= 100_000
                ? Math.round(value / 1_000).toString()
                : (value / 1_000).toFixed(1).replace(/\.0$/, '');
            return `${compactValue}k`;
        }

        return Math.round(value).toLocaleString('en-US');
    }

    private getTextureSettingsSignature(settings: FoxholeMapSettingsSnapshot): string {
        return JSON.stringify({
            colors: settings.colors,
            baseMap: settings.baseMap,
            baseMapFull: settings.baseMapFull,
            modded: settings.modded,
            mapModRevision: settings.modded ? this.mapModRevision : '',
            roads: settings.roads,
            roadsTiers: settings.roadsTiers,
            rdz: settings.rdz,
            darkRdz: settings.darkRdz,
            glaciers: settings.glaciers,
            bulwark: settings.bulwark,
            railBridge: settings.railBridge,
            rocks: settings.rocks,
            underwaterRocksStripes: settings.underwaterRocksStripes,
        });
    }

    private getOverlaySettingsSignature(settings: FoxholeMapSettingsSnapshot): string {
        return JSON.stringify({
            roads: settings.roads,
            roadsTiers: settings.roadsTiers,
            rdz: settings.rdz,
            darkRdz: settings.darkRdz,
            glaciers: settings.glaciers,
            bulwark: settings.bulwark,
            railBridge: settings.railBridge,
            rocks: settings.rocks,
            underwaterRocksStripes: settings.underwaterRocksStripes,
        });
    }

    private resolveBaseRegionTexturePath(region: FoxholeMapRegionRecord, settings: FoxholeMapSettingsSnapshot): string {
        if (settings.modded && this.mapModStore.hasTexture(region.textureKey)) {
            return `mapmod:${this.mapModRevision}:${region.textureKey}`;
        }
        if (settings.baseMap) {
            return `maps/IMM/BaseMap/${region.textureKey}.webp`;
        }
        if (settings.colors) {
            return `maps/IMM/BaseMapTopo/${region.textureKey}.webp`;
        }
        if (settings.baseMapFull) {
            return `maps/IMM/BaseMapFull/${region.textureKey}.webp`;
        }
        return `maps/HexMaps/Processed/${region.textureKey}.webp`;
    }

    private resolveModRegionTextureUrl(region: FoxholeMapRegionRecord): string | null {
        return this.mapModStore.getTextureUrl(region.textureKey);
    }

    private isTextureLayerEnabled(settings: FoxholeMapSettingsSnapshot, layerKey: FoxholeMapTextureLayerKey): boolean {
        switch (layerKey) {
            case 'roads':
                return settings.roads;
            case 'roads_tiers':
                return settings.roadsTiers;
            case 'rdz':
                return settings.rdz;
            case 'dark_rdz':
                return settings.darkRdz;
            case 'rail_bridge':
                return settings.railBridge;
            case 'underwater_rocks_stripes':
                return settings.underwaterRocksStripes;
            default:
                return Boolean(settings[layerKey]);
        }
    }

    private async syncRegionTextureLayers(
        view: FoxholeMapRegionView,
        settings: FoxholeMapSettingsSnapshot,
        textureSignature: string,
    ): Promise<void> {
        if (view.textureSignature === textureSignature) {
            return;
        }
        if (view.textureSyncPromise) {
            await view.textureSyncPromise;
            if (view.textureSignature === textureSignature) {
                return;
            }
        }

        view.textureSyncPromise = this.performRegionTextureSync(view, settings, textureSignature);
        try {
            await view.textureSyncPromise;
        } finally {
            view.textureSyncPromise = null;
        }
    }

    private async performRegionTextureSync(
        view: FoxholeMapRegionView,
        settings: FoxholeMapSettingsSnapshot,
        textureSignature: string,
    ): Promise<void> {
        const baseTexturePath = this.resolveBaseRegionTexturePath(view.region, settings);
        const currentBasePath = String(view.sprite.label ?? '');
        if (currentBasePath !== baseTexturePath) {
            const modTextureUrl = baseTexturePath.startsWith('mapmod:')
                ? this.resolveModRegionTextureUrl(view.region)
                : null;
            view.sprite.texture = await this.loadRegionTexture(baseTexturePath, modTextureUrl);
            view.sprite.label = baseTexturePath;
        }

        const overlaySignature = this.getOverlaySettingsSignature(settings);
        this.queueOverlayTextureSync(view, overlaySignature);
        view.textureSignature = textureSignature;
    }

    private queueOverlayTextureSync(view: FoxholeMapRegionView, overlaySignature: string): void {
        if (view.overlaySignature === overlaySignature) {
            return;
        }

        view.overlaySignature = overlaySignature;
        this.pendingOverlayRegionKeys.add(view.region.key);
        this.scheduleOverlayTextureSync();
    }

    private scheduleOverlayTextureSync(): void {
        if (this.overlaySyncScheduled) {
            return;
        }

        this.overlaySyncScheduled = true;
        window.setTimeout(() => {
            void this.processOverlayTextureQueue();
        }, 0);
    }

    private async processOverlayTextureQueue(): Promise<void> {
        this.overlaySyncScheduled = false;
        if (!this.pendingOverlayRegionKeys.size) {
            return;
        }

        const settings = this.context.readMapSettings();
        const overlaySignature = this.getOverlaySettingsSignature(settings);
        const nextRegionKeys = Array.from(this.pendingOverlayRegionKeys).slice(0, 6);
        for (const regionKey of nextRegionKeys) {
            this.pendingOverlayRegionKeys.delete(regionKey);
        }

        await Promise.all(nextRegionKeys.map(async regionKey => {
            const view = this.regionViewByKey.get(regionKey);
            if (!view || view.overlaySignature !== overlaySignature) {
                return;
            }
            await this.syncRegionOverlayTextures(view, settings);
        }));

        if (this.pendingOverlayRegionKeys.size) {
            this.scheduleOverlayTextureSync();
        }
    }

    private async syncRegionOverlayTextures(
        view: FoxholeMapRegionView,
        settings: FoxholeMapSettingsSnapshot,
    ): Promise<void> {
        for (const [index, layerDefinition] of FOXHOLE_MAP_TEXTURE_LAYER_DEFINITIONS.entries()) {
            const enabled = this.isTextureLayerEnabled(settings, layerDefinition.key);
            let sprite = view.textureLayers[layerDefinition.key];

            if (!enabled) {
                if (sprite) {
                    sprite.visible = false;
                }
                continue;
            }

            const texturePath = `maps/IMM/${layerDefinition.directory}/${view.region.textureKey}.webp`;
            if (!sprite) {
                sprite = new PIXI.Sprite(await this.loadRegionTexture(texturePath));
                sprite.anchor.set(0.5);
                sprite.width = FOXHOLE_REGION_WIDTH;
                sprite.height = FOXHOLE_REGION_HEIGHT;
                sprite.zIndex = index + 1;
                sprite.label = texturePath;
                view.container.addChild(sprite);
                view.textureLayers[layerDefinition.key] = sprite;
            } else if (sprite.label !== texturePath) {
                sprite.texture = await this.loadRegionTexture(texturePath);
                sprite.label = texturePath;
            }

            sprite.visible = true;
        }
    }

    private getShowIconsAndLabels(): boolean {
        return (1 / Math.max(this.context.getZoom(), 0.0001)) < FoxholeMapRenderer.LIVE_OVERLAY_MAX_BASE_ZOOM;
    }

    private getShowGrid(): boolean {
        if (!this.context.readMapSettings().grid) {
            return false;
        }

        return (1 / Math.max(this.context.getZoom(), 0.0001)) < FoxholeMapRenderer.GRID_MAX_BASE_ZOOM;
    }

    private async syncRegionLiveData(view: FoxholeMapRegionView, data: FoxholeMapServerRegionData | undefined): Promise<void> {
        const settings = this.context.readMapSettings();
        const tasks: Array<Promise<void>> = [];

        tasks.push(this.syncRegionVictoryBaseBadge(view, data?.icons));

        if (settings.hotspots) {
            tasks.push(this.syncRegionActivityHeat(view, data?.reports, data?.labels));
        } else {
            this.clearRegionActivityHeat(view);
        }

        if (settings.majorLabels || settings.minorLabels) {
            tasks.push(this.syncRegionLabels(view, data?.labels));
        } else {
            this.clearRegionLabels(view);
        }

        if (settings.voronoi || settings.faction || settings.frontline || settings.frontAlt) {
            tasks.push(this.syncRegionVoronoi(view, data?.labels));
        } else {
            this.clearRegionVoronoi(view);
        }

        if (settings.icons) {
            tasks.push(this.syncRegionIcons(view, data?.icons));
        } else {
            this.clearRegionIcons(view);
        }

        await Promise.all(tasks);
    }

    private clearRegionActivityHeat(view: FoxholeMapRegionView): void {
        if (!view.activityHeatSignature && view.activityHeatIntensity === 0) {
            return;
        }

        view.activityHeatSignature = '';
        view.activityHeatIntensity = 0;
        view.subregionHeatGraphics.visible = false;
        view.subregionHeatGraphics.alpha = 0;
        view.subregionHeatGraphics.clear();
    }

    private clearRegionLabels(view: FoxholeMapRegionView): void {
        if (view.liveLabelsVersion === null && !view.majorLabels.children.length && !view.minorLabels.children.length) {
            return;
        }

        view.liveLabelsVersion = null;
        view.majorLabels.removeChildren().forEach(child => child.destroy());
        view.minorLabels.removeChildren().forEach(child => child.destroy());
    }

    private clearRegionVoronoi(view: FoxholeMapRegionView): void {
        if (!view.voronoiCells.length && !view.voronoiLayoutSignature && !view.voronoiStyleSignature && !view.voronoiRenderSignature) {
            return;
        }

        view.voronoiCells = [];
        view.voronoiLayoutSignature = '';
        view.voronoiStyleSignature = '';
        view.voronoiRenderSignature = '';
        view.subregionFillGraphics.clear();
        view.subregionLineGraphics.clear();
    }

    private clearRegionIcons(view: FoxholeMapRegionView): void {
        if (view.liveIconsVersion === null && !view.liveIcons.children.length) {
            return;
        }

        view.liveIconsVersion = null;
        view.liveIcons.removeChildren().forEach(child => child.destroy({ children: true }));
    }

    private async syncRegionActivityHeat(
        view: FoxholeMapRegionView,
        reports: FoxholeMapReportData | undefined,
        labels: FoxholeMapServerLayer<FoxholeMapLabelData> | undefined,
    ): Promise<void> {
        const heatAnchors = this.resolveRegionHeatAnchors(view, labels?.items ?? []);
        const intensity = this.computeRegionHeatIntensity(view.region.key, reports);
        const nextSignature = JSON.stringify({
            version: reports?.version ?? null,
            totalEnlistments: reports?.totalEnlistments ?? null,
            colonialHourlyCasualties: reports?.factions?.colonial?.totalHourlyCasualties ?? null,
            wardenHourlyCasualties: reports?.factions?.warden?.totalHourlyCasualties ?? null,
            dayOfWar: reports?.dayOfWar ?? null,
            anchors: heatAnchors.map(anchor => [
                Number(anchor.x.toFixed(1)),
                Number(anchor.y.toFixed(1)),
                Number(anchor.weight.toFixed(3)),
            ]),
            intensity: Number(intensity.toFixed(4)),
        });
        if (view.activityHeatSignature === nextSignature) {
            return;
        }

        view.activityHeatSignature = nextSignature;
        view.activityHeatIntensity = intensity;
        view.subregionHeatGraphics.clear();
        view.subregionHeatGraphics.visible = intensity > 0;
        if (intensity <= 0) {
            view.subregionHeatGraphics.alpha = 0;
            return;
        }

        const baseRadius = Math.min(FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT) * (0.108 + (intensity * 0.085));
        const heatPalette = this.resolveRegionHeatPalette(intensity);
        for (const anchor of heatAnchors) {
            const weightedIntensity = intensity * anchor.weight;
            const outerRadius = baseRadius * (1.95 + (anchor.weight * 0.8));
            const middleRadius = outerRadius * 0.68;
            const coreRadius = outerRadius * 0.38;

            drawFoxholeMapHeatCircle(view.subregionHeatGraphics, anchor.x, anchor.y, outerRadius, {
                color: heatPalette.outerColor,
                alpha: heatPalette.outerBaseAlpha + (weightedIntensity * heatPalette.outerAlphaBoost),
            });
            drawFoxholeMapHeatCircle(view.subregionHeatGraphics, anchor.x, anchor.y, middleRadius, {
                color: heatPalette.middleColor,
                alpha: heatPalette.middleBaseAlpha + (weightedIntensity * heatPalette.middleAlphaBoost),
            });
            drawFoxholeMapHeatCircle(view.subregionHeatGraphics, anchor.x, anchor.y, coreRadius, {
                color: heatPalette.coreColor,
                alpha: heatPalette.coreBaseAlpha + (weightedIntensity * heatPalette.coreAlphaBoost),
            });

            const offsetX = (anchor.weight - 0.35) * 3200;
            const offsetY = (0.6 - anchor.weight) * 2600;
            drawFoxholeMapHeatCircle(view.subregionHeatGraphics, anchor.x + offsetX, anchor.y + offsetY, coreRadius * 0.68, {
                color: heatPalette.highlightColor,
                alpha: heatPalette.highlightBaseAlpha + (weightedIntensity * heatPalette.highlightAlphaBoost),
            });

            drawFoxholeMapHeatCircle(view.subregionHeatGraphics, anchor.x - (offsetX * 0.45), anchor.y + (offsetY * 0.2), middleRadius * 0.72, {
                color: heatPalette.accentColor,
                alpha: heatPalette.accentBaseAlpha + (weightedIntensity * heatPalette.accentAlphaBoost),
            });
        }

        view.subregionHeatGraphics.alpha = this.computeRegionHeatPulse(performance.now(), intensity, view.revealOrder);
    }

    private async syncRegionLabels(
        view: FoxholeMapRegionView,
        labels: FoxholeMapServerLayer<FoxholeMapLabelData> | undefined,
    ): Promise<void> {
        const nextVersion = typeof labels?.version === 'number' ? labels.version : null;
        if (view.liveLabelsVersion === nextVersion) {
            return;
        }

        view.liveLabelsVersion = nextVersion;
        view.majorLabels.removeChildren().forEach(child => child.destroy());
        view.minorLabels.removeChildren().forEach(child => child.destroy());

        for (const mapLabel of labels?.items ?? []) {
            const label = new PIXI.Text({
                text: mapLabel.text,
                style: {
                    fill: 0xFFFFFF,
                    fontFamily: 'Jost',
                    fontSize: mapLabel.mapMarkerType === 'Major' ? 32 : 26,
                    stroke: {
                        width: 4,
                        color: 0x505050,
                    },
                },
            });
            label.anchor.set(0.5);
            label.position.set(mapLabel.x * FOXHOLE_REGION_WIDTH, mapLabel.y * FOXHOLE_REGION_HEIGHT);

            if (mapLabel.mapMarkerType === 'Major') {
                view.majorLabels.addChild(label);
            } else {
                view.minorLabels.addChild(label);
            }
        }
    }

    private async syncRegionVoronoi(
        view: FoxholeMapRegionView,
        labels: FoxholeMapServerLayer<FoxholeMapLabelData> | undefined,
    ): Promise<void> {
        const majorLabels = (labels?.items ?? []).filter(label => label.mapMarkerType === 'Major');
        if (!majorLabels.length) {
            this.clearRegionVoronoi(view);
            return;
        }

        const nextLayoutSignature = this.getVoronoiLayoutSignature(majorLabels);
        if (view.voronoiLayoutSignature === nextLayoutSignature && view.voronoiCells.length) {
            const labelsByKey = new Map(majorLabels.map(label => [this.getVoronoiLabelKey(label), label]));
            let hasStyleChanged = false;

            for (const cell of view.voronoiCells) {
                const nextLabel = labelsByKey.get(cell.key);
                const nextTeamId = nextLabel?.teamId;
                const nextCapturedTimestamp = nextLabel?.capturedTimestamp;
                if (cell.teamId !== nextTeamId || cell.capturedTimestamp !== nextCapturedTimestamp) {
                    cell.teamId = nextTeamId;
                    cell.capturedTimestamp = nextCapturedTimestamp;
                    hasStyleChanged = true;
                }
            }

            const nextStyleSignature = this.getVoronoiStyleSignature(view.voronoiCells);
            if (hasStyleChanged || view.voronoiStyleSignature !== nextStyleSignature) {
                view.voronoiStyleSignature = nextStyleSignature;
                if (this.context.readMapSettings().faction) {
                    view.voronoiRenderSignature = '';
                }
            }

            return;
        }

        const nextVoronoiCells = this.buildVoronoiCells(majorLabels);

        view.voronoiCells = nextVoronoiCells;
        view.voronoiLayoutSignature = nextLayoutSignature;
        view.voronoiStyleSignature = this.getVoronoiStyleSignature(nextVoronoiCells);
        view.voronoiRenderSignature = '';
    }

    private buildVoronoiCells(majorLabels: FoxholeMapLabelData[]): FoxholeVoronoiCell[] {
        if (!majorLabels.length) {
            return [];
        }

        const nextVoronoiCells: FoxholeVoronoiCell[] = [];
        const diagram = new Voronoi().compute(
            majorLabels.map(label => ({
                x: label.x * FOXHOLE_REGION_WIDTH,
                y: label.y * FOXHOLE_REGION_HEIGHT,
                mapLabel: label,
            })),
            { xl: 0, xr: FOXHOLE_REGION_WIDTH, yt: 0, yb: FOXHOLE_REGION_HEIGHT },
        );

        for (const cell of diagram.cells ?? []) {
            const xMin = FOXHOLE_REGION_WIDTH / 4;
            const xMax = FOXHOLE_REGION_WIDTH - xMin;
            let points: number[][] = [];
            let outOfBounds = false;

            for (const halfedge of cell.halfedges ?? []) {
                const point = halfedge.getStartpoint();
                if (!outOfBounds && (point.x < xMin || point.x > xMax)) {
                    outOfBounds = true;
                }
                points.push([point.x, point.y]);
            }

            if (!points.length) {
                continue;
            }

            points.push(points[0]!);
            if (outOfBounds) {
                const clipped = intersect(featureCollection([polygon([points]), this.regionPolygon]));
                points = clipped?.geometry?.coordinates?.[0] as number[][] ?? [];
            }

            if (!points.length) {
                continue;
            }

            const mapLabel = cell.site?.mapLabel;
            nextVoronoiCells.push({
                key: mapLabel ? this.getVoronoiLabelKey(mapLabel) : `${cell.site?.x ?? 0}:${cell.site?.y ?? 0}`,
                points,
                teamId: mapLabel?.teamId,
                capturedTimestamp: mapLabel?.capturedTimestamp,
            });
        }

        return nextVoronoiCells;
    }

    private async syncRegionIcons(
        view: FoxholeMapRegionView,
        icons: FoxholeMapServerLayer<{
            x: number;
            y: number;
            iconType: string | number;
            teamId?: string;
            flags?: number;
        }> | undefined,
    ): Promise<void> {
        if (!icons && view.liveIconsVersion !== null) {
            return;
        }
        const nextVersion = typeof icons?.version === 'number' ? icons.version : null;
        if (view.liveIconsVersion === nextVersion) {
            return;
        }

        view.liveIconsVersion = nextVersion;
        view.liveIcons.removeChildren().forEach(child => child.destroy({ children: true }));

        const settings = this.context.readMapSettings();
        const regionIcons = [
            ...view.region.staticIcons,
            ...(icons?.items ?? []),
        ];
        for (const iconData of regionIcons) {
            const iconMeta = FOXHOLE_MAP_ICONS[String(iconData.iconType)];
            if (!iconMeta) {
                continue;
            }

            const texture = await this.loadMapIconTexture(iconMeta.key);
            const container = new PIXI.Container() as FoxholeLiveIconContainer;
            container.position.set(iconData.x * FOXHOLE_REGION_WIDTH, iconData.y * FOXHOLE_REGION_HEIGHT);
            container.label = `foxhole-map-icon:${view.region.key}:${iconMeta.key}`;
            container.eventMode = this.pointerInteractionsEnabled ? 'static' : 'none';
            container.data = iconData;
            const hoverTooltipData = {
                ...this.resolveMapIconHoverTooltipData(iconMeta),
                factionLabel: this.getMapIconFactionLabel(iconData.teamId),
                factionColor: this.getMapIconFactionLabelColor(iconData.teamId),
                isScorched: typeof iconData.flags === 'number' && (iconData.flags & FOXHOLE_MAP_FLAG_IS_SCORCHED) !== 0,
            };
            this.presentationHoverData.set(container, hoverTooltipData);
            container.on('pointerover', (event: PIXI.FederatedPointerEvent) => {
                if (
                    !this.pointerInteractionsEnabled
                    || this.isViewportDragging
                    || !this.isPointerOverCanvas(event.clientX, event.clientY)
                ) {
                    return;
                }
                this.setHoveredIcon(hoverTooltipData, { x: event.clientX, y: event.clientY });
            });
            container.on('pointermove', (event: PIXI.FederatedPointerEvent) => {
                if (
                    this.pointerInteractionsEnabled
                    && !this.isViewportDragging
                    && this.isPointerOverCanvas(event.clientX, event.clientY)
                    && this.hoveredIconName === iconMeta.name
                    && this.hoveredTooltipData
                ) {
                    this.setHoveredIcon(this.hoveredTooltipData, { x: event.clientX, y: event.clientY });
                }
            });
            container.on('pointerout', () => {
                if (this.hoveredIconName === iconMeta.name) {
                    this.clearHoveredIcon();
                }
            });

            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            container.sprite = sprite;

            const isScorched = typeof iconData.flags === 'number'
                && (iconData.flags & FOXHOLE_MAP_FLAG_IS_SCORCHED) !== 0;

            if (iconData.flags && iconData.teamId && (iconData.flags & FOXHOLE_MAP_FLAG_IS_VICTORY_BASE) !== 0) {
                const background = new PIXI.Graphics();
                let fillColor = 0x9fa29f;
                if (iconData.teamId === 'COLONIALS') {
                    fillColor = 0x516C4B;
                } else if (iconData.teamId === 'WARDENS') {
                    fillColor = 0x245682;
                }
                background.alpha = 0.35;
                background
                    .circle(0, 0, 30)
                    .fill(fillColor)
                    .stroke({ width: 2, color: 0x080808 });
                container.teamBackground = background;
                container.addChild(background);
            }

            if (isScorched) {
                sprite.tint = FOXHOLE_MAP_SCORCHED_TINT;
            } else if (iconData.teamId === 'COLONIALS') {
                sprite.tint = 0x516C4B;
            } else if (iconData.teamId === 'WARDENS') {
                sprite.tint = 0x245682;
            } else if (settings.coloredIcons && iconMeta.color !== null) {
                sprite.tint = iconMeta.color;
            }

            container.addChild(sprite);
            view.liveIcons.addChild(container);
        }

        this.updateRegionIconVisibility(view, settings, this.getShowIconsAndLabels());
        const iconScale = this.getLabelIconScale();
        for (const child of view.liveIcons.children) {
            child.scale.set(iconScale);
        }
    }

    private async syncRegionVictoryBaseBadge(
        view: FoxholeMapRegionView,
        icons: FoxholeMapServerLayer<{
            x: number;
            y: number;
            iconType: string | number;
            teamId?: string;
            flags?: number;
        }> | undefined,
    ): Promise<void> {
        const liveVictoryBase = (icons?.items ?? []).find(icon => this.isVictoryBaseIcon(icon));
        const staticVictoryBase = view.region.staticIcons.find(icon => this.isVictoryBaseIcon(icon));
        const victoryBase = liveVictoryBase ?? staticVictoryBase;
        const iconMeta = victoryBase ? FOXHOLE_MAP_ICONS[String(victoryBase.iconType)] : null;
        const nextSignature = JSON.stringify(
            victoryBase
                ? {
                    iconType: victoryBase.iconType,
                    teamId: victoryBase.teamId ?? null,
                    flags: victoryBase.flags ?? null,
                }
                : null,
        );
        if (view.victoryBaseBadgeSignature === nextSignature) {
            return;
        }

        view.victoryBaseBadgeSignature = nextSignature;
        if (!victoryBase || !iconMeta) {
            this.clearRegionVictoryBaseBadge(view);
            return;
        }

        const texture = await this.loadMapIconTexture(iconMeta.key);
        if (view.victoryBaseBadgeSignature !== nextSignature) {
            return;
        }

        let sprite = view.victoryBaseBadgeSprite;
        if (!sprite) {
            sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            view.victoryBaseBadgeSprite = sprite;
            view.victoryBaseBadge.addChild(sprite);
        } else {
            sprite.texture = texture;
        }

        const fillColor = this.getMapIconFactionColor(victoryBase.teamId) ?? 0x9FA29F;
        view.victoryBaseBadgeBackground.clear();
        view.victoryBaseBadgeBackground
            .circle(0, 0, 28)
            .fill({
                color: fillColor,
                alpha: 0.18,
            })
            .stroke({
                width: 2,
                color: 0xFFF0D4,
                alpha: 0.12,
            });

        if (typeof victoryBase.flags === 'number' && (victoryBase.flags & FOXHOLE_MAP_FLAG_IS_SCORCHED) !== 0) {
            sprite.tint = FOXHOLE_MAP_SCORCHED_TINT;
        } else if (victoryBase.teamId === 'COLONIALS') {
            sprite.tint = 0x516C4B;
        } else if (victoryBase.teamId === 'WARDENS') {
            sprite.tint = 0x245682;
        } else {
            sprite.tint = 0xFFFFFF;
        }

        sprite.alpha = 0.98;
        sprite.visible = true;
        view.hasVictoryBaseBadge = true;
    }

    private clearRegionVictoryBaseBadge(view: FoxholeMapRegionView): void {
        view.hasVictoryBaseBadge = false;
        view.victoryBaseBadge.visible = false;
        view.victoryBaseBadgeBackground.clear();
        if (view.victoryBaseBadgeSprite) {
            view.victoryBaseBadgeSprite.visible = false;
        }
    }

    private isVictoryBaseIcon(icon: { flags?: number; }): boolean {
        return typeof icon.flags === 'number' && (icon.flags & FOXHOLE_MAP_FLAG_IS_VICTORY_BASE) !== 0;
    }

    private async loadMapIconTexture(iconKey: string): Promise<PIXI.Texture> {
        const cacheKey = String(iconKey ?? '').trim();
        const existing = this.iconTextureCache.get(cacheKey);
        if (existing) {
            return await existing;
        }

        const iconMeta = FOXHOLE_MAP_ICONS[cacheKey];
        const iconUrl = iconMeta ? resolveFoxholeMapIconUrl(this.context.getAssetsBaseUrl(), iconMeta) : null;
        const promise = this.context.loadTexture(iconUrl ?? '');
        this.iconTextureCache.set(cacheKey, promise);
        return await promise;
    }

    private resolveFactionFillColor(teamId?: string): number | null {
        if (teamId === 'COLONIALS') {
            return 0x00A000;
        }
        if (teamId === 'WARDENS') {
            return 0x0000FF;
        }
        return null;
    }

    private isResistancePhaseActive(): boolean {
        const warData = this.context.getWarData();
        const resistanceStart = Number(warData?.resistanceStart ?? Number.NaN);
        if (!Number.isFinite(resistanceStart)) {
            return false;
        }

        const warStart = Number(warData?.warStart ?? Number.NaN);
        if (!Number.isFinite(warStart)) {
            return true;
        }

        return resistanceStart >= warStart;
    }

    private shouldSuppressResistanceFactionColor(region: Pick<FoxholeMapRegionRecord, 'showForResistance'>): boolean {
        return !region.showForResistance && this.isResistancePhaseActive();
    }

    private canDisplayResistanceRegionData(region: Pick<FoxholeMapRegionRecord, 'showForResistance'>): boolean {
        return !this.shouldSuppressResistanceFactionColor(region);
    }

    private updateRegionResistanceAppearance(view: FoxholeMapRegionView): void {
        const suppressFactionColor = this.shouldSuppressResistanceFactionColor(view.region);
        const grayscaleFilters = suppressFactionColor ? [this.resistanceSuppressedFilter] : null;

        view.container.filters = grayscaleFilters;
        view.majorLabels.filters = grayscaleFilters;
        view.minorLabels.filters = grayscaleFilters;
        view.label.filters = grayscaleFilters;
    }

    private computeFactionAlpha(capturedTimestamp?: number): number {
        const warStart = this.context.getWarData()?.warStart;
        if (!capturedTimestamp || !warStart || capturedTimestamp === warStart) {
            return 0.15;
        }

        const factionFadeDuration = 12 * 3600000;
        const factionMinAlpha = 0.15;
        const factionMaxAlpha = 0.35;
        const referenceTimestamp = this.context.getPlaybackTimestamp() ?? Date.now();
        const elapsedPercentage = Math.min(1, Math.max(0, (referenceTimestamp - capturedTimestamp) / factionFadeDuration));
        return factionMaxAlpha + (factionMinAlpha - factionMaxAlpha) * elapsedPercentage;
    }

    private computeRegionHeatIntensity(regionKey: string, reports: FoxholeMapReportData | undefined): number {
        const currentScore = this.getRegionHeatActivityScore(reports);
        if (currentScore <= 0) {
            return 0;
        }

        const settings = this.context.readMapSettings();
        const selectedRegions = new Set(settings.regionKeys);
        const scores = Object.entries(this.liveData)
            .filter(([key]) => selectedRegions.size === 0 || selectedRegions.has(key))
            .map(([, data]) => this.getRegionHeatActivityScore(data?.reports))
            .filter(score => score > 0)
            .sort((left, right) => left - right);

        if (!scores.length) {
            return 0;
        }
        if (scores.length === 1) {
            return 1;
        }

        const peakScore = scores[scores.length - 1]!;
        const percentileIndex = Math.max(0, Math.floor((scores.length - 1) * 0.64));
        const percentileScore = scores[percentileIndex]!;
        const activationFloor = Math.max(percentileScore, peakScore * 0.32);
        if (currentScore <= activationFloor) {
            return 0;
        }

        const normalizedIntensity = (currentScore - activationFloor) / Math.max(peakScore - activationFloor, peakScore * 0.08, 1);
        const isTopRegion = currentScore === peakScore
            || currentScore >= scores[Math.max(0, scores.length - 2)]!;
        const curvedIntensity = Math.pow(Math.min(1, Math.max(0, normalizedIntensity)), isTopRegion ? 0.85 : 0.95);
        const absoluteIntensity = this.getRegionHeatAbsoluteIntensity(reports);
        return Math.min(1, Math.max(0, Math.max(curvedIntensity, absoluteIntensity)));
    }

    private getRegionHeatActivityScore(reports: FoxholeMapReportData | undefined): number {
        const colonialHourlyCasualties = Number(
            reports?.factions?.colonial?.totalHourlyCasualties
            ?? reports?.factions?.colonials?.totalHourlyCasualties
            ?? 0,
        );
        const wardenHourlyCasualties = Number(
            reports?.factions?.warden?.totalHourlyCasualties
            ?? reports?.factions?.wardens?.totalHourlyCasualties
            ?? 0,
        );
        const hourlyCasualties = colonialHourlyCasualties + wardenHourlyCasualties;
        if (Number.isFinite(hourlyCasualties) && hourlyCasualties > 0) {
            return hourlyCasualties;
        }

        const totalEnlistments = Number(reports?.totalEnlistments ?? 0);
        if (!Number.isFinite(totalEnlistments) || totalEnlistments <= 0) {
            return 0;
        }

        return Math.log10(totalEnlistments + 1);
    }

    private getRegionHeatAbsoluteIntensity(reports: FoxholeMapReportData | undefined): number {
        const colonialHourlyCasualties = Number(
            reports?.factions?.colonial?.totalHourlyCasualties
            ?? reports?.factions?.colonials?.totalHourlyCasualties
            ?? 0,
        );
        const wardenHourlyCasualties = Number(
            reports?.factions?.warden?.totalHourlyCasualties
            ?? reports?.factions?.wardens?.totalHourlyCasualties
            ?? 0,
        );
        const hourlyCasualties = colonialHourlyCasualties + wardenHourlyCasualties;
        if (!Number.isFinite(hourlyCasualties) || hourlyCasualties <= 0) {
            return 0;
        }

        return Math.pow(Math.min(1, hourlyCasualties / 800), 0.68);
    }

    private resolveRegionHeatAnchors(view: FoxholeMapRegionView, labels: FoxholeMapLabelData[]): FoxholeRegionHeatAnchor[] {
        const majorLabels = labels
            .filter(label => label.mapMarkerType === 'Major')
            .map(label => ({
                key: this.getVoronoiLabelKey(label),
                x: label.x * FOXHOLE_REGION_WIDTH,
                y: label.y * FOXHOLE_REGION_HEIGHT,
                teamId: label.teamId,
                capturedTimestamp: label.capturedTimestamp,
            }));

        if (!majorLabels.length) {
            return this.getDefaultRegionHeatAnchors();
        }

        const voronoiCells = this.getHeatAnchorVoronoiCells(view, majorLabels);
        const frontlineSegments = this.buildRegionHeatFrontlines(view, voronoiCells);
        const regionScale = Math.min(FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT);
        const candidates = majorLabels.map(label => {
            const nearestFrontline = this.getNearestFrontlineProjection([label.x, label.y], frontlineSegments);
            const frontlineProximity = nearestFrontline
                ? Math.pow(Math.max(0, 1 - (nearestFrontline.distance / (regionScale * 0.32))), 1.4)
                : 0;
            const captureFreshness = (
                typeof label.capturedTimestamp === 'number'
                && Number.isFinite(label.capturedTimestamp)
            )
                ? this.computeFrontlineFreshness(label.capturedTimestamp)
                : 0;
            const activityScore = (
                (frontlineProximity * 0.76)
                + (captureFreshness * 0.26)
                + (label.teamId === 'NONE' ? 0.12 : 0)
                + (nearestFrontline?.kind === 'contested' ? 0.08 : nearestFrontline ? 0.05 : 0)
            );
            const frontlinePull = nearestFrontline
                ? Math.min(0.44, 0.18 + (frontlineProximity * 0.2) + (captureFreshness * 0.08))
                : 0;

            return {
                anchorX: label.x + (((nearestFrontline?.point[0] ?? label.x) - label.x) * frontlinePull),
                anchorY: label.y + (((nearestFrontline?.point[1] ?? label.y) - label.y) * frontlinePull),
                score: activityScore,
            } satisfies FoxholeRegionHeatCandidate;
        });

        const strongestCandidate = candidates.reduce(
            (strongest, candidate) => Math.max(strongest, candidate.score),
            Number.NEGATIVE_INFINITY,
        );
        if (!(strongestCandidate > 0.18)) {
            return this.getLegacyRegionHeatAnchors(majorLabels);
        }

        const selectedCandidates: FoxholeRegionHeatCandidate[] = [];
        const selectedIndexes = new Set<number>();
        const maxAnchorCount = Math.min(3, candidates.length);

        while (selectedCandidates.length < maxAnchorCount) {
            let bestIndex = -1;
            let bestSelectionScore = Number.NEGATIVE_INFINITY;

            for (const [index, candidate] of candidates.entries()) {
                if (selectedIndexes.has(index)) {
                    continue;
                }

                const spacingScore = selectedCandidates.length
                    ? Math.min(
                        1,
                        Math.min(
                            ...selectedCandidates.map(selected => Math.hypot(
                                candidate.anchorX - selected.anchorX,
                                candidate.anchorY - selected.anchorY,
                            )),
                        ) / (regionScale * 0.24),
                    )
                    : 1;
                const selectionScore = candidate.score * (selectedCandidates.length ? 0.72 + (spacingScore * 0.28) : 1);
                if (selectionScore > bestSelectionScore) {
                    bestSelectionScore = selectionScore;
                    bestIndex = index;
                }
            }

            if (bestIndex < 0) {
                break;
            }

            selectedIndexes.add(bestIndex);
            selectedCandidates.push(candidates[bestIndex]!);
        }

        if (!selectedCandidates.length) {
            return this.getLegacyRegionHeatAnchors(majorLabels);
        }

        const anchorWeights = this.getRegionHeatAnchorWeights(selectedCandidates.length);
        return selectedCandidates.map((candidate, index) => ({
            x: candidate.anchorX,
            y: candidate.anchorY,
            weight: anchorWeights[index] ?? 0.16,
        }));
    }

    private getHeatAnchorVoronoiCells(
        view: FoxholeMapRegionView,
        majorLabels: Array<{
            key: string;
            x: number;
            y: number;
            teamId?: string;
            capturedTimestamp?: number;
        }>,
    ): FoxholeVoronoiCell[] {
        const nextLayoutSignature = majorLabels
            .map(label => label.key)
            .sort()
            .join('|');

        if (view.voronoiLayoutSignature === nextLayoutSignature && view.voronoiCells.length) {
            const labelsByKey = new Map(majorLabels.map(label => [label.key, label]));
            return view.voronoiCells.map(cell => {
                const nextLabel = labelsByKey.get(cell.key);
                return {
                    key: cell.key,
                    points: cell.points,
                    teamId: nextLabel?.teamId,
                    capturedTimestamp: nextLabel?.capturedTimestamp,
                } satisfies FoxholeVoronoiCell;
            });
        }

        return this.buildVoronoiCells(majorLabels.map(label => ({
            x: label.x / FOXHOLE_REGION_WIDTH,
            y: label.y / FOXHOLE_REGION_HEIGHT,
            text: label.key,
            mapMarkerType: 'Major',
            teamId: label.teamId,
            capturedTimestamp: label.capturedTimestamp,
        })));
    }

    private buildRegionHeatFrontlines(
        view: FoxholeMapRegionView,
        cells: FoxholeVoronoiCell[],
    ): FoxholeFrontlineSegment[] {
        if (!cells.length) {
            return [];
        }

        const suppressFactionColor = this.shouldSuppressResistanceFactionColor(view.region);
        return this.buildGlobalFrontlineOverlay(cells.map(cell => ({
            key: `${view.region.key}:${cell.key}`,
            regionKey: view.region.key,
            points: cell.points,
            teamId: suppressFactionColor ? undefined : cell.teamId,
            casualtyIntensity: 0,
            capturedTimestamp: cell.capturedTimestamp,
        })));
    }

    private getNearestFrontlineProjection(
        point: number[],
        frontlines: FoxholeFrontlineSegment[],
    ): FoxholeRegionHeatProjection | null {
        let nearestProjection: FoxholeRegionHeatProjection | null = null;

        for (const frontline of frontlines) {
            const projectedPoint = this.getClosestPointOnSegment(point, frontline.start, frontline.end);
            const distance = Math.hypot(
                (projectedPoint[0] ?? 0) - (point[0] ?? 0),
                (projectedPoint[1] ?? 0) - (point[1] ?? 0),
            );
            if (!nearestProjection || distance < nearestProjection.distance) {
                nearestProjection = {
                    point: projectedPoint,
                    distance,
                    kind: frontline.kind,
                };
            }
        }

        return nearestProjection;
    }

    private getClosestPointOnSegment(
        point: number[],
        start: number[],
        end: number[],
    ): [number, number] {
        const startX = start[0] ?? 0;
        const startY = start[1] ?? 0;
        const deltaX = (end[0] ?? 0) - startX;
        const deltaY = (end[1] ?? 0) - startY;
        const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
        if (lengthSquared <= 0) {
            return [startX, startY];
        }

        const projection = (((point[0] ?? 0) - startX) * deltaX) + (((point[1] ?? 0) - startY) * deltaY);
        const ratio = Math.min(1, Math.max(0, projection / lengthSquared));
        return [
            startX + (deltaX * ratio),
            startY + (deltaY * ratio),
        ];
    }

    private getRegionHeatAnchorWeights(count: number): number[] {
        if (count <= 1) {
            return [0.82];
        }
        if (count === 2) {
            return [0.66, 0.34];
        }

        return [0.56, 0.28, 0.16];
    }

    private getDefaultRegionHeatAnchors(): FoxholeRegionHeatAnchor[] {
        return [
            { x: FOXHOLE_REGION_WIDTH * 0.5, y: FOXHOLE_REGION_HEIGHT * 0.52, weight: 0.58 },
            { x: FOXHOLE_REGION_WIDTH * 0.4, y: FOXHOLE_REGION_HEIGHT * 0.43, weight: 0.26 },
            { x: FOXHOLE_REGION_WIDTH * 0.62, y: FOXHOLE_REGION_HEIGHT * 0.63, weight: 0.16 },
        ];
    }

    private getLegacyRegionHeatAnchors(
        majorLabels: Array<{
            x: number;
            y: number;
        }>,
    ): FoxholeRegionHeatAnchor[] {
        if (!majorLabels.length) {
            return this.getDefaultRegionHeatAnchors();
        }

        const centroid = majorLabels.reduce(
            (sum, label) => ({ x: sum.x + label.x, y: sum.y + label.y }),
            { x: 0, y: 0 },
        );
        const centerAnchor = {
            x: centroid.x / majorLabels.length,
            y: centroid.y / majorLabels.length,
        };
        const anchors = [centerAnchor];

        if (majorLabels.length > 1) {
            let furthestFromCenter = majorLabels[0]!;
            let furthestFromCenterDistance = Number.NEGATIVE_INFINITY;
            for (const label of majorLabels) {
                const distance = Math.hypot(label.x - centerAnchor.x, label.y - centerAnchor.y);
                if (distance > furthestFromCenterDistance) {
                    furthestFromCenterDistance = distance;
                    furthestFromCenter = label;
                }
            }
            anchors.push(furthestFromCenter);
        }

        if (majorLabels.length > 2) {
            let furthestSpread = majorLabels[0]!;
            let furthestSpreadDistance = Number.NEGATIVE_INFINITY;
            for (const label of majorLabels) {
                const distance = anchors.reduce(
                    (total, anchor) => total + Math.hypot(label.x - anchor.x, label.y - anchor.y),
                    0,
                );
                if (distance > furthestSpreadDistance) {
                    furthestSpreadDistance = distance;
                    furthestSpread = label;
                }
            }
            anchors.push(furthestSpread);
        }

        return anchors.slice(0, 3).map((anchor, index) => ({
            x: anchor.x,
            y: anchor.y,
            weight: index === 0 ? 0.56 : index === 1 ? 0.28 : 0.16,
        }));
    }

    private computeRegionHeatPulse(currentTime: number, intensity: number, revealOrder: number): number {
        if (intensity <= 0) {
            return 0;
        }

        const pulse = Math.sin((currentTime / FoxholeMapRenderer.ACTIVITY_HEAT_PULSE_PERIOD_MS) + (revealOrder * 0.65));
        const pulseScale = 0.96 + ((pulse + 1) * 0.08);
        return Math.min(1, (0.82 + (intensity * 0.28)) * pulseScale);
    }

    private getVoronoiLabelKey(label: FoxholeMapLabelData): string {
        return [
            label.text,
            label.mapMarkerType ?? '',
            Math.round(label.x * 1000),
            Math.round(label.y * 1000),
        ].join(':');
    }

    private getVoronoiLayoutSignature(labels: FoxholeMapLabelData[]): string {
        return labels
            .map(label => this.getVoronoiLabelKey(label))
            .sort()
            .join('|');
    }

    private getVoronoiStyleSignature(cells: FoxholeVoronoiCell[]): string {
        return cells
            .map(cell => `${cell.key}:${cell.teamId ?? ''}:${cell.capturedTimestamp ?? ''}`)
            .sort()
            .join('|');
    }

    private getVoronoiRenderSignature(
        view: FoxholeMapRegionView,
        lineThickness: number,
        showVoronoi: boolean,
        showFaction: boolean,
    ): string {
        return JSON.stringify({
            lineThickness: Number(lineThickness.toFixed(3)),
            showVoronoi,
            showFaction,
            suppressFactionColor: this.shouldSuppressResistanceFactionColor(view.region),
            factionTimeBucket: showFaction
                ? Math.floor((this.context.getPlaybackTimestamp() ?? Date.now()) / FoxholeMapRenderer.FACTION_RENDER_BUCKET_MS)
                : null,
            styleSignature: showFaction ? view.voronoiStyleSignature : null,
        });
    }

    private redrawRegionVoronoiIfNeeded(
        view: FoxholeMapRegionView,
        lineThickness: number,
        showVoronoi: boolean,
        showFaction: boolean,
    ): void {
        const nextRenderSignature = this.getVoronoiRenderSignature(view, lineThickness, showVoronoi, showFaction);
        if (view.voronoiRenderSignature === nextRenderSignature) {
            return;
        }

        const fillSignature = this.getVoronoiRenderSignature(view, 0, false, showFaction);
        const redrawFill = !view.voronoiRenderSignature || view.voronoiFillSignature !== fillSignature;
        this.redrawRegionVoronoi(view, lineThickness, showVoronoi, showFaction, redrawFill);
        view.voronoiFillSignature = fillSignature;
        view.voronoiRenderSignature = nextRenderSignature;
    }

    private redrawRegionVoronoi(
        view: FoxholeMapRegionView,
        lineThickness: number,
        showVoronoi: boolean,
        showFaction: boolean,
        redrawFill: boolean,
    ): void {
        const fillGraphics = view.subregionFillGraphics;
        const lineGraphics = view.subregionLineGraphics;
        const suppressFactionColor = this.shouldSuppressResistanceFactionColor(view.region);
        if (redrawFill) fillGraphics.clear();
        lineGraphics.clear();
        lineGraphics.alpha = showVoronoi ? 0.15 : 1;

        for (const cell of view.voronoiCells) {
            const points = cell.points;
            if (!points.length) {
                continue;
            }

            if (showVoronoi) this.drawPolyline(lineGraphics, points);

            const fillColor = this.resolveFactionFillColor(cell.teamId);
            if (redrawFill && showFaction && !suppressFactionColor && fillColor !== null) {
                const fillAlpha = cell.teamId && cell.teamId !== 'NONE'
                    ? this.computeFactionAlpha(cell.capturedTimestamp)
                    : 0.15;
                this.drawPolyline(fillGraphics, points);
                fillGraphics.fill({
                    color: fillColor,
                    alpha: fillAlpha,
                });
            }
        }

        if (showVoronoi) {
            lineGraphics.stroke({
                width: lineThickness,
                color: 0x000000,
            });
        }
    }

    private setFrontlineRenderMode(useAltFrontline: boolean, zoom = this.context.getZoom()): void {
        const nextMode = useAltFrontline ? 'front-alt' : 'default';
        if (this.frontlineRenderMode !== nextMode) {
            this.clearFrontlines();
            this.frontlines.removeChildren();
            this.frontlineSource.removeChildren();

            if (useAltFrontline) {
                this.frontlineSource.addChild(this.frontlineShadow);
                this.frontlineSource.addChild(this.frontlineGlow);
                this.frontlineSource.addChild(this.frontlineCore);
                this.frontlines.addChild(this.frontlineSprite);
                this.frontlines.filters = [this.frontlineBlurFilter];
            } else {
                this.frontlines.addChild(this.frontlineShadow);
                this.frontlines.addChild(this.frontlineGlow);
                this.frontlines.addChild(this.frontlineCore);
                this.frontlines.filters = null;
            }

            this.frontlineRenderMode = nextMode;
        }

        if (useAltFrontline) {
            this.frontlineBlurFilter.strength = this.getFrontlineBlurStrength(Math.max(zoom, 0.0001));
            if (this.frontlines.filterArea) {
                this.frontlines.filterArea = undefined;
            }
        }
    }

    private clearFrontlines(): void {
        this.frontlineLayoutSignature = '';
        this.frontlineStyleSignature = '';
        this.frontlineRenderSignature = '';
        this.frontlineSegments = [];
        this.frontlineShadow.clear();
        this.frontlineGlow.clear();
        this.frontlineCore.clear();
        this.frontlineSprite.visible = false;
        this.frontlineSprite.texture = PIXI.Texture.EMPTY;
        if (this.frontlineTexture) {
            this.frontlineTexture.destroy(true);
            this.frontlineTexture = null;
        }
    }

    private redrawFrontlinesIfNeeded(lineThickness: number): void {
        if (this.frontlineRenderMode === 'front-alt') {
            this.redrawAltFrontlinesIfNeeded(lineThickness);
            return;
        }

        this.redrawDefaultFrontlinesIfNeeded(lineThickness);
    }

    private redrawDefaultFrontlinesIfNeeded(lineThickness: number): void {
        const visibleFrontlineState = this.collectVisibleFrontlineState();
        if (!visibleFrontlineState || visibleFrontlineState.cells.length < 2) {
            if (this.frontlineRenderSignature || this.frontlineSegments.length) {
                this.clearFrontlines();
            }
            return;
        }

        if (
            this.frontlineLayoutSignature !== visibleFrontlineState.layoutSignature
            || this.frontlineStyleSignature !== visibleFrontlineState.styleSignature
        ) {
            this.frontlineSegments = this.buildGlobalFrontlineOverlay(visibleFrontlineState.cells);
            this.frontlineLayoutSignature = visibleFrontlineState.layoutSignature;
            this.frontlineStyleSignature = visibleFrontlineState.styleSignature;
            this.frontlineRenderSignature = '';
        }

        const nextSignature = JSON.stringify({
            renderMode: 'default',
            lineThickness: Number(lineThickness.toFixed(3)),
            layoutSignature: this.frontlineLayoutSignature,
            styleSignature: this.frontlineStyleSignature,
            frontlines: this.frontlineSegments
                .map(frontline => {
                    const casualtyBucket = Number(frontline.casualtyIntensity.toFixed(3));
                    return `${this.getFrontlinePointKey(frontline.start)}>${this.getFrontlinePointKey(frontline.end)}:${frontline.kind}:${casualtyBucket}`;
                })
                .sort(),
        });
        if (this.frontlineRenderSignature === nextSignature) {
            return;
        }

        this.frontlineRenderSignature = nextSignature;
        this.frontlineShadow.clear();
        this.frontlineGlow.clear();
        this.frontlineCore.clear();

        const renderGroups = this.buildFrontlineRenderGroups(this.frontlineSegments);
        for (const renderGroup of renderGroups) {
            const palette = this.resolveFrontlinePalette(renderGroup.kind, renderGroup.casualtyIntensity);

            for (const polyline of renderGroup.polylines) {
                this.drawFrontlinePolyline(this.frontlineShadow, polyline);
                this.frontlineShadow.stroke({
                    width: lineThickness * 7.4,
                    color: palette.shadowColor,
                    alpha: palette.shadowAlpha,
                    cap: 'round',
                    join: 'round',
                });

                this.drawFrontlinePolyline(this.frontlineGlow, polyline);
                this.frontlineGlow.stroke({
                    width: lineThickness * 5.6,
                    color: palette.glowColor,
                    alpha: palette.glowAlpha,
                    cap: 'round',
                    join: 'round',
                });

                this.drawFrontlinePolyline(this.frontlineCore, polyline);
                this.frontlineCore.stroke({
                    width: Math.max(lineThickness * 1.75, lineThickness + 1.5),
                    color: palette.coreColor,
                    alpha: palette.coreAlpha,
                    cap: 'round',
                    join: 'round',
                });
            }
        }
    }

    private redrawAltFrontlinesIfNeeded(lineThickness: number): void {
        const visibleFrontlineState = this.collectVisibleFrontlineState();
        if (!visibleFrontlineState || visibleFrontlineState.cells.length < 2) {
            if (this.frontlineRenderSignature || this.frontlineSegments.length) {
                this.clearFrontlines();
            }
            return;
        }

        if (
            this.frontlineLayoutSignature !== visibleFrontlineState.layoutSignature
            || this.frontlineStyleSignature !== visibleFrontlineState.styleSignature
        ) {
            this.frontlineSegments = this.buildGlobalFrontlineOverlay(visibleFrontlineState.cells);
            this.frontlineLayoutSignature = visibleFrontlineState.layoutSignature;
            this.frontlineStyleSignature = visibleFrontlineState.styleSignature;
            this.frontlineRenderSignature = '';
        }

        const nextSignature = JSON.stringify({
            renderMode: 'front-alt',
            renderVersion: FoxholeMapRenderer.FRONTLINE_RENDER_VERSION,
            lineThickness: Number(lineThickness.toFixed(3)),
            layoutSignature: this.frontlineLayoutSignature,
            styleSignature: this.frontlineStyleSignature,
            frontlines: this.frontlineSegments
                .map(frontline => {
                    const casualtyBucket = Number(frontline.casualtyIntensity.toFixed(3));
                    return `${this.getFrontlinePointKey(frontline.start)}>${this.getFrontlinePointKey(frontline.end)}:${frontline.kind}:${casualtyBucket}`;
                })
                .sort(),
        });
        if (this.frontlineRenderSignature === nextSignature) {
            return;
        }

        this.frontlineRenderSignature = nextSignature;
        this.frontlineShadow.clear();
        this.frontlineGlow.clear();
        this.frontlineCore.clear();
        this.frontlineSprite.visible = false;

        const palette = this.resolveUnifiedFrontlinePalette();
        for (const polyline of this.buildFrontlinePolylines(this.frontlineSegments)) {
            const renderPath = this.buildFrontlineRenderPath(polyline);
            if (renderPath.centerline.length < 2) {
                continue;
            }

            this.fillFrontlineAreaCloud(
                this.frontlineShadow,
                renderPath,
                {
                    radius: lineThickness * 7.2,
                    spread: lineThickness * 19,
                    lateralBands: 3,
                    color: palette.shadowColor,
                    alpha: Math.max(0.12, palette.shadowAlpha * 0.54),
                },
            );
            this.fillFrontlineAreaCloud(
                this.frontlineGlow,
                renderPath,
                {
                    radius: lineThickness * 5.6,
                    spread: lineThickness * 13.4,
                    lateralBands: 3,
                    color: palette.glowColor,
                    alpha: Math.max(0.15, palette.glowAlpha * 0.62),
                },
            );
            this.fillFrontlineAreaCloud(
                this.frontlineCore,
                renderPath,
                {
                    radius: lineThickness * 4.2,
                    spread: lineThickness * 7.8,
                    lateralBands: 2,
                    color: palette.coreColor,
                    alpha: Math.max(0.2, palette.coreAlpha * 0.42),
                },
            );
        }

        this.refreshFrontlineTexture();
    }

    private refreshFrontlineTexture(): void {
        const sourceBounds = this.frontlineSource.getLocalBounds();
        if (sourceBounds.width <= 0 || sourceBounds.height <= 0) {
            this.frontlineSprite.visible = false;
            this.frontlineSprite.texture = PIXI.Texture.EMPTY;
            if (this.frontlineTexture) {
                this.frontlineTexture.destroy(true);
                this.frontlineTexture = null;
            }
            return;
        }

        const padding = Math.max(FOXHOLE_REGION_WIDTH * 0.08, FOXHOLE_REGION_HEIGHT * 0.08);
        const frame = new PIXI.Rectangle(
            sourceBounds.x - padding,
            sourceBounds.y - padding,
            sourceBounds.width + (padding * 2),
            sourceBounds.height + (padding * 2),
        );
        const nextTexture = this.context.app.renderer.generateTexture({
            target: this.frontlineSource,
            frame,
            resolution: FoxholeMapRenderer.FRONTLINE_TEXTURE_RESOLUTION,
            antialias: true,
            clearColor: [0, 0, 0, 0],
        }) as PIXI.RenderTexture;
        const previousTexture = this.frontlineTexture;

        this.frontlineTexture = nextTexture;
        this.frontlineSprite.texture = nextTexture;
        this.frontlineSprite.position.set(frame.x, frame.y);
        this.frontlineSprite.visible = true;

        if (previousTexture) {
            previousTexture.destroy(true);
        }
    }

    private getFrontlineBlurStrength(zoom: number): number {
        const zoomRatio = zoom / FoxholeMapRenderer.FRONTLINE_BLUR_REFERENCE_ZOOM;
        const compensatedStrength = FoxholeMapRenderer.FRONTLINE_BLUR_BASE_STRENGTH
            * Math.sqrt(Math.max(zoomRatio, 0));

        return Math.min(
            FoxholeMapRenderer.FRONTLINE_BLUR_MAX_STRENGTH,
            Math.max(FoxholeMapRenderer.FRONTLINE_BLUR_MIN_STRENGTH, compensatedStrength),
        );
    }

    private collectVisibleFrontlineState(): {
        cells: FoxholeFrontlineWorldCell[];
        layoutSignature: string;
        styleSignature: string;
    } | null {
        const visibleRegionKeys: string[] = [];
        const cells: FoxholeFrontlineWorldCell[] = [];

        for (const view of this.regionViews) {
            if (!view.container.visible) {
                continue;
            }

            visibleRegionKeys.push(view.region.key);
            const casualtyIntensity = this.computeRegionHeatIntensity(view.region.key, this.liveData[view.region.key]?.reports);

            const suppressFactionColor = this.shouldSuppressResistanceFactionColor(view.region);
            for (const cell of view.voronoiCells) {
                if (!cell.points.length) {
                    continue;
                }

                cells.push({
                    key: `${view.region.key}:${cell.key}`,
                    regionKey: view.region.key,
                    points: this.getWorldVoronoiCellPoints(view.region, cell.points),
                    teamId: suppressFactionColor ? undefined : cell.teamId,
                    casualtyIntensity,
                    capturedTimestamp: cell.capturedTimestamp,
                });
            }
        }

        if (!cells.length) {
            return null;
        }

        return {
            cells,
            layoutSignature: JSON.stringify({
                regions: visibleRegionKeys.sort(),
                cells: cells.map(cell => `${cell.key}:${cell.points.map(point => this.getFrontlinePointKey(point)).join('>')}`),
            }),
            styleSignature: JSON.stringify(
                cells.map(cell => `${cell.key}:${cell.teamId ?? ''}:${cell.capturedTimestamp ?? ''}:${Number(cell.casualtyIntensity.toFixed(4))}`),
            ),
        };
    }

    private buildGlobalFrontlineOverlay(
        cells: FoxholeFrontlineWorldCell[],
    ): FoxholeFrontlineSegment[] {
        if (!cells.length) {
            return [];
        }

        const frontlines: FoxholeFrontlineSegment[] = [];
        const factionSegments: FoxholeFrontlineSegmentEntry[] = [];
        const exactSharedSegments = new Map<string, FoxholeFrontlineSegmentEntry[]>();
        const frontlineSegmentKeys = new Set<string>();

        for (const cell of cells) {
            for (let index = 0; index < cell.points.length - 1; index += 1) {
                const start = cell.points[index];
                const end = cell.points[index + 1];
                if (!start || !end || this.getSegmentLength(start, end) < 12) {
                    continue;
                }

                const segmentKey = this.getFrontlineSegmentKey(start, end);
                const renderableTeamId = this.getFrontlineTeamId(cell.teamId);
                if (renderableTeamId) {
                    const entry = {
                        start,
                        end,
                        kind: 'contested',
                        casualtyIntensity: cell.casualtyIntensity,
                        regionKey: cell.regionKey,
                        teamId: renderableTeamId,
                        capturedTimestamp: cell.capturedTimestamp,
                    } satisfies FoxholeFrontlineSegmentEntry;
                    factionSegments.push(entry);
                    const existing = exactSharedSegments.get(segmentKey) ?? [];
                    existing.push(entry);
                    exactSharedSegments.set(segmentKey, existing);
                }
            }
        }

        for (const [segmentKey, entries] of exactSharedSegments.entries()) {
            const match = this.resolveFrontlinePair(entries);
            if (!match) {
                continue;
            }

            frontlineSegmentKeys.add(segmentKey);
            frontlines.push({
                start: match.leftEntry.start,
                end: match.leftEntry.end,
                kind: match.kind,
                casualtyIntensity: Math.max(match.leftEntry.casualtyIntensity, match.rightEntry.casualtyIntensity),
                capturedTimestamp: Math.max(
                    Number(match.leftEntry.capturedTimestamp ?? Number.NEGATIVE_INFINITY),
                    Number(match.rightEntry.capturedTimestamp ?? Number.NEGATIVE_INFINITY),
                ),
            });
        }

        for (let index = 0; index < factionSegments.length; index += 1) {
            const leftSegment = factionSegments[index];
            if (!leftSegment) {
                continue;
            }

            for (let otherIndex = index + 1; otherIndex < factionSegments.length; otherIndex += 1) {
                const rightSegment = factionSegments[otherIndex];
                if (!rightSegment) {
                    continue;
                }

                const kind = this.resolveFrontlineSegmentKind(leftSegment.teamId, rightSegment.teamId);
                if (!kind) {
                    continue;
                }

                const overlap = this.getCollinearSegmentOverlap(
                    leftSegment.start,
                    leftSegment.end,
                    rightSegment.start,
                    rightSegment.end,
                );
                if (!overlap) {
                    continue;
                }

                const segmentKey = this.getFrontlineSegmentKey(overlap.start, overlap.end);
                if (frontlineSegmentKeys.has(segmentKey)) {
                    continue;
                }

                frontlineSegmentKeys.add(segmentKey);
                frontlines.push({
                    start: overlap.start,
                    end: overlap.end,
                    kind,
                    casualtyIntensity: Math.max(leftSegment.casualtyIntensity, rightSegment.casualtyIntensity),
                    capturedTimestamp: Math.max(
                        Number(leftSegment.capturedTimestamp ?? Number.NEGATIVE_INFINITY),
                        Number(rightSegment.capturedTimestamp ?? Number.NEGATIVE_INFINITY),
                    ),
                });
            }
        }

        return frontlines;
    }

    private getWorldVoronoiCellPoints(region: Pick<FoxholeMapRegionRecord, 'gridCoord'>, points: number[][]): number[][] {
        const position = getFoxholeRegionPosition(region);
        const offsetX = position.x - (FOXHOLE_REGION_WIDTH / 2);
        const offsetY = position.y - (FOXHOLE_REGION_HEIGHT / 2);
        return points.map(point => [
            (point[0] ?? 0) + offsetX,
            (point[1] ?? 0) + offsetY,
        ]);
    }

    private getCollinearSegmentOverlap(
        leftStart: number[],
        leftEnd: number[],
        rightStart: number[],
        rightEnd: number[],
    ): { start: [number, number]; end: [number, number]; } | null {
        const leftLength = this.getSegmentLength(leftStart, leftEnd);
        const rightLength = this.getSegmentLength(rightStart, rightEnd);
        if (leftLength < 12 || rightLength < 12) {
            return null;
        }

        const lineTolerance = 16;
        if (
            this.getPointLineDistance(rightStart, leftStart, leftEnd) > lineTolerance
            || this.getPointLineDistance(rightEnd, leftStart, leftEnd) > lineTolerance
        ) {
            return null;
        }

        const leftDirectionX = ((leftEnd[0] ?? 0) - (leftStart[0] ?? 0)) / leftLength;
        const leftDirectionY = ((leftEnd[1] ?? 0) - (leftStart[1] ?? 0)) / leftLength;
        const rightDirectionX = ((rightEnd[0] ?? 0) - (rightStart[0] ?? 0)) / rightLength;
        const rightDirectionY = ((rightEnd[1] ?? 0) - (rightStart[1] ?? 0)) / rightLength;
        const directionAlignment = Math.abs((leftDirectionX * rightDirectionX) + (leftDirectionY * rightDirectionY));
        if (directionAlignment < 0.999) {
            return null;
        }

        const rightStartProjection = (((rightStart[0] ?? 0) - (leftStart[0] ?? 0)) * leftDirectionX) + (((rightStart[1] ?? 0) - (leftStart[1] ?? 0)) * leftDirectionY);
        const rightEndProjection = (((rightEnd[0] ?? 0) - (leftStart[0] ?? 0)) * leftDirectionX) + (((rightEnd[1] ?? 0) - (leftStart[1] ?? 0)) * leftDirectionY);
        const overlapStart = Math.max(0, Math.min(rightStartProjection, rightEndProjection));
        const overlapEnd = Math.min(leftLength, Math.max(rightStartProjection, rightEndProjection));
        if ((overlapEnd - overlapStart) < 12) {
            return null;
        }

        return {
            start: [
                (leftStart[0] ?? 0) + (leftDirectionX * overlapStart),
                (leftStart[1] ?? 0) + (leftDirectionY * overlapStart),
            ],
            end: [
                (leftStart[0] ?? 0) + (leftDirectionX * overlapEnd),
                (leftStart[1] ?? 0) + (leftDirectionY * overlapEnd),
            ],
        };
    }

    private getPointLineDistance(
        point: number[],
        lineStart: number[],
        lineEnd: number[],
    ): number {
        const lineDx = (lineEnd[0] ?? 0) - (lineStart[0] ?? 0);
        const lineDy = (lineEnd[1] ?? 0) - (lineStart[1] ?? 0);
        const lineLength = Math.hypot(lineDx, lineDy);
        if (lineLength <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        return Math.abs(
            (((point[0] ?? 0) - (lineStart[0] ?? 0)) * lineDy)
            - (((point[1] ?? 0) - (lineStart[1] ?? 0)) * lineDx),
        ) / lineLength;
    }

    private getSegmentLength(start: number[], end: number[]): number {
        return Math.hypot((end[0] ?? 0) - (start[0] ?? 0), (end[1] ?? 0) - (start[1] ?? 0));
    }

    private drawPolyline(graphics: PIXI.Graphics, points: number[][]): void {
        const firstPoint = points[0];
        if (!firstPoint) {
            return;
        }

        const { x: firstX, y: firstY } = this.getPointCoordinates(firstPoint);
        graphics.moveTo(firstX, firstY);
        for (let index = 1; index < points.length; index += 1) {
            const point = points[index];
            if (!point) {
                continue;
            }

            const { x, y } = this.getPointCoordinates(point);
            graphics.lineTo(x, y);
        }
    }

    private buildFrontlineRenderPath(points: number[][]): FoxholeFrontlineRenderPath {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        if (!firstPoint || !lastPoint) {
            return {
                centerline: [],
                closed: false,
            };
        }

        const isClosed = points.length > 3
            && this.getFrontlinePointKey(firstPoint) === this.getFrontlinePointKey(lastPoint);
        let centerline = (isClosed ? points.slice(0, -1) : points)
            .map(point => [point[0] ?? 0, point[1] ?? 0]);
        const closed = isClosed && centerline.length > 2;
        const refinementPasses = centerline.length >= 6
            ? 4
            : centerline.length >= 4
                ? 3
                : centerline.length >= 3
                    ? 2
                    : 1;
        for (let pass = 0; pass < refinementPasses; pass += 1) {
            centerline = this.refineFrontlinePath(centerline, closed);
        }
        const relaxationPasses = centerline.length >= 5 ? 2 : 1;
        for (let pass = 0; pass < relaxationPasses; pass += 1) {
            centerline = this.relaxFrontlinePath(centerline, closed);
        }

        return {
            centerline,
            closed,
        };
    }

    private refineFrontlinePath(points: number[][], closed: boolean): number[][] {
        if (points.length < 2) {
            return points;
        }

        if (closed) {
            const refined: number[][] = [];
            for (let index = 0; index < points.length; index += 1) {
                const start = points[index];
                const end = points[(index + 1) % points.length];
                if (!start || !end) {
                    continue;
                }

                refined.push([
                    ((start[0] ?? 0) * 0.75) + ((end[0] ?? 0) * 0.25),
                    ((start[1] ?? 0) * 0.75) + ((end[1] ?? 0) * 0.25),
                ]);
                refined.push([
                    ((start[0] ?? 0) * 0.25) + ((end[0] ?? 0) * 0.75),
                    ((start[1] ?? 0) * 0.25) + ((end[1] ?? 0) * 0.75),
                ]);
            }

            return refined;
        }

        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        if (!firstPoint || !lastPoint) {
            return points;
        }

        const refined: number[][] = [[firstPoint[0] ?? 0, firstPoint[1] ?? 0]];
        for (let index = 0; index < points.length - 1; index += 1) {
            const start = points[index];
            const end = points[index + 1];
            if (!start || !end) {
                continue;
            }

            refined.push([
                ((start[0] ?? 0) * 0.75) + ((end[0] ?? 0) * 0.25),
                ((start[1] ?? 0) * 0.75) + ((end[1] ?? 0) * 0.25),
            ]);
            refined.push([
                ((start[0] ?? 0) * 0.25) + ((end[0] ?? 0) * 0.75),
                ((start[1] ?? 0) * 0.25) + ((end[1] ?? 0) * 0.75),
            ]);
        }
        refined.push([lastPoint[0] ?? 0, lastPoint[1] ?? 0]);

        return refined;
    }

    private relaxFrontlinePath(points: number[][], closed: boolean): number[][] {
        if (points.length < 3) {
            return points;
        }

        if (closed) {
            return points.map((point, index) => {
                const previousPoint = points[(index - 1 + points.length) % points.length];
                const nextPoint = points[(index + 1) % points.length];
                if (!point || !previousPoint || !nextPoint) {
                    return point;
                }

                return [
                    ((previousPoint[0] ?? 0) * 0.18) + ((point[0] ?? 0) * 0.64) + ((nextPoint[0] ?? 0) * 0.18),
                    ((previousPoint[1] ?? 0) * 0.18) + ((point[1] ?? 0) * 0.64) + ((nextPoint[1] ?? 0) * 0.18),
                ];
            });
        }

        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        if (!firstPoint || !lastPoint) {
            return points;
        }

        const relaxed: number[][] = [[firstPoint[0] ?? 0, firstPoint[1] ?? 0]];
        for (let index = 1; index < points.length - 1; index += 1) {
            const previousPoint = points[index - 1];
            const point = points[index];
            const nextPoint = points[index + 1];
            if (!previousPoint || !point || !nextPoint) {
                continue;
            }

            relaxed.push([
                ((previousPoint[0] ?? 0) * 0.18) + ((point[0] ?? 0) * 0.64) + ((nextPoint[0] ?? 0) * 0.18),
                ((previousPoint[1] ?? 0) * 0.18) + ((point[1] ?? 0) * 0.64) + ((nextPoint[1] ?? 0) * 0.18),
            ]);
        }
        relaxed.push([lastPoint[0] ?? 0, lastPoint[1] ?? 0]);

        return relaxed;
    }

    private drawFrontlineRibbon(
        graphics: PIXI.Graphics,
        renderPath: FoxholeFrontlineRenderPath,
        width: number,
    ): void {
        const ribbon = this.buildFrontlineRibbonPolygon(renderPath.centerline, width, renderPath.closed);
        const firstPoint = ribbon[0];
        if (!firstPoint) {
            return;
        }

        const { x: firstX, y: firstY } = this.getPointCoordinates(firstPoint);
        graphics.moveTo(firstX, firstY);
        for (let index = 1; index < ribbon.length; index += 1) {
            const point = ribbon[index];
            if (!point) {
                continue;
            }

            const { x, y } = this.getPointCoordinates(point);
            graphics.lineTo(x, y);
        }

        graphics.closePath();
    }

    private fillFrontlineAreaCloud(
        graphics: PIXI.Graphics,
        renderPath: FoxholeFrontlineRenderPath,
        options: {
            radius: number;
            spread: number;
            lateralBands: number;
            color: number;
            alpha: number;
        },
    ): void {
        if (renderPath.centerline.length < 2) {
            return;
        }

        const bandCount = Math.max(2, Math.min(3, Math.trunc(options.lateralBands)));
        const outerWidth = options.spread + (options.radius * 1.85);
        const innerWidth = Math.max(options.radius * 1.4, options.spread * 0.46);

        for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
            const progress = bandCount === 1
                ? 0
                : bandIndex / (bandCount - 1);
            const width = outerWidth + ((innerWidth - outerWidth) * progress);
            const alpha = options.alpha * (0.96 - (progress * 0.18));
            this.drawFrontlineRibbon(graphics, renderPath, width);
            graphics.fill({
                color: options.color,
                alpha,
            });
        }
    }

    private buildFrontlineRibbonPolygon(points: number[][], width: number, closed: boolean): number[][] {
        if (points.length < 2) {
            return [];
        }

        const leftEdge: number[][] = [];
        const rightEdge: number[][] = [];
        const pointCount = points.length;
        const progressDenominator = closed
            ? pointCount
            : Math.max(1, pointCount - 1);

        for (let index = 0; index < pointCount; index += 1) {
            const point = points[index];
            const previousPoint = closed
                ? points[(index - 1 + pointCount) % pointCount]
                : points[Math.max(0, index - 1)];
            const nextPoint = closed
                ? points[(index + 1) % pointCount]
                : points[Math.min(pointCount - 1, index + 1)];
            if (!point || !previousPoint || !nextPoint) {
                continue;
            }

            let tangentX = (nextPoint[0] ?? 0) - (previousPoint[0] ?? 0);
            let tangentY = (nextPoint[1] ?? 0) - (previousPoint[1] ?? 0);
            if (!closed && index === 0) {
                tangentX = (nextPoint[0] ?? 0) - (point[0] ?? 0);
                tangentY = (nextPoint[1] ?? 0) - (point[1] ?? 0);
            } else if (!closed && index === pointCount - 1) {
                tangentX = (point[0] ?? 0) - (previousPoint[0] ?? 0);
                tangentY = (point[1] ?? 0) - (previousPoint[1] ?? 0);
            }

            const tangentLength = Math.hypot(tangentX, tangentY);
            if (tangentLength < 0.001) {
                continue;
            }

            const normalX = -tangentY / tangentLength;
            const normalY = tangentX / tangentLength;
            const progress = index / progressDenominator;
            const turnStrength = this.getFrontlineTurnStrength(previousPoint, point, nextPoint);
            const fanScale = closed
                ? 1.28 + (turnStrength * 0.2)
                : 1.16 + (Math.sin(progress * Math.PI) * 1.08) + (turnStrength * 0.16);
            const halfWidth = Math.max(width * 0.48, width * fanScale * 0.5);
            const pointX = point[0] ?? 0;
            const pointY = point[1] ?? 0;

            leftEdge.push([
                pointX + (normalX * halfWidth),
                pointY + (normalY * halfWidth),
            ]);
            rightEdge.push([
                pointX - (normalX * halfWidth),
                pointY - (normalY * halfWidth),
            ]);
        }

        if (leftEdge.length < 2 || rightEdge.length < 2) {
            return [];
        }

        return [
            ...leftEdge,
            ...rightEdge.reverse(),
        ];
    }

    private getFrontlineTurnStrength(previousPoint: number[], point: number[], nextPoint: number[]): number {
        const incomingX = (point[0] ?? 0) - (previousPoint[0] ?? 0);
        const incomingY = (point[1] ?? 0) - (previousPoint[1] ?? 0);
        const outgoingX = (nextPoint[0] ?? 0) - (point[0] ?? 0);
        const outgoingY = (nextPoint[1] ?? 0) - (point[1] ?? 0);
        const incomingLength = Math.hypot(incomingX, incomingY);
        const outgoingLength = Math.hypot(outgoingX, outgoingY);
        if (incomingLength < 0.001 || outgoingLength < 0.001) {
            return 0;
        }

        const dotProduct = ((incomingX / incomingLength) * (outgoingX / outgoingLength))
            + ((incomingY / incomingLength) * (outgoingY / outgoingLength));
        const clampedDot = Math.max(-1, Math.min(1, dotProduct));
        return Math.max(0, (1 - clampedDot) * 0.5);
    }

    private drawFrontlinePolyline(graphics: PIXI.Graphics, points: number[][]): void {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        if (!firstPoint || !lastPoint) {
            return;
        }

        const shouldClose = points.length > 3
            && this.getFrontlinePointKey(firstPoint) === this.getFrontlinePointKey(lastPoint);
        const { x: firstX, y: firstY } = this.getPointCoordinates(firstPoint);
        graphics.moveTo(firstX, firstY);

        const endIndex = shouldClose ? points.length - 1 : points.length;
        for (let index = 1; index < endIndex; index += 1) {
            const point = points[index];
            if (!point) {
                continue;
            }

            const { x, y } = this.getPointCoordinates(point);
            graphics.lineTo(x, y);
        }

        if (shouldClose) {
            graphics.closePath();
        }
    }

    private getPointCoordinates(point: number[]): { x: number; y: number; } {
        return {
            x: point[0] ?? 0,
            y: point[1] ?? 0,
        };
    }

    private buildFrontlineRenderGroups(frontlines: FoxholeFrontlineSegment[]): Array<{
        kind: FoxholeFrontlineSegmentKind;
        casualtyIntensity: number;
        polylines: number[][][];
    }> {
        const groups = new Map<string, {
            kind: FoxholeFrontlineSegmentKind;
            casualtyIntensity: number;
            segments: FoxholeFrontlineSegment[];
        }>();

        for (const frontline of frontlines) {
            const casualtyBucket = this.getFrontlineCasualtyBucket(frontline.casualtyIntensity);
            const groupKey = `${frontline.kind}:${casualtyBucket}`;
            const existing = groups.get(groupKey);
            if (existing) {
                existing.casualtyIntensity = Math.max(existing.casualtyIntensity, frontline.casualtyIntensity);
                existing.segments.push(frontline);
                continue;
            }

            groups.set(groupKey, {
                kind: frontline.kind,
                casualtyIntensity: frontline.casualtyIntensity,
                segments: [frontline],
            });
        }

        return Array.from(groups.values()).map(group => ({
            kind: group.kind,
            casualtyIntensity: group.casualtyIntensity,
            polylines: this.buildFrontlinePolylines(group.segments),
        }));
    }

    private buildFrontlinePolylines(segments: FoxholeFrontlineSegment[]): number[][][] {
        if (!segments.length) {
            return [];
        }

        const segmentById = new Map<string, FoxholeFrontlineSegment>();
        const segmentIdsByPointKey = new Map<string, string[]>();
        const visitedSegmentIds = new Set<string>();

        for (const [index, segment] of segments.entries()) {
            const segmentId = `${index}`;
            segmentById.set(segmentId, segment);

            const startKey = this.getFrontlinePointKey(segment.start);
            const endKey = this.getFrontlinePointKey(segment.end);
            const startList = segmentIdsByPointKey.get(startKey) ?? [];
            startList.push(segmentId);
            segmentIdsByPointKey.set(startKey, startList);
            const endList = segmentIdsByPointKey.get(endKey) ?? [];
            endList.push(segmentId);
            segmentIdsByPointKey.set(endKey, endList);
        }

        const polylines: number[][][] = [];
        const orderedPointKeys = Array.from(segmentIdsByPointKey.keys())
            .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));

        for (const pointKey of orderedPointKeys) {
            const segmentIds = segmentIdsByPointKey.get(pointKey) ?? [];
            if (segmentIds.length === 2) {
                continue;
            }

            for (const segmentId of segmentIds) {
                if (visitedSegmentIds.has(segmentId)) {
                    continue;
                }

                const polyline = this.buildFrontlinePolylineFromSegment(
                    segmentId,
                    pointKey,
                    segmentById,
                    segmentIdsByPointKey,
                    visitedSegmentIds,
                );
                if (polyline.length >= 2) {
                    polylines.push(polyline);
                }
            }
        }

        for (const segmentId of segmentById.keys()) {
            if (visitedSegmentIds.has(segmentId)) {
                continue;
            }

            const segment = segmentById.get(segmentId);
            if (!segment) {
                continue;
            }

            const polyline = this.buildFrontlinePolylineFromSegment(
                segmentId,
                this.getFrontlinePointKey(segment.start),
                segmentById,
                segmentIdsByPointKey,
                visitedSegmentIds,
            );
            if (polyline.length >= 2) {
                polylines.push(polyline);
            }
        }

        return polylines;
    }

    private buildFrontlinePolylineFromSegment(
        startingSegmentId: string,
        startingPointKey: string,
        segmentById: Map<string, FoxholeFrontlineSegment>,
        segmentIdsByPointKey: Map<string, string[]>,
        visitedSegmentIds: Set<string>,
    ): number[][] {
        const polyline: number[][] = [];
        let currentSegmentId: string | null = startingSegmentId;
        let currentPointKey = startingPointKey;

        while (currentSegmentId) {
            const segment = segmentById.get(currentSegmentId);
            if (!segment) {
                break;
            }

            visitedSegmentIds.add(currentSegmentId);

            const startKey = this.getFrontlinePointKey(segment.start);
            const orientedStart = startKey === currentPointKey ? segment.start : segment.end;
            const orientedEnd = startKey === currentPointKey ? segment.end : segment.start;
            if (!polyline.length) {
                polyline.push(orientedStart);
            }
            polyline.push(orientedEnd);

            const nextPointKey = this.getFrontlinePointKey(orientedEnd);
            const candidateSegmentIds = (segmentIdsByPointKey.get(nextPointKey) ?? [])
                .filter(segmentId => !visitedSegmentIds.has(segmentId));
            currentSegmentId = candidateSegmentIds.length === 1
                ? candidateSegmentIds[0] ?? null
                : null;
            currentPointKey = nextPointKey;
        }

        return polyline;
    }

    private getFrontlineCasualtyBucket(casualtyIntensity: number): 'hot' | 'warm' | 'cool' {
        if (casualtyIntensity >= 0.72) {
            return 'hot';
        }
        if (casualtyIntensity >= 0.38) {
            return 'warm';
        }
        return 'cool';
    }

    private resolveFrontlinePalette(
        frontlineKind: FoxholeFrontlineSegmentKind,
        casualtyIntensity: number,
    ): {
        shadowColor: number;
        shadowAlpha: number;
        glowColor: number;
        glowAlpha: number;
        coreColor: number;
        coreAlpha: number;
    } {
        const isHot = casualtyIntensity >= 0.72;
        const isWarm = casualtyIntensity >= 0.38;
        const neutralAlphaPenalty = frontlineKind === 'neutralized' ? 0.04 : 0;

        if (isHot) {
            return {
                shadowColor: 0x3A0908,
                shadowAlpha: 0.14 + (casualtyIntensity * 0.1) - neutralAlphaPenalty,
                glowColor: 0xD12A1F,
                glowAlpha: 0.2 + (casualtyIntensity * 0.2) - neutralAlphaPenalty,
                coreColor: 0xFF9B3D,
                coreAlpha: 0.54 + (casualtyIntensity * 0.24) - neutralAlphaPenalty,
            };
        }

        if (isWarm) {
            return {
                shadowColor: 0x2C0B06,
                shadowAlpha: 0.13 + (casualtyIntensity * 0.09) - neutralAlphaPenalty,
                glowColor: 0xE06A1C,
                glowAlpha: 0.17 + (casualtyIntensity * 0.17) - neutralAlphaPenalty,
                coreColor: 0xFFC468,
                coreAlpha: 0.5 + (casualtyIntensity * 0.24) - neutralAlphaPenalty,
            };
        }

        return {
            shadowColor: 0x210904,
            shadowAlpha: 0.12 + (casualtyIntensity * 0.08) - neutralAlphaPenalty,
            glowColor: 0xC5541C,
            glowAlpha: 0.14 + (casualtyIntensity * 0.16) - neutralAlphaPenalty,
            coreColor: 0xFFE0B5,
            coreAlpha: 0.48 + (casualtyIntensity * 0.28) - neutralAlphaPenalty,
        };
    }

    private resolveUnifiedFrontlinePalette(): {
        shadowColor: number;
        shadowAlpha: number;
        glowColor: number;
        glowAlpha: number;
        coreColor: number;
        coreAlpha: number;
    } {
        return {
            shadowColor: 0x340507,
            shadowAlpha: 0.22,
            glowColor: 0x8E1518,
            glowAlpha: 0.28,
            coreColor: 0xD23B3B,
            coreAlpha: 0.56,
        };
    }

    private resolveRegionHeatPalette(casualtyIntensity: number): {
        outerColor: number;
        outerBaseAlpha: number;
        outerAlphaBoost: number;
        middleColor: number;
        middleBaseAlpha: number;
        middleAlphaBoost: number;
        coreColor: number;
        coreBaseAlpha: number;
        coreAlphaBoost: number;
        highlightColor: number;
        highlightBaseAlpha: number;
        highlightAlphaBoost: number;
        accentColor: number;
        accentBaseAlpha: number;
        accentAlphaBoost: number;
    } {
        const bucket = this.getFrontlineCasualtyBucket(casualtyIntensity);
        const frontlinePalette = this.resolveFrontlinePalette('contested', casualtyIntensity);

        if (bucket === 'hot') {
            return {
                outerColor: frontlinePalette.shadowColor,
                outerBaseAlpha: 0.07,
                outerAlphaBoost: 0.13,
                middleColor: frontlinePalette.glowColor,
                middleBaseAlpha: 0.09,
                middleAlphaBoost: 0.18,
                coreColor: frontlinePalette.coreColor,
                coreBaseAlpha: 0.13,
                coreAlphaBoost: 0.27,
                highlightColor: 0xFFD09B,
                highlightBaseAlpha: 0.1,
                highlightAlphaBoost: 0.15,
                accentColor: 0xFF632D,
                accentBaseAlpha: 0.09,
                accentAlphaBoost: 0.17,
            };
        }

        if (bucket === 'warm') {
            return {
                outerColor: frontlinePalette.shadowColor,
                outerBaseAlpha: 0.06,
                outerAlphaBoost: 0.12,
                middleColor: frontlinePalette.glowColor,
                middleBaseAlpha: 0.08,
                middleAlphaBoost: 0.17,
                coreColor: frontlinePalette.coreColor,
                coreBaseAlpha: 0.12,
                coreAlphaBoost: 0.24,
                highlightColor: 0xFFE2AE,
                highlightBaseAlpha: 0.09,
                highlightAlphaBoost: 0.13,
                accentColor: 0xF08C35,
                accentBaseAlpha: 0.08,
                accentAlphaBoost: 0.15,
            };
        }

        return {
            outerColor: frontlinePalette.shadowColor,
            outerBaseAlpha: 0.05,
            outerAlphaBoost: 0.11,
            middleColor: frontlinePalette.glowColor,
            middleBaseAlpha: 0.07,
            middleAlphaBoost: 0.15,
            coreColor: frontlinePalette.coreColor,
            coreBaseAlpha: 0.11,
            coreAlphaBoost: 0.22,
            highlightColor: 0xFBEBD2,
            highlightBaseAlpha: 0.08,
            highlightAlphaBoost: 0.11,
            accentColor: 0xD86B2C,
            accentBaseAlpha: 0.07,
            accentAlphaBoost: 0.13,
        };
    }

    private resolveFrontlinePair(entries: FoxholeFrontlineSegmentEntry[]): {
        leftEntry: FoxholeFrontlineSegmentEntry;
        rightEntry: FoxholeFrontlineSegmentEntry;
        kind: FoxholeFrontlineSegmentKind;
    } | null {
        const colonialEntry = entries.find(entry => entry.teamId === 'COLONIALS');
        const wardenEntry = entries.find(entry => entry.teamId === 'WARDENS');
        if (colonialEntry && wardenEntry) {
            return {
                leftEntry: colonialEntry,
                rightEntry: wardenEntry,
                kind: 'contested',
            };
        }

        const neutralEntry = entries.find(entry => entry.teamId === 'NONE');
        const factionEntry = entries.find(entry => this.isFrontlineFactionTeam(entry.teamId));
        if (neutralEntry && factionEntry) {
            return {
                leftEntry: factionEntry,
                rightEntry: neutralEntry,
                kind: 'neutralized',
            };
        }

        return null;
    }

    private resolveFrontlineSegmentKind(
        leftTeamId: FoxholeFrontlineTeamId,
        rightTeamId: FoxholeFrontlineTeamId,
    ): FoxholeFrontlineSegmentKind | null {
        if (leftTeamId === rightTeamId) {
            return null;
        }

        if (this.isFrontlineFactionTeam(leftTeamId) && this.isFrontlineFactionTeam(rightTeamId)) {
            return 'contested';
        }

        if (
            (leftTeamId === 'NONE' && this.isFrontlineFactionTeam(rightTeamId))
            || (rightTeamId === 'NONE' && this.isFrontlineFactionTeam(leftTeamId))
        ) {
            return 'neutralized';
        }

        return null;
    }

    private getFrontlineTeamId(teamId?: string): FoxholeFrontlineTeamId | null {
        if (teamId === 'COLONIALS' || teamId === 'WARDENS' || teamId === 'NONE') {
            return teamId;
        }

        return null;
    }

    private isFrontlineFactionTeam(teamId?: string): teamId is FoxholeFrontlineFactionTeamId {
        return teamId === 'COLONIALS' || teamId === 'WARDENS';
    }

    private getFrontlineSegmentKey(start: number[], end: number[]): string {
        const startKey = this.getFrontlinePointKey(start);
        const endKey = this.getFrontlinePointKey(end);
        return startKey < endKey
            ? `${startKey}|${endKey}`
            : `${endKey}|${startKey}`;
    }

    private getFrontlinePointKey(point: number[]): string {
        return `${Math.round(point[0]! * 10)}:${Math.round(point[1]! * 10)}`;
    }

    private computeFrontlineFreshness(capturedTimestamp?: number): number {
        const referenceTimestamp = this.context.getPlaybackTimestamp() ?? Date.now();
        if (!capturedTimestamp || !Number.isFinite(capturedTimestamp)) {
            return 0.45;
        }

        const freshnessWindowMs = 4 * 3600000;
        return Math.min(1, Math.max(0, 1 - ((referenceTimestamp - capturedTimestamp) / freshnessWindowMs)));
    }

    private updateRegionIconVisibility(
        view: FoxholeMapRegionView,
        settings: ReturnType<FoxholeMapContext['readMapSettings']>,
        showIconsAndLabels: boolean,
    ): void {
        const suppressFactionColor = this.shouldSuppressResistanceFactionColor(view.region);
        for (const child of view.liveIcons.children) {
            const iconContainer = child as FoxholeLiveIconContainer;
            const iconKey = String(iconContainer.data?.iconType ?? '');
            const iconMeta = FOXHOLE_MAP_ICONS[iconKey];
            const canShowCategory = iconMeta ? settings.iconCategories[iconMeta.category] !== false : true;
            const canShowType = !settings.iconBlacklist.includes(iconKey);
            child.visible = settings.icons && showIconsAndLabels && canShowCategory && canShowType && !suppressFactionColor;
            iconContainer.eventMode = child.visible && this.pointerInteractionsEnabled ? 'static' : 'none';

            if (iconContainer.teamBackground) {
                iconContainer.teamBackground.visible = child.visible;
            }

            const sprite = iconContainer.sprite;
            if (!sprite || !iconMeta) {
                continue;
            }

            const isScorched = typeof iconContainer.data?.flags === 'number'
                && (iconContainer.data.flags & FOXHOLE_MAP_FLAG_IS_SCORCHED) !== 0;
            if (isScorched) {
                sprite.tint = FOXHOLE_MAP_SCORCHED_TINT;
            } else if (iconContainer.data?.teamId === 'COLONIALS') {
                sprite.tint = 0x516C4B;
            } else if (iconContainer.data?.teamId === 'WARDENS') {
                sprite.tint = 0x245682;
            } else if (settings.coloredIcons && iconMeta.color !== null) {
                sprite.tint = iconMeta.color;
            } else {
                sprite.tint = 0xFFFFFF;
            }
        }
    }

    private getLabelIconScale(): number {
        const safeZoom = Math.max(this.context.getZoom(), 0.0001);
        return Math.min(1 / safeZoom, 200) * 0.7;
    }

    /** Scene V2 resolves the projected billboard; retain the original card data and owner. */
    hoverPresentation(source: PIXI.Container | null, point: PIXI.PointData): void {
        if (!this.context.readMapSettings().enabled || !this.isPointerOverCanvas(point.x, point.y)) {
            this.clearHoveredIcon();
            return;
        }
        for (let target = source; target && target !== this.root; target = target.parent) {
            const data = this.presentationHoverData.get(target);
            if (data) {
                this.setHoveredIcon(data, point);
                return;
            }
        }
        this.clearHoveredIcon();
    }

    private setHoveredIcon(data: FoxholeMapHoverTooltipData | null, point: { x: number; y: number; }): void {
        const nextName = String(data?.iconName ?? '').trim();
        if (!nextName.length || !data) {
            this.clearHoveredIcon();
            return;
        }
        if (
            this.hoveredIconName === nextName
            && this.hoveredTooltipData?.categoryLabel === data.categoryLabel
            && this.hoveredTooltipData?.factionLabel === data.factionLabel
            && this.hoveredTooltipData?.isScorched === data.isScorched
        ) {
            if (canvasHoverPopover.value?.owner === this) {
                moveCanvasHoverPopover(this, point);
                return;
            }
        }

        this.hoveredIconName = nextName;
        this.hoveredTooltipData = data;
        showCanvasHoverPopover(this, {
            kind: 'map-icon',
            name: data.iconName,
            category: data.categoryLabel,
            faction: data.factionLabel,
            factionColor: data.factionColor,
            scorched: data.isScorched,
            iconUrl: data.iconUrl,
            previewUrl: data.previewUrl,
        }, point);
    }

    private clearHoveredIcon(): void {
        hideCanvasHoverPopover(this);
        this.hoveredIconName = null;
        this.hoveredTooltipData = null;
    }

    private isPointerOverCanvas(clientX: number, clientY: number): boolean {
        // Pixi can still hit-test map icons while an HTML overlay covers the canvas.
        return document.elementFromPoint(clientX, clientY) === this.context.app.canvas;
    }

    private getMapIconCategoryLabel(category: 'bases' | 'resources' | 'structures'): string {
        switch (category) {
            case 'bases':
                return 'Base';
            case 'resources':
                return 'Resource';
            default:
                return 'Structure';
        }
    }

    private getMapIconFactionLabel(teamId?: string): string | null {
        if (teamId === 'COLONIALS') {
            return 'Colonials';
        }
        if (teamId === 'WARDENS') {
            return 'Wardens';
        }
        return null;
    }

    private getMapIconFactionColor(teamId?: string): number | null {
        if (teamId === 'COLONIALS') {
            return 0x516C4B;
        }
        if (teamId === 'WARDENS') {
            return 0x245682;
        }
        return null;
    }

    /** Brighter faction hues stay legible as hover-card metadata on the shell panel. */
    private getMapIconFactionLabelColor(teamId?: string): number | null {
        if (teamId === 'COLONIALS') {
            return 0x9ACB76;
        }
        if (teamId === 'WARDENS') {
            return 0x7BB8EC;
        }
        return null;
    }

    private buildStructureHoverAssetByName(): Readonly<Record<string, { categoryName: string; previewUrl: string | null; }>> {
        const catalog = getFoxholeStructureCatalog(this.context.getAssetsBaseUrl());
        const byName: Record<string, { categoryName: string; previewUrl: string | null; }> = {};
        for (const asset of catalog.assets) {
            const hoverAsset = {
                categoryName: asset.categoryName,
                previewUrl: asset.previewUrl,
            };
            for (const lookupValue of [asset.foxholeKey, asset.codeName, asset.buildingKey, asset.name]) {
                const key = this.normalizeHoverLookupKey(lookupValue);
                if (key && !byName[key]) {
                    byName[key] = hoverAsset;
                }
            }
        }
        return byName;
    }

    private buildItemHoverAssetByName(): Readonly<Record<string, { categoryName: string; previewUrl: string | null; }>> {
        const catalog = getFoxholeItemCatalog(this.context.getAssetsBaseUrl());
        const byName: Record<string, { categoryName: string; previewUrl: string | null; }> = {};
        for (const asset of catalog.assets) {
            const hoverAsset = {
                categoryName: asset.categoryName,
                previewUrl: asset.previewUrl,
            };
            for (const lookupValue of [asset.foxholeKey, asset.resourceKey, asset.codeName, asset.name]) {
                const key = this.normalizeHoverLookupKey(lookupValue);
                if (key && !byName[key]) {
                    byName[key] = hoverAsset;
                }
            }
        }
        return byName;
    }

    private normalizeHoverLookupKey(value: string | null | undefined): string {
        return String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/['']/g, '')
            .replace(/\s+/g, ' ');
    }

    private resolveMapIconHoverTooltipData(iconMeta: typeof FOXHOLE_MAP_ICONS[string]): FoxholeMapHoverTooltipData {
        const assetLookupKey = this.normalizeHoverLookupKey(iconMeta.assetKey);
        const lookupKey = this.normalizeHoverLookupKey(iconMeta.name);
        const structureAsset = this.structureHoverAssetByName[assetLookupKey] ?? this.structureHoverAssetByName[lookupKey];
        if (structureAsset) {
            return {
                iconName: iconMeta.name,
                categoryLabel: structureAsset.categoryName,
                factionLabel: null,
                factionColor: null,
                isScorched: false,
                iconUrl: resolveFoxholeMapIconUrl(this.context.getAssetsBaseUrl(), iconMeta),
                previewUrl: structureAsset.previewUrl,
            };
        }
        const itemAsset = this.itemHoverAssetByName[assetLookupKey] ?? this.itemHoverAssetByName[lookupKey];
        if (itemAsset) {
            return {
                iconName: iconMeta.name,
                categoryLabel: itemAsset.categoryName,
                factionLabel: null,
                factionColor: null,
                isScorched: false,
                iconUrl: resolveFoxholeMapIconUrl(this.context.getAssetsBaseUrl(), iconMeta),
                previewUrl: itemAsset.previewUrl,
            };
        }
        return {
            iconName: iconMeta.name,
            categoryLabel: this.getMapIconCategoryLabel(iconMeta.category),
            factionLabel: null,
            factionColor: null,
            isScorched: false,
            iconUrl: resolveFoxholeMapIconUrl(this.context.getAssetsBaseUrl(), iconMeta),
            previewUrl: null,
        };
    }

    private readonly handleViewportDragStart = (): void => {
        this.isViewportDragging = true;
        this.clearHoveredIcon();
    };

    private readonly handleCanvasPointerLeave = (): void => {
        this.clearHoveredIcon();
    };

    private readonly handleViewportDragEnd = (): void => {
        this.isViewportDragging = false;
    };

    /**
     * Enable/disable all Pixi pointer hit-testing under the map root.
     * The map mounts beside the board scene layer, so scene-layer pauses alone do not cover it.
     * Disabling uses `eventMode = 'none'` on the root so children are skipped without per-icon walks.
     */
    setPointerInteractionsEnabled(enabled: boolean): void {
        if (this.pointerInteractionsEnabled === enabled) {
            if (!enabled) {
                this.clearHoveredIcon();
            }
            return;
        }

        this.pointerInteractionsEnabled = enabled;

        if (!enabled) {
            this.root.eventMode = 'none';
            this.root.interactiveChildren = false;
            this.clearHoveredIcon();
            return;
        }

        this.root.eventMode = 'passive';
        this.root.interactiveChildren = true;
        this.liveIcons.eventMode = 'passive';
        this.liveIcons.interactiveChildren = true;

        for (const view of this.regionViews) {
            view.liveIcons.eventMode = 'passive';
            view.liveIcons.interactiveChildren = true;
            for (const child of view.liveIcons.children) {
                const iconContainer = child as FoxholeLiveIconContainer;
                iconContainer.eventMode = child.visible ? 'static' : 'none';
            }
        }
    }
}
