import { pathToFileURL } from 'node:url';

const sourceRoot = new URL('../../../../', import.meta.url);
const hostRoot = process.env.NIXIE_HOST_ROOT
    ? pathToFileURL(process.env.NIXIE_HOST_ROOT + '/')
    : new URL('../../../../../nixie/', import.meta.url);

/** Resolve private host fixtures in the explicitly selected Nixie checkout. */
export function hostSourceUrl(specifier, base) {
    const url = new URL(specifier, base);
    for (const path of ['packages/nixie/', 'extensions/scene-v2-diagram/', 'node_modules/@pixi/3d/']) {
        const prefix = new URL(path, sourceRoot).href;
        if (url.href.startsWith(prefix)) return new URL(path + url.href.slice(prefix.length), hostRoot);
    }
    return url;
}
