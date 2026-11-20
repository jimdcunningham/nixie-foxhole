import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';

type Offset = [x: number, y: number, angle: number];
type Point = readonly [x: number, y: number];

// Visible pin centers in glTF X/Y metres. The rear main rod eye sits off
// center in the return crank head, beyond the crank's own armature pivot.
const axle: Point = [-.30345, -.90802];
const mainPin: Point = [-.25769, -.90893];
const slider: Point = [.52465, -.72838];
const lowerPin: Point = [.39574, -.74884];
const upperPin: Point = [.39574, -.49240];
const bellPivot: Point = [.21443, -.49239];
const valvePin: Point = [.21465, -.32415];
const couplingRadius = .25905;
const rodLength = Math.hypot(slider[0] - mainPin[0], slider[1] - mainPin[1]);
const heading = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const restRodAngle = heading(mainPin, slider);
const restLinkAngle = heading(upperPin, lowerPin);

function rotate(point: Point, pivot: Point, angle: number): Point {
    const x = point[0] - pivot[0], y = point[1] - pivot[1];
    return [pivot[0] + x * Math.cos(angle) - y * Math.sin(angle),
        pivot[1] + x * Math.sin(angle) + y * Math.cos(angle)];
}

function offset(rest: Point, posed: Point, angle: number): Offset {
    return [posed[0] - rest[0], posed[1] - rest[1], angle];
}

function smallGaugeGearPose(angle: number) {
    const rear = rotate(mainPin, axle, angle);
    const rise = slider[1] - rear[1];
    const front: Point = [rear[0] + Math.sqrt(rodLength ** 2 - rise ** 2), slider[1]];
    const piston = front[0] - slider[0];
    const rodAngle = heading(rear, front) - restRodAngle;
    const bottom = rotate(lowerPin, slider, rodAngle);
    const liftedBottom: Point = [bottom[0] + piston, bottom[1]];
    // Keep the telescoping links on a shared axis between the rocker and rod.
    // The bell crank drives the upper valve stem along its horizontal guide.
    const bellAngle = piston * 1.7;
    const liftedTop = rotate(upperPin, bellPivot, bellAngle);
    const liftAngle = heading(liftedTop, liftedBottom) - restLinkAngle;
    const valve = rotate(valvePin, bellPivot, bellAngle);
    return {
        coupling: [couplingRadius * Math.sin(angle), couplingRadius * (1 - Math.cos(angle)), 0],
        rod: [piston, 0, rodAngle],
        piston: [piston, 0, 0],
        'valve-stem': [valve[0] - valvePin[0], 0, 0],
        'lifting-link': offset(lowerPin, liftedBottom, liftAngle),
        'upper-link': offset(upperPin, liftedTop, liftAngle),
        'bell-crank': [0, 0, bellAngle],
    } satisfies Record<string, Offset>;
}

export function smallGaugeValveGear(radiansPerUnit: number): NonNullable<NixieSpatialPlanV1['modelDistancePoseCycles']> {
    const count = 48;
    const frames = Array.from({ length: count }, (_, index) =>
        smallGaugeGearPose(Math.sign(radiansPerUnit) * 2 * Math.PI * index / count));
    const names = Object.keys(frames[0]!) as Array<keyof ReturnType<typeof smallGaugeGearPose>>;
    const tracks = names.flatMap(name => {
        const samples = frames.map((frame, index): Offset => index === 0 ? [0, 0, 0]
            : frame[name].map(value => Number(value.toFixed(6))) as Offset);
        return ['l', 'r'].map(side => ({ nodeName: `rail-link-small-${name}-${side}`, samples }));
    });
    return [{ distancePerCycle: 2 * Math.PI / Math.abs(radiansPerUnit), tracks }];
}
