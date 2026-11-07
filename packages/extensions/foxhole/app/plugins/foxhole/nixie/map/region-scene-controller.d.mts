import type { View3D } from '@pixi/3d';
import type { loadCompactRegion } from '@nixiejs/foxhole-world';
type Status = { phase: string; region?: string; error?: string; downloadBytes?: number; totalBytes?: number; terrainTransfers?: { bytes: number; observed: number; unknown: number; cached: number; }; readyMs?: number; regionCount?: number; readyRegions?: number; failedRegions?: number; loadingRegions?: number; selectionGeneration?: number; retryableFailed?: boolean; retryableLoading?: boolean; };
export function regionIdForKey(key: string): string;
export function selectedSpatialRegions(options: { enabled: boolean; regionKeys: string[]; mode: 'flat' | '2d' | '3d'; }): string[];
export class FoxholeRegionSceneController {
    constructor(options: { baseUrl: string; loadRegion: typeof loadCompactRegion; fetcher?: typeof fetch; indexLoader?: (signal?: AbortSignal) => Promise<unknown>; concurrency?: number; manageEnvironment?: boolean; onStatus?: (status: Status) => void; });
    sync(options: { view: View3D; settings: { enabled: boolean; regionKeys: string[]; solidMap?: boolean; terrainSurface?: 'native' | 'map' | 'plain'; ambientOcclusion?: boolean; waterReflections?: boolean; vegetationShadows?: boolean; softShadows?: boolean; shadowStrength?: 'light' | 'medium' | 'strong'; vegetationDensity?: 'full' | 'reduced' | 'minimal'; adaptiveStreaming?: boolean; modelLod?: boolean; terrainLod?: boolean; adaptiveTextures?: boolean; frustumCulling?: boolean; worldLayers?: Parameters<typeof loadCompactRegion>[0]['layers']; }; mode: 'flat' | '2d' | '3d'; position?: { x: number; y: number; }; regions?: { id: string; position: { x: number; y: number; }; terrainMapImage?: { key: string; load: () => Promise<import('pixi.js').Texture | null>; release?: () => Promise<void>; } | null; warState?: { items?: readonly unknown[]; } | null; }[]; deltaMS?: number; warState?: { items?: readonly unknown[]; } | null; }): void;
    retryFailed(): boolean;
    retryLoading(): boolean;
    streamingStats(): { resident: number; loading: number; total: number; };
    tourRegions(): { id: string; position: { x: number; y: number; }; scene: import('@nixiejs/foxhole-world').BakedRegion; }[];
    mapAssetAt(x: number, y: number): string | null;
    sampleGround(x: number, y: number): number | null;
    sampleWater(x: number, y: number): number | null;
    setGroundCutouts(volumes: readonly (readonly (readonly number[])[])[]): void;
    readonly active: boolean;
    whenDisposed(): Promise<void>;
    destroy(): void;
}
