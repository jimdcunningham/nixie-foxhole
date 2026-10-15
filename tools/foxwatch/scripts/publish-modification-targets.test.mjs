import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canShareModificationVariant, resolveAssetScopedModificationRenderEntry } from './modification-storage-policy.mjs';

// Exercise the real publisher transformation without running its file-writing CLI.
// Upgrade variants are host-local, so the later shared-store pass is outside this fixture.
const publisherSource = readFileSync(new URL('./publish-manifest.mjs', import.meta.url), 'utf8');
function definition(name) {
    const start = publisherSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists in publisher`);
    const next = publisherSource.slice(start).search(/\n(?:async )?function [A-Za-z]/);
    assert.ok(next > 0, `${name} has a following top-level declaration`);
    return publisherSource.slice(start, start + next);
}
const functions = ['normalizeId', 'compactLocalizationId', 'sortObjectEntries', 'normalizeLocalizationBundles',
    'resolvePublishedUpgradeVariantContext', 'stripPublishedModificationSlotNoise'].map(definition).join('\n');
const publishSlots = new Function('canShareModificationVariant', 'resolveAssetScopedModificationRenderEntry',
    'buildSharedModificationStore', `${functions}\nreturn stripPublishedModificationSlotNoise;`)(
    canShareModificationVariant, resolveAssetScopedModificationRenderEntry, manifest => manifest,
);
const source = {
    coal: { name: 'Coal Power Plant', description: 'A generator that burns coal to generate power.' },
    petrol: { name: 'Petrol Power Plant', description: 'A generator that burns petrol to generate more power.' },
};
function host(variants) {
    return { id: 'facilitypowerdiesel', modifications: Object.fromEntries(Object.keys(variants).map(id => [id, {
        isUpgrade: true, appliedModificationId: id, name: id, description: '',
    }])), modificationSlots: [{ name: 'UpgradeSlotComponent', componentType: 'ModificationSlotComponent', variants }] };
}
function publish(assets) {
    return publishSlots({ assets, localizations: [{ locale: 'en', strings: {
        'asset:coal:desc': 'Coal item description', 'asset:petrol:desc': 'Petrol item description',
    } }] }, {}, {}, {});
}
for (const id of ['coal', 'petrol']) {
    test(`${id} item collision retains the authored plant variant text and scoped localization`, () => {
        const item = { id, isItem: true, name: { id: `asset:${id}:name`, fallback: id },
            description: { id: `asset:${id}:desc`, fallback: `${id} item description` } };
        const output = publish([host({ [id]: { ...source[id], isUpgrade: true } }), item]);
        const variant = output.assets[0].modifications[0].variants[id];
        assert.equal(variant.name.fallback, source[id].name);
        assert.equal(variant.description.fallback, source[id].description);
        assert.equal(variant.description.id, `asset:facilitypowerdiesel:mod:${id}:description`);
        assert.equal(output.localizations[0].strings[variant.description.id], source[id].description);
        assert.equal(output.localizations[0].strings[`asset:${id}:desc`], id === 'coal' ? 'Coal item description' : 'Petrol item description');
        assert.deepEqual(output.assets[1].name, item.name, 'commodity name is preserved');
        assert.deepEqual(output.assets[1].description, item.description, 'commodity description is preserved');
        assert.equal(output.assets[1].isItem, true);
    });
}
test('a genuine structural upgrade target retains canonical target name and description precedence', () => {
    const target = { id: 'advancedplant', name: { id: 'asset:advancedplant:name', fallback: 'Advanced Plant' },
        description: { id: 'asset:advancedplant:desc', fallback: 'Canonical advanced plant description' } };
    const output = publish([host({ advancedplant: { isUpgrade: true, name: 'Generic Upgrade', description: 'Slot description' } }), target]);
    const variant = output.assets[0].modifications[0].variants.advancedplant;
    assert.deepEqual(variant.name, target.name);
    assert.deepEqual(variant.description, target.description);
});