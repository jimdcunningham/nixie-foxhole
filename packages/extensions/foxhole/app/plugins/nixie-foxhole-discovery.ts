import { defineNuxtPlugin } from '#app';
import { registerFoxholeLegacyDiscoveryProfile } from '#foxhole/utils/legacy-discovery-profile.ts';
import LegacyBlueprintDetail from '#foxhole/components/NxLegacyBlueprintDetail.vue';
import { getNixieLegacyBlueprintProfile, registerNixieLegacyBlueprintProfile } from '#nixie/utils/legacy-blueprints.ts';
export default defineNuxtPlugin({ name: 'foxhole-discovery-profile', enforce: 'pre', setup() {
    registerFoxholeLegacyDiscoveryProfile();
    registerNixieLegacyBlueprintProfile({ ...getNixieLegacyBlueprintProfile()!, detailComponent: LegacyBlueprintDetail, adminSection: { id: 'blueprint-moderation', label: 'Blueprint Moderation', icon: 'ph:shield-check', bodyLayout: 'workspace' } });
} });
