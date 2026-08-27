import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { foxholeManifestSchema } from '../../../packages/extensions/foxhole/app/plugins/foxhole/nixie/manifest-schema.ts';
import {
    augmentTargetedOnlyPublishedStructures,
    getExplicitlyRemovedStructureIdsForTargetedPublish,
    preserveAuthoredStructureMarkedCargoOverlays,
    preserveAuthoredStructurePreviewDirections,
    resolveFactionTextureVariants,
    shouldPublishVehicleDestroyedVisual,
    stripSyntheticFactionTextureVariants,
} from './publish-manifest-overrides.mjs';
import {
    normalizeConversionRecipeCursorOrder,
    stripPublishedManifestLocalizationMetadata,
} from './publish-manifest-normalization.mjs';
import { isVehicleDestroyedPublishAllowlisted } from './vehicle-destroyed-allowlist.mjs';

test('published localization compaction strips extraction metadata', () => {
    assert.deepEqual(
        stripPublishedManifestLocalizationMetadata({
            'asset:aircraftfighter2c:name': 'The Charon',
            'foxhole:meta:baseAssetsUrl': '/foxhole/assets/',
            'meta:legacy': 'not public',
            'category:vehicles:name': 'Vehicles',
        }),
        {
            'asset:aircraftfighter2c:name': 'The Charon',
            'category:vehicles:name': 'Vehicles',
        },
    );
});

test('conversion recipe cursors have deterministic property order after targeted parsing', () => {
    const manifest = {
        assets: [{
            id: 'facilitytest',
            nextRecipeId: 3,
            conversionEntries: [{ id: 1, inputs: [], outputs: [] }],
            modificationSlots: [{
                name: 'UpgradeSlot',
                variants: {
                    default: {
                        nextRecipeId: 2,
                        conversionEntries: [{ id: 1, inputs: [], outputs: [] }],
                    },
                },
            }],
        }],
    };

    normalizeConversionRecipeCursorOrder(manifest);

    const structure = manifest.assets[0];
    const variant = structure.modificationSlots[0].variants.default;
    assert.equal(Object.keys(structure).at(-1), 'nextRecipeId');
    assert.equal(Object.keys(variant).at(-1), 'nextRecipeId');
});

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

