import type { Renderer, TextureSource } from 'pixi.js';
import type { Container3D, Pass3D } from '@pixi/3d';
export interface BakedResource { path: string; hash: string; bytes: number; }
export interface BakedRegionEntry { id: string; key?: string; manifest: BakedResource; resources?: BakedResource[]; downloadBytes: number; }
export interface BakedRegion {
    root: Container3D;
    passes: Pass3D[];
    sharedPasses?: Record<string, Pass3D>;
    combinedPasses?: Record<string, Pass3D>;
    metrics: { resident?: boolean; waterReflections?: boolean; vegetationShadows?: boolean; ambientOcclusion?: boolean; vegetationDensity?: 'full' | 'reduced' | 'minimal'; adaptiveStreaming?: boolean; modelLod?: boolean; terrainLod?: boolean; adaptiveTextures?: boolean; frustumCulling?: boolean; progressive?: boolean; terrainGeometry?: { step: number; triangles: number; bytes: number; pending: boolean; error: string | null; chunks?: number; visibleChunks?: number; detailChunks?: number; draws?: number; residentTriangles?: number; budget?: { limitBytes: number; baseBytes: number; detailBytes: number; pendingBytes: number; totalBytes: number; evictions: number; denied: number; coarseOverBudget: boolean; }; }; downloadBytes: number; cacheHits: number; cacheMisses: number; cacheWriteFailures: number; readyMs: number; firstVisibleMs?: number; revealedBatches?: number; layers?: { key: string; loaded: boolean; requested: boolean; loading: boolean; error?: string; }[]; };
    update(options: { time?: number; deltaMS?: number; camera?: { position: number[]; height: number; fov: number; orthographicHeight?: number | null; planes?: ArrayLike<number>; }; }): void;
    whenLayersReady?(): Promise<void>;
    setShellEdges?(visible: boolean[]): void;
    setWarState?(state?: { items?: readonly unknown[]; } | null): void;
    setPlanningOverlays?(options: { rdz?: boolean; topo?: boolean; }): void;
    setWaterReflections?(enabled: boolean): void;
    setVegetationShadows?(enabled: boolean): void;
    setAmbientOcclusion?(enabled: boolean): void;
    setFrustumCulling?(enabled: boolean): void;
    setLayers?(layers?: Partial<Record<'terrain' | 'building' | 'structures' | 'rocks' | 'trees' | 'vegetation' | 'infrastructure' | 'roads' | 'decals' | 'puddles' | 'water' | 'effects' | 'shell', boolean>>): void;
    createRoadTour?(): Promise<{ state: string; speed: number; view: string; viewStyle: string; pose: { position: number[]; target: number[]; }; start(pose: { position: number[]; target: number[]; }): boolean; next(pose: { position: number[]; target: number[]; }): boolean; pause(): void; stop(): void; update(seconds: number): { position: number[]; target: number[]; }; snapshot(): Record<string, unknown>; }>;
    sampleGround?(x: number, y: number): number | null;
    sampleWater?(x: number, y: number): number | null;
    setGroundCutouts?(volumes: readonly (readonly (readonly number[])[])[]): void;
    prepareFirstFrame?(renderer: Renderer): void;
    destroy(): void;
}
export function loadBakedRegion(options: { baseUrl: string; entry: BakedRegionEntry; signal?: AbortSignal; renderer?: Renderer; prepareTerrain?: (source: TextureSource) => void | Promise<void>; frame?: { x: number; y: number; scale: number; }; onProgress?: (state: { phase: string; downloadBytes: number; }) => void; }): Promise<BakedRegion>;

export type PreparingRegion = Omit<BakedRegion, 'metrics'> & { metrics: Omit<BakedRegion['metrics'], 'readyMs'> & { readyMs?: number; }; };
/** Progressive publication defaults on. Asset streaming, model LOD, terrain LOD, adaptive terrain textures and frustum culling are independent; all adaptive policies default off. Atomic publication remains an internal viewer/test option. */
export function loadCompactRegion(options: Parameters<typeof loadBakedRegion>[0] & { scheduleModelTask?: <T>(task: () => Promise<T>) => Promise<T>; terrainSurface?: 'native' | 'map' | 'plain'; waterReflections?: boolean; vegetationShadows?: boolean; ambientOcclusion?: boolean; vegetationDensity?: 'full' | 'reduced' | 'minimal'; progressive?: boolean; adaptiveStreaming?: boolean; modelLod?: boolean; terrainLod?: boolean; adaptiveTextures?: boolean; frustumCulling?: boolean; layers?: Parameters<NonNullable<BakedRegion['setLayers']>>[0]; onSceneCreated?: (scene: PreparingRegion) => void; onSceneReady?: (scene: PreparingRegion) => boolean | void; priorityPosition?: number[]; }): Promise<BakedRegion>;
