import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    augmentTargetedOnlyPublishedStructures,
    getExplicitlyRemovedStructureIdsForTargetedPublish,
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

test('augmentTargetedOnlyPublishedStructures keeps --only targets missing from partial source', () => {
    const publishedManifest = {
        assets: [
            { id: 'liquidcontainer', colors: [{ hex: 'fd9d06' }] },
            { id: 'resourcecontainer', colors: [{ hex: '080909' }] },
        ],
    };
    const filteredManifest = { assets: [] };
    const filter = { only: new Set(['liquidcontainer', 'resourcecontainer', 'shippingcontainer']) };

    const augmented = augmentTargetedOnlyPublishedStructures(filteredManifest, publishedManifest, filter);
    assert.deepEqual(augmented.assets.map(structure => structure.id), ['liquidcontainer', 'resourcecontainer']);
});

test('getExplicitlyRemovedStructureIdsForTargetedPublish never treats missing partial source as removal', () => {
    assert.equal(getExplicitlyRemovedStructureIdsForTargetedPublish().size, 0);
});