test('preserveAuthoredStructureMarkedCargoOverlays prefers authored override over published defaults', () => {
    const published = preserveAuthoredStructureMarkedCargoOverlays(
        {
            assets: [
                { id: 'facilitytransferresource', markedCargoOverlay: { offsetY: 12 } },
                { id: 'trailerresource', markedCargoOverlay: { offsetX: 4 } },
            ],
        },
        {
            assets: [
                { id: 'facilitytransferresource', markedCargoOverlay: { offsetY: 20 } },
            ],
        },
        new Map([
            ['trailerresource', { offsetY: -18 }],
        ]),
    );

    assert.deepEqual(published.assets[0].markedCargoOverlay, { offsetY: 20 });
    assert.deepEqual(published.assets[1].markedCargoOverlay, { offsetY: -18 });
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

test('augmentTargetedOnlyPublishedStructures skips authored exclude targets', () => {
    const publishedManifest = {
        assets: [
            { id: 'destroyedbarn' },
            { id: 'liquidcontainer' },
        ],
    };
    const filteredManifest = { assets: [] };
    const filter = { only: new Set(['destroyedbarn', 'liquidcontainer']) };
    const excluded = new Set(['destroyedbarn']);

    const augmented = augmentTargetedOnlyPublishedStructures(
        filteredManifest,
        publishedManifest,
        filter,
        excluded,
    );
    assert.deepEqual(augmented.assets.map(structure => structure.id), ['liquidcontainer']);
});

test('getExplicitlyRemovedStructureIdsForTargetedPublish removes authored excludes in --only', () => {
    const removed = getExplicitlyRemovedStructureIdsForTargetedPublish(
        { only: new Set(['destroyedbarn', 'liquidcontainer']) },
        new Set(['destroyedbarn']),
        { assets: [{ id: 'destroyedbarn' }, { id: 'liquidcontainer' }] },
    );
    assert.deepEqual([...removed], ['destroyedbarn']);
});

test('getExplicitlyRemovedStructureIdsForTargetedPublish never treats missing partial source as removal', () => {
    assert.equal(getExplicitlyRemovedStructureIdsForTargetedPublish(
        { only: new Set(['liquidcontainer']) },
        new Set(),
        { assets: [{ id: 'liquidcontainer' }] },
    ).size, 0);
});

test('resolveFactionTextureVariants drops identical synthetic faction fallbacks', () => {
    assert.deepEqual(
        resolveFactionTextureVariants(
            {
                c: { textureUrl: '/foxhole/assets/icons/trenchintt3.webp' },
                w: { textureUrl: '/foxhole/assets/icons/trenchintt3.webp' },
            },
            null,
            '/foxhole/assets/types/structures/trenchintt3/trenchintt3.texture.webp',
        ),
        {
            colonialTextureUrl: '/foxhole/assets/types/structures/trenchintt3/trenchintt3.texture.webp',
            wardenTextureUrl: '/foxhole/assets/types/structures/trenchintt3/trenchintt3.texture.webp',
            hasColonialVariant: false,
            hasWardenVariant: false,
        },
    );
});

test('resolveFactionTextureVariants preserves genuine extracted faction textures', () => {
    assert.deepEqual(
        resolveFactionTextureVariants(
            {},
            {
                c: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.c.webp' },
                w: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.w.webp' },
            },
            '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.webp',
        ),
        {
            colonialTextureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.c.webp',
            wardenTextureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.w.webp',
            hasColonialVariant: true,
            hasWardenVariant: true,
        },
    );
});

test('stripSyntheticFactionTextureVariants cleans merged assets but preserves genuine pairs', () => {
    const manifest = stripSyntheticFactionTextureVariants({
        assets: [
            {
                id: 'trenchintt3',
                variants: {
                    default: { textureUrl: '/foxhole/assets/types/structures/trenchintt3/trenchintt3.texture.webp' },
                    c: { textureUrl: '/foxhole/assets/icons/trenchintt3.webp' },
                    w: { textureUrl: '/foxhole/assets/icons/trenchintt3.webp' },
                },
            },
            {
                id: 'engineeringcenter',
                variants: {
                    c: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.c.webp' },
                    w: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.w.webp' },
                },
            },
        ],
    });

    assert.deepEqual(manifest.assets[0].variants, {
        default: { textureUrl: '/foxhole/assets/types/structures/trenchintt3/trenchintt3.texture.webp' },
    });
    assert.deepEqual(manifest.assets[1].variants, {
        c: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.c.webp' },
        w: { textureUrl: '/foxhole/assets/types/structures/engineeringcenter/engineeringcenter.texture.w.webp' },
    });
});

test('foxholeManifestSchema preserves stockpile metadata from raw FoxWatch manifests', () => {
    const rawManifest = JSON.parse(readFileSync(new URL('../tmp/foxwatch-manifest.v1.json', import.meta.url), 'utf8'));
    const sourceAsset = rawManifest.assets.find(asset => asset.id === 'facilitytransfermaterial');
    assert.ok(sourceAsset?.stockpile);

    const parsedManifest = foxholeManifestSchema.parse(rawManifest);
    const parsedAsset = parsedManifest.assets.find(asset => asset.id === 'facilitytransfermaterial');

    assert.deepEqual(parsedAsset?.stockpile, sourceAsset.stockpile);
    assert.ok(parsedManifest.assets.some(asset => asset.stockpile));
});

test('foxholeManifestSchema preserves holdProfile metadata from raw FoxWatch manifests', () => {
    const rawManifest = JSON.parse(readFileSync(new URL('../tmp/foxwatch-manifest.v1.json', import.meta.url), 'utf8'));
    const sourceAsset = rawManifest.assets.find(asset => asset.id === 'resourcecontainer');
    assert.ok(sourceAsset?.holdProfile);

    const parsedManifest = foxholeManifestSchema.parse(rawManifest);
    const parsedAsset = parsedManifest.assets.find(asset => asset.id === 'resourcecontainer');

    assert.deepEqual(
        JSON.parse(JSON.stringify(parsedAsset?.holdProfile)),
        JSON.parse(JSON.stringify(sourceAsset.holdProfile)),
    );
    assert.ok(parsedManifest.assets.some(asset => asset.holdProfile));
});

test('raw FoxWatch manifest preserves authored connector behavior and marked cargo overlays', () => {
    const rawManifest = JSON.parse(readFileSync(new URL('../tmp/foxwatch-manifest.v1.json', import.meta.url), 'utf8'));
    const tankStop = rawManifest.assets.find(asset => asset.id === 'tankstopsplinet3');
    const transferStation = rawManifest.assets.find(asset => asset.id === 'facilitytransferresource');

    assert.deepEqual(tankStop?.connector?.behavior, { tankStop: true });
    assert.deepEqual(transferStation?.markedCargoOverlay, { offsetX: 52 });

    const parsedManifest = foxholeManifestSchema.parse(rawManifest);
    assert.deepEqual(
        parsedManifest.assets.find(asset => asset.id === 'tankstopsplinet3')?.connector?.behavior,
        { tankStop: true },
    );
    assert.deepEqual(
        parsedManifest.assets.find(asset => asset.id === 'facilitytransferresource')?.markedCargoOverlay,
        { offsetX: 52 },
    );
});
