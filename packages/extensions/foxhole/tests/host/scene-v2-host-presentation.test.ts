import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNixieInternalSpatialPresentation } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { foxholeSceneV2HostPolicy } from '../../app/utils/scene-v2-host-policy.ts';
import { FOXHOLE_SCENE_FACTION_SETTING_ID } from '../../app/utils/scene-faction.ts';
import factionContribution from '../../app/plugins/nixie/contributions/foxhole/scene-faction.contrib.ts';

test('saved faction preferences still select the correct flag atlas row', () => {
    assert.equal(FOXHOLE_SCENE_FACTION_SETTING_ID, 'nixie.scene.foxholeFaction');
    const setting = factionContribution.settings![0]!;
    assert.equal(setting.id, FOXHOLE_SCENE_FACTION_SETTING_ID);
    assert.equal(setting.persist, 'local');
    assert.equal(setting.viewpoint, true);
    for (const [value, expected] of [['colonial', 0], ['warden', 1], ['asset-default', undefined], ['invalid', undefined], [null, undefined]] as const) {
        const readSetting = (id: string) => id === setting.id ? value : undefined;
        assert.equal(foxholeSceneV2HostPolicy.spatialPresentation!(readSetting).flagAtlasRow, expected, String(value));
        assert.deepEqual(resolveNixieInternalSpatialPresentation(readSetting), {});
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
                assert.equal(foxholeSceneV2HostPolicy.spatialPresentation!(id => settings[id]).poweredSpotlights,
                    nighttime && spotlights && !hideRoofs);
            }
        }
    }
    assert.equal(foxholeSceneV2HostPolicy.spatialPresentation!(() => undefined).poweredSpotlights, false);
});
