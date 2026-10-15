export function isWaterWallSpline(foxholeKey?: string): boolean {
    return String(foxholeKey ?? '').trim().toLowerCase() === 'waterwallsplinet1';
}

interface WaterWallBuoy {
    x: number;
    y: number;
    rotation: number;
    meshIndex: number;
    role: 'back' | 'interior' | 'front';
}

/** BackPIllar/FrontPillar follow the endpoints; the authored interval config adds at most three interior buoys. */
export function resolveWaterWallBuoys(
    start: { x: number; y: number; },
    end: { x: number; y: number; },
    config?: { interval?: number; },
): WaterWallBuoy[] {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(length) || length <= 0) {
        return [];
    }
    const interval = Number(config?.interval) > 0 ? Number(config?.interval) * 0.32 : 160;
    const rotation = Math.atan2(end.y - start.y, end.x - start.x);
    const buoys: WaterWallBuoy[] = [{ ...start, rotation, meshIndex: 0, role: 'back' }];
    for (let index = 1; index <= 3; index++) {
        const distance = index * interval;
        // The physical front pillar owns the endpoint, including exact intervals.
        if (distance >= length - 0.001) {
            break;
        }
        buoys.push({ x: start.x + (end.x - start.x) * distance / length,
            y: start.y + (end.y - start.y) * distance / length, rotation, meshIndex: 0, role: 'interior' });
    }
    buoys.push({ ...end, rotation, meshIndex: 0, role: 'front' });
    return buoys;
}

/** The authored net config fills the remainder up to the physical front pillar. */
export function resolveWaterWallNetInsets(
    start: { x: number; y: number; },
    end: { x: number; y: number; },
    config?: { interval?: number; },
): { startInset: number; endInset: number; } {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const buoys = resolveWaterWallBuoys(start, end, config);
    const last = buoys.at(-1);
    const connectedLength = buoys.length >= 2 && last ? Math.hypot(last.x - start.x, last.y - start.y) : 0;
    return { startInset: 0, endInset: Math.max(0, length - connectedLength) };
}
