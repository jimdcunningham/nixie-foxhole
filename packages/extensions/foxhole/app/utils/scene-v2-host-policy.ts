import { foxholeLegacyEditingCapabilities } from './legacy-scene-editing.ts';
import { foxholeRailPresentation } from './spatial-foxhole-rail-bed.ts';
import { readFoxholeModelLightHints } from '../../../../../extensions/foxhole-planner/src/model-light-hints.ts';
import { registerNixieInternalSceneV2Adapter } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import type { NixieInternalSceneV2Adapter } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { regionIdForKey } from '../../../../foxhole-world/runtime/region-id.mjs';

import { FOXHOLE_SCENE_FACTION_SETTING_ID, normalizeFoxholeSceneFaction } from './scene-faction.ts';

const OWNER_ID = 'nixie.foxhole-planner';
export const foxholeSceneV2HostPolicy: NixieInternalSceneV2Adapter = {
    ownerId: OWNER_ID,
    legacyCapabilities: foxholeLegacyEditingCapabilities,
    rail: foxholeRailPresentation,
    transformSettings(readSetting) {
        if (readSetting('foxhole.map.enabled') !== true) return {};
        const regions = String(readSetting('foxhole.map.regionKeys') ?? '').split(',').map(key => key.trim());
        return Object.fromEntries([...new Set(regions.map(regionIdForKey))].filter(id => /^[a-z0-9]+$/u.test(id))
            .slice(0, 64).map(id => [`foxhole.map.fixedRails.${id}`, true])); // SDK context setting limit.
    },
    modelLightHints: readFoxholeModelLightHints,
    legacyIconCatalogReference(entity) {
        const asset = entity.components.find(component => component.ownerId === OWNER_ID && component.componentId === 'asset'
            && component.version === 1 && component.definitionAvailable && component.data.catalogId === 'foxhole.icons');
        const assetId = asset?.data.assetId;
        if (typeof assetId !== 'string' || !assetId) return;
        return { catalogSourceId: `sdk.${OWNER_ID}__assets`, catalogAssetId: `asset.${assetId}` };
    },
    spatialPresentation(readSetting) {
        const faction = normalizeFoxholeSceneFaction(readSetting(FOXHOLE_SCENE_FACTION_SETTING_ID));
        return {
            modelLights: readSetting('foxhole.structure.modelLights') === true,
            poweredSpotlights: readSetting('foxhole.ranges.nighttime') === true
                && readSetting('foxhole.ranges.poweredSpotlights') === true
                && readSetting('foxhole.structure.hideRoofs') !== true,
            flagAtlasRow: faction === 'asset-default' ? undefined : faction === 'warden' ? 1 : 0,
        };
    },
    catalog: {
        providerId: 'assets', legacySourceIds: ['foxhole.structures'],
        lookup: async (sourceId, assetId) => (await import('./sdk-catalog-compatibility.ts')).lookupFoxholeSdkCatalogReference(sourceId, assetId),
        createSnapshot: async (product, label, position) => (await import('./sdk-catalog-compatibility.ts')).createFoxholeSdkCatalogSnapshot(product, label, position),
    },
    productCapabilities(product) {
        const hasProductComponent = (value: typeof product, ownerId: string, componentId: string) => value.components.some(component => component.ownerId === ownerId && component.componentId === componentId);
    const recognizedFoxholeOwner = true;
    const foxholeGeometryComponent = recognizedFoxholeOwner
        ? product.components.find(component => (
            component.ownerId === OWNER_ID
            && ['tactical-line', 'connector', 'spline-connector', 'range', 'binocular-line', 'triangulation']
                .includes(component.componentId)
        ))?.componentId
        : undefined;
    if (foxholeGeometryComponent) {
        return [
            'move',
            'rotate',
            ...(['tactical-line', 'connector'].includes(foxholeGeometryComponent)
                ? ['geometry-resize' as const]
                : []),
            'geometry-reshape',
        ];
    }
    if (recognizedFoxholeOwner && hasProductComponent(product, OWNER_ID, 'asset')) {
        return ['move', 'rotate'];
    }
        return [];
    },
    spline: {
        componentId: 'spline-connector', version: 1,
        readHandlePolicy(data) {
            if (typeof data.foxholeKey !== 'string') return null;
            for (const field of ['maxRadius', 'maxBuffer', 'curveT', 'maxTargetAngleDeg', 'maxArcAngleDeg']) {
                if (data[field] !== undefined && (typeof data[field] !== 'number' || !Number.isFinite(data[field]))) return null;
            }
            return { maximumLength: data.maxBuffer as number | undefined, preferredChordRatio: 0.4, interpolation: data.curveT as number | undefined };
        },
    },
};
export function registerFoxholeSceneV2HostPolicy() {
    return registerNixieInternalSceneV2Adapter(foxholeSceneV2HostPolicy);
}
