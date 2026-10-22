import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

// CharMoveComp.DepthOffset overrides from the native blueprint defaults (build 26058282), in centimetres.
// Buoyancy is a dimensionless factor. Missing depth overrides retain the preserved blueprint origin.
const depthOffsets: Record<string, number> = {
    Motorboat: 70,
    LargeShipBaseShip: 70,
    LargeShipBattleshipAircraftW: 70,
    LargeShipBattleshipC: 70,
    LargeShipBattleshipW: 70,
    LargeShipDestroyerC: 70,
    LargeShipAircraftC: 70,
    LargeShipDestroyerW: 70,
    LargeShipLiquidShip: 70,
    LargeShipResourceShip: 70,
    LargeShipSubmarineW: 70,
    ScoutVehicleUtilityW: 3,
};

/** Convert the native floating reference into the exported, grounded model's scene-unit coordinates. */
export function foxholeAquaticWaterline(asset: FoxholeSceneV2AssetMetadata): number | undefined {
    if (!['naval', 'aquatic'].includes(asset.category) && !Object.hasOwn(depthOffsets, asset.codeName)) return;
    const origin = asset.model?.blueprintOrigin?.z;
    if (origin === undefined || !Number.isFinite(origin)) return;
    return origin + (depthOffsets[asset.codeName] ?? 0) * 32 / 100;
}
