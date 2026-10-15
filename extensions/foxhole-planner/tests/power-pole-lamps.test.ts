import assert from 'node:assert/strict';
import test from 'node:test';
import { FOXHOLE_POWER_POLE_LAMP, POWER_POLE_LAMP_STOPS, powerPoleLampFootprint, showFoxholePowerPoleLamp } from '../src/power-pole-lamps.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from '../src/render-lanes.ts';

test('lamp uses the authored warm color and downward cone footprint', () => {
    assert.equal(FOXHOLE_POWER_POLE_LAMP.color, 0xffe1b5);
    assert.ok(Math.abs(FOXHOLE_POWER_POLE_LAMP.radius / 32 - 3.77) < 0.01);
    assert.equal(POWER_POLE_LAMP_STOPS.at(-1)?.alpha, 0);
    assert.ok(powerPoleLampFootprint().slice(1).every(point => Math.abs(Math.atan2(point.y, point.x)) >= 12 * Math.PI / 180 - 1e-8));
    assert.equal(showFoxholePowerPoleLamp('PowerPole', ['light'], () => true), true);
    assert.equal(showFoxholePowerPoleLamp('PowerPole', [], () => true), false);
    assert.equal(showFoxholePowerPoleLamp('PowerPole', ['light'], () => false), false);
    assert.equal(showFoxholePowerPoleLamp('PowerPole', ['light'], () => true, { blueprint: true }), false);
});

test('an upgraded power pole lights the ground lane only during nighttime powered-light planning', () => {
    for (const night of [false, true]) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: 'pole', revision: 1,
            components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
                data: { catalogId: 'foxhole.structures', assetId: 'powerpole' } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true,
                data: { selections: [{ slotId: 'UpgradeModificationSlot', variantId: 'light' }] } }],
        }, { contractVersion: 1, entities: [], settings: { 'foxhole.ranges.nighttime': night, 'foxhole.ranges.poweredSpotlights': true } }));
        const glow = plan.root.children.find(node => node.id === 'power-pole-lamp-glow');
        if (night) {
            assert.equal(glow?.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail.laneId);
            assert.equal(glow?.experimentalPresentation?.excludeFromBounds, true);
        } else {
            assert.equal(glow, undefined);
        }
    }
});
