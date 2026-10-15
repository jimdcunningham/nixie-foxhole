import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseNixieExperimentalProductResultV1, resolveNixieExperimentalResourceV1 } from '@nixie/extension-sdk';
import { createFoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import { listFoxholeSceneV2Products } from '../../../../../extensions/foxhole-planner/src/scene-v2-products.ts';
import { createNixieExtensionAssetCard, getNixieExtensionAssetCardImages } from '../../../../nixie/app/utils/nixie-extension-asset-card.ts';

function assertSameVisiblePixels(actual: Buffer, expected: Buffer, label: string) {
    // Lossless WebP may discard RGB beneath alpha zero. Those bytes cannot
    // affect rendering; every alpha and every nontransparent RGB byte stays exact.
    const canonical = (bytes: Buffer) => {
        const result = Buffer.from(bytes);
        for (let offset = 0; offset < result.length; offset += 4) {
            if (result[offset + 3] === 0) result.fill(0, offset, offset + 3);
        }
        return createHash('sha256').update(result).digest('hex');
    };
    assert.equal(canonical(actual), canonical(expected), label);
}

test('visible-pixel equality ignores only fully transparent RGB, never alpha or visible color', () => {
    assertSameVisiblePixels(Buffer.from([255, 80, 1, 0]), Buffer.from([0, 0, 0, 0]), 'transparent');
    assert.throws(() => assertSameVisiblePixels(Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 0, 0]), 'alpha'));
    assert.throws(() => assertSameVisiblePixels(Buffer.from([1, 0, 0, 1]), Buffer.from([0, 0, 0, 1]), 'visible'));
});

