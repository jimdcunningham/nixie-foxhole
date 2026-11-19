import type { NixieProductPlacementPortV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { foxholeRailVehicleGauge, railCouplers } from './rail-vehicle-snapping.ts';

export function foxholeRailCouplerPlacementPorts(assetId: string,
    metadata: Record<string, FoxholeSceneV2AssetMetadata>): NixieProductPlacementPortV1[] {
    const owner = metadata[assetId], gauge = foxholeRailVehicleGauge(assetId);
    if (!owner || !gauge || gauge === 'crane') return [];
    const candidates = Object.entries(metadata).filter(([id]) => foxholeRailVehicleGauge(id) === gauge)
        .map(([id, asset]) => ({ id, couplers: railCouplers(asset, gauge) }));
    const size = gauge === 'small' ? { length: 28, width: 24, height: 18 } : { length: 44, width: 34, height: 24 };
    return railCouplers(owner, gauge).map(port => {
        const products = Object.fromEntries(candidates.flatMap(({ id, couplers }) => {
            const mating = couplers.find(coupler => port.name !== coupler.name);
            if (!mating) return [];
            const rotation = port.rotation === mating.rotation ? Math.PI : 0;
            const direction = rotation === 0 ? 1 : -1;
            // The new vehicle shares the running height of the existing one.
            return [[`asset.${id}`, { x: port.point.x - mating.point.x * direction,
                y: port.point.y - mating.point.y * direction, z: 0, rotation }]];
        }));
        return { point: port.point, rotation: port.rotation, size, products, placementSound: 'foxhole.audio.coupler-clank' };
    }).filter(port => Object.keys(port.products).length > 0);
}
