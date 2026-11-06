import {FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID} from './night-ranges.ts';
import {parseNixieSpatialPlanV1} from '@nixiejs/extension-sdk/scene-v2';
import type {NixieSpatialModelLightOverrideV1} from '@nixiejs/extension-sdk/scene-v2';
export interface FoxholeModelLightMetadata {nodeName: string; castShadow: boolean; poweredIntensity?: number;}
export type FoxholeModelLightCatalog = Record<string, FoxholeModelLightMetadata[]>;
/** FoxWatch has already interpreted blueprint metadata; runtime only chooses a portable presentation. */
export function buildFoxholeModelLightOverrides(resourceId: string | undefined, catalog: FoxholeModelLightCatalog | undefined, powered: boolean): NixieSpatialModelLightOverrideV1[] {
    const rows = resourceId && catalog && Object.hasOwn(catalog,resourceId) ? catalog[resourceId] : undefined;
    return parseNixieSpatialPlanV1({contractVersion:1,supplementModel:true,nodes:[],modelLightOverrides:(rows??[]).map(light=>({
        nodeName:light.nodeName,castShadow:light.castShadow,
        ...(light.poweredIntensity===undefined?{}:{intensity:light.poweredIntensity,enabled:powered}),
    }))}).modelLightOverrides!;
}

/** Keep powered lamp presentation aligned with the retained nighttime and roof controls. */
export function shouldEnableFoxholePoweredModelLights(settings: Record<string, unknown> | undefined): boolean {
    return settings?.[FOXHOLE_NIGHTTIME_RANGES_SETTING_ID] === true
        && settings?.[FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID] === true
        && settings?.['foxhole.structure.hideRoofs'] !== true;
}
