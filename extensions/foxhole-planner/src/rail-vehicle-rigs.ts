import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { blackBoltValveGear } from './black-bolt-valve-gear.ts';

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
const driveRate = (radiusMetres: number) => -1 / (32 * radiusMetres);
const mainWheelRadius = .745;
export const foxholeBlackBoltValveGear = blackBoltValveGear(driveRate(mainWheelRadius));
// The mouth of the stack measures x=2.56m and z=5.45m in the bound Black Bolt model.
const stack: [number, number, number] = [82, 0, 175];
const steam = (opacity: number, endSize: number, lifetime: number) => ({
    color: 0xd8e0e5, opacity, size: 28, endSize, velocity: [4, -6, 34] as [number, number, number], lifetime,
});
export const foxholeBlackBoltEffects: NonNullable<NixieSpatialPlanV1['simulationEffects']> = [
    { id: 'exhaust', point: stack, trigger: 'distance', interval: 2 * Math.PI * 32 * mainWheelRadius / 4,
        sound: { resourceId: 'foxhole.audio.steam-chuff', gain: .8, range: 4200 },
        particle: steam(.85, 102, 2.2) },
    { id: 'steam-idle', point: stack, trigger: 'idle', interval: 1.8,
        sound: { resourceId: 'foxhole.audio.steam-idle', gain: .23, range: 1600 },
        particle: steam(.31, 72, 2.7) },
    { id: 'whistle', point: stack, trigger: 'cue', label: 'Whistle',
        sound: { resourceId: 'foxhole.audio.steam-whistle', gain: .85, range: 8500 },
        particle: steam(.95, 128, 2.5) },
    { id: 'brake-squeal', point: [18, 0, 16], trigger: 'brake', interval: 24,
        sound: { resourceId: 'foxhole.audio.brake-squeal', gain: .62, range: 3800 } },
];
const roll = (name: string, radiusMetres: number) => ({
    nodeName: `rail-wheel-${name}`, axis: 'z' as const, radiansPerUnit: driveRate(radiusMetres),
});
export const foxholeRailWheelRoll: Readonly<Record<string, NixieSpatialPlanV1['modelDistanceRotations']>> = {
    trainengine: ['1', '2', '3'].map(name => roll(name, mainWheelRadius)).concat(roll('back', .555)),
    trainlrartillery: ['front', 'back'].flatMap(bogie => ['01', '02', '03'].map(axle => roll(`${axle}-${bogie}`, .409))),
};

const engineLinkNodes = (kind: string) => ['l', 'r'].map(side => `rail-link-${kind}-${side}`);
export const foxholeRailLinkages: Readonly<Record<string, NixieSpatialPlanV1['modelDistanceLinkages']>> = {
    trainengine: [{
        radiansPerUnit: driveRate(mainWheelRadius),
        // Rest crank pin and wrist pin measured from the authored Black Bolt rig.
        crankOffset: [-.373353, 0],
        rodLength: 3.572301,
        couplingNodes: engineLinkNodes('coupling'),
        rodNodes: engineLinkNodes('rod'),
        sliderNodes: engineLinkNodes('slider'),
    }],
};
