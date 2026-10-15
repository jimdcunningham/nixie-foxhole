import { registerNixieLegacyBlueprintProfile } from '#nixie/utils/legacy-blueprints.ts';
export function registerFoxholeLegacyDiscoveryProfile() {
    registerNixieLegacyBlueprintProfile({ sourceKind: 'legacy-foxhole-blueprint', prefix: 'foxhole-blueprint-', converterRevision: 'foxhole-legacy-bridge-v1', label: 'Foxhole Planner', requiredExtensionIds: ['foxhole'] });
}
