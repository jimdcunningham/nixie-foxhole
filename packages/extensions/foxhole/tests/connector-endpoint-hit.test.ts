import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isConnectorEndpointHit,
    usesConnectorEndpointOnlyHitTesting,
} from '../app/plugins/foxhole/nixie/connector-behavior.ts';

test('usesConnectorEndpointOnlyHitTesting is limited to underground pipes', () => {
    assert.equal(usesConnectorEndpointOnlyHitTesting('facilitypipeunderground'), true);
    assert.equal(usesConnectorEndpointOnlyHitTesting('facilitypipe'), false);
    assert.equal(usesConnectorEndpointOnlyHitTesting('powerline'), false);
});

test('isConnectorEndpointHit accepts only the trim sockets', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 200, y: 0 };
    const hitRadius = 20;

    assert.equal(isConnectorEndpointHit({ x: 0, y: 0 }, start, end, hitRadius), true);
    assert.equal(isConnectorEndpointHit({ x: 200, y: 0 }, start, end, hitRadius), true);
    assert.equal(isConnectorEndpointHit({ x: 10, y: 5 }, start, end, hitRadius), true);
    assert.equal(isConnectorEndpointHit({ x: 100, y: 0 }, start, end, hitRadius), false);
    assert.equal(isConnectorEndpointHit({ x: 100, y: 5 }, start, end, hitRadius), false);
});
