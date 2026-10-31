import { resolveFoxholeContactShadowProjection, resolveFoxholeTextureSidecarUrl } from '../../../../../../../extensions/foxhole-planner/src/contact-shadow.ts';
import type { FoxholeContactShadowProjection } from '../../../../../../../extensions/foxhole-planner/src/contact-shadow.ts';
import { resolveFoxholeAssetUrl } from './asset-locations.ts';

export { resolveFoxholeContactShadowProjection, resolveFoxholeTextureSidecarUrl, resolveFoxholeContactShadowCenter } from '../../../../../../../extensions/foxhole-planner/src/contact-shadow.ts';
export type { FoxholeContactShadowProjection } from '../../../../../../../extensions/foxhole-planner/src/contact-shadow.ts';
const metadataLoads = new Map<string, Promise<FoxholeContactShadowProjection | null>>();
export function loadFoxholeContactShadowProjection(textureUrl: string): Promise<FoxholeContactShadowProjection | null> {
    const sidecar = resolveFoxholeTextureSidecarUrl(textureUrl);
    if (!sidecar) {
        return Promise.resolve(null);
    }
    let resolved: string;
    try {
        resolved = resolveFoxholeAssetUrl(sidecar);
    } catch {
        resolved = sidecar;
    }
    const previous = metadataLoads.get(resolved);
    if (previous) {
        return previous;
    }
    const load = fetch(resolved).then(async response => {
        if (!response.ok) {
            return null;
        }
        const projection = resolveFoxholeContactShadowProjection(textureUrl, await response.json());
        if (!projection) {
            return null;
        }
        try {
            return { ...projection, textureUrl: resolveFoxholeAssetUrl(projection.textureUrl) };
        } catch {
            return projection;
        }
    }).catch(() => null);
    metadataLoads.set(resolved, load);
    return load;
}
