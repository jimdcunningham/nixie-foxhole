import type { NixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { createFoxholeCornerWallMaskPoints, createFoxholeStructureFloorMaskPoints, createFoxholeTrenchEmplacementMaskPolygons, isFoxholeTrenchEmplacementCodeName } from './structure-floor-mask.ts';
import { isFoxholeFloorRenderLayer } from './structure-render-layer-visibility.ts';
type Point = {
    x: number;
    y: number;
};
/** Ear clipping preserves concave intersection approaches without filling their cutout corners. */
export function triangulateStructureRegion(input: readonly Point[]): Point[][] {
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const points = input.filter((p, i) => Math.hypot(p.x - input[(i + input.length - 1) % input.length]!.x, p.y - input[(i + input.length - 1) % input.length]!.y) > 1e-7);
    const area = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length]!.y - p.y * points[(i + 1) % points.length]!.x, 0);
    if (area < 0)
        points.reverse();
    const result: Point[][] = [];
    while (points.length > 3) {
        let found = false;
        for (let i = 0; i < points.length; i++) {
            const a = points[(i + points.length - 1) % points.length]!, b = points[i]!, c = points[(i + 1) % points.length]!;
            if (Math.abs(cross(a, b, c)) < 1e-8) {
                points.splice(i, 1);
                found = true;
                break;
            }
            if (cross(a, b, c) < 0)
                continue;
            if (points.some(p => p !== a && p !== b && p !== c && cross(a, b, p) >= -1e-8 && cross(b, c, p) >= -1e-8 && cross(c, a, p) >= -1e-8))
                continue;
            result.push([a, b, c]);
            points.splice(i, 1);
            found = true;
            break;
        }
        if (!found)
            throw Error('Invalid structural clipping polygon');
    }
    if (points.length === 3 && Math.abs(cross(points[0]!, points[1]!, points[2]!)) > 1e-8)
        result.push([...points]);
    return result;
}
export function structuralModelClips(asset: FoxholeSceneV2AssetMetadata, occupied: ReadonlySet<string>): NonNullable<NixieExperimentalSpatialPlanV1['modelClips']> {
    const model = asset.model, profile = model?.structuralProfile;
    if (!model || !profile)
        return [];
    return Object.entries(asset.renderLayers).flatMap(([id, layer]) => {
        const nodeNames = profile.layers[id];
        if (!nodeNames?.length)
            return [];
        const floor = isFoxholeFloorRenderLayer({ ...layer, id }, asset.codeName);
        const outline = floor ? createFoxholeStructureFloorMaskPoints(asset.codeName, layer, 160, occupied) : createFoxholeCornerWallMaskPoints(asset.codeName, { ...layer, id }, 160, occupied);
        const regions = isFoxholeTrenchEmplacementCodeName(asset.codeName) ? createFoxholeTrenchEmplacementMaskPolygons(asset.codeName, layer, 160, floor ? 'floor' : 'walls', occupied) : outline.length ? triangulateStructureRegion(outline) : [];
        return regions.length ? [{ nodeNames: [...nodeNames], polygons: regions.map(region => region.flatMap(p => [(p.x - model.offsetX) / 32, (p.y - model.offsetY) / 32])) }] : [];
    });
}
