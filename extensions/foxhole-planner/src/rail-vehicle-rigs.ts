import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { parseNixieSimulationEffectsV1 } from '@nixiejs/extension-sdk/scene-v2';
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
type SimulationEffect = NonNullable<NixieSpatialPlanV1['simulationEffects']>[number];
const cylinderSteam = (side: -1 | 1): SimulationEffect[] => {
    // Vent just below the front cylinder on either side of the Black Bolt rig.
    const point: SimulationEffect['point'] = [77, side * 45, 19];
    const label = side < 0 ? 'left' : 'right';
    return [
        { id: `cylinder-idle-${label}`, point, trigger: 'idle', interval: side < 0 ? 2.3 : 2.8,
            particle: { ...steam(.25, 30, 1.35), size: 12, velocity: [0, side * 10, 8], velocitySpace: 'entity' } },
        { id: `cylinder-start-${label}`, point, trigger: 'start',
            particle: { ...steam(.78, 86, 1.8), size: 22, velocity: [2, side * 53, 13], velocitySpace: 'entity' } },
    ];
};
const exhaust = {
    id: 'exhaust', point: stack, trigger: 'distance', interval: Math.PI * 32 * mainWheelRadius,
    sound: { resourceId: 'foxhole.audio.steam-chuff', gain: .8, range: 4200 },
    particle: steam(.85, 102, 2.2),
} satisfies SimulationEffect;
// Keep the former crawl pitch at every cadence. Equal bounds pin the sample's playback rate.
const fixedExhaust = { ...exhaust, sound: { ...exhaust.sound, distancePlayback: {
    referenceSpeed: 3.4 * exhaust.interval, rate: 1.2, variation: 0, minDuration: .85, maxDuration: .85,
} } };
const cruiseExhaust = parseSupportedSimulationEffect({ ...fixedExhaust, sound: { ...fixedExhaust.sound,
    speedGain: { startSpeed: 64, endSpeed: 224, startGain: 1, endGain: .28 },
} });
const railRolling = parseSupportedSimulationEffect({ id: 'rail-rolling', point: [0, 0, 12], trigger: 'moving',
    sound: { resourceId: 'foxhole.audio.rail-rolling', gain: .22, range: 1400,
        speedGain: { startSpeed: 16, endSpeed: 176, startGain: 0, endGain: 1 } },
});
function parseSupportedSimulationEffect(effect: unknown): SimulationEffect | undefined {
    try {
        return parseNixieSimulationEffectsV1([effect])[0];
    } catch {
        return undefined;
    }
}
const distanceSoundPlaybackSupported = Boolean(parseSupportedSimulationEffect(fixedExhaust));
const bell = { id: 'bell', point: stack, trigger: 'cue', label: 'Bell',
    sound: { resourceId: 'foxhole.audio.steam-bell', gain: .75, range: 5000 } } satisfies SimulationEffect;
const loopingBell = { ...bell, loop: true, interval: 1.25, sound: { ...bell.sound, resourceId: 'foxhole.audio.steam-bell-loop', gain: .28 } };
const loopingBellSupported = Boolean(parseSupportedSimulationEffect(loopingBell));

const blackBoltEffects: SimulationEffect[] = [
    { id: 'steam-idle', point: stack, trigger: 'idle', interval: 1.8,
        sound: { resourceId: 'foxhole.audio.steam-idle', gain: .3, range: 2400 },
        particle: steam(.31, 72, 2.7) },
    { id: 'whistle', point: stack, trigger: 'cue', label: 'Whistle',
        sound: { resourceId: 'foxhole.audio.steam-whistle', gain: .85, range: 8500 },
        particle: steam(.95, 128, 2.5) },
    { id: 'wheel-grind', point: [18, 0, 16], trigger: 'slip', interval: 12,
        sound: { resourceId: 'foxhole.audio.wheel-grind', gain: .45, range: 3800 } },
    ...cylinderSteam(-1),
    ...cylinderSteam(1),
];

export function foxholeBlackBoltEffects(settings: Readonly<Record<string, unknown>> | undefined): SimulationEffect[] {
    const exhaustEffect = settings?.['nixie.scene.motionSoundMix'] === true && cruiseExhaust ? cruiseExhaust
        : settings?.['nixie.scene.distanceSoundPlayback'] === true && distanceSoundPlaybackSupported ? fixedExhaust : exhaust;
    const bellEffect = settings?.['nixie.scene.loopedSimulationCue'] === true && loopingBellSupported ? loopingBell : bell;
    return [exhaustEffect, ...blackBoltEffects, bellEffect];
}

export function foxholeRailRollingEffect(assetId: string, settings: Readonly<Record<string, unknown>> | undefined): SimulationEffect | undefined {
    if (settings?.['nixie.scene.motionSoundMix'] !== true || !railRolling?.sound || !foxholeRailVehicleBogies[assetId]) return;
    return assetId === 'trainengine' ? { ...railRolling, sound: { ...railRolling.sound, gain: .5 } } : railRolling;
}
const roll = (name: string, radiusMetres: number) => ({
    nodeName: `rail-wheel-${name}`, axis: 'z' as const, radiansPerUnit: driveRate(radiusMetres),
});
const standardCarWheels = ['front-1', 'front-2', 'back-1', 'back-2'].map(name => roll(name, .409));
export const foxholeRailWheelRoll: Readonly<Record<string, NixieSpatialPlanV1['modelDistanceRotations']>> = {
    trainengine: ['1', '2', '3'].map(name => roll(name, mainWheelRadius)).concat(roll('back', .555)),
    trainlrartillery: ['front', 'back'].flatMap(bogie => ['01', '02', '03'].map(axle => roll(`${axle}-${bogie}`, .409))),
    traincoal: ['front', 'back'].map(name => roll(name, .409)),
    trainhospital: ['1-f', '2-f', '1-r', '2-r'].map(name => roll(name, .409)),
    traincaboose: standardCarWheels,
    traincombatcarc: standardCarWheels,
    traincombatcarw: standardCarWheels,
    trainflatbed: standardCarWheels,
    traininfantry: standardCarWheels,
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
