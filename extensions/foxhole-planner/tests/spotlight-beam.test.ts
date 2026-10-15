import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { createFoxholeSpotlightBeamGraphics, readFoxholeAuthoredSpotlight } from '../src/spotlight-beam.ts';
import { FOXHOLE_BUNKER_SPOTLIGHT_BEAM, resolveFoxholeBunkerSpotlightLights } from '../src/bunker-spotlights.ts';

test('headlights preserve their tapered footprint and elliptical falloff in portable plans', () => {
    const light = { ...FOXHOLE_BUNKER_SPOTLIGHT_BEAM, coneLength: 240, beamStrength: 0.55 };
    const children = createFoxholeSpotlightBeamGraphics(light);
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children } }));
    assert.equal(children.length, 2);
    const beam = children[0]!;
    const shape = beam.commands[0]!;
    assert.ok(shape.op === 'polygon');
    assert.equal(shape.points[0]?.x, 0);
    assert.equal(shape.points[0]!.y * beam.scaleY!, -light.baseHalfWidthPixels);
    const halfAngle = light.outerConeAngleRadians / 2;
    const expectedWidth = Math.tan(halfAngle) * (light.coneLength + light.baseOffsetPixels);
    assert.ok(Math.abs(Math.min(...shape.points.map(point => point.y * beam.scaleY!)) + expectedWidth) < 0.000001);
    const gradient = beam.commands[1]!;
    assert.ok(gradient.op === 'fill-radial-gradient');
    assert.equal(gradient.colorStops[0]!.alpha, 0.045 + light.beamStrength * 0.09);
    assert.equal(gradient.colorStops.at(-1)!.alpha, 0);
});

test('vertical vehicle lights retain their radial glow rather than acquiring a beam', () => {
    const children = createFoxholeSpotlightBeamGraphics({ ...FOXHOLE_BUNKER_SPOTLIGHT_BEAM, planarProjectionScale: 0 });
    assert.equal(children.length, 1);
    assert.equal(children[0]!.id, 'light-glow');
    assert.equal(children[0]!.commands.filter(command => command.op === 'circle').length, 2);
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children } }));
});

test('published light values determine world position, cone size, color and falloff without using the old mesh fallback', () => {
    const source = { n: 'FortSpotLight:Light_GEN_VARIABLE', x: 80, y: -25, z: 363, r: 90,
        a: 2275, o: 45, i: 5, v: 100, lc: 'FFDEA4', fe: 8, isf: false };
    const light = readFoxholeAuthoredSpotlight(source)!;
    assert.equal(light.useInverseSquaredFalloff, false);
    assert.equal(light.lightFalloffExponent, 8);
    const resolved = resolveFoxholeBunkerSpotlightLights([source], { width: 999, offsetX: -999 })[0]!;
    assert.equal(resolved.authored, true);
    assert.equal(resolved.x, 25.6);
    assert.equal(resolved.y, -8);
    assert.equal(resolved.rotation, Math.PI / 2);
    assert.equal(resolved.beam.coneLength, 728);
    assert.equal(resolved.beam.outerConeAngleRadians, Math.PI / 2);
    const nodes = createFoxholeSpotlightBeamGraphics(resolved.beam);
    assert.equal(nodes.length, 1, 'a powered bunker lamp emits one continuous beam');
    for (const node of nodes) {
        const shape = node.commands[0]!;
        const gradient = node.commands[1]!;
        assert.ok(shape.op === 'polygon');
        assert.ok(shape.points.every(point => Math.hypot(point.x, point.y * (node.scaleY ?? 1)) <= 728.000001));
        assert.ok(gradient.op === 'fill-radial-gradient');
        assert.equal(gradient.outerRadius, 728);
        assert.equal(gradient.colorStops[0]!.color, 0xFFDEA4);
        const mid = gradient.colorStops[8]!;
        assert.ok(Math.abs(mid.alpha! / gradient.colorStops[0]!.alpha! - Math.pow(0.75, 8)) < 0.00001);
        assert.ok(gradient.colorStops.every(stop => stop.alpha === 0 || stop.alpha! >= 0.000001));
    }
    assert.equal(resolveFoxholeBunkerSpotlightLights([], { width: 26 })[0]!.authored, false);
    assert.equal(readFoxholeAuthoredSpotlight({ ...source, a: NaN }), null);
});
