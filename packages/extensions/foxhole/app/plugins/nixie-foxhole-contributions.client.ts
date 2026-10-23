import { initializeFoxholeAssetDelivery } from '#foxhole/utils/asset-delivery.ts';
import { defineNuxtPlugin } from '#app';
import { registerNixieExtension } from '#nixie/plugins/nixie/extensions/index.ts';

import { registerNixieInternalModelResource } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { registerFoxholeSceneV2HostPolicy } from '#foxhole/utils/scene-v2-host-policy.ts';

import { registerNixieAssistantIntegration } from '#nixie/plugins/nixie/assistant/integration-actions.ts';
import { normalizeFoxholeAssistantAction, foxholeAssistantNodeLabel } from '#foxhole/utils/assistant-client-actions.ts';

import LegacySettingsImport from '#foxhole/components/nixie/NixieLegacySettingsImport.vue';
import { registerNixieSettingsImportIntegration } from '#nixie/composables/useNixieSettingsImportIntegration.ts';

export default defineNuxtPlugin({
    name: 'foxhole-nixie-contributions',
    enforce: 'pre',
    dependsOn: ['nixie-registry'],
    async setup() {
        const assetDelivery = await initializeFoxholeAssetDelivery();
        registerNixieSettingsImportIntegration('nixie.foxhole-planner', LegacySettingsImport);
        registerNixieAssistantIntegration('nixie.foxhole-planner', normalizeFoxholeAssistantAction, foxholeAssistantNodeLabel);
        registerFoxholeSceneV2HostPolicy();
        // Keep the saved preview identity, but resolve bytes only from separately supplied assets.
        registerNixieInternalModelResource('nixie.core/resource-transfer-station-preview', assetDelivery.resolve('types/structures/facilitytransferresource/facilitytransferresource.glb'));
        registerNixieExtension({
            id: 'nixie.foxhole-planner',
            aliases: ['foxhole'],
            internalSdkIntegration: true,
            enabledForLegacyProjects: true,
            label: 'Foxhole Planner',
            description: 'Structures, connectors, war map tools, and Foxhole-specific planning features.',
            icon: 'ph:strategy',
            contributionSourcePrefix: 'layer:foxhole:',
            loadContributions: async () => {
                const { registerFoxholeNixieContributions } = await import('#foxhole/utils/foxhole-nixie-contributions.ts');
                registerFoxholeNixieContributions();
            },
        });
    },
});
