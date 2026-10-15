import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import spatialPolicy from './scene-v2-model-policy.json' with { type: 'json' };

export function readFoxholeSpatialPathProfile(value: unknown): FoxholeSpatialPathProfile | undefined {
    if (value === undefined) return undefined;
    const profile = value as FoxholeSpatialPathProfile;
    const validPoint = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3
        && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000);
    if (!profile || profile.version !== 1 || !profile.parts || Array.isArray(profile.parts)
        || Object.keys(profile.parts).length > 128 || !Object.values(profile.parts).every(part => part && Number.isInteger(part.meshIndex)
            && part.meshIndex >= 0 && part.meshIndex <= 1023 && validPoint(part.origin)
            && (part.meshIndices === undefined || Array.isArray(part.meshIndices) && part.meshIndices.length > 0 && part.meshIndices.length <= 32 && part.meshIndices.every(index => Number.isInteger(index) && index >= 0 && index <= 1023)))
        || profile.endOrigin !== undefined && !validPoint(profile.endOrigin)) throw new Error('Invalid Foxhole spatial profile');
    return structuredClone(profile);
}

const allowedCategories = new Set<string>(spatialPolicy.categoryIds);
const allowedModelIds = new Set<string>(spatialPolicy.assets);
export function isFoxholeSceneV2ModelAllowed(assetId: string): boolean {
    return /^[a-z0-9-]+$/.test(assetId) && (spatialPolicy.assetSelection === 'catalog' || allowedModelIds.has(assetId));
}

export interface FoxholeSpatialPathProfile {
    version: 1;
    parts: Record<string, { meshIndex: number; meshIndices?: number[]; origin: [number, number, number]; }>;
    endOrigin?: [number, number, number];
}

export interface FoxholeStructuralModelProfile {
    version: 1;
    layers: Record<string,string[]>;
    modifications?: Array<{slotId:string;variantId:string;nodeNames:string[];replacesLayers:string[]}>;
}
export function readFoxholeStructuralModelProfile(value: unknown): FoxholeStructuralModelProfile | undefined {
    if(value===undefined)return undefined;
    const profile=value as FoxholeStructuralModelProfile;
    const names=(value:unknown): value is string[]=>Array.isArray(value)&&value.length<=256&&value.every(name=>typeof name==='string'&&name.length>0&&name.length<=256&&!/[\u0000-\u001f]/.test(name));
    if(!profile||profile.version!==1||!profile.layers||Array.isArray(profile.layers)||Object.keys(profile.layers).length>128
        ||!Object.values(profile.layers).every(names))throw Error('Invalid Foxhole structural profile');
    const token=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f]/.test(value);
    if(profile.modifications!==undefined&&(!Array.isArray(profile.modifications)||profile.modifications.length>128
        ||profile.modifications.some(part=>!part||!token(part.slotId)||!token(part.variantId)||!names(part.nodeNames)
            ||!names(part.replacesLayers)||part.replacesLayers.some(id=>!profile.layers[id]))))throw Error('Invalid Foxhole structural modifications');
    if(new Set([...Object.values(profile.layers).flat(),...(profile.modifications??[]).flatMap(part=>part.nodeNames)]).size>256)
        throw Error('Foxhole structural profile exceeds visibility budget');
    return structuredClone(profile);
}
export interface FoxholeSceneV2ModelMetadata {
    structuralProfile?: FoxholeStructuralModelProfile;
    pathProfile?: FoxholeSpatialPathProfile;
    insulatedPathProfile?: FoxholeSpatialPathProfile;
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
    document: { schemaVersion: number; assets: Record<string, Omit<FoxholeSceneV2ModelMetadata, 'pathProfile' | 'structuralProfile'> & { pathProfile?: unknown; structuralProfile?: unknown; } & { path: string; codeName: string; }>;
        resources?: Record<string, Omit<FoxholeSceneV2ModelMetadata, 'pathProfile' | 'structuralProfile'> & { pathProfile?: unknown; structuralProfile?: unknown; } & { path: string; assetId: string; }>; }) {
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
        asset.model = { ...(model.structuralProfile ? { structuralProfile: readFoxholeStructuralModelProfile(model.structuralProfile) } : {}), ...(model.pathProfile ? { pathProfile: readFoxholeSpatialPathProfile(model.pathProfile) } : {}), resourceId: model.resourceId, width: model.width, height: model.height, depth: model.depth,
            offsetX: model.offsetX, offsetY: model.offsetY, offsetZ: model.offsetZ };
        if (asset.model.structuralProfile) (asset as FoxholeSceneV2AssetMetadata & {modelLayerNodes?:Record<string,string[]>}).modelLayerNodes = asset.model.structuralProfile.layers;
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
        if (id === `${resource.assetId}.upgrade.insulation` && assets[resource.assetId]?.model && resource.pathProfile) {
            assets[resource.assetId]!.model!.insulatedPathProfile = readFoxholeSpatialPathProfile(resource.pathProfile);
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

/** Export recipes belong to runtime metadata, never persisted model components. */
export function getFoxholeSceneV2ModelComponentData(model: FoxholeSceneV2ModelMetadata) {
    return { resourceId: model.resourceId, width: model.width, height: model.height, depth: model.depth,
        offsetX: model.offsetX, offsetY: model.offsetY, offsetZ: model.offsetZ };
}
