import type { NixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { createFoxholeStructureFloorMaskPoints, createFoxholeTrenchEmplacementMaskPolygons, isFoxholeTrenchEmplacementCodeName } from './structure-floor-mask.ts';
import { triangulateStructureRegion } from './scene-v2-structural-clips.ts';

/** Match authored floor footprints, never the padded projection's image bounds. */
export function structuralGroundCutouts(asset: FoxholeSceneV2AssetMetadata, occupied: ReadonlySet<string>): NonNullable<NixieExperimentalSpatialPlanV1['groundCutouts']> {
    const floor = asset.renderLayers.floor ?? asset.renderLayers.floormesh ?? {width:160,height:160,offsetX:0,offsetY:0};
    if (!asset.bunker || !asset.model?.structuralProfile) return [];
    const id = asset.codeName.toLowerCase();
    let regions: Array<Array<{ x: number; y: number }>>;
    if (isFoxholeTrenchEmplacementCodeName(id)) {
        regions = createFoxholeTrenchEmplacementMaskPolygons(id, floor, 160, 'floor', occupied);
    } else {
        let outline = createFoxholeStructureFloorMaskPoints(id, floor, 160, occupied);
        if (!outline.length) {
            const rect = (x: number, y: number, centerY = 0) => [{ x: -x, y: centerY - y }, { x, y: centerY - y }, { x, y: centerY + y }, { x: -x, y: centerY + y }];
            if (/^trencht[123]$/.test(id)) outline = rect(160, 48);
            else if (/^fortcornert[123]$/.test(id)) outline = [{x:-80,y:-80},{x:80,y:-80},{x:80,y:-16},{x:-16,y:80},{x:-80,y:80}];
            else if (/^fortbaset[123]$/.test(id)) outline = rect(80, 160, 80);
            else if (asset.profileType?.toLowerCase() === 'fort') outline = rect(80, 80);
            else {
                regions = (asset.selectionPolygons ?? []).flatMap(p => triangulateStructureRegion(p.shape.filter((_,i)=>i%2===0)
                    .map((x,i)=>({x:x*32,y:p.shape[i*2+1]!*32}))));
                return regions.map(region=>({polygon:region.flatMap(p=>[p.x,p.y]),minZ:-64,maxZ:0}));
            }
        }
        regions = triangulateStructureRegion(outline);
    }
    // Native trench/bunker floors lie 160 cm below the surface. The extra depth
    // keeps their thickness inside the excavation, without cutting ground above raised structures.
    return regions.map(region => ({ polygon: region.flatMap(p => [p.x, p.y]), minZ: -64, maxZ: 0 }));
}
