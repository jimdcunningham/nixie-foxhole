import {parseNixieExperimentalSpatialPlanV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
import type {NixieExperimentalSpatialModelTextureTransformV1} from '@nixiejs/extension-sdk/experimental/scene-v2';

export const FOXHOLE_SCENE_FACTION_SETTING_ID = 'nixie.scene.foxholeFaction';
export interface FoxholeFlagAtlasMetadata {
    materialName: string;
    authoredRow: 0 | 1;
}
export type FoxholeFlagAtlasCatalog = Record<string, FoxholeFlagAtlasMetadata[]>;

/** Source UV interpretation belongs to FoxWatch; runtime only chooses the retained faction. */
export function buildFoxholeModelTextureTransforms(resourceId: string | undefined, catalog: FoxholeFlagAtlasCatalog | undefined,
    faction: unknown): NixieExperimentalSpatialModelTextureTransformV1[] {
    if (faction !== 'colonial' && faction !== 'warden') return [];
    const rows = resourceId && catalog && Object.hasOwn(catalog, resourceId) ? catalog[resourceId] : undefined;
    const desiredRow = faction === 'colonial' ? 0 : 1;
    return parseNixieExperimentalSpatialPlanV1({contractVersion: 1, supplementModel: true, nodes: [],
        modelTextureTransforms: (rows ?? []).map(row => {
            if (row.authoredRow !== 0 && row.authoredRow !== 1) {
                throw Error('Invalid flag atlas metadata');
            }
            return {materialName: row.materialName, offset: [0, (desiredRow - row.authoredRow) * 0.5]};
        })}).modelTextureTransforms!;
}
