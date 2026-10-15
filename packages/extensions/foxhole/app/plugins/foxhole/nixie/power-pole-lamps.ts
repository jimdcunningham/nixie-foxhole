import { FillGradient, Graphics } from 'pixi.js';
import { FOXHOLE_POWER_POLE_LAMP, POWER_POLE_LAMP_STOPS, powerPoleLampFootprint } from '../../../../../../../extensions/foxhole-planner/src/power-pole-lamps.ts';

export * from '../../../../../../../extensions/foxhole-planner/src/power-pole-lamps.ts';

export function createFoxholePowerPoleLampGlow() {
    const glow = new Graphics();
    glow.label = 'power-pole-lamp-glow';
    glow.eventMode = 'none';
    glow.poly(powerPoleLampFootprint().flatMap(point => [point.x, point.y]), true);
    glow.fill(new FillGradient({ type: 'radial', center: { x: 0, y: 0 }, outerRadius: FOXHOLE_POWER_POLE_LAMP.radius,
        colorStops: POWER_POLE_LAMP_STOPS.map(stop => ({ offset: stop.offset, color: [1, 225 / 255, 181 / 255, stop.alpha] })),
        textureSpace: 'global' }));
    glow.position.set(FOXHOLE_POWER_POLE_LAMP.x, FOXHOLE_POWER_POLE_LAMP.y);
    return glow;
}
