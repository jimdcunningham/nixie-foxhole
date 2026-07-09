import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    preserveAuthoredStructurePreviewDirections,
    shouldPublishVehicleDestroyedVisual,
} from './publish-manifest-overrides.mjs';
import { isVehicleDestroyedPublishAllowlisted } from './vehicle-destroyed-allowlist.mjs';

test('shouldPublishVehicleDestroyedVisual requires allowlist membership for vehicles', () => {
    const allowlist = new Set(['truckliquidc']);
    assert.equal(
        shouldPublishVehicleDestroyedVisual({ id: 'facilitymine1', isVehicle: false }, allowlist),
        true,
    );
    assert.equal(
        shouldPublishVehicleDestroyedVisual({ id: 'truckliquidc', isVehicle: true }, allowlist),
        true,
    );
    assert.equal(
        shouldPublishVehicleDestroyedVisual({ id: 'truckw', isVehicle: true }, allowlist),
        false,
    );
    assert.equal(isVehicleDestroyedPublishAllowlisted('truckliquidc', allowlist), true);
});

test('preserveAuthoredStructurePreviewDirections prefers authored override over render inference', () => {
    const published = preserveAuthoredStructurePreviewDirections(
        {
            assets: [
                { id: 'artilleryait3', previewDirection: 'ne' },
                { id: 'artilleryait1', previewDirection: 'nw' },
            ],
        },
        {
            assets: [
                { id: 'artilleryait3', previewDirection: 'sw' },
            ],
        },
        new Map([
            ['artilleryait1', 'sw'],
        ]),
    );

    assert.equal(published.assets[0].previewDirection, 'sw');
    assert.equal(published.assets[1].previewDirection, 'sw');
});
