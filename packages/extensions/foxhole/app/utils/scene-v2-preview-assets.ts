import { shallowRef } from 'vue';
import type { FoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import type { FoxholeAssetGeneration } from './asset-generation.ts';

const assets = shallowRef<ReadonlyMap<string, FoxholeSceneV2AssetMetadata>>(new Map());
export function readFoxholePreviewAsset(id: string): FoxholeSceneV2AssetMetadata | undefined {
    return assets.value.get(id);
}
export async function prepareFoxholePreviewAssets(generation: FoxholeAssetGeneration | null): Promise<() => void> {
    const text = generation ? (await generation.readProductCatalog('foxhole.catalog')).text : null;
    const document = text ? JSON.parse(text) as { products: Array<{ id: string; data: FoxholeSceneV2AssetMetadata; }>; } : null;
    const prepared = new Map(document?.products.map(product => [product.id, product.data]) ?? []);
    return () => {
        assets.value = prepared;
    };
}

export function readFoxholePreviewAssetsVersion() {
    return assets.value;
}
