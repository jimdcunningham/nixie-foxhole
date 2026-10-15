export interface FoxholeLineOfSightPoint {
    x: number;
    y: number;
}

export interface BuildFoxholeLineOfSightMaskInput {
    origin: FoxholeLineOfSightPoint;
    maxDistance: number;
    occluders: readonly (readonly FoxholeLineOfSightPoint[])[];
    /** Lower-detail circle sampling for transient editor previews. */
    baseRayCount?: number;
}

/**
 * Keep this deliberately small while the range mask is being validated against
 * the rendered structure bounds. More structures can opt in as their hitboxes
 * are audited.
 */
export const FOXHOLE_LINE_OF_SIGHT_STRUCTURE_KEYS = new Set([
    'isgpillbox',
    'atpillbox',
    'mgpillbox',
    'riflepillbox',
]);

const RAY_EPSILON = 0.0001;
const INTERSECTION_EPSILON = 0.000001;
const BASE_RAY_COUNT = 72;

function normalizeAngle(angle: number): number {
    const fullTurn = Math.PI * 2;
    return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function cross(left: FoxholeLineOfSightPoint, right: FoxholeLineOfSightPoint): number {
    return (left.x * right.y) - (left.y * right.x);
}

function subtract(left: FoxholeLineOfSightPoint, right: FoxholeLineOfSightPoint): FoxholeLineOfSightPoint {
    return { x: left.x - right.x, y: left.y - right.y };
}

function findRayIntersectionDistance(
    origin: FoxholeLineOfSightPoint,
    direction: FoxholeLineOfSightPoint,
    maxDistance: number,
    start: FoxholeLineOfSightPoint,
    end: FoxholeLineOfSightPoint,
): number | null {
    const edge = subtract(end, start);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) <= INTERSECTION_EPSILON) {
        return null;
    }

    const fromOrigin = subtract(start, origin);
    const rayDistance = cross(fromOrigin, edge) / denominator;
    const edgePosition = cross(fromOrigin, direction) / denominator;
    if (
        rayDistance <= INTERSECTION_EPSILON
        || rayDistance > maxDistance
        || edgePosition < -INTERSECTION_EPSILON
        || edgePosition > 1 + INTERSECTION_EPSILON
    ) {
        return null;
    }

    return rayDistance;
}

/** Build a visibility polygon by casting toward a coarse circle plus every blocker corner. */
export function buildFoxholeLineOfSightMaskPoints(input: BuildFoxholeLineOfSightMaskInput): FoxholeLineOfSightPoint[] {
    const maxDistance = Number(input.maxDistance);
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
        return [];
    }

    const angles = new Set<number>();
    const baseRayCount = Math.max(12, Math.floor(Number(input.baseRayCount) || BASE_RAY_COUNT));
    for (let index = 0; index < baseRayCount; index += 1) {
        angles.add((index / baseRayCount) * Math.PI * 2);
    }

    for (const polygon of input.occluders) {
        for (const point of polygon) {
            const angle = Math.atan2(point.y - input.origin.y, point.x - input.origin.x);
            angles.add(normalizeAngle(angle - RAY_EPSILON));
            angles.add(normalizeAngle(angle));
            angles.add(normalizeAngle(angle + RAY_EPSILON));
        }
    }

    return [...angles]
        .sort((left, right) => left - right)
        .map(angle => {
            const direction = { x: Math.cos(angle), y: Math.sin(angle) };
            let nearestDistance = maxDistance;

            for (const polygon of input.occluders) {
                for (let index = 0; index < polygon.length; index += 1) {
                    const intersection = findRayIntersectionDistance(
                        input.origin,
                        direction,
                        maxDistance,
                        polygon[index]!,
                        polygon[(index + 1) % polygon.length]!,
                    );
                    if (intersection !== null) {
                        nearestDistance = Math.min(nearestDistance, intersection);
                    }
                }
            }

            return {
                x: input.origin.x + (direction.x * nearestDistance),
                y: input.origin.y + (direction.y * nearestDistance),
            };
        });
}

export function isFoxholeLineOfSightStructureKey(value: unknown): boolean {
    return FOXHOLE_LINE_OF_SIGHT_STRUCTURE_KEYS.has(String(value ?? '').trim().toLowerCase());
}
