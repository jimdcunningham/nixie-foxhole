import { registerNixieInternalSceneV2Adapter } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import type { NixieInternalSceneV2Adapter } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';

const OWNER_ID = 'nixie.foxhole-planner';
export const foxholeSceneV2HostPolicy: NixieInternalSceneV2Adapter = {
    ownerId: OWNER_ID,
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
