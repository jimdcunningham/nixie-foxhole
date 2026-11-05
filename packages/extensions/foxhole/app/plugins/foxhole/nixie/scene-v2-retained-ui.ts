import type { RetainedInternalExtensionUi } from '#nixie-internal/desktop-extensions/ui-routing.ts';
import { FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS } from './contribution-source-ids.ts';
import { foxholeMapSettings } from './map-settings.ts';
import { foxholeSceneMapRendererSetting } from './scene-map-renderer-setting.ts';

/** Temporary bundled War map/server UI; authoring and Statistics use SDK declarations. */
export function createFoxholeRetainedSceneV2Ui(development: boolean): RetainedInternalExtensionUi[] {
    return [{
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.map,
        settings: [...foxholeMapSettings, ...(development ? [foxholeSceneMapRendererSetting] : [])].map(setting => setting.id),
        commands: ['foxhole.map.toggle'],
        menus: ['foxhole.map.menu.separator', 'foxhole.map.menu.toggle'],
        leftSidebar: ['foxhole-war-shell'],
    }];
}
