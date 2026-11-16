import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { NIXIE_URL_SPRITE_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/url-sprite.ts';
import {
    collectLegacyPlanPendingImages,
    createLegacyPlanImageFile,
    createLegacyPlanImageSpriteSnapshot,
    findLegacyPlanArchiveAsset,
} from '../../app/plugins/foxhole/legacy/plan-image-mapper.ts';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';

const filename = 'fixture.gif';
const asset = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function imageArchive() {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ version: '1.0.5', entities: [{
        id: 1, type: 'image', textureFile: filename, width: 228, height: 221, rotation: 90, shapeStyle: { alpha: 0.5 },
    }] }));
    zip.file(`assets/${filename}`, asset);
    return zip.generateAsync({ type: 'nodebuffer' });
}

test('image mapper resolves archive textureFile into a File', async () => {
    const zip = await JSZip.loadAsync(await imageArchive());
    const project = JSON.parse(await zip.file('project.json')!.async('string'));
    const assetBytes = await zip.file(`assets/${filename}`)!.async('uint8array');
    const pending = collectLegacyPlanPendingImages(project.entities);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.textureFile, filename);
    assert.ok(Math.abs(Number(pending[0]?.alpha) - 0.5) < 1e-9);

    const assets = [{ path: `assets/${filename}`, bytes: assetBytes }];
    assert.ok(findLegacyPlanArchiveAsset(assets, filename));
    const fileResult = createLegacyPlanImageFile({ pending: pending[0]!, assets });
    assert.ok(!('unresolved' in fileResult));
    assert.equal(fileResult.file.name, filename);
    assert.deepEqual(Buffer.from(await fileResult.file.arrayBuffer()), asset);
});

test('importer collects pending images from fixture archives', async () => {
    const result = await new LegacyPlanImporter({ fixtureName: 'image-fixture.plan' }).importArchive(await imageArchive());

    assert.equal(result.pendingImages.length, 1);
    assert.equal(result.report.unresolvedImageKeys.length, 0);
    assert.equal(result.report.skippedEntityTypes.image, undefined);
    assert.equal(result.archive.assets.length, 1);

    const snapshot = createLegacyPlanImageSpriteSnapshot({
        projectId: 'local-test',
        asset: {
            id: 'asset-1',
            displayName: filename,
            originalFilename: filename,
            mimeType: 'image/gif',
            width: 228,
            height: 221,
        },
        pending: result.pendingImages[0]!,
    });
    assert.equal(snapshot.type, NIXIE_URL_SPRITE_NODE_TYPE);
    assert.equal(snapshot.id, `legacy-${result.pendingImages[0]!.legacyId}`);
    assert.equal(snapshot.state.width, result.pendingImages[0]!.width);
    assert.equal(snapshot.state.height, result.pendingImages[0]!.height);
    assert.ok(Math.abs(Number(snapshot.state.rotation) - (Math.PI / 2)) < 1e-9);
    assert.ok(Math.abs(Number(snapshot.state.alpha) - 0.5) < 1e-9);
    assert.equal(snapshot.state.projectAssetId, 'asset-1');
});
