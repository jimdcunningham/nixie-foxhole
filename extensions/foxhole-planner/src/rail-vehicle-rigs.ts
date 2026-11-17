import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';

/** Authored longitudinal pivots and wheel contacts measured from the posed game rigs, in metres. */
export interface FoxholeBogie {
    nodeName: string;
    pivot: number;
    wheelOffsets: readonly [number, number];
}

function pair(front: number, rear: number, wheelSpan = 0): readonly FoxholeBogie[] {
    return [
        { nodeName: 'rail-bogie-front', pivot: front, wheelOffsets: [-wheelSpan, wheelSpan] },
        { nodeName: 'rail-bogie-rear', pivot: rear, wheelOffsets: [-wheelSpan, wheelSpan] },
    ];
}

const standard = pair(2.55597, -2.55597, 0.5947);
const small = pair(0.66048, -0.66048);

export const foxholeRailVehicleBogies: Readonly<Record<string, readonly FoxholeBogie[]>> = {
    trainengine: [{ nodeName: 'rail-bogie-rear', pivot: -1.92332, wheelOffsets: [-1.3397, -1.3397] }],
    traincaboose: standard,
    traincoal: pair(1.41327, -1.28163),
    traincombatcarc: standard,
    traincombatcarw: pair(4.42312, -4.42312, 0.5947),
    trainflatbed: standard,
    trainhospital: pair(-8.06221, 7.45103, 1.2634),
    traininfantry: standard,
    trainlrartillery: [
        { nodeName: 'rail-bogie-front', pivot: 8.23018, wheelOffsets: [-1.7548, 1.7548] },
        { nodeName: 'rail-bogie-rear', pivot: -8.22777, wheelOffsets: [-1.7714, 1.7381] },
    ],
    smalltrainengine: pair(1.01751, -0.30345),
    smalltrainliquid: small,
    smalltrainmaterial: small,
    smalltrainresource: small,
    smalltrainshipping: small,
};

// Rolling radii measured at the treads, outside the hub and inside the flange.
const roll = (name: string, radiusMetres: number) => ({
    nodeName: `rail-wheel-${name}`, axis: 'z' as const, radiansPerUnit: -1 / (32 * radiusMetres),
});
export const foxholeRailWheelRoll: Readonly<Record<string, NixieSpatialPlanV1['modelDistanceRotations']>> = {
    trainengine: ['1', '2', '3'].map(name => roll(name, .745)).concat(roll('back', .555)),
    trainlrartillery: ['front', 'back'].flatMap(bogie => ['01', '02', '03'].map(axle => roll(`${axle}-${bogie}`, .409))),
};
