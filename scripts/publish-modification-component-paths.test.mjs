import assert from 'node:assert/strict';
import { test } from 'node:test';

// Mirrors publish-manifest parseAssetRelativeLocation segment rules for modification components.
function parseAssetRelativeLocationSegments(relativePath) {
    const segments = String(relativePath ?? '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);

    if (segments[0] !== 'types' || segments.length < 4) {
        return null;
    }

    const assetType = segments[1];
    const assetId = segments[2];

    if (segments.length === 6 && segments[3] === 'modifications') {
        return {
            scope: 'assetModification',
            assetType,
            assetId,
            modificationId: segments[4],
            fileName: segments[5],
        };
    }

    if (
        segments.length === 8
        && segments[3] === 'modifications'
        && segments[5] === 'components'
    ) {
        return {
            scope: 'assetModificationComponent',
            assetType,
            assetId,
            modificationId: segments[4],
            componentId: segments[6],
            fileName: segments[7],
        };
    }

    return null;
}

test('parseAssetRelativeLocation recognizes modification component textures', () => {
    const location = parseAssetRelativeLocationSegments(
        'types/structures/facilitypipe/modifications/insulation/components/span/span.texture.webp',
    );

    assert.deepEqual(location, {
        scope: 'assetModificationComponent',
        assetType: 'structures',
        assetId: 'facilitypipe',
        modificationId: 'insulation',
        componentId: 'span',
        fileName: 'span.texture.webp',
    });
});

test('parseAssetRelativeLocation still recognizes top-level modification textures', () => {
    const location = parseAssetRelativeLocationSegments(
        'types/structures/facilitypipe/modifications/insulation/insulation.texture.webp',
    );

    assert.deepEqual(location, {
        scope: 'assetModification',
        assetType: 'structures',
        assetId: 'facilitypipe',
        modificationId: 'insulation',
        fileName: 'insulation.texture.webp',
    });
});
