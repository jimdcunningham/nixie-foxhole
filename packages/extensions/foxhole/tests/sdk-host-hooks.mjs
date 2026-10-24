import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hostSourceUrl } from './host-source-url.mjs';
const hostLayer = pathToFileURL(process.env.NIXIE_HOST_ROOT + '/packages/nixie/');
// Resolve host pressure-test imports without installing any private extension adapter.
registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@nixiejs/extension-sdk' || specifier.startsWith('@nixiejs/extension-sdk/')) {
        return next(specifier, { ...context, parentURL: new URL('package.json', hostLayer).href });
    }
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
        const url = hostSourceUrl(specifier, context.parentURL || import.meta.url); if (url.href !== new URL(specifier, context.parentURL || import.meta.url).href) return next(url.href, context);
    }
    return next(specifier, context);
}, load(url, context, next) { return next(hostSourceUrl(url, import.meta.url).href, context); } });
