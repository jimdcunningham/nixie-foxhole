import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNixieInternalSpatialPresentation } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { FOXHOLE_SCENE_FACTION_SETTING_ID } from '../../app/utils/scene-faction.ts';
import factionContribution from '../../app/plugins/nixie/contributions/foxhole/scene-faction.contrib.ts';

// The host hooks register the real compiled integration, independently of map loading.
test('saved faction preferences still select the correct flag atlas row', () => {
    assert.equal(FOXHOLE_SCENE_FACTION_SETTING_ID, 'nixie.scene.foxholeFaction');
    const setting = factionContribution.settings![0]!;
    assert.equal(setting.id, FOXHOLE_SCENE_FACTION_SETTING_ID);
    assert.equal(setting.persist, 'local');
    assert.equal(setting.viewpoint, true);
    for (const [value, expected] of [['colonial', 0], ['warden', 1], ['asset-default', undefined], ['invalid', undefined], [null, undefined]] as const) {
        const presentation = resolveNixieInternalSpatialPresentation(id => id === setting.id ? value : undefined);
        assert.equal(presentation.flagAtlasRow, expected, String(value));
    }
});

test('spotlights require nighttime and the enabled overlay with roofs visible', () => {
    for (const nighttime of [false, true]) {
        for (const spotlights of [false, true]) {
            for (const hideRoofs of [false, true]) {
                const settings: Record<string, boolean> = {
                    'foxhole.ranges.nighttime': nighttime,
                    'foxhole.ranges.poweredSpotlights': spotlights,
                    'foxhole.structure.hideRoofs': hideRoofs,
                };
                assert.equal(resolveNixieInternalSpatialPresentation(id => settings[id]).poweredSpotlights,
                    nighttime && spotlights && !hideRoofs);
            }
        }
    }
    assert.equal(resolveNixieInternalSpatialPresentation(() => undefined).poweredSpotlights, false);
});
