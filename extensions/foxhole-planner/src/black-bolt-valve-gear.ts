import type { NixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';

type Point = [number, number];
type Offset = [number, number, number];

// Pivots from the posed armature and pin centers measured on the exported mesh.
// These are model X and Y (up), in metres. The two sides share this rest geometry.
const axle: Point = [-.793279, -1.905033];
const crank: Point = [-1.166632, -1.905033];
const eccentric: Point = [-.919764, -1.905033];
const expansionPivot: Point = [-.032923, -1.586844];
const expansionPin: Point = [.037, -1.905033];
const radiusShoe: Point = [.203, -1.8];
const radiusPivot: Point = [.022470, -1.402804];
const crosshead: Point = [2.405669, -1.905033];
const unionPin: Point = [2.592527, -1.905033];
const valveStem: Point = [2.596639, -1.288515];
const leverPivot: Point = [2.592525, -1.288516];
const hangerPivot: Point = [1.113051, -1.046259];
const hangerEye: Point = [1.113051, -1.542];
const upperHangerPivot: Point = [1.832500, -1.046257];
const lowerHangerPivot: Point = [.933393, -1.402804];

const span = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const heading = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);

function rotate(point: Point, center: Point, angle: number): Point {
    const x = point[0] - center[0], y = point[1] - center[1];
    return [center[0] + x * Math.cos(angle) - y * Math.sin(angle), center[1] + x * Math.sin(angle) + y * Math.cos(angle)];
}

function closure(a: Point, b: Point, radiusA: number, radiusB: number, side: 1 | -1): Point {
    const distance = span(a, b);
    const along = (radiusA ** 2 - radiusB ** 2 + distance ** 2) / (2 * distance);
    const lateral = side * Math.sqrt(radiusA ** 2 - along ** 2);
    const x = (b[0] - a[0]) / distance, y = (b[1] - a[1]) / distance;
    return [a[0] + along * x - lateral * y, a[1] + along * y + lateral * x];
}

function slide(pin: Point, axisHeight: number, length: number): Point {
    return [pin[0] + Math.sqrt(length ** 2 - (pin[1] - axisHeight) ** 2), axisHeight];
}

function pose(pivot: Point, restAnchor: Point, anchor: Point, angle: number): Offset {
    const [x, y] = rotate(pivot, restAnchor, angle);
    return [x + anchor[0] - restAnchor[0] - pivot[0], y + anchor[1] - restAnchor[1] - pivot[1],
        Math.atan2(Math.sin(angle), Math.cos(angle))];
}

function sampleValveGear(angle: number) {
    const drivenCrank = rotate(crank, axle, angle);
    const drivenEccentric = rotate(eccentric, axle, angle);
    const drivenExpansionPin = closure(expansionPivot, drivenEccentric, span(expansionPivot, expansionPin),
        span(eccentric, expansionPin), 1);
    const expansionAngle = heading(expansionPivot, drivenExpansionPin) - heading(expansionPivot, expansionPin);
    const drivenShoe = rotate(radiusShoe, expansionPivot, expansionAngle);
    const drivenValve = slide(drivenShoe, valveStem[1], span(radiusShoe, valveStem));
    const radiusAngle = heading(drivenShoe, drivenValve) - heading(radiusShoe, valveStem);
    const drivenCrosshead = slide(drivenCrank, crosshead[1], span(crank, crosshead));
    const drivenUnionPin = closure(drivenCrosshead, drivenValve, span(crosshead, unionPin), span(valveStem, unionPin), -1);
    const combinationAngle = heading(drivenValve, drivenUnionPin) - heading(valveStem, unionPin);
    const [hangerX, hangerY] = rotate(hangerEye, radiusShoe, radiusAngle);
    const drivenEye: Point = [hangerX + drivenShoe[0] - radiusShoe[0], hangerY + drivenShoe[1] - radiusShoe[1]];
    const hangerAngle = heading(hangerPivot, drivenEye) - heading(hangerPivot, hangerEye);
    return {
        'return-crank': pose(crank, crank, drivenCrank, angle),
        eccentric: pose(eccentric, eccentric, drivenEccentric, heading(drivenEccentric, drivenExpansionPin) - heading(eccentric, expansionPin)),
        expansion: pose(expansionPivot, expansionPivot, expansionPivot, expansionAngle),
        radius: pose(radiusPivot, radiusShoe, drivenShoe, radiusAngle),
        union: pose(crosshead, crosshead, drivenCrosshead, heading(drivenCrosshead, drivenUnionPin) - heading(crosshead, unionPin)),
        combination: pose(leverPivot, valveStem, drivenValve, combinationAngle),
        'combination-head': pose(unionPin, valveStem, drivenValve, combinationAngle),
        'valve-stem': pose(valveStem, valveStem, drivenValve, 0),
        'hanger-upper': pose(upperHangerPivot, hangerPivot, hangerPivot, hangerAngle),
        'hanger-lower': pose(lowerHangerPivot, hangerEye, drivenEye, hangerAngle),
    };
}

export function blackBoltValveGear(radiansPerUnit: number): NonNullable<NixieSpatialPlanV1['modelDistancePoseCycles']> {
    const sampleCount = 48;
    const poses = Array.from({ length: sampleCount }, (_, i) =>
        sampleValveGear(Math.sign(radiansPerUnit) * 2 * Math.PI * i / sampleCount));
    const names = Object.keys(poses[0]!) as Array<keyof ReturnType<typeof sampleValveGear>>;
    const tracks = names.flatMap(name => {
        const samples: Offset[] = poses.map((frame, i) => i === 0 ? [0, 0, 0]
            : frame[name].map(value => Number(value.toFixed(6))) as Offset);
        return ['l', 'r'].map(side => ({ nodeName: `rail-link-${name}-${side}`, samples }));
    });
    return [{ distancePerCycle: 2 * Math.PI / Math.abs(radiansPerUnit), tracks }];
}
