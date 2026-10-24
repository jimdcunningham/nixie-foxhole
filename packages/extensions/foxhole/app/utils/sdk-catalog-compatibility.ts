import { getNixieExtensionProductCatalog } from '#nixie/utils/nixie-extension-product-catalog.ts';
import { FOXHOLE_COMPLETE_CATALOG_SETTINGS as allSettings } from './sdk-catalog-settings.ts';
import { createNixieIconAssetSnapshot } from '#nixie/plugins/nixie/contributions/assets/shared/icon-asset.ts';
import type { NixieExperimentalComponentProductV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { createFoxholeAssetIdentityResolver } from '../../../../../extensions/foxhole-planner/src/catalog-identity.ts';
import { getFoxholeManifest } from '../plugins/foxhole/nixie/manifest.ts';
import { foxholeSceneV2StateAdapter } from '../plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import { createFoxholeStructureSnapshot } from '../plugins/foxhole/nixie/snapshot.ts';
import { createFoxholeSplineConnectorSnapshot } from '../plugins/foxhole/nixie/spline-connector-snapshot.ts';

const OWNER = 'nixie.foxhole-planner';
const SDK_SOURCE = `sdk.${OWNER}__assets`;


export async function lookupFoxholeSdkCatalogReference(sourceId: string, assetId: string) {
    if (sourceId !== SDK_SOURCE && sourceId !== 'foxhole.structures') return null;
    const manifest = getFoxholeManifest('/foxhole/assets/');
    const catalog = getNixieExtensionProductCatalog();
    const resolve = catalog?.extensions.value.some(entry => entry.ownerId === OWNER)
        ? catalog.domainData(OWNER, 'asset-identities', () => createFoxholeAssetIdentityResolver(manifest.assets))
        : createFoxholeAssetIdentityResolver(manifest.assets);
    let reference = assetId.replace(/^#?registry-asset:/u, '').replace(/^#/u, '');
    for (const prefix of [`${SDK_SOURCE}:`, 'foxhole.structures:']) {
        if (reference.startsWith(prefix)) {
            reference = reference.slice(prefix.length);
        }
    }
    const sdkUpgrade = /^upgrade\.(.+)\.\d+\.\d+$/u.exec(reference);
    const legacyUpgrade = /^upgrade:([^:]+):([^:]+):(.+?)(:destroyed)?$/u.exec(reference);
    const destroyed = reference.endsWith(':destroyed');
    const plain = legacyUpgrade?.[1] ?? sdkUpgrade?.[1] ?? reference.replace(/^(?:asset\.|item:)/u, '').replace(/:destroyed$/u, '');
    const canonical = resolve(plain);
    if (!canonical) {
        return null;
    }
    const matches = (product: NixieExperimentalComponentProductV1) => {
        const asset = product.components.find(component => component.ownerId === OWNER && component.componentId === 'asset');
        if (asset?.data.assetId !== canonical) {
            return false;
        }
        if (sdkUpgrade) {
            return product.id === reference;
        }
        const selections = product.components.find(component => component.ownerId === OWNER && component.componentId === 'modification')?.data.selections;
        return legacyUpgrade ? Array.isArray(selections) && selections.some(selection => selection && typeof selection === 'object'
            && !Array.isArray(selection) && selection.slotId === legacyUpgrade[2] && selection.variantId === legacyUpgrade[3])
            : product.id === `asset.${canonical}`;
    };
    return { query: canonical, settings: allSettings, matches,
        ...(destroyed ? { adapt: (product: NixieExperimentalComponentProductV1) => {
            const next = structuredClone(product);
            const appearance = next.components.find(component => component.ownerId === OWNER && component.componentId === 'appearance');
            if (appearance) {
                appearance.data.destroyed = true;
            } else {
                next.components.push({ ownerId: OWNER, componentId: 'appearance', version: 1, data: { destroyed: true } });
            }
            return next;
        } } : {}) };
}

export async function createFoxholeSdkCatalogSnapshot(product: NixieExperimentalComponentProductV1, label: string,
    position: { x: number; y: number; z?: number; }) {
    const entity = { entityId: crypto.randomUUID(), revision: 1,
        components: product.components.map(component => ({ ...component, definitionAvailable: true })) };
    const projected = foxholeSceneV2StateAdapter.project(entity);
    const asset = product.components.find(component => component.ownerId === OWNER && component.componentId === 'asset');
    if (asset?.data.catalogId === 'foxhole.icons' && typeof asset.data.assetId === 'string') {
        const item = getFoxholeManifest('/foxhole/assets/').assets.find(candidate => candidate.id === asset.data.assetId);
        return item ? createNixieIconAssetSnapshot({ key: label, label, textureUrl: item.iconUrl ?? item.icons?.default ?? '', ...position }) : null;
    }
    const key = projected?.state.foxholeKey;
    if (!projected || typeof key !== 'string') {
        return null;
    }
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === key);
    const snapshot = projected.type === 'foxholeSplineConnector'
        ? createFoxholeSplineConnectorSnapshot({ foxholeKey: key, structure, label, ...position })
        : createFoxholeStructureSnapshot({ foxholeKey: key, label, ...position });
    return { ...snapshot, state: { ...snapshot.state, ...projected.state } };
}
