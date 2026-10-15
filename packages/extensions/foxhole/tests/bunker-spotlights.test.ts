import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FillGradient, Matrix, Texture } from 'pixi.js';
import { createFoxholeBunkerSpotlightGlow, FOXHOLE_BUNKER_SPOTLIGHT_BEAM } from '../app/plugins/foxhole/nixie/bunker-spotlights.ts';
import { createFoxholeSpotlightBeam } from '../app/plugins/foxhole/nixie/spotlight-beam.ts';
import { foxholeManifestSchema } from '../app/plugins/foxhole/nixie/manifest-schema.ts';
import { resolveFoxholeBunkerSpotlightLights } from '../app/plugins/foxhole/nixie/bunker-spotlights.ts';

test('bunker lamps reuse the vehicle beam geometry without intercepting scene input', t => {
    // Exercise retained geometry in Node; gradient rasterization is verified in the browser.
    t.mock.method(FillGradient.prototype, 'buildGradient', function (this: FillGradient) {
        this.texture = Texture.WHITE;
        this.transform = new Matrix();
    });
    const glow = createFoxholeBunkerSpotlightGlow();
    const headlight = createFoxholeSpotlightBeam(FOXHOLE_BUNKER_SPOTLIGHT_BEAM);
    assert.equal(glow.eventMode, 'none');
    assert.ok(glow.children.every(child => child.eventMode === 'none'));
    assert.equal(glow.children.length, headlight.children.length);
    const bounds = headlight.getLocalBounds();
    assert.ok(bounds.maxX >= FOXHOLE_BUNKER_SPOTLIGHT_BEAM.coneLength);
    assert.ok(bounds.maxX < 100);
    assert.ok(bounds.minY < -30 && bounds.maxY > 30);
    assert.ok(glow.getLocalBounds().minX >= -2);
    glow.destroy({ children: true });
    headlight.destroy({ children: true });
});

test('extracted falloff with tiny opacities constructs Pixi gradients without CSS scientific notation', t => {
    t.mock.method(FillGradient.prototype, 'buildGradient', function (this: FillGradient) {
        this.texture = Texture.WHITE;
        this.transform = new Matrix();
    });
    const [light] = resolveFoxholeBunkerSpotlightLights([{ x: 20, a: 2275, o: 45, i: 5, fe: 8, isf: false, v: 100, lc: 'ffdea4' }]);
    assert.doesNotThrow(() => {
        const glow = createFoxholeBunkerSpotlightGlow(light!.beam);
        assert.equal(glow.children.length, 1);
        glow.destroy({ children: true });
    });
});

test('native schema retains compact spotlight metadata including a false inverse-square flag', () => {
    const raw = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    raw.assets = [{ ...raw.assets.find((asset: { id: string; }) => asset.id === 'rifleait3'),
        spotlights: [{ n: 'FortSpotLight:Light_GEN_VARIABLE', x: 20, z: 338, a: 2275, o: 45, i: 5,
            v: 100, lc: 'FFDEA4', fe: 8, isf: false }] }];
    const manifest = foxholeManifestSchema.parse(raw);
    const source = manifest.assets[0]!.spotlights[0]!;
    assert.equal(source.lightFalloffExponent, 8);
    assert.equal(source.useInverseSquaredFalloff, false);
    const light = resolveFoxholeBunkerSpotlightLights([source])[0]!;
    assert.equal(light.authored, true);
    assert.equal(light.x, 6.4);
    assert.equal(light.beam.coneLength, 728);
});
