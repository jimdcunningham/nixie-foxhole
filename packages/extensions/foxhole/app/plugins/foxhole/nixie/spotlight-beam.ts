import { Container, FillGradient, Graphics } from 'pixi.js';
import { createFoxholeSpotlightBeamGraphics } from '../../../../../../../extensions/foxhole-planner/src/spotlight-beam.ts';
import type { FoxholeSpotlightBeam } from '../../../../../../../extensions/foxhole-planner/src/spotlight-beam.ts';
export type { FoxholeSpotlightBeam } from '../../../../../../../extensions/foxhole-planner/src/spotlight-beam.ts';

function beamColor(color: number, alpha = 1): [number, number, number, number] {
    return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, Math.max(0, Math.min(1, alpha))];
}

export function createFoxholeSpotlightBeam(spotlight: FoxholeSpotlightBeam): Container {
    const container = new Container();
    container.eventMode = 'none';
    for (const node of createFoxholeSpotlightBeamGraphics(spotlight)) {
        const graphics = new Graphics();
        graphics.label = node.id;
        graphics.eventMode = 'none';
        graphics.scale.y = node.scaleY ?? 1;
        for (const command of node.commands) {
            switch (command.op) {
                case 'circle': graphics.circle(command.x, command.y, command.radius); break;
                case 'polygon': graphics.poly(command.points.flatMap(point => [point.x, point.y]), command.close); break;
                case 'fill': graphics.fill({ color: command.color, alpha: command.alpha }); break;
                case 'fill-radial-gradient': graphics.fill(new FillGradient({ type: 'radial',
                    center: command.center, outerCenter: command.outerCenter ?? command.center,
                    innerRadius: command.innerRadius ?? 0, outerRadius: command.outerRadius,
                    colorStops: command.colorStops.map(stop => ({ offset: stop.offset, color: beamColor(stop.color, stop.alpha) })),
                    textureSpace: 'global',
                })); break;
            }
        }
        container.addChild(graphics);
    }
    return container;
}
