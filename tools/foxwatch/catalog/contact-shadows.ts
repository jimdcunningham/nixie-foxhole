import { resolveFoxholeTextureSidecarUrl, resolveFoxholeContactShadowProjection } from '../../../extensions/foxhole-planner/src/contact-shadow.ts';
import type { FoxholeSceneV2AssetMetadata } from './product-metadata.ts';
/** Compile optional sidecars once; SDK consumers never fetch or interpret them. */
export async function bindFoxholeContactShadows(generated: {
    assets: Record<string, FoxholeSceneV2AssetMetadata>;
    visualResources: Array<{
        id: string;
        sourceUrl: string;
    }>;
    modificationResources: Array<{
        id: string;
        sourceUrl: string;
    }>;
}, textures: Array<{
    id: string;
    sourceUrl: string;
}>, read: (url: string) => Promise<unknown>, exists: (url: string) => Promise<boolean>): Promise<string[]> {
    const sources = new Map([
        ...textures.map(row => [`foxhole.asset.${row.id}`, row.sourceUrl] as const),
        ...generated.visualResources.map(row => [`foxhole.visual.${row.id}`, row.sourceUrl] as const),
        ...generated.modificationResources.map(row => [`foxhole.mod.${row.id}`, row.sourceUrl] as const),
    ]);
    const bound = new Map<string, NonNullable<FoxholeSceneV2AssetMetadata['contactShadows']>[string]>();
    const files = new Set<string>();
    const resourceSources = new Map<string, string>();
    for (const [id, url] of sources) {
        const sidecar = resolveFoxholeTextureSidecarUrl(url);
        if (!sidecar) {
            continue;
        }
        const data = await read(sidecar);
        if (!data) {
            continue;
        }
        const projection = resolveFoxholeContactShadowProjection(url, data);
        if (!projection || !await exists(projection.textureUrl)) {
            continue;
        }
        const resource = `contact-shadow-${id.replace(/^foxhole\./, '').replace(/\./g, '-')}`;
        const previous = resourceSources.get(resource);
        if (previous && previous !== projection.textureUrl) {
            throw Error(`Contact shadow resource collision: ${resource}`);
        }
        if (!previous) {
            generated.visualResources.push({ id: resource, sourceUrl: projection.textureUrl });
        }
        resourceSources.set(resource, projection.textureUrl);
        const { textureUrl, ...geometry } = projection;
        bound.set(id, { ...geometry, resourceId: `foxhole.visual.${resource}` });
        files.add(sidecar);
        files.add(textureUrl);
    }
    const collect = (value: unknown, result: Set<string>) => {
        if (!value || typeof value !== 'object') {
            return;
        }
        if ('resourceId' in value && typeof value.resourceId === 'string') {
            result.add(value.resourceId);
        }
        for (const entry of Object.values(value)) {
            collect(entry, result);
        }
    };
    for (const [id, asset] of Object.entries(generated.assets)) {
        const ids = new Set([`foxhole.asset.${id}`]);
        collect(asset, ids);
        const entries = [...ids].flatMap(key => bound.has(key) ? [[key, bound.get(key)!] as const] : []);
        if (entries.length) {
            asset.contactShadows = Object.fromEntries(entries);
        }
    }
    return [...files];
}
