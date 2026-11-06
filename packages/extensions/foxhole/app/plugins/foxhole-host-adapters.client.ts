import { prepareFoxholePreviewAssets } from '#foxhole/utils/scene-v2-preview-assets.ts';
import { parseLegacySettings } from '#foxhole/utils/nixie-legacy-settings.ts';
import { initializeFoxholeAssetDelivery, prepareFoxholeAssetGeneration } from '#foxhole/utils/asset-delivery.ts';
import { defineNuxtPlugin } from '#app';
import { registerNixieInternalExtensionAdapter } from '#nixie-internal/desktop-extensions/internal-extension-adapters.ts';

import { createFoxholeRetainedSceneV2Ui } from '#foxhole/plugins/foxhole/nixie/scene-v2-retained-ui.ts';
import { registerFoxholeSceneV2HostPolicy } from '#foxhole/utils/scene-v2-host-policy.ts';

import { registerNixieAssistantIntegration } from '#nixie/plugins/nixie/assistant/integration-actions.ts';
import { normalizeFoxholeAssistantAction, foxholeAssistantNodeLabel } from '#foxhole/utils/assistant-client-actions.ts';

import LegacySettingsImport from '#foxhole/components/nixie/NixieLegacySettingsImport.vue';
import { registerNixieSettingsImportIntegration } from '#nixie/composables/useNixieSettingsImportIntegration.ts';

export default defineNuxtPlugin({
    name: 'nixie-private-extension-adapters',
    enforce: 'pre',
    dependsOn: ['nixie-registry'],
    async setup(nuxtApp) {
        initializeFoxholeAssetDelivery();
        registerNixieSettingsImportIntegration('nixie.foxhole-planner', LegacySettingsImport, text => {
            parseLegacySettings(text, []);
            return true;
        });
        registerNixieAssistantIntegration('nixie.foxhole-planner', normalizeFoxholeAssistantAction, foxholeAssistantNodeLabel);
        const stopPolicy = registerFoxholeSceneV2HostPolicy();
        const stopAdapter = registerNixieInternalExtensionAdapter({
            ownerId: 'nixie.foxhole-planner',
            aliases: ['foxhole'],
            prepareGeneration: async generation => {
                const activate = await prepareFoxholeAssetGeneration(generation);
                const activatePreviews = await prepareFoxholePreviewAssets(generation);
                return () => {
                    activate();
                    activatePreviews();
                };
            },
            replacesSdkUi: true,
            retainedSceneV2Ui: createFoxholeRetainedSceneV2Ui(import.meta.dev),
            enabledForLegacyProjects: true,
            contributionSourcePrefixes: ['layer:foxhole:'],
            loadContributions: async () => {
                const { registerFoxholeNixieContributions } = await import('#foxhole/utils/foxhole-nixie-contributions.ts');
                registerFoxholeNixieContributions();
            },
        });
        nuxtApp.vueApp.onUnmount(() => {
            stopAdapter();
            stopPolicy();
        });
    },
});
