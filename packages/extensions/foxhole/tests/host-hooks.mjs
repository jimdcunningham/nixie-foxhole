import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({ resolve(specifier, context, next) {
    for (const [prefix, root] of [['#nixie/', '../../../nixie/app/'], ['#nixie-internal/', '../../../nixie/'], ['#foxhole/', '../app/'], ['#foxhole-server/', '../server/'], ['#nixie-server/', '../../../nixie/server/']]) {
        if (specifier.startsWith(prefix)) {
            const base = new URL(root + specifier.slice(prefix.length), import.meta.url);
            const target = [base, ...['.ts', '.js', '.mjs', '.json', '/index.ts'].map(suffix => new URL(base.href + suffix))].find(url => existsSync(url));
            if (target) return { url: target.href, shortCircuit: true };
        }
    }
    return next(specifier, context);
} });

const { registerFoxholeLegacyDiscoveryProfile } = await import('../app/utils/legacy-discovery-profile.ts');
registerFoxholeLegacyDiscoveryProfile();

const { registerFoxholeSceneV2HostPolicy } = await import('../app/utils/scene-v2-host-policy.ts');
registerFoxholeSceneV2HostPolicy();
const { registerNixieExtension } = await import('../../../nixie/app/plugins/nixie/extensions/index.ts');
registerNixieExtension({ id: 'nixie.foxhole-planner', aliases: ['foxhole'], label: 'Foxhole Planner', contributionSourcePrefix: 'layer:foxhole:', internalSdkIntegration: true, enabledForLegacyProjects: true });
