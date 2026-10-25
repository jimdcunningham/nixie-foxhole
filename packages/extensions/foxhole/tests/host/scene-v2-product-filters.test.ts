import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNixieSceneV2ProductFilters } from '../../../../nixie/app/utils/nixie-scene-v2-product-filters.ts';

const load = (name: string) => JSON.parse(readFileSync(hostSourceUrl(`../../../../../extensions/${name}/nixie.extension.json`, import.meta.url), 'utf8')).contributes;

test('Planner provider settings preserve bundled button order, cycles and tier availability', () => {
    const manifest = load('foxhole-planner');
    const filters = createNixieSceneV2ProductFilters([{ settings: manifest.settings, productProviders: manifest.experimentalProductProviders }]);
    const values = Object.fromEntries(manifest.settings.map((setting: { id: string; defaultValue: unknown; }) => [setting.id, setting.defaultValue]));
    const context = { getSetting: (id: string) => values[id] } as Parameters<NonNullable<(typeof filters)[number]['enabled']>>[0];
    assert.deepEqual(filters.map(filter => typeof filter.label === 'function' ? filter.label(values[filter.settingId], context) : filter.label),
        ['Bunkers', 'Facilities', 'Vehicles', 'World', 'Items', 'Faction', 'Tier 3', 'Previous Tiers', '3D', 'Upgrades', 'Destroyed', 'Breached']);
    const faction = filters.find(filter => filter.settingId.endsWith('.faction'))!;
    assert.equal(faction.isActive!('all', context), false);
    assert.equal(faction.nextValue!('all', context), 'c');
    assert.equal(faction.nextValue!('c', context), 'w');
    assert.equal(faction.nextValue!('w', context), 'all');
    const tier = filters.find(filter => filter.settingId.endsWith('.tier'))!;
    assert.equal(tier.nextValue!('3', context), '1');
    const previous = filters.find(filter => filter.settingId.endsWith('.showPreviousTiers'))!;
    values['foxhole.assets.filter.tier'] = '1';
    assert.equal(previous.enabled!(context), false);
    values['foxhole.assets.filter.tier'] = '2';
    assert.equal(previous.enabled!(context), true);
});

test('neutral Diagram provider also uses the shared cyclic filter surface', () => {
    const manifest = load('scene-v2-diagram');
    const filters = createNixieSceneV2ProductFilters([{ settings: manifest.settings, productProviders: manifest.experimentalProductProviders }]);
    assert.equal(filters.length, 1);
    const filter = filters[0]!;
    const context = {} as Parameters<NonNullable<typeof filter.nextValue>>[1];
    const values = manifest.settings.find((setting: { id: string; }) => setting.id === filter.settingId).options.map((option: { value: string; }) => option.value);
    for (let index = 0; index < values.length; index++) {
        assert.equal(filter.nextValue!(values[index], context), values[(index + 1) % values.length]);
    }
});
