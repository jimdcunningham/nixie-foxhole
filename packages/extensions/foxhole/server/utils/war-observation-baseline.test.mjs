import assert from 'node:assert/strict';
import test from 'node:test';
import { currentWarObservationTimeline, isInitialFoxholeOwnershipEvent } from '../../app/composables/foxholeWarObservationBaseline.ts';

const start = Date.parse('2026-10-01T17:00:00Z');
const frame = (offset, controlledTowns, warId = 'war-141') => ({ warId, capturedAt: new Date(start + offset).toISOString(), summary: { controlledTowns } });

test('Pulse uses only current conquest observations with complete ownership coverage', () => {
    const baseline = frame(300000, { COLONIALS: 100, WARDENS: 100, NONE: 10 });
    const captured = frame(360000, { COLONIALS: 101, WARDENS: 100, NONE: 9 });
    const items = [frame(-60000, { COLONIALS: 100, WARDENS: 100, NONE: 10 }),
        frame(60000, { COLONIALS: 30, WARDENS: 40 }), frame(120000, {}),
        frame(180000, { COLONIALS: 500 }, 'previous-war'), baseline, captured];
    assert.deepEqual(currentWarObservationTimeline(items, { warId: 'war-141', warStart: start }), [baseline, captured]);
});

test('No known ownership yields no synthetic chart baseline', () => {
    assert.deepEqual(currentWarObservationTimeline([frame(0, {})], { warId: 'war-141', warStart: start }), []);
});

test('Starting assignments are excluded while real neutral captures remain', () => {
    const event = { eventType: 'town-captured', observedAt: new Date(start + 300000).toISOString(), data: { previousTeamId: 'NONE', capturedTimestamp: start } };
    assert.equal(isInitialFoxholeOwnershipEvent(event), true);
    assert.equal(isInitialFoxholeOwnershipEvent({ ...event, data: { previousTeamId: 'NONE', capturedTimestamp: start + 300001 } }), false);
    assert.equal(isInitialFoxholeOwnershipEvent({ ...event, data: { previousTeamId: 'COLONIALS', capturedTimestamp: start } }), false);
    assert.equal(isInitialFoxholeOwnershipEvent({ ...event, eventType: 'town-neutralized' }), false);
});
