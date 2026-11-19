import type { NixieSceneV2ComponentV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieSceneV1NodeConversionResult } from '#nixie/utils/nixie-scene-v2-conversion.ts';

const editableComponents = new Map([
    ['foxholeAsset', 'asset'],
    ['foxholeSplineConnector', 'spline-connector'],
    ['foxholeConnector', 'connector'],
    ['foxholeTacticalLine', 'tactical-line'],
    ['foxholeRange', 'range'],
    ['foxholeBinocularLine', 'binocular-line'],
    ['foxholeTriangulation', 'triangulation'],
]);

export function foxholeLegacyEditingCapabilities(nodeType: string,
    components: readonly NixieSceneV2ComponentV1[]): NonNullable<NixieSceneV1NodeConversionResult['legacyCapabilities']> {
    const id = editableComponents.get(nodeType);
    if (!id || !components.some(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === id && component.version === 1)) return [];
    if (id === 'asset') return ['move', 'rotate'];
    return id === 'connector' || id === 'tactical-line'
        ? ['move', 'rotate', 'geometry-resize', 'geometry-reshape']
        : ['move', 'rotate', 'geometry-reshape'];
}
