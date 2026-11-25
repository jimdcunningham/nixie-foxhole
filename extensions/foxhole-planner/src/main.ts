import { finalizeFoxholeSurfacePlacement } from './surface-placement.ts';
import { foxholeRailTrackFinalizers } from './rail-vehicle-snapping.ts';
import { buildFoxholeStatisticsReport } from './statistics-report.ts';
import { renderFoxholePlanningMap } from './scene-v2-map-renderer.ts';
import { renderFoxholePlanningGrid } from './scene-v2-map-grid.ts';
import { connectNixieExtension } from '@nixiejs/extension-sdk';
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
const supportsSnapFeedback = (() => {
    try {
        parseNixieTransformFinalizeResultV1({ contractVersion: 1, transform: { x: 0, y: 0 },
            snap: { id: 'socket', points: [{ x: 0, y: 0, z: 0 }] } });
        return true;
    } catch {
        return false;
    }
})();

const finalizeSocketTransform: typeof finalizeFoxholeSceneV2Transform = request =>
    finalizeFoxholeSceneV2Transform(supportsSnapFeedback || !request.context.settings?.['nixie.scene.snapFeedback']
        ? request
        : { ...request, context: { ...request.context, settings: { ...request.context.settings, 'nixie.scene.snapFeedback': false } } });

const connection = await connectNixieExtension({
    sceneV2: {
        documentRenderers: { 'render.planning-map': renderFoxholePlanningMap, 'render.planning-grid': renderFoxholePlanningGrid },
        panelReportProviders: { 'reports.statistics': buildFoxholeStatisticsReport },
        inspectorProviders: { [FOXHOLE_INSPECTOR_SYSTEM_ID]: inspectFoxholeSceneV2Structure,
            [FOXHOLE_CONNECTOR_INSPECTOR_SYSTEM_ID]: inspectFoxholeSceneV2SplineConnector,
            'inspect.range': inspectFoxholeSceneV2PlanningPath,
            'inspect.binocular-line': inspectFoxholeSceneV2PlanningPath,
            'inspect.tactical-line': inspectFoxholeSceneV2PlanningPath,
            'inspect.triangulation': inspectFoxholeSceneV2PlanningPath },
        entityRenderers: {
            [FOXHOLE_SCENE_V2_ENTITY_RENDERER_SYSTEM_ID]: renderFoxholeSceneV2Entity,
        },
        productProviders: {
            [FOXHOLE_SCENE_V2_PRODUCT_PROVIDER_SYSTEM_ID]: listFoxholeSceneV2Products,
        },
        transformFinalizers: {
            'transforms.surface-placement': finalizeFoxholeSurfacePlacement,
            ...foxholeRailTrackFinalizers,
            [FOXHOLE_SCENE_V2_TRANSFORM_FINALIZER_SYSTEM_ID]: finalizeSocketTransform,
            'transforms.spline-socket-snapping': finalizeSocketTransform,
            'transforms.connector-socket-snapping': finalizeSocketTransform,
        },
    },
});
window.addEventListener('pagehide', () => connection.dispose(), { once: true });
