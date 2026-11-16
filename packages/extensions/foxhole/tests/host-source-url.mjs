import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sourceRoot = new URL('../../../../', import.meta.url);
const hostRoot = process.env.NIXIE_HOST_ROOT
    ? pathToFileURL(process.env.NIXIE_HOST_ROOT + '/')
    : new URL('../../../../../nixie/', import.meta.url);

/** Resolve private host fixtures in the explicitly selected Nixie checkout. */
export function hostSourceUrl(specifier, base) {
    const url = new URL(specifier, base);
    const pixi3dPrefix = new URL('node_modules/@pixi/3d/', sourceRoot).href;
    if (url.href.startsWith(pixi3dPrefix)) {
        const requireFromStudio = createRequire(new URL('packages/nixie/package.json', hostRoot));
        const pixi3dEntry = pathToFileURL(requireFromStudio.resolve('@pixi/3d'));
        return new URL('../' + url.href.slice(pixi3dPrefix.length), pixi3dEntry);
    }
    for (const path of ['packages/nixie/', 'packages/extension-sdk/', 'extensions/scene-v2-diagram/']) {
        const prefix = new URL(path, sourceRoot).href;
        if (url.href.startsWith(prefix)) return new URL(path + url.href.slice(prefix.length), hostRoot);
    }
    return url;
}
