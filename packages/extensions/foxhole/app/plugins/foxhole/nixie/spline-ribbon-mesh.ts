import * as PIXI from 'pixi.js';
import { buildSplineRibbonMeshData } from '../../../../../../../extensions/foxhole-planner/src/spline-ribbon-mesh.ts';
export * from '../../../../../../../extensions/foxhole-planner/src/spline-ribbon-mesh.ts';

export function buildSplineRibbonMeshGeometry(...args: Parameters<typeof buildSplineRibbonMeshData>): PIXI.MeshGeometry | null {
    const data = buildSplineRibbonMeshData(...args);
    return data ? new PIXI.MeshGeometry(data) : null;
}

export function configureSpanRibbonTexture(texture: PIXI.Texture, addressMode: 'repeat' | 'clamp-to-edge' = 'repeat'): void {
    if (!texture.source) return;
    texture.source.addressMode = addressMode;
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = false;
}
