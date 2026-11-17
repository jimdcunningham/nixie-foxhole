import type { FoxholeSpatialPoint } from './scene-v2-spatial-transforms.ts';

// WheelBase on the rail vehicle blueprint CDOs, in centimetres.
const WHEELBASE_CM = new Map<string, number>([
    ['trainengine', 590],
    ['traincaboose', 510], ['traincombatcarc', 510], ['traincombatcarw', 510],
    ['trainflatbed', 510], ['traininfantry', 510], ['traincoal', 268],
    ['smalltrainengine', 132], ['smalltrainliquid', 132], ['smalltrainmaterial', 132],
    ['smalltrainresource', 132], ['smalltrainshipping', 132],
]);

export function foxholeRailWheelbase(assetId: string): number | undefined {
    const wheelbase = WHEELBASE_CM.get(assetId);
    return wheelbase === undefined ? undefined : wheelbase * 0.32;
}

/** Match the rigid axle spacing with a chord over the two rail contact points. */
export function fitFoxholeRailWheelbase(wheelbase: number,
    sample: (distance: number) => FoxholeSpatialPoint | undefined) {
    let halfSpan = wheelbase / 2;
    let pose: { point: FoxholeSpatialPoint; heading: number; halfSpan: number; pitch: number; } | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
        const rear = sample(-halfSpan);
        const front = sample(halfSpan);
        if (!rear || !front) return pose;
        const dx = front[0] - rear[0], dy = front[1] - rear[1], dz = front[2] - rear[2];
        const chord = Math.hypot(dx, dy, dz);
        if (chord < wheelbase * 0.8) return pose;
        pose = { point: [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2, (front[2] + rear[2]) / 2],
            heading: Math.atan2(dy, dx), halfSpan, pitch: Math.atan2(dz, Math.hypot(dx, dy)) };
        if (Math.abs(chord - wheelbase) < 0.05) break;
        halfSpan *= wheelbase / chord;
    }
    return pose;
}
