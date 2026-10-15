import type { NixieSceneWind } from '#nixie/utils/nixie-scene-settings.ts';

export interface PowerlinePoint {
    x: number;
    y: number;
}

const PARTICLE_COUNT = 9;
const PATH_SUBDIVISIONS = 2;
const SPRING_STRENGTH = 120;
const DAMPING_PER_SECOND = 2.8;
const SIMULATION_STEP_MS = 1000 / 60;

export interface PowerlineMotion {
    particles: PowerlinePoint[];
    velocities: PowerlinePoint[];
    elapsedSeconds: number;
    accumulatedMs: number;
}

export function createPowerlineMotion(): PowerlineMotion {
    return { particles: [], velocities: [], elapsedSeconds: 0, accumulatedMs: 0 };
}

export function resetPowerlineMotion(motion: PowerlineMotion): void {
    motion.particles = [];
    motion.velocities = [];
    motion.accumulatedMs = 0;
}

/** Preserve the rope's world positions when its node origin is moved to the start socket. */
export function rebasePowerlineMotion(motion: PowerlineMotion, oldOriginInNewLocal: PowerlinePoint): void {
    for (const particle of motion.particles) {
        particle.x += oldOriginInNewLocal.x;
        particle.y += oldOriginInNewLocal.y;
    }
}

function interpolate(a: number, b: number, c: number, d: number, t: number): number {
    const squared = t * t;
    return 0.5 * (
        2 * b + (c - a) * t
        + (2 * a - 5 * b + 4 * c - d) * squared
        + (3 * b - a - 3 * c + d) * squared * t
    );
}

export function powerlinePathPoints(
    start: PowerlinePoint,
    end: PowerlinePoint,
    motion: PowerlineMotion,
): PowerlinePoint[] {
    if (motion.particles.length !== PARTICLE_COUNT) {
        return [start, end];
    }

    const particles = [{ ...start }, ...motion.particles.slice(1, -1), { ...end }];
    const points: PowerlinePoint[] = [];
    for (let segment = 0; segment < PARTICLE_COUNT - 1; segment += 1) {
        const before = particles[Math.max(0, segment - 1)]!;
        const from = particles[segment]!;
        const to = particles[segment + 1]!;
        const after = particles[Math.min(PARTICLE_COUNT - 1, segment + 2)]!;
        for (let subdivision = 0; subdivision < PATH_SUBDIVISIONS; subdivision += 1) {
            const t = subdivision / PATH_SUBDIVISIONS;
            points.push({
                x: interpolate(before.x, from.x, to.x, after.x, t),
                y: interpolate(before.y, from.y, to.y, after.y, t),
            });
        }
    }
    points.push(end);
    return points;
}

function limitSegmentStretch(particles: PowerlinePoint[], spanLength: number): void {
    const segmentLength = spanLength / (PARTICLE_COUNT - 1) * 1.035;
    for (let iteration = 0; iteration < 2; iteration += 1) {
        const corrected = particles.map(point => ({ ...point }));
        for (let index = 0; index < PARTICLE_COUNT - 1; index += 1) {
            const from = particles[index]!;
            const to = particles[index + 1]!;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= segmentLength || distance < 0.001) {
                continue;
            }
            const correction = (distance - segmentLength) / distance;
            const fromWeight = index === 0 ? 0 : index === PARTICLE_COUNT - 2 ? 1 : 0.5;
            const toWeight = 1 - fromWeight;
            corrected[index]!.x += dx * correction * fromWeight;
            corrected[index]!.y += dy * correction * fromWeight;
            corrected[index + 1]!.x -= dx * correction * toWeight;
            corrected[index + 1]!.y -= dy * correction * toWeight;
        }
        for (let index = 1; index < PARTICLE_COUNT - 1; index += 1) {
            particles[index] = corrected[index]!;
        }
    }
}

export function advancePowerlineMotion(
    motion: PowerlineMotion,
    start: PowerlinePoint,
    end: PowerlinePoint,
    wind: NixieSceneWind,
    deltaMs: number,
    viewportScale: number,
    phase: number,
): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) {
        resetPowerlineMotion(motion);
        return;
    }
    if (motion.particles.length !== PARTICLE_COUNT) {
        motion.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
            x: start.x + dx * index / (PARTICLE_COUNT - 1),
            y: start.y + dy * index / (PARTICLE_COUNT - 1),
        }));
        motion.velocities = Array.from({ length: PARTICLE_COUNT }, () => ({ x: 0, y: 0 }));
    }

    const deltaSeconds = Math.min(0.05, Math.max(0, deltaMs / 1000));
    motion.elapsedSeconds += deltaSeconds;
    const normalX = -dy / length;
    const normalY = dx / length;
    const maxBend = Math.min(length * 0.06, 11 / Math.max(0.05, viewportScale), 36);
    const directionRadians = wind.directionDeg * Math.PI / 180;
    const crosswind = Math.cos(directionRadians) * normalX + Math.sin(directionRadians) * normalY;
    const windAcceleration = SPRING_STRENGTH * maxBend * wind.strength * crosswind / 8;
    const damping = Math.exp(-DAMPING_PER_SECOND * deltaSeconds);
    const previous = motion.particles.map(point => ({ ...point }));
    previous[0] = start;
    previous[PARTICLE_COUNT - 1] = end;
    motion.particles[0] = { ...start };
    motion.particles[PARTICLE_COUNT - 1] = { ...end };

    for (let index = 1; index < PARTICLE_COUNT - 1; index += 1) {
        const point = previous[index]!;
        const left = previous[index - 1]!;
        const right = previous[index + 1]!;
        const position = index / (PARTICLE_COUNT - 1);
        const gust = 0.65
            + 0.22 * Math.sin(motion.elapsedSeconds * 1.4 + phase - position * 2.2)
            + 0.13 * Math.sin(motion.elapsedSeconds * 2.3 + phase * 0.7 + position * 3.8);
        const velocity = motion.velocities[index]!;
        velocity.x = (velocity.x + ((left.x + right.x - 2 * point.x) * SPRING_STRENGTH
            + normalX * windAcceleration * gust) * deltaSeconds) * damping;
        velocity.y = (velocity.y + ((left.y + right.y - 2 * point.y) * SPRING_STRENGTH
            + normalY * windAcceleration * gust) * deltaSeconds) * damping;
        motion.particles[index] = {
            x: point.x + velocity.x * deltaSeconds,
            y: point.y + velocity.y * deltaSeconds,
        };
    }
    limitSegmentStretch(motion.particles, length);
}

export function advancePowerlineMotionFrame(
    motion: PowerlineMotion,
    start: PowerlinePoint,
    end: PowerlinePoint,
    wind: NixieSceneWind,
    frameMs: number,
    viewportScale: number,
    phase: number,
): boolean {
    // Keep the solver at 60 Hz regardless of the display refresh rate, with a short catch-up cap.
    motion.accumulatedMs = Math.min(
        motion.accumulatedMs + Math.max(0, frameMs),
        SIMULATION_STEP_MS * 3,
    );
    let advanced = false;
    while (motion.accumulatedMs + 0.001 >= SIMULATION_STEP_MS) {
        advancePowerlineMotion(motion, start, end, wind, SIMULATION_STEP_MS, viewportScale, phase);
        motion.accumulatedMs = Math.max(0, motion.accumulatedMs - SIMULATION_STEP_MS);
        advanced = true;
    }
    return advanced;
}
