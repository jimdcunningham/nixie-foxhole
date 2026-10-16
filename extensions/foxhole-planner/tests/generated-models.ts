import { readFileSync } from 'node:fs';
import bundle from '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json' with { type: 'json' };
import { isFoxholeGeneratedModelPath } from '../src/scene-v2-models.ts';

/** Read the current generated identity instead of assuming the old flat layout. */
export function readFoxholeGeneratedModel(id: string): Buffer {
    const model = ({ ...bundle.assets, ...bundle.resources } as Record<string, { path: string; assetId: string; }>)[id];
    if (!model || !isFoxholeGeneratedModelPath({ id, assetId: model.assetId, path: model.path })) {
        throw new Error(`Missing or invalid generated model: ${id}`);
    }
    return readFileSync(new URL(`../../../packages/extensions/foxhole/public/foxhole/assets/${model.path}`, import.meta.url));
}
