import {parseNixieExperimentalSpatialPlanV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import type {NixieExperimentalSpatialModelLightOverrideV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
export interface FoxholeModelLightMetadata {nodeName: string; castShadow: boolean; poweredIntensity?: number;}
export type FoxholeModelLightCatalog = Record<string, FoxholeModelLightMetadata[]>;
/** FoxWatch has already interpreted blueprint metadata; runtime only chooses a portable presentation. */
export function buildFoxholeModelLightOverrides(resourceId: string | undefined, catalog: FoxholeModelLightCatalog | undefined, powered: boolean): NixieExperimentalSpatialModelLightOverrideV1[] {
    const rows = resourceId && catalog && Object.hasOwn(catalog,resourceId) ? catalog[resourceId] : undefined;
    return parseNixieExperimentalSpatialPlanV1({contractVersion:1,supplementModel:true,nodes:[],modelLightOverrides:(rows??[]).map(light=>({
        nodeName:light.nodeName,castShadow:light.castShadow,
        ...(light.poweredIntensity===undefined?{}:{intensity:light.poweredIntensity,enabled:powered}),
    }))}).modelLightOverrides!;
}
