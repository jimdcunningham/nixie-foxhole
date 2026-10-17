import FoxholeWarNxSidebarPanel from '#foxhole/components/nixie/foxhole/FoxholeWarNxSidebarPanel.vue';
import FoxholeWarNxSidebarTitle from '#foxhole/components/nixie/foxhole/FoxholeWarNxSidebarTitle.vue';
import FoxholeWarNxSidebarMetadata from '#foxhole/components/nixie/foxhole/FoxholeWarNxSidebarMetadata.vue';
import FoxholeWarNxSidebarOverflow from '#foxhole/components/nixie/foxhole/FoxholeWarNxSidebarOverflow.vue';
import FoxholeSceneStatsSidebarPanel from '#foxhole/components/nixie/foxhole/FoxholeSceneStatsSidebarPanel.vue';
import FoxholeSceneStatsSidebarMetadata from '#foxhole/components/nixie/foxhole/FoxholeSceneStatsSidebarMetadata.vue';
import FoxholeSceneStatsSidebarActions from '#foxhole/components/nixie/foxhole/FoxholeSceneStatsSidebarActions.vue';
import FoxholeSceneStatsSidebarOverflow from '#foxhole/components/nixie/foxhole/FoxholeSceneStatsSidebarOverflow.vue';
import { startFoxholePlaybackEventService } from '#foxhole/composables/useFoxholePlaybackEventService.ts';
import { getNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { NIXIE_OVERLAYS_STRUCTURES_MENU_ID } from '#nixie/plugins/nixie/registry/menu-ids.ts';
import { useNixieProjectStore } from '#nixie/stores/project.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION,
    withCommandSettingsPageSection,
} from '#foxhole/plugins/foxhole/nixie/settings-page-sections.ts';
import { FOXHOLE_MAP_SETTING_KEYS, foxholeMapSettings, readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { FoxholeMapViewportPlugin, getFoxholeMapActiveBounds } from '#foxhole/plugins/foxhole/nixie/map/controller.ts';
import { foxholeSceneMapRendererSetting } from '#foxhole/plugins/foxhole/nixie/scene-map-renderer-setting.ts';
import { foxholeStatsUserSettings } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';

function isFoxholeSceneSurfaceActive(): boolean {
    const session = getNixieEditorDocumentSessionBridge();
    return session?.isSceneActive.value === true || session?.isSceneV2Active.value === true;
}

export default defineContribution({
    settings: [
        ...foxholeMapSettings,
        foxholeSceneMapRendererSetting,
        ...foxholeStatsUserSettings,
    ],
    commands: withCommandSettingsPageSection([
        {
            id: 'foxhole.map.toggle',
            type: 'editor',
            name: 'Toggle Foxhole Map',
            description: 'Show or hide the Foxhole map overlay.',
            icon: 'ph:hexagon',
            availableInShell: true,
            defaultKeybinding: {
                primary: { key: 'm' },
            },
            run: context => {
                const settings = readFoxholeMapSettings(context.project.settings.value);
                context.project.patchSettings({
                    [FOXHOLE_MAP_SETTING_KEYS.enabled]: !settings.enabled,
                }, 'command:foxhole.map.toggle');
            },
        },
    ], FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION),
    menus: [
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 200,
            item: {
                type: 'separator',
                id: 'foxhole.map.menu.separator',
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 210,
            item: {
                id: 'foxhole.map.menu.toggle',
                label: 'Foxhole Map',
                icon: 'ph:hexagon',
                type: 'checkbox',
                visible: () => useNixieProjectStore().ready,
                checked: () => readFoxholeMapSettings(useNixieProjectStore().settings).enabled,
                onClick: () => {
                    const projectStore = useNixieProjectStore();
                    const settings = readFoxholeMapSettings(projectStore.settings);
                    projectStore.patchSettings({
                        [FOXHOLE_MAP_SETTING_KEYS.enabled]: !settings.enabled,
                    }, 'menu:foxhole.map.toggle');
                },
            },
        },
    ],
    leftSidebar: [
        {
            // Keep `foxhole-war-shell` so existing shell-layout open/visible state maps across.
            id: 'foxhole-war-shell',
            name: 'Foxhole War',
            icon: 'nx:hexagon-bars',
            headerTitle: FoxholeWarNxSidebarTitle,
            headerMetadata: FoxholeWarNxSidebarMetadata,
            headerOverflow: FoxholeWarNxSidebarOverflow,
            order: 45,
            visible: () => isFoxholeSceneSurfaceActive(),
            sections: [
                {
                    id: 'foxhole-war-shell',
                    name: 'Foxhole War',
                    component: FoxholeWarNxSidebarPanel,
                    showHeader: false,
                },
            ],
        },
    ],
    rightSidebar: [
        {
            id: 'foxhole-scene-stats',
            name: 'Statistics',
            icon: 'ph:chart-bar-horizontal',
            headerMetadata: FoxholeSceneStatsSidebarMetadata,
            headerActions: FoxholeSceneStatsSidebarActions,
            headerOverflow: FoxholeSceneStatsSidebarOverflow,
            order: 55,
            visible: () => isFoxholeSceneSurfaceActive(),
            sections: [
                {
                    id: 'foxhole-scene-stats',
                    name: 'Statistics',
                    component: FoxholeSceneStatsSidebarPanel,
                    showHeader: false,
                },
            ],
        },
    ],
    viewportPlugins: [
        {
            id: 'foxhole.map.viewport',
            order: 100,
            create: context => {
                return new FoxholeMapViewportPlugin(context.viewport, context);
            },
        },
    ],
    runtimeServices: [
        {
            id: 'foxhole.playback.events',
            order: 100,
            start: startFoxholePlaybackEventService,
        },
    ],
    worldBounds: [
        {
            id: 'foxhole.map.world-bounds',
            order: 100,
            getBounds: context => {
                const settingsStore = useNixieSettingsStore();
                const settings = readFoxholeMapSettings(
                    context.project.settings.value,
                    settingId => settingsStore.getValue(settingId),
                );
                if (!settings.enabled) {
                    return null;
                }

                const bounds = getFoxholeMapActiveBounds(settings);
                return {
                    minX: bounds.left,
                    minY: bounds.top,
                    maxX: bounds.right,
                    maxY: bounds.bottom,
                    minScaleFloor: 0,
                };
            },
        },
    ],
});
