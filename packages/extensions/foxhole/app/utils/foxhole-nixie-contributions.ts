import { foxholeNixieContributionEntries } from '#foxhole/plugins/foxhole/nixie/contribution-sources.ts';
import '#foxhole/plugins/foxhole/nixie/board-snapshot-serialization.ts';
import '#foxhole/plugins/foxhole/nixie/board-snapshot-wire.ts';
import { registerFoxholeNodeToolBridge } from '#foxhole/plugins/foxhole/nixie/register-foxhole-node-tool-bridge.ts';
import { registerFoxholeStyleClipboardHandlers } from '#foxhole/plugins/foxhole/nixie/style-clipboard.ts';
import {
    importLegacyPlanClipboardText,
    isLegacyPlanClipboardText,
} from '#foxhole/plugins/foxhole/legacy/plan-clipboard-import.ts';
import {
    importLegacyPlanFile,
    insertLegacyBlueprintFile,
    prepareLegacyBlueprintFile,
    isLegacyPlanImportCandidate,
} from '#foxhole/plugins/foxhole/legacy/plan-import-ui.ts';
import { setNixieAlternateClipboardImporter } from '#nixie/plugins/nixie/clipboard.ts';
import { setNixieAlternateProjectArchiveImporter } from '#nixie/plugins/nixie/project-archive-import.ts';
import { registerNixieContributionSources } from '#nixie/plugins/nixie/registry/index.ts';
import { registerNixieSceneV1NodeConverter } from '#nixie/utils/nixie-scene-v2-converter-registry.ts';
import { registerLegacyBlueprintImporter } from '#nixie/plugins/nixie/legacy-blueprint-import.ts';
import { convertFoxholeSceneV1NodeToV2 } from '#foxhole/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { registerNixieSceneV2StateAdapter } from '#nixie/utils/nixie-scene-v2-state-adapter-registry.ts';
import { foxholeSceneV2StateAdapter } from '#foxhole/plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import { registerNixieSceneV2RenderPresentationAdapter } from '#nixie/plugins/nixie/scene-v2/render-presentation.ts';
import { prepareFoxholeSceneV2RenderPresentation, FOXHOLE_SCENE_V2_PRESENTATION_SETTING_IDS } from '#foxhole/plugins/foxhole/nixie/scene-v2-render-presentation.ts';

import { registerNixieSceneV2CanvasContribution } from '#nixie/plugins/nixie/scene-v2/canvas-contributions.ts';
import { createFoxholeSceneMapCanvas } from '#foxhole/plugins/foxhole/nixie/scene-map-canvas-adapter.ts';

import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { FOXHOLE_USE_SDK_MAP_SETTING_ID } from '#foxhole/plugins/foxhole/nixie/scene-map-renderer-setting.ts';

let registered = false;

export function registerFoxholeNixieContributions(): void {
    if (registered) {
        return;
    }
    registered = true;

    const settings = useNixieSettingsStore();
    registerNixieSceneV2CanvasContribution('nixie.foxhole-planner', createFoxholeSceneMapCanvas,
        () => !import.meta.dev || settings.getValueOr(FOXHOLE_USE_SDK_MAP_SETTING_ID, false) !== true);
    registerFoxholeNodeToolBridge();
    registerFoxholeStyleClipboardHandlers();
    registerNixieSceneV1NodeConverter('nixie.foxhole-planner', convertFoxholeSceneV1NodeToV2);
    registerNixieSceneV2StateAdapter('nixie.foxhole-planner', foxholeSceneV2StateAdapter);
    registerNixieSceneV2RenderPresentationAdapter('nixie.foxhole-planner', prepareFoxholeSceneV2RenderPresentation, FOXHOLE_SCENE_V2_PRESENTATION_SETTING_IDS);
    registerNixieContributionSources(foxholeNixieContributionEntries);
    registerLegacyBlueprintImporter({
        prepare: prepareLegacyBlueprintFile,
        copy: (file, provenance, initialName) => importLegacyPlanFile(file, { provenance, initialName }),
        insert: insertLegacyBlueprintFile,
    });
    setNixieAlternateProjectArchiveImporter({
        canImport: isLegacyPlanImportCandidate,
        importFile: importLegacyPlanFile,
    });
    setNixieAlternateClipboardImporter({
        canImport: isLegacyPlanClipboardText,
        importText: importLegacyPlanClipboardText,
    });
}
