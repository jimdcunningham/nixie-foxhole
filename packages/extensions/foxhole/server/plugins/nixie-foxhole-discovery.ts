import { registerFoxholeLegacyDiscoveryProfile } from '#foxhole/utils/legacy-discovery-profile.ts';
import { registerNixieInternalBlueprintServices } from '#nixie-server/utils/internal-blueprint-services.ts';
import { getFoxholeLegacyBlueprint, searchFoxholeLegacyBlueprints, requireFoxholeLegacyBlueprintFeature } from '#foxhole-server/utils/legacy-blueprints.ts';
import { foxholeBlueprintSubscriptionStore } from '#foxhole-server/utils/blueprint-subscription-store.ts';
import { readFoxholeLegacyUploads } from '#foxhole-server/utils/legacy-discovery-uploads.ts';
import { registerFoxholeHostProductProfile } from '#foxhole/utils/host-product-profile.ts';
export default defineNitroPlugin(() => {
    registerFoxholeHostProductProfile();
    registerFoxholeLegacyDiscoveryProfile();
    registerNixieInternalBlueprintServices({ get: getFoxholeLegacyBlueprint, search: searchFoxholeLegacyBlueprints, requireFeature: requireFoxholeLegacyBlueprintFeature, subscriptions: foxholeBlueprintSubscriptionStore, uploads: readFoxholeLegacyUploads });
});
