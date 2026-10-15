import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { NIXIE_URL_SPRITE_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/url-sprite.ts';
import {
    collectLegacyPlanPendingImages,
    createLegacyPlanImageFile,
    createLegacyPlanImageSpriteSnapshot,
    findLegacyPlanArchiveAsset,
} from '../../app/plugins/foxhole/legacy/plan-image-mapper.ts';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
    __dirname,
    '../fixtures/legacy-plans/raw/bp-0ad7d5b9-6b12-47d4-ae00-9bae9f6e59f2.zip',
);

test('image mapper resolves archive textureFile into a File', async () => {
    const zip = await JSZip.loadAsync(readFileSync(FIXTURE));
    const project = JSON.parse(await zip.file('project.json')!.async('string'));
    const assetBytes = await zip.file('assets/warden.jpg')!.async('uint8array');
    const pending = collectLegacyPlanPendingImages(project.entities);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.textureFile, 'warden.jpg');
    assert.ok(Math.abs(Number(pending[0]?.alpha) - 0.5) < 1e-9);

    const assets = [{ path: 'assets/warden.jpg', bytes: assetBytes }];
    assert.ok(findLegacyPlanArchiveAsset(assets, 'warden.jpg'));
    const fileResult = createLegacyPlanImageFile({ pending: pending[0]!, assets });
    assert.ok(!('unresolved' in fileResult));
    assert.equal(fileResult.file.name, 'warden.jpg');
    assert.ok(fileResult.file.size > 0);
});

test('importer collects pending images from fixture archives', async () => {
    const bytes = readFileSync(FIXTURE);
    const result = await new LegacyPlanImporter({
        fixtureName: path.basename(FIXTURE),
    }).importArchive(bytes);

    assert.equal(result.pendingImages.length, 1);
    assert.equal(result.report.unresolvedImageKeys.length, 0);
    assert.equal(result.report.skippedEntityTypes.image, undefined);
    assert.equal(result.archive.assets.length, 1);

    const snapshot = createLegacyPlanImageSpriteSnapshot({
        projectId: 'local-test',
        asset: {
            id: 'asset-1',
            displayName: 'warden.jpg',
            originalFilename: 'warden.jpg',
            mimeType: 'image/jpeg',
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
