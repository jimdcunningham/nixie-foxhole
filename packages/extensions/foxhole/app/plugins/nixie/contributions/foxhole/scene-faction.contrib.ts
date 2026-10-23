import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { NIXIE_OVERLAYS_STRUCTURES_MENU_ID } from '#nixie/plugins/nixie/registry/menu-ids.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { FOXHOLE_SCENE_FACTION_OPTIONS, FOXHOLE_SCENE_FACTION_SETTING_ID, normalizeFoxholeSceneFaction } from '#foxhole/utils/scene-faction.ts';

export default defineContribution({
    settings: [{
        id: FOXHOLE_SCENE_FACTION_SETTING_ID, scope: 'user', persist: 'local', type: 'select', name: 'Foxhole Faction',
        description: 'Choose the faction appearance for spatial scene flags.',
        icon: 'ph:flag', group: 'general', defaultValue: 'asset-default', viewpoint: true,
        options: [...FOXHOLE_SCENE_FACTION_OPTIONS],
    }],
    menus: [{
        menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID, order: -709,
        item: {
            type: 'submenu', label: 'Faction', icon: 'ph:flag',
            availableWhen: { surfaces: ['scene-v2'] },
            children: FOXHOLE_SCENE_FACTION_OPTIONS.map(option => ({
                type: 'checkbox' as const, label: option.label,
                checked: () => normalizeFoxholeSceneFaction(useNixieSettingsStore().getValue(FOXHOLE_SCENE_FACTION_SETTING_ID)) === option.value,
                onClick: () => useNixieSettingsStore().setValue(FOXHOLE_SCENE_FACTION_SETTING_ID, option.value),
            })),
        },
    }],
});
