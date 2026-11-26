import { finalizeFoxholeSurfacePlacement } from './surface-placement.ts';
import { foxholeRailTrackFinalizers } from './rail-vehicle-snapping.ts';
import { buildFoxholeStatisticsReport } from './statistics-report.ts';
import { prepareFoxholeCatalogLocale } from './catalog-localization.ts';
import { renderFoxholePlanningMap } from './scene-v2-map-renderer.ts';
import { renderFoxholePlanningGrid } from './scene-v2-map-grid.ts';
import type { ConnectNixieExtensionOptions } from '@nixiejs/extension-sdk';
import { parseNixieTransformFinalizeResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import { FOXHOLE_INSPECTOR_SYSTEM_ID, FOXHOLE_CONNECTOR_INSPECTOR_SYSTEM_ID, inspectFoxholeSceneV2Structure, inspectFoxholeSceneV2SplineConnector, inspectFoxholeSceneV2PlanningPath } from './scene-v2-inspector.ts';
import {
    FOXHOLE_SCENE_V2_ENTITY_RENDERER_SYSTEM_ID,
    renderFoxholeSceneV2Entity,
} from './scene-v2-renderers.ts';
import {
    FOXHOLE_SCENE_V2_PRODUCT_PROVIDER_SYSTEM_ID,
    listFoxholeSceneV2Products,
} from './scene-v2-products.ts';
import {
    FOXHOLE_SCENE_V2_TRANSFORM_FINALIZER_SYSTEM_ID,
    finalizeFoxholeSceneV2Transform,
} from './scene-v2-transform-finalizer.ts';

// Standalone builds with an older SDK can still snap on a newer Studio host.
function supportsSnapPoints(count: number): boolean {
    try {
        parseNixieTransformFinalizeResultV1({ contractVersion: 1, transform: { x: 0, y: 0 },
            snap: { id: 'socket', points: Array.from({ length: count }, (_, x) => ({ x, y: 0, z: 0 })) } });
        return true;
    } catch {
        return false;
    }
}

const supportsAllSnapPoints = supportsSnapPoints(9);
const supportsSnapFeedback = supportsAllSnapPoints || supportsSnapPoints(1);

const finalizeSocketTransform: typeof finalizeFoxholeSceneV2Transform = request => {
    const settings = request.context.settings;
    if (!settings?.['nixie.scene.snapFeedback'] || supportsAllSnapPoints
        || (supportsSnapFeedback && !settings['nixie.scene.snapFeedbackAll'])) {
        return finalizeFoxholeSceneV2Transform(request);
    }
    return finalizeFoxholeSceneV2Transform({ ...request, context: { ...request.context, settings: {
        ...settings, 'nixie.scene.snapFeedback': supportsSnapFeedback, 'nixie.scene.snapFeedbackAll': false,
    } } });
};

function withCatalogLocale<Request, Result>(provider: (request: Request) => Result, locale: (request: Request) => unknown) {
    return async (request: Request) => {
        await prepareFoxholeCatalogLocale(locale(request));
        return provider(request);
    };
}

export const sceneV2: NonNullable<ConnectNixieExtensionOptions['sceneV2']> = {
        documentRenderers: { 'render.planning-map': renderFoxholePlanningMap, 'render.planning-grid': renderFoxholePlanningGrid },
        panelReportProviders: { 'reports.statistics': withCatalogLocale(buildFoxholeStatisticsReport, request => request.scene.panelContext?.locale) },
        inspectorProviders: { [FOXHOLE_INSPECTOR_SYSTEM_ID]: withCatalogLocale(inspectFoxholeSceneV2Structure, request => request.locale),
            [FOXHOLE_CONNECTOR_INSPECTOR_SYSTEM_ID]: withCatalogLocale(inspectFoxholeSceneV2SplineConnector, request => request.locale),
            'inspect.range': inspectFoxholeSceneV2PlanningPath,
            'inspect.binocular-line': inspectFoxholeSceneV2PlanningPath,
            'inspect.tactical-line': inspectFoxholeSceneV2PlanningPath,
            'inspect.triangulation': inspectFoxholeSceneV2PlanningPath },
        entityRenderers: {
            [FOXHOLE_SCENE_V2_ENTITY_RENDERER_SYSTEM_ID]: renderFoxholeSceneV2Entity,
        },
        productProviders: {
            [FOXHOLE_SCENE_V2_PRODUCT_PROVIDER_SYSTEM_ID]: withCatalogLocale(listFoxholeSceneV2Products, request => request.locale ?? request.settings?.['foxhole.locale']),
        },
        transformFinalizers: {
            'transforms.surface-placement': finalizeFoxholeSurfacePlacement,
            ...foxholeRailTrackFinalizers,
            [FOXHOLE_SCENE_V2_TRANSFORM_FINALIZER_SYSTEM_ID]: finalizeSocketTransform,
            'transforms.spline-socket-snapping': finalizeSocketTransform,
            'transforms.connector-socket-snapping': finalizeSocketTransform,
        },
};
