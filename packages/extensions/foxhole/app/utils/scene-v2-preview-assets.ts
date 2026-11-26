import { shallowRef } from 'vue';
import { decodeFoxholeCatalogMetadata } from '../../../../../extensions/foxhole-planner/src/catalog-keys.mjs';
import type { FoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import { readFoxholeProductCatalog, type FoxholeAssetGeneration } from './asset-generation.ts';

const assets = shallowRef<ReadonlyMap<string, FoxholeSceneV2AssetMetadata>>(new Map());
export function readFoxholePreviewAsset(id: string): FoxholeSceneV2AssetMetadata | undefined {
    return assets.value.get(id);
}
export async function prepareFoxholePreviewAssets(generation: FoxholeAssetGeneration | null): Promise<() => void> {
    const document = generation
        ? decodeFoxholeCatalogMetadata((await readFoxholeProductCatalog(generation)).catalog) as {
            products: Array<{ id: string; data: FoxholeSceneV2AssetMetadata; }>;
        } : null;
    const prepared = new Map(document?.products.map(product => [product.id, product.data]) ?? []);
    return () => {
        assets.value = prepared;
    };
}

export function readFoxholePreviewAssetsVersion() {
    return assets.value;
}
