import type { NixieProductPlacementPortV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { foxholeRailVehicleGauge } from './rail-vehicle-snapping.ts';

const UNITS_PER_CM = 0.32;

function railCouplers(asset: FoxholeSceneV2AssetMetadata, gauge: 'small' | 'standard') {
    const model = asset.model;
    if (!model) return [];
    return (asset.overlayRailCouplers ?? []).flatMap(socket => {
        if (socket.name !== 'FrontCoupler' && socket.name !== 'RearCoupler') return [];
        const authoredX = Number(socket.x) * UNITS_PER_CM;
        if (!Number.isFinite(authoredX) || authoredX === 0) return [];
        const direction = Math.sign(authoredX);
        const end = (model.offsetX ?? 0) + direction * model.width / 2;
        const authoredZ = Number(socket.z) * UNITS_PER_CM + (model.blueprintOrigin?.z ?? 0);
        // Some articulated exports keep their template markers on an internal
        // segment. Put those ports on the matching end of the complete model.
        const x = Math.abs(authoredX) >= Math.abs(end) * 0.75 ? authoredX : end;
        const z = authoredZ > 0 ? authoredZ : gauge === 'small' ? 17.28 : 33.92;
        return [{ name: socket.name, point: { x, y: Number(socket.y ?? 0) * UNITS_PER_CM, z },
            rotation: direction > 0 ? 0 : Math.PI }];
    });
}

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
        return { point: { ...port.point, z: port.point.z - size.height / 2 }, rotation: port.rotation, size, products };
    }).filter(port => Object.keys(port.products).length > 0);
}
