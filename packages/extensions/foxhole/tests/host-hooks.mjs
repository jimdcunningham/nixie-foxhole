import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hostSourceUrl } from './host-source-url.mjs';
const hostLayer = process.env.NIXIE_HOST_ROOT
    ? pathToFileURL(process.env.NIXIE_HOST_ROOT + '/packages/nixie/')
    : new URL('../../../../../nixie/packages/nixie/', import.meta.url);
const externalRoot = new URL('../../../../', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
    // Private host pressure tests must share the host's SDK/Pixi/decoder
    // instances rather than a separately installed FoxWatch dependency tree.
    if (context.parentURL?.startsWith(externalRoot) && !specifier.startsWith('.') && !specifier.startsWith('#') && !specifier.includes(':') && !specifier.startsWith('/')) {
        try {
            return next(specifier, { ...context, parentURL: new URL('package.json', hostLayer).href });
        } catch (error) {
            if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        }
    }
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
        const remapped = hostSourceUrl(specifier, context.parentURL || import.meta.url);
        if (remapped.href !== new URL(specifier, context.parentURL || import.meta.url).href) return next(remapped.href, context);
    }
    if (specifier === '@nixie/extension-sdk' || specifier.startsWith('@nixie/extension-sdk/')) {
        return next(specifier, { ...context, parentURL: new URL('package.json', hostLayer).href });
    }
    if (specifier.startsWith('../../../../nixie/')) {
        return next(new URL(specifier.slice('../../../../nixie/'.length), hostLayer).href, context);
    }
    for (const [prefix, root] of [['#nixie/', '../../../nixie/app/'], ['#nixie-internal/', '../../../nixie/'], ['#foxhole/', '../app/'], ['#foxhole-server/', '../server/'], ['#nixie-server/', '../../../nixie/server/']]) {
        if (specifier.startsWith(prefix)) {
            const base = prefix.startsWith('#nixie')
                ? new URL((prefix === '#nixie/' ? 'app/' : prefix === '#nixie-server/' ? 'server/' : '') + specifier.slice(prefix.length), hostLayer)
                : new URL(root + specifier.slice(prefix.length), import.meta.url);
            const target = [base, ...['.ts', '.js', '.mjs', '.json', '/index.ts'].map(suffix => new URL(base.href + suffix))].find(url => existsSync(url));
            if (target) return { url: target.href, shortCircuit: true };
        }
    }
    if (specifier.startsWith('../../../../../extensions/scene-v2-diagram/')) {
        return next(hostSourceUrl(specifier, context.parentURL).href, context);
    }
    try {
        return next(specifier, context);
    } catch (error) {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && !specifier.startsWith('.') && !specifier.startsWith('#') && !specifier.startsWith('file:')) {
            return next(specifier, { ...context, parentURL: new URL('package.json', hostLayer).href });
        }
        throw error;
    }
}, load(url, context, next) {
    return next(hostSourceUrl(url, import.meta.url).href, context);
} });

const { registerFoxholeLegacyDiscoveryProfile } = await import('../app/utils/legacy-discovery-profile.ts');
registerFoxholeLegacyDiscoveryProfile();

const { registerFoxholeSceneV2HostPolicy } = await import('../app/utils/scene-v2-host-policy.ts');
registerFoxholeSceneV2HostPolicy();
const { registerNixieExtension } = await import(new URL('app/plugins/nixie/extensions/index.ts', hostLayer).href);
registerNixieExtension({ id: 'nixie.foxhole-planner', aliases: ['foxhole'], label: 'Foxhole Planner', contributionSourcePrefix: 'layer:foxhole:', internalSdkIntegration: true, enabledForLegacyProjects: true });
