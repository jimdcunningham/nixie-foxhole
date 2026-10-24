import { createRequire, registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const studioRoot = resolve(process.env.NIXIE_STUDIO_ROOT || fileURLToPath(new URL('../../../nixie/', import.meta.url)));
export const hostRequire = createRequire(pathToFileURL(resolve(studioRoot, 'package.json')));
export const hostModule = path => pathToFileURL(resolve(studioRoot, path)).href;
export function registerHostImports() {
    return registerHooks({ resolve(specifier, context, next) {
        if (specifier.startsWith('#nixie-host/')) return { url: hostModule('packages/nixie/' + specifier.slice(12)), shortCircuit: true };
        if (specifier.startsWith('@pixi/3d/dist/')) return { url: hostModule('node_modules/' + specifier), shortCircuit: true };
        if (specifier === '@pixi/3d' || specifier === 'pixi.js' || specifier.startsWith('@nixiejs/extension-sdk')) return next(specifier, { ...context, parentURL: hostModule('package.json') });
        return next(specifier, context);
    } });
}
