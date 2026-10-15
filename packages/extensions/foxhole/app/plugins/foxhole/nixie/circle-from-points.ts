export interface PlanarPoint {
    x: number;
    y: number;
}

export interface CircleFitResult {
    centerX: number;
    centerY: number;
    radius: number;
}

const MINIMUM_RADIUS = 1;
const MAX_ABSOLUTE_CIRCLE_RADIUS = 500_000;
const MAX_RADIUS_TO_SPREAD_RATIO = 32;

function getPointSpread(points: readonly PlanarPoint[]): number {
    let maxDistance = 0;
    for (let left = 0; left < points.length; left += 1) {
        for (let right = left + 1; right < points.length; right += 1) {
            maxDistance = Math.max(
                maxDistance,
                Math.hypot(points[left]!.x - points[right]!.x, points[left]!.y - points[right]!.y),
            );
        }
    }
    return maxDistance;
}

function isViableCircleRadius(radius: number, points: readonly PlanarPoint[]): boolean {
    if (!Number.isFinite(radius) || radius < MINIMUM_RADIUS || radius > MAX_ABSOLUTE_CIRCLE_RADIUS) {
        return false;
    }

    const spread = getPointSpread(points);
    if (spread <= Number.EPSILON) {
        return true;
    }

    return radius <= spread * MAX_RADIUS_TO_SPREAD_RATIO;
}

function finalizeCircleFit(
    centerX: number,
    centerY: number,
    radius: number,
    points: readonly PlanarPoint[],
): CircleFitResult | null {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !isViableCircleRadius(radius, points)) {
        return null;
    }

    return { centerX, centerY, radius };
}

function readPlanarPoints(points: readonly number[]): PlanarPoint[] {
    const result: PlanarPoint[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
        const x = points[index]!;
        const y = points[index + 1]!;
        if (Number.isFinite(x) && Number.isFinite(y)) {
            result.push({ x, y });
        }
    }
    return result;
}

export function circumcircleFromThreePoints(
    first: PlanarPoint,
    second: PlanarPoint,
    third: PlanarPoint,
): CircleFitResult | null {
    const determinant = 2 * (
        (first.x * (second.y - third.y))
        + (second.x * (third.y - first.y))
        + (third.x * (first.y - second.y))
    );
    if (Math.abs(determinant) < Number.EPSILON) {
        return null;
    }

    const firstSquared = (first.x * first.x) + (first.y * first.y);
    const secondSquared = (second.x * second.x) + (second.y * second.y);
    const thirdSquared = (third.x * third.x) + (third.y * third.y);
    const centerX = (
        (firstSquared * (second.y - third.y))
        + (secondSquared * (third.y - first.y))
        + (thirdSquared * (first.y - second.y))
    ) / determinant;
    const centerY = (
        (firstSquared * (third.x - second.x))
        + (secondSquared * (first.x - third.x))
        + (thirdSquared * (second.x - first.x))
    ) / determinant;
    const radius = Math.hypot(first.x - centerX, first.y - centerY);

    return finalizeCircleFit(centerX, centerY, radius, [first, second, third]);
}

export function fitCircleFromPoints(points: readonly PlanarPoint[]): CircleFitResult | null {
    if (points.length < 3) {
        return null;
    }

    if (points.length === 3) {
        return circumcircleFromThreePoints(points[0]!, points[1]!, points[2]!);
    }

    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let sumX3 = 0;
    let sumY3 = 0;
    let sumX1Y2 = 0;
    let sumX2Y1 = 0;

    for (const point of points) {
        const x2 = point.x * point.x;
        const y2 = point.y * point.y;
        sumX += point.x;
        sumY += point.y;
        sumX2 += x2;
        sumY2 += y2;
        sumXY += point.x * point.y;
        sumX3 += x2 * point.x;
        sumY3 += y2 * point.y;
        sumX1Y2 += point.x * y2;
        sumX2Y1 += x2 * point.y;
    }

    const count = points.length;
    const matrixA = (count * sumX2) - (sumX * sumX);
    const matrixB = (count * sumXY) - (sumX * sumY);
    const matrixC = (count * sumY2) - (sumY * sumY);
    const vectorD = 0.5 * ((count * sumX3) + (count * sumX1Y2) - (sumX * (sumX2 + sumY2)));
    const vectorE = 0.5 * ((count * sumY3) + (count * sumX2Y1) - (sumY * (sumX2 + sumY2)));
    const denominator = (matrixA * matrixC) - (matrixB * matrixB);
    if (Math.abs(denominator) < Number.EPSILON) {
        return null;
    }

    const centerX = ((vectorD * matrixC) - (vectorE * matrixB)) / denominator;
    const centerY = ((matrixA * vectorE) - (matrixB * vectorD)) / denominator;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
        return null;
    }

    let radiusTotal = 0;
    for (const point of points) {
        radiusTotal += Math.hypot(point.x - centerX, point.y - centerY);
    }
    const radius = radiusTotal / count;
    return finalizeCircleFit(centerX, centerY, radius, points);
}

export function fitCircleFromFlatPoints(points: readonly number[]): CircleFitResult | null {
    return fitCircleFromPoints(readPlanarPoints(points));
}

export function countPlanarPoints(points: readonly number[]): number {
    return readPlanarPoints(points).length;
}
