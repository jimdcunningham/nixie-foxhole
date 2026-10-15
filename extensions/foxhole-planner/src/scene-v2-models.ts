import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import spatialPolicy from './scene-v2-model-policy.json' with { type: 'json' };

const allowedCategories = new Set<string>(spatialPolicy.categoryIds);
const allowedModelIds = new Set<string>(spatialPolicy.assets);
export function isFoxholeSceneV2ModelAllowed(assetId: string): boolean {
    return /^[a-z0-9-]+$/.test(assetId) && (spatialPolicy.assetSelection === 'catalog' || allowedModelIds.has(assetId));
}

export interface FoxholeSceneV2ModelMetadata {
    resourceId: string;
    width: number;
    height: number;
    depth: number;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
}

export interface FoxholeSceneV2ModelSource {
    id: string;
    assetId: string;
    path: string;
}

/** Keep every packaged model and model part beside its owning asset resources. */
export function getFoxholeSceneV2PackagedModelPath(model: FoxholeSceneV2ModelSource): string {
    if (!/^[a-z0-9-]+$/.test(model.assetId)
        || (model.id !== model.assetId && !model.id.startsWith(`${model.assetId}.`))) {
        throw new Error(`Invalid Foxhole packaged model identity: ${model.id}`);
    }
    return `assets/${model.assetId}/${model.id}.glb`;
}

/** Join generated spatial output to the real catalog identity, never a preview product. */
export function bindFoxholeSceneV2Models(assets: Record<string, FoxholeSceneV2AssetMetadata>,
    document: { schemaVersion: number; assets: Record<string, FoxholeSceneV2ModelMetadata & { path: string; codeName: string; }>;
        resources?: Record<string, FoxholeSceneV2ModelMetadata & { path: string; assetId: string; }>; }) {
    if (document.schemaVersion !== 1) {
        throw new Error('Unsupported Foxhole model bundle version.');
    }
    for (const [assetId, asset] of Object.entries(assets)) {
        if (!isFoxholeSceneV2ModelAllowed(assetId)) {
            delete asset.model;
        }
    }
    const models = Object.entries(document.assets).filter(([id]) => isFoxholeSceneV2ModelAllowed(id)).map(([assetId, model]) => {
        const asset = assets[assetId];
        if (!asset || (spatialPolicy.assetSelection !== 'catalog' && !allowedCategories.has(asset.category))
            || asset.codeName !== model.codeName || model.path !== `models/${assetId}.glb`
            || model.resourceId !== `foxhole.model.${assetId}`
            || !['width', 'height', 'depth'].every(key => Number.isFinite(model[key as 'width']) && Number(model[key as 'width']) > 0)
            || !Number.isFinite(model.offsetX) || !Number.isFinite(model.offsetY) || !Number.isFinite(model.offsetZ)) {
            throw new Error(`Invalid Foxhole model binding: ${assetId}`);
        }
        asset.model = { resourceId: model.resourceId, width: model.width, height: model.height, depth: model.depth,
            offsetX: model.offsetX, offsetY: model.offsetY, offsetZ: model.offsetZ };
        return { id: assetId, assetId, path: model.path };
    });
    for (const [id, resource] of Object.entries(document.resources ?? {})) {
        if (!isFoxholeSceneV2ModelAllowed(resource.assetId)) {
            continue;
        }
        if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(id) || !assets[resource.assetId] || !id.startsWith(`${resource.assetId}.`)
            || resource.resourceId !== `foxhole.model.${id}` || resource.path !== `models/${id}.glb`
            || !['width', 'height', 'depth'].every(key => Number.isFinite(resource[key as 'width']) && resource[key as 'width'] > 0)
            || !['offsetX', 'offsetY', 'offsetZ'].every(key => Number.isFinite(resource[key as 'offsetX']))) {
            throw new Error(`Invalid Foxhole model-part binding: ${id}`);
        }
        models.push({ id, assetId: resource.assetId, path: resource.path });
    }
    return models;
}

/** Optional development build selection; the authored asset policy remains the default. */
export function selectFoxholeSceneV2ModelBuild(
    assets: Record<string, FoxholeSceneV2AssetMetadata>,
    models: FoxholeSceneV2ModelSource[],
    selection?: string,
) {
    if (selection === undefined) return models;
    const ids = selection.split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length) return models;
    if (ids.some(id => !isFoxholeSceneV2ModelAllowed(id) || !models.some(model => model.id === id))) {
        throw new Error('The development model selection must name exported allowlisted assets.');
    }
    const selected = new Set(ids);
    for (const [id, asset] of Object.entries(assets)) {
        if (!selected.has(id)) delete asset.model;
    }
    return models.filter(model => selected.has(model.assetId));
}