test('SDK library icons and hover text preserve the visible authored Native assets', async () => {
    const plannerRoot = process.env.NIXIE_FOXHOLE_TEST_RUNTIME_ROOT
        ? pathToFileURL(process.env.NIXIE_FOXHOLE_TEST_RUNTIME_ROOT + '/')
        : hostSourceUrl('../../../../../extensions/foxhole-planner/', import.meta.url);
    const extension = JSON.parse(await readFile(hostSourceUrl('nixie.extension.json', plannerRoot), 'utf8'));
    const root = hostSourceUrl('../../public/foxhole/assets/', import.meta.url);
    const manifest = JSON.parse(await readFile(hostSourceUrl('manifest.v1.json', root), 'utf8'));
    const generated = createFoxholeSceneV2AssetMetadata(manifest);
    const strings = manifest.localizations.find((entry: { locale: string; }) => entry.locale === 'en').strings;
    const samples = [manifest.assets.find((asset: { id: string; }) => asset.id === 'facilityrefinery1'),
        manifest.assets.find((asset: { id: string; }) => asset.id === 'facilityfactoryammo'),
        manifest.assets.find((asset: { id: string; }) => asset.id === 'rifleammo'),
        manifest.assets.find((asset: { isVehicle?: boolean; }) => asset.isVehicle)];
    for (const asset of samples) {
        assert.ok(asset);
        const metadata = generated.assets[asset.id]!;
        assert.equal(metadata.label, strings[asset.name]);
        if (asset.description) {
            assert.equal(metadata.description, strings[asset.description]?.trim() || undefined);
        }
        const color = asset.colors?.[0];
        const colorHex = color?.hex?.replace(/^#/, '').toLowerCase();
        const previewSource = asset.previewUrl ?? (asset.isItem ? asset.icons.rendered ?? asset.icons.default
            : color?.previewUrl ?? `/foxhole/assets/types/${asset.isVehicle ? 'vehicles' : 'structures'}/${asset.id}/${asset.id}.preview${colorHex ? `.${colorHex}` : ''}.webp`);
        for (const [image, source] of [[metadata.browserIcon, asset.icons.default], [metadata.browserPreview, previewSource]] as const) {
            assert.ok(image);
            const resource = resolveNixieExperimentalResourceV1(extension.contributes.experimentalResources ?? [],
                extension.contributes.experimentalResourceTemplates ?? [], image.resourceId);
            assert.equal(resource?.kind, 'texture');
            const sheet = hostSourceUrl(resource!.path, plannerRoot);
            const actual = await sharp(fileURLToPath(sheet)).extract({ left: image.frame.x, top: image.frame.y,
                width: image.frame.width, height: image.frame.height }).ensureAlpha().raw().toBuffer();
            const expected = await sharp(fileURLToPath(hostSourceUrl(source.slice('/foxhole/assets/'.length), root)))
                .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();
            assertSameVisiblePixels(actual, expected, asset.id);
        }
    }
});

test('base factory and Forge use published card previews separately from library icons', async () => {
    const manifest = JSON.parse(await readFile(hostSourceUrl('../../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    const generated = createFoxholeSceneV2AssetMetadata(manifest);
    const factory = generated.assets.facilityrefinery1!;
    const forge = factory.modifications.UpgradeSlotComponent!.variants.forge!;
    const source = (image: NonNullable<typeof factory.browserIcon>) => generated.browserImageSources[
        Number(image.resourceId.split('.').at(-1)) * 64 + image.frame.y / 256 * 8 + image.frame.x / 256];
    assert.equal(source(factory.browserPreview!), '/foxhole/assets/types/structures/facilityrefinery1/facilityrefinery1.preview.webp');
    assert.equal(source(forge.browserPreview!), '/foxhole/assets/types/structures/facilityrefinery1/modifications/forge/forge.preview.webp');
    assert.notDeepEqual(factory.browserIcon, factory.browserPreview);
    assert.notDeepEqual(forge.browserIcon, forge.browserPreview);
});

test('Materials Factory and Forge cards retain observed Native units and cumulative costs', () => {
    const result = listFoxholeSceneV2Products({ contractVersion: 1, query: 'materials factory', offset: 0, limit: 100,
        settings: { 'foxhole.assets.filter.upgrades': true, 'foxhole.assets.filter.showPreviousTiers': true } });
    const factory = result.items.find(item => item.label === 'Materials Factory')!;
    const forge = result.items.find(item => item.label === 'Materials Factory (Forge)')!;
    assert.deepEqual(factory.presentation!.attributes, [
        { label: 'Slots: 15', icon: 'ph:grid-nine-fill', tone: 'accent' },
        { label: 'Decays', icon: 'ph:shield-warning-fill', tone: 'accent' },
        { label: 'Fuel: 5,000', icon: 'ph:gas-pump-fill', tone: 'accent' },
        { label: '-2 MW', icon: 'nx:lightning', tone: 'warning' },
    ]);
    assert.deepEqual(forge.presentation!.costs!.map(cost => [cost.label, cost.value]),
        [['Basic Materials', 'x200'], ['Construction Materials', 'x200']]);
    assert.match(forge.presentation!.description!, /Requires Coke or Petrol/);
    const details = forge.presentation!.details!;
    assert.deepEqual(details.columns, [{ label: 'Inputs', compact: true }, 'Outputs',
        { label: 'Power', compact: true, align: 'center' }, { label: 'Time', compact: true, align: 'center' }]);
    assert.deepEqual(details.rows.map(row => row.slice(2)), Array(2).fill([{ text: '-2 MW', tone: 'warning' }, { text: '1m', tone: 'info' }]));
    const inputs = details.rows[0]![0];
    assert.ok(inputs && typeof inputs !== 'string');
    assert.deepEqual(inputs.resources!.map(resource => [resource.label, resource.value]), [['Coke', 'x75'], ['Salvage', 'x15']]);
    assert.ok(inputs.resources!.every(resource => resource.icon?.resourceId.startsWith('foxhole.browser.')));
    const card = createNixieExtensionAssetCard(forge.presentation!, image => `host:${image.resourceId}`);
    const cell = card.details!.rows[0]![0];
    assert.ok(cell && typeof cell !== 'string');
    assert.match(cell.resources![0]!.iconUrl!, /^host:/);
    assert.equal('icon' in cell.resources![0]!, false);
    assert.ok(getNixieExtensionAssetCardImages(forge.presentation!).includes(inputs.resources![0]!.icon!));
});

test('the full Planner library retains bounded structured recipe presentation', () => {
    const settings = { 'foxhole.assets.filter.upgrades': true, 'foxhole.assets.filter.showPreviousTiers': true };
    let total = 1;
    let lists = 0;
    for (let offset = 0; offset < total; offset += 100) {
        const result = parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products({ contractVersion: 1, query: '', offset, limit: 100, settings }));
        total = result.total;
        lists += result.items.filter(item => item.presentation?.details?.layout === 'list').length;
    }
    assert.ok(total > 700);
    assert.ok(lists > 0);
});
