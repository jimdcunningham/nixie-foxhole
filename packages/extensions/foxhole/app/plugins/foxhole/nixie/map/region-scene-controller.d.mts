import type { View3D } from '@pixi/3d';
import type { loadCompactRegion } from '@nixie/foxhole-world';
type Status = { phase: string; region?: string; error?: string; downloadBytes?: number; totalBytes?: number; readyMs?: number; regionCount?: number; readyRegions?: number; failedRegions?: number; loadingRegions?: number; };
export function regionIdForKey(key: string): string;
export function selectedSpatialRegions(options: { enabled: boolean; regionKeys: string[]; mode: 'flat' | '2d' | '3d'; }): string[];
export class FoxholeRegionSceneController {
    constructor(options: { baseUrl: string; loadRegion: typeof loadCompactRegion; fetcher?: typeof fetch; concurrency?: number; manageEnvironment?: boolean; onStatus?: (status: Status) => void; });
    sync(options: { view: View3D; settings: { enabled: boolean; regionKeys: string[]; terrainSurface?: 'native' | 'map' | 'plain'; ambientOcclusion?: boolean; waterReflections?: boolean; vegetationShadows?: boolean; softShadows?: boolean; shadowStrength?: 'light' | 'medium' | 'strong'; vegetationDensity?: 'full' | 'reduced' | 'minimal'; shadowQuality?: 'off' | 'low' | 'medium' | 'high'; adaptiveStreaming?: boolean; modelLod?: boolean; terrainLod?: boolean; adaptiveTextures?: boolean; frustumCulling?: boolean; worldLayers?: Parameters<typeof loadCompactRegion>[0]['layers']; }; mode: 'flat' | '2d' | '3d'; position?: { x: number; y: number; }; regions?: { id: string; position: { x: number; y: number; }; warState?: { items?: readonly unknown[]; } | null; }[]; deltaMS?: number; warState?: { items?: readonly unknown[]; } | null; }): void;
    streamingStats(): { resident: number; loading: number; total: number; };
    tourRegions(): { id: string; position: { x: number; y: number; }; scene: import('@nixie/foxhole-world').BakedRegion; }[];
    sampleGround(x: number, y: number): number | null;
    sampleWater(x: number, y: number): number | null;
    setGroundCutouts(volumes: readonly (readonly (readonly number[])[])[]): void;
    readonly active: boolean;
    destroy(): void;
}
