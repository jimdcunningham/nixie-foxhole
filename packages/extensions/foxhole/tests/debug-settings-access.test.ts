import assert from 'node:assert/strict';
import test from 'node:test';
import { foxholeRangeDebugUserSettings } from '../app/plugins/foxhole/nixie/range-settings.ts';
import { foxholeStructureDebugSettings } from '../app/plugins/foxhole/nixie/structure-debug-settings.ts';
import { canAccessNixieDevSetting } from '#nixie/utils/nixie-setting-access.ts';

const publicOverlayIds = new Set([
    'foxhole.structure.markedCargo',
    'foxhole.debug.structure.powerSockets',
    'foxhole.debug.structure.pipeSockets',
    'foxhole.structure.breachIndicators',
    'foxhole.structure.hideRoofs',
    'foxhole.structure.hideRoofsOnHover',
]);

test('public Foxhole menu overlays are accessible to regular production users', () => {
    const definitions = foxholeStructureDebugSettings.filter(definition => publicOverlayIds.has(definition.id));
    assert.equal(definitions.length, publicOverlayIds.size);
    for (const definition of definitions) {
        assert.equal(canAccessNixieDevSetting(definition.accessibleInDev === true, false), true, definition.id);
    }
});

test('all Foxhole debug settings require development access', () => {
    const definitions = [
        ...foxholeStructureDebugSettings.filter(definition => !publicOverlayIds.has(definition.id)),
        ...foxholeRangeDebugUserSettings,
    ];

    assert.ok(definitions.length > 0);
    assert.deepEqual(
        definitions.filter(definition => definition.accessibleInDev !== true).map(definition => definition.id),
        [],
    );
});
