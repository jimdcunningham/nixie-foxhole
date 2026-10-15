import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mapLegacyPlanAuthorsToCredits,
    mapLegacyPlanIdentitySettings,
} from '../../app/plugins/foxhole/legacy/plan-identity-settings.ts';
import { mapLegacyPlanProjectSettings } from '../../app/plugins/foxhole/legacy/plan-project-settings.ts';

test('mapLegacyPlanAuthorsToCredits trims string authors into credits', () => {
    assert.equal(mapLegacyPlanAuthorsToCredits('  [HAND] Bretonec  '), '[HAND] Bretonec');
    assert.equal(mapLegacyPlanAuthorsToCredits(''), '');
    assert.equal(mapLegacyPlanAuthorsToCredits(null), '');
});

test('mapLegacyPlanAuthorsToCredits joins array authors', () => {
    assert.equal(
        mapLegacyPlanAuthorsToCredits(['Antoine', ' elpargo ', '']),
        'Antoine\nelpargo',
    );
});

test('mapLegacyPlanIdentitySettings maps description, authors→credits, and tags', () => {
    const mapped = mapLegacyPlanIdentitySettings({
        description: '  Frontline bunker line  ',
        authors: 'Antoine & elpargo',
        tags: ['Bunker', 'hand', 'Bunker'],
    });

    assert.deepEqual(mapped, {
        description: 'Frontline bunker line',
        credits: 'Antoine & elpargo',
        tags: 'Bunker\nhand',
    });
});

test('mapLegacyPlanIdentitySettings omits empty identity fields', () => {
    assert.deepEqual(mapLegacyPlanIdentitySettings({
        description: '   ',
        authors: '',
        tags: [],
    }), {});
    assert.deepEqual(mapLegacyPlanIdentitySettings(undefined), {});
});

test('mapLegacyPlanProjectSettings maps shard and selected regions into project map settings', () => {
    assert.deepEqual(mapLegacyPlanProjectSettings({
        shardId: ' live-3 ',
        regionKeys: ['DeadLands', ' DeadLands ', 'FarranacCoast', ''],
        showWorldRegion: true,
    }), {
        'foxhole.map.enabled': true,
        'foxhole.map.shardId': 'live-3',
        'foxhole.map.regionKeys': 'DeadLands,FarranacCoast',
    });
});

test('mapLegacyPlanProjectSettings keeps a disabled map context and omits crop data', () => {
    assert.deepEqual(mapLegacyPlanProjectSettings({
        shardId: 'live',
        regionKeys: ['DeadLands'],
        showWorldRegion: false,
        regionCrop: { x: 10, y: 20 },
    }), {
        'foxhole.map.enabled': false,
        'foxhole.map.shardId': 'live',
        'foxhole.map.regionKeys': 'DeadLands',
    });
});
