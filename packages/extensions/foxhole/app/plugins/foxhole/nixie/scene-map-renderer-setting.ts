import type { UserSettingDefinition } from '#nixie/plugins/nixie/registry/types.ts';
import { FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION } from './settings-page-sections.ts';

/** Studio comparison only; never changes a saved map or the standalone SDK. */
export const FOXHOLE_USE_SDK_MAP_SETTING_ID = 'foxhole.map.useSdkRenderer';
export const foxholeSceneMapRendererSetting: UserSettingDefinition = {
    id: FOXHOLE_USE_SDK_MAP_SETTING_ID,
    scope: 'user',
    persist: 'local',
    type: 'boolean',
    name: 'Use SDK Map',
    accessibleInDev: true,
    description: 'Compare the standalone SDK map renderer with the bundled map in Scene V2. Scene V1 keeps its bundled map.',
    icon: 'ph:code',
    group: 'general',
    settingsPageSectionId: FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION.id,
    order: 250,
    defaultValue: false,
};
