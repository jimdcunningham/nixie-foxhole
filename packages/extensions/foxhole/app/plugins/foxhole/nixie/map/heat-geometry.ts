import type { FillInput, Graphics } from 'pixi.js';

// Bound tessellation independently of world units. At map zoom the native
// world-radius circles otherwise spend thousands of vertices on one soft ring.
const HEAT_CIRCLE_RADIUS = 512;

export function drawFoxholeMapHeatCircle(graphics: Graphics, x: number, y: number, radius: number, fill: FillInput): void {
    const scale = radius / HEAT_CIRCLE_RADIUS;
    graphics.save().transform(scale, 0, 0, scale, x, y)
        .circle(0, 0, HEAT_CIRCLE_RADIUS).fill(fill).restore();
}
