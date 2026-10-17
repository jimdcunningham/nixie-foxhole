import type * as PIXI from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { PointData } from 'pixi.js';
import type { NixieProjectSettings } from '#nixie/plugins/nixie/project.ts';
import type { NxAssetIconTileThemeColors, NxCanvasLabelThemeColors } from '#nixie/utils/nx-design-tokens.ts';
import type { FoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';

export interface FoxholeMapContext {
    app: PIXI.Application;
    viewport: Viewport;
    world: PIXI.Container;
    getProjectSettings: () => NixieProjectSettings;
    patchProjectSettings: (patch: Partial<NixieProjectSettings>, reason?: string) => NixieProjectSettings;
    readMapSettings: () => FoxholeMapSettings;
    getWarData: () => {
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
    } | null;
    getPlaybackTimestamp: () => number | null;
    getAssetsBaseUrl: () => string;
    getWorldPointer: () => PointData | null;
    getZoom: () => number;
    /** Shell-derived chrome for map labels and hover tooltips. */
    getCanvasLabelTheme: () => NxCanvasLabelThemeColors;
    getAssetIconTileTheme: () => NxAssetIconTileThemeColors;
    /** True only while a scene tab is the active editor surface. */
    hasActiveSceneView: () => boolean;
    loadTexture: (url: string) => Promise<PIXI.Texture>;
    releaseTexture?: (url: string) => Promise<void>;
    releaseAllTextures?: () => Promise<void>;
}
