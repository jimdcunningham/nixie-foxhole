/** Worst-case nighttime planning from https://foxhole.wiki.gg/wiki/Garrison.
 * Midnight vision is limited to 15 m from the structure center, with a 33%
 * powered spotlight bonus. This estimates detection, not retaliation or weather.
 */
export const FOXHOLE_NIGHTTIME_RANGES_SETTING_ID = 'foxhole.ranges.nighttime';
export const FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID = 'foxhole.ranges.poweredSpotlights';
export const FOXHOLE_NIGHT_RANGE_SETTING_IDS = [
    FOXHOLE_NIGHTTIME_RANGES_SETTING_ID,
    FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID,
];

interface NightRange {
    type: string;
    x?: number | null;
    y?: number | null;
    max?: number | null;
    min?: number | null;
    arc?: number | null;
    rotation?: number | null;
}
interface NightRangeStructure {
    codeName: string;
    isVehicle?: boolean;
}

export function hasFoxholeBunkerSpotlight(codeName: string | null | undefined): boolean {
    return /^(?:Rifle|MG|ATGun)AIT[23]$/i.test(String(codeName ?? '').trim());
}

export function resolveFoxholeNightVisionRadius(structure: NightRangeStructure, range: NightRange, getValue: (id: string) => unknown): number | null {
    // The published manifest does not yet carry AITurretComponent's night flag.
    // Use known AI families, not killbox alone: that also includes manned guns,
    // binoculars, radar and intelligence equipment. Artillery, AA and naval AI
    // are deliberately excluded, as are vehicles.
    if (structure.isVehicle || !['killbox', 'killboxMG', 'killboxAT'].includes(range.type)
        || !/^(?:(?:Rifle|MG|ATGun)AIT[123]|(?:Rifle|MG|AT|ISG)Pillbox)$/i.test(structure.codeName)) {
        return null;
    }
    if (getValue(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID) !== true) {
        return null;
    }
    const powered = getValue(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID) === true
        && hasFoxholeBunkerSpotlight(structure.codeName);
    return 15 * (powered ? 1.33 : 1);
}

/** Intersect a firing sector with a circle at the structure origin, in meters.
 * The range's own origin and half-arc stay intact. The inscribed 96-sided
 * circle keeps the approximation slightly inside the estimated vision limit.
 */
export function createFoxholeNightRangePolygon(range: NightRange, visionRadius: number | null): number[] | null {
    const max = Number(range.max);
    if (visionRadius === null || !Number.isFinite(visionRadius) || !Number.isFinite(max) || max <= 0) {
        return null;
    }
    const x = Number(range.x ?? 0), y = Number(range.y ?? 0);
    if (Math.hypot(x, y) + max <= visionRadius) {
        return null;
    }
    // The supported AI families have no minimum range; don't flatten a future
    // annular range into a filled circle if the asset contract changes.
    if (Number(range.min ?? 0) > 0) {
        return null;
    }
    const halfArc = Math.min(Math.PI, Math.max(0, Number(range.arc ?? 180)) * Math.PI / 180);
    const fullCircle = halfArc >= Math.PI - 0.0001 || halfArc === 0;
    const rotation = Number(range.rotation ?? 0) * Math.PI / 180;
    const start = fullCircle ? 0 : rotation - halfArc;
    const sweep = fullCircle ? Math.PI * 2 : halfArc * 2;
    const segments = Math.max(2, Math.ceil(96 * sweep / (Math.PI * 2)));
    const centered = x === 0 && y === 0;
    const radius = centered ? Math.min(max, visionRadius) : max;
    let points: Array<[number, number]> = fullCircle ? [] : [[x, y]];
    for (let index = 0; index <= segments; index++) {
        const angle = start + sweep * index / segments;
        points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
    if (!centered) {
        // Sutherland-Hodgman clipping against the convex visibility circle.
        for (let edge = 0; edge < 96 && points.length; edge++) {
            const angle = edge * Math.PI * 2 / 96, next = (edge + 1) * Math.PI * 2 / 96;
            const ax = Math.cos(angle) * visionRadius, ay = Math.sin(angle) * visionRadius;
            const dx = Math.cos(next) * visionRadius - ax, dy = Math.sin(next) * visionRadius - ay;
            const side = ([px, py]: [number, number]) => dx * (py - ay) - dy * (px - ax);
            const output: Array<[number, number]> = [];
            let previous = points[points.length - 1]!;
            let previousSide = side(previous);
            for (const point of points) {
                const currentSide = side(point);
                if ((currentSide >= 0) !== (previousSide >= 0)) {
                    const fraction = previousSide / (previousSide - currentSide);
                    output.push([previous[0] + (point[0] - previous[0]) * fraction, previous[1] + (point[1] - previous[1]) * fraction]);
                }
                if (currentSide >= 0) output.push(point);
                previous = point;
                previousSide = currentSide;
            }
            points = output;
        }
    }
    return points.length >= 3 ? points.flat() : [];
}
