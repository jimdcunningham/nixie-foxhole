import { finalizeFoxholeSurfacePlacement } from './surface-placement.ts';
import { buildFoxholeStatisticsReport } from './statistics-report.ts';
import { renderFoxholePlanningMap } from './scene-v2-map-renderer.ts';
import { renderFoxholePlanningGrid } from './scene-v2-map-grid.ts';
import { connectNixieExtension } from '@nixie/extension-sdk';
import { mountSceneStatistics } from './scene-statistics.ts';
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
            [FOXHOLE_SCENE_V2_TRANSFORM_FINALIZER_SYSTEM_ID]: finalizeFoxholeSceneV2Transform,
            'transforms.spline-socket-snapping': finalizeFoxholeSceneV2Transform,
            'transforms.connector-socket-snapping': finalizeFoxholeSceneV2Transform,
        },
    },
});
const disposeStatistics = mountSceneStatistics(connection);
window.addEventListener('pagehide', () => {
    disposeStatistics();
    connection.dispose();
}, { once: true });
