import { FOXHOLE_BUNKER_SPOTLIGHT_BEAM } from '../../../../../../../extensions/foxhole-planner/src/bunker-spotlights.ts';
import { createFoxholeSpotlightBeam } from './spotlight-beam.ts';
import type { FoxholeSpotlightBeam } from './spotlight-beam.ts';
export * from '../../../../../../../extensions/foxhole-planner/src/bunker-spotlights.ts';

export function createFoxholeBunkerSpotlightGlow(beam: FoxholeSpotlightBeam = FOXHOLE_BUNKER_SPOTLIGHT_BEAM) {
    const container = createFoxholeSpotlightBeam(beam);
    container.label = 'bunker-spotlight-glow';
    return container;
}
