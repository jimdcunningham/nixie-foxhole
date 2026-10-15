import { FOXHOLE_SOCKET_SNAPPING_SETTING_ID } from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { NIXIE_PRIMARY_TOOLBAR_SNAPPING_GROUP_ID } from '#nixie/plugins/nixie/registry/primary-toolbar-ids.ts';

export default defineContribution({
    settings: [
        {
            id: FOXHOLE_SOCKET_SNAPPING_SETTING_ID,
            scope: 'user',
            type: 'boolean',
            name: 'Socket Snapping',
            description: 'Snap compatible Foxhole structure and connector sockets together while editing.',
            icon: 'ph:plugs-connected',
            group: 'general',
            settingsPageSectionId: 'viewport',
            defaultValue: true,
        },
    ],
    primaryToolbarItems: [
        {
            id: 'foxhole.primary-toolbar.snapping.sockets',
            group: NIXIE_PRIMARY_TOOLBAR_SNAPPING_GROUP_ID,
            order: 30,
            label: 'Socket Snapping',
            icon: 'ph:plugs-connected',
            tooltip: 'Socket Snapping',
            active: context => context.getSetting(FOXHOLE_SOCKET_SNAPPING_SETTING_ID) === true,
            disabled: context => !context.canEdit.value,
            run: context => context.toggleSetting(FOXHOLE_SOCKET_SNAPPING_SETTING_ID),
        },
    ],
});
