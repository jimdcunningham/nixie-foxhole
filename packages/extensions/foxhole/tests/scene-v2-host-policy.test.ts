import assert from 'node:assert/strict';
import test from 'node:test';
import { foxholeSceneV2HostPolicy } from '../app/utils/scene-v2-host-policy.ts';
const product = (componentId: string) => ({ contractVersion: 1 as const, id: 'test', components: [{ ownerId: 'nixie.foxhole-planner', componentId, version: 1, data: {} }] });
test('Planner compatibility profiles retain asset and drawing authority without accepting foreign components', () => {
    assert.deepEqual(foxholeSceneV2HostPolicy.productCapabilities(product('asset')), ['move', 'rotate']);
    for (const id of ['tactical-line', 'connector']) assert.deepEqual(foxholeSceneV2HostPolicy.productCapabilities(product(id)), ['move', 'rotate', 'geometry-resize', 'geometry-reshape']);
    for (const id of ['spline-connector', 'range', 'binocular-line', 'triangulation']) assert.deepEqual(foxholeSceneV2HostPolicy.productCapabilities(product(id)), ['move', 'rotate', 'geometry-reshape']);
    const foreign = product('asset'); foreign.components[0]!.ownerId = 'example.foreign';
    assert.deepEqual(foxholeSceneV2HostPolicy.productCapabilities(foreign), []);
});
test('Planner spline parameters become private handle policy without rewriting the source', () => {
    const data = { foxholeKey: 'facilitypipe', maxBuffer: 20, curveT: 0.5 };
    assert.deepEqual(foxholeSceneV2HostPolicy.spline!.readHandlePolicy(data), { maximumLength: 20, preferredChordRatio: 0.4, interpolation: 0.5 });
    assert.equal(foxholeSceneV2HostPolicy.spline!.readHandlePolicy({ maxBuffer: 20 }), null);
    assert.equal(foxholeSceneV2HostPolicy.spline!.readHandlePolicy({ ...data, maxBuffer: Infinity }), null);
    assert.deepEqual(data, { foxholeKey: 'facilitypipe', maxBuffer: 20, curveT: 0.5 });
});

test('the active bundled policy translates exported lamps without host product identities', async () => {
    const { registerFoxholeSceneV2HostPolicy } = await import('../app/utils/scene-v2-host-policy.ts');
    const { resolveNixieInternalModelLightHints } = await import('#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts');
    const document = { nodes: [{ name: 'lamp', extras: { nixieBlueprintLight: {
        sourceName: 'FortSpotLight:Light', candela: 1473.84, source: { enabled: false, castShadows: true },
    } } }] };
    const unregister = registerFoxholeSceneV2HostPolicy();
    try {
        assert.deepEqual(resolveNixieInternalModelLightHints(document).get('lamp'), { shadows: true, poweredIntensity: 1473.84 });
    } finally { unregister(); }
    assert.equal(resolveNixieInternalModelLightHints(document).size, 0);
});
