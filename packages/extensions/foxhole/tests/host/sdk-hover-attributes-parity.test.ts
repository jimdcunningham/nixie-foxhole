import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import published from '../../public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeAssetForSceneV2 } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { getFoxholeManifest } = await import('../../app/plugins/foxhole/nixie/manifest.ts');
const { resolveFoxholeAssetHoverAttributes, formatFoxholeHoverPowerLabel } = await import('../../app/plugins/foxhole/nixie/asset-hover-layout.ts');
hook.deregister();

test('all structure hover attributes retain Native labels and order independently of placement inference', () => {
    const native = getFoxholeManifest('/foxhole/assets/');
    const generated = createFoxholeSceneV2AssetMetadata(published as unknown as { assets: PublishedFoxholeAssetForSceneV2[]; });
    const mismatches: string[] = [];
    let cases = 0;
    for (const asset of native.assets.filter(asset => !asset.isItem)) {
        const metadata = generated.assets[asset.id];
        assert.ok(metadata, asset.id);
        const expected = resolveFoxholeAssetHoverAttributes(null, asset).map(attribute => attribute.label);
        const power = formatFoxholeHoverPowerLabel(asset.powerGridInfo?.powerDelta);
        if (power) expected.push(power);
        const actual = (metadata.browserAttributes ?? []).map(attribute => typeof attribute === 'string' ? attribute : attribute.label);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(asset.id);
        cases++;
    }
    assert.equal(cases, native.assets.filter(asset => !asset.isItem).length);
    assert.ok(cases > 0);
    assert.deepEqual(mismatches, []);
    console.log('Compared ' + cases + ' Native/SDK hover attribute entries.');
});

test('the explicit foundation badge never changes facility placement-support policy', () => {
    const factory = published.assets.find(asset => asset.id === 'facilityrefinery1')!;
    for (const flag of [undefined, false, true]) {
        const generate = (categoryId: string, isFacility: boolean) => createFoxholeSceneV2AssetMetadata({ assets: [{
            ...factory, categoryId, isFacility, bIsBuiltOnLandscape: false, bIsBuiltOnFoundation: flag,
        } as unknown as PublishedFoxholeAssetForSceneV2] }).assets.facilityrefinery1!;
        const facility = generate('facility', true);
        const defense = generate('defense', false);
        assert.equal(facility.requiresFoundation, true);
        assert.equal(defense.requiresFoundation, false);
        for (const asset of [facility, defense]) {
            assert.equal(asset.browserAttributes!.some(attribute => typeof attribute !== 'string' && attribute.label === 'Requires Foundation'), flag === true);
        }
    }
});
