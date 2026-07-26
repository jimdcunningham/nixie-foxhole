import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';

import {
    collectSharedModificationSourceIconKeys,
    collectSharedPublishedIconKeyReferenceCounts,
    coLocateSingleUseHostLocalModificationDefaultIcons,
    inheritParentStructureDefaultIconsForModifications,
    removeUnreferencedPublicIcons,
    resolveHostLocalModificationDefaultIconUrl,
    shouldCoLocateSingleUseModificationDefaultIcon,
    shouldInheritParentStructureDefaultIconForModification,
} from './publish-modification-default-icons.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(currentDir, '../../../tests/fixtures/foxhole/icon-publish');

test('resolveHostLocalModificationDefaultIconUrl derives from rendered path', () => {
    assert.equal(
        resolveHostLocalModificationDefaultIconUrl({
            icons: {
                rendered: '/foxhole/assets/types/structures/facilitymineoil/modifications/electric/electric.icon.rendered.webp',
            },
        }),
        '/foxhole/assets/types/structures/facilitymineoil/modifications/electric/electric.icon.default.webp',
    );
});

test('shouldCoLocateSingleUseModificationDefaultIcon keeps multi-use icons shared', () => {
    const counts = new Map([
        ['facilityelectricoilwellicon', 1],
        ['barbedwirestructureicon', 82],
    ]);

    assert.equal(
        shouldCoLocateSingleUseModificationDefaultIcon(
            '/foxhole/assets/icons/facilityelectricoilwellicon.webp',
            counts,
        ),
        true,
    );
    assert.equal(
        shouldCoLocateSingleUseModificationDefaultIcon(
            '/foxhole/assets/icons/barbedwirestructureicon.webp',
            counts,
        ),
        false,
    );
    assert.equal(
        shouldCoLocateSingleUseModificationDefaultIcon(
            '/foxhole/assets/types/structures/x/modifications/y/y.icon.default.webp',
            counts,
        ),
        false,
    );
});

test('collectSharedPublishedIconKeyReferenceCounts counts mod defaults', () => {
    const counts = collectSharedPublishedIconKeyReferenceCounts({
        assets: [
            {
                id: 'facilitymineoil',
                modifications: [
                    {
                        variants: {
                            electric: {
                                icons: {
                                    default: '/foxhole/assets/icons/facilityelectricoilwellicon.webp',
                                },
                            },
                        },
                    },
                ],
            },
            {
                id: 'trencht2',
                modifications: [
                    {
                        variants: {
                            barbedwire: {
                                icons: {
                                    default: '/foxhole/assets/icons/barbedwirestructureicon.webp',
                                },
                            },
                        },
                    },
                ],
            },
            {
                id: 'trencht1',
                modifications: [
                    {
                        variants: {
                            barbedwire: {
                                icons: {
                                    default: '/foxhole/assets/icons/barbedwirestructureicon.webp',
                                },
                            },
                        },
                    },
                ],
            },
        ],
    });

    assert.equal(counts.get('facilityelectricoilwellicon'), 1);
    assert.equal(counts.get('barbedwirestructureicon'), 2);
});

test('coLocateSingleUseHostLocalModificationDefaultIcons rewrites single-use defaults only', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-mod-default-icons-'));
    const publicAssetsRoot = resolve(tempRoot, 'public/foxhole/assets');
    const iconsRoot = resolve(publicAssetsRoot, 'icons');
    const modDir = resolve(
        publicAssetsRoot,
        'types/structures/facilitymineoil/modifications/electric',
    );
    await mkdir(iconsRoot, { recursive: true });
    await mkdir(modDir, { recursive: true });

    const blueprint = await readFile(resolve(fixtureRoot, 'blueprint-128.png'));
    const iconWebp = await sharp(blueprint).webp({ lossless: true, quality: 100, effort: 6 }).toBuffer();
    await writeFile(resolve(iconsRoot, 'facilityelectricoilwellicon.webp'), iconWebp);
    await writeFile(resolve(iconsRoot, 'barbedwirestructureicon.webp'), iconWebp);

    const manifest = {
        assets: [
            {
                id: 'facilitymineoil',
                modifications: [
                    {
                        variants: {
                            electric: {
                                icons: {
                                    default: '/foxhole/assets/icons/facilityelectricoilwellicon.webp',
                                    rendered: '/foxhole/assets/types/structures/facilitymineoil/modifications/electric/electric.icon.rendered.webp',
                                },
                            },
                        },
                    },
                ],
            },
            {
                id: 'trencht2',
                modifications: [
                    {
                        variants: {
                            barbedwire: {
                                icons: {
                                    default: '/foxhole/assets/icons/barbedwirestructureicon.webp',
                                    rendered: '/foxhole/assets/types/structures/trencht2/modifications/barbedwire/barbedwire.icon.rendered.webp',
                                },
                            },
                        },
                    },
                ],
            },
            {
                id: 'trencht1',
                modifications: [
                    {
                        variants: {
                            barbedwire: {
                                icons: {
                                    default: '/foxhole/assets/icons/barbedwirestructureicon.webp',
                                    rendered: '/foxhole/assets/types/structures/trencht1/modifications/barbedwire/barbedwire.icon.rendered.webp',
                                },
                            },
                        },
                    },
                ],
            },
        ],
    };

    const written = [];
    const result = await coLocateSingleUseHostLocalModificationDefaultIcons(manifest, {
        readIconSource: async (sourceUrl) => {
            const key = sourceUrl.split('/').pop();
            return {
                sourceFilePath: resolve(iconsRoot, key),
                content: await readFile(resolve(iconsRoot, key)),
            };
        },
        writeIconFile: async (outputPath, content) => {
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, content);
            written.push(outputPath);
            return true;
        },
        resolvePublicAssetFilePath: (publicUrl) => resolve(
            publicAssetsRoot,
            String(publicUrl).replace(/^\/?foxhole\/assets\//i, ''),
        ),
    });

    assert.equal(result.coLocatedCount, 1);
    assert.deepEqual([...result.coLocatedIconKeys], ['facilityelectricoilwellicon']);
    assert.equal(
        result.manifest.assets[0].modifications[0].variants.electric.icons.default,
        '/foxhole/assets/types/structures/facilitymineoil/modifications/electric/electric.icon.default.webp',
    );
    assert.equal(
        result.manifest.assets[1].modifications[0].variants.barbedwire.icons.default,
        '/foxhole/assets/icons/barbedwirestructureicon.webp',
    );
    assert.equal(written.length, 1);

    await unlink(resolve(iconsRoot, 'facilityelectricoilwellicon.webp'));
});

test('coLocateSingleUseHostLocalModificationDefaultIcons preserves shared modification source metadata', async () => {
    const defaultIconSources = new Map([
        ['advcoalliquefier-4d35ba008d6a', '/foxhole/assets/icons/facilityadvancedcoalliquefiericon.webp'],
    ]);
    const sharedSources = new Map([
        ['advcoalliquefier-4d35ba008d6a', {
            defaultIconSourceUrl: '/foxhole/assets/icons/facilityadvancedcoalliquefiericon.webp',
        }],
    ]);
    const manifest = {
        assets: [],
        shared: {
            modifications: {
                'advcoalliquefier-4d35ba008d6a': {
                    icons: {
                        default: '/foxhole/assets/shared/modifications/advcoalliquefier-4d35ba008d6a/advcoalliquefier-4d35ba008d6a.icon.default.webp',
                    },
                },
            },
        },
    };
    Object.defineProperty(manifest, '__sharedModificationDefaultIconSourceById', {
        value: defaultIconSources,
        enumerable: false,
        configurable: true,
        writable: false,
    });
    Object.defineProperty(manifest, '__sharedModificationSourceById', {
        value: sharedSources,
        enumerable: false,
        configurable: true,
        writable: false,
    });

    const result = await coLocateSingleUseHostLocalModificationDefaultIcons(manifest, {
        readIconSource: async () => {
            throw new Error('should not read icons when there are no host-local mods');
        },
        writeIconFile: async () => true,
        resolvePublicAssetFilePath: () => null,
    });

    assert.equal(result.coLocatedCount, 0);
    assert.equal(
        result.manifest.__sharedModificationDefaultIconSourceById,
        defaultIconSources,
    );
    assert.equal(
        result.manifest.__sharedModificationSourceById,
        sharedSources,
    );
});

test('shouldInheritParentStructureDefaultIconForModification targets valve and silo insulation', () => {
    assert.equal(
        shouldInheritParentStructureDefaultIconForModification('facilitypipevalve', 'insulation'),
        true,
    );
    assert.equal(
        shouldInheritParentStructureDefaultIconForModification('facilitysilooil', 'insulation'),
        true,
    );
    assert.equal(
        shouldInheritParentStructureDefaultIconForModification('facilitypipe', 'insulation'),
        false,
    );
    assert.equal(
        shouldInheritParentStructureDefaultIconForModification('facilitypipevalve', 'electric'),
        false,
    );
});

test('inheritParentStructureDefaultIconsForModifications copies parent default icons', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-inherit-mod-icon-'));
    const publicAssetsRoot = resolve(tempRoot, 'public');
    const structureDir = resolve(publicAssetsRoot, 'types/structures/facilitypipevalve');
    const modDir = resolve(structureDir, 'modifications/insulation');
    await mkdir(modDir, { recursive: true });

    const blueprint = await readFile(resolve(fixtureRoot, 'blueprint-128.png'));
    const iconWebp = await sharp(blueprint).webp({ lossless: true, quality: 100, effort: 6 }).toBuffer();
    const parentIconPath = resolve(structureDir, 'facilitypipevalve.icon.default.webp');
    await writeFile(parentIconPath, iconWebp);

    const manifest = {
        assets: [
            {
                id: 'facilitypipevalve',
                icons: {
                    default: '/foxhole/assets/types/structures/facilitypipevalve/facilitypipevalve.icon.default.webp',
                },
                modifications: [
                    {
                        variants: {
                            insulation: {
                                icons: {
                                    default: '/foxhole/assets/icons/pipelinesegmenticon.webp',
                                    rendered: '/foxhole/assets/types/structures/facilitypipevalve/modifications/insulation/insulation.icon.rendered.webp',
                                },
                            },
                        },
                    },
                ],
            },
            {
                id: 'facilitypipe',
                icons: {
                    default: '/foxhole/assets/types/structures/facilitypipe/facilitypipe.icon.default.webp',
                },
                modifications: [
                    {
                        variants: {
                            insulation: {
                                icons: {
                                    default: '/foxhole/assets/icons/pipelinesegmenticon.webp',
                                    rendered: '/foxhole/assets/types/structures/facilitypipe/modifications/insulation/insulation.icon.rendered.webp',
                                },
                            },
                        },
                    },
                ],
            },
        ],
    };

    const written = [];
    const result = await inheritParentStructureDefaultIconsForModifications(manifest, {
        readIconSource: async (sourceUrl) => {
            const relative = String(sourceUrl).replace(/^\/?foxhole\/assets\//i, '');
            return {
                sourceFilePath: resolve(publicAssetsRoot, relative),
                content: await readFile(resolve(publicAssetsRoot, relative)),
            };
        },
        writeIconFile: async (outputPath, content) => {
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, content);
            written.push(outputPath);
            return true;
        },
        resolvePublicAssetFilePath: (publicUrl) => resolve(
            publicAssetsRoot,
            String(publicUrl).replace(/^\/?foxhole\/assets\//i, ''),
        ),
    });

    assert.equal(result.inheritedCount, 1);
    assert.equal(
        result.manifest.assets[0].modifications[0].variants.insulation.icons.default,
        '/foxhole/assets/types/structures/facilitypipevalve/modifications/insulation/insulation.icon.default.webp',
    );
    assert.equal(
        result.manifest.assets[1].modifications[0].variants.insulation.icons.default,
        '/foxhole/assets/icons/pipelinesegmenticon.webp',
    );
    assert.equal(written.length, 1);
    assert.deepEqual(
        await readFile(written[0]),
        iconWebp,
    );
});

test('collectSharedModificationSourceIconKeys reads shared-mod blueprint source urls', () => {
    const manifest = { assets: [] };
    Object.defineProperty(manifest, '__sharedModificationDefaultIconSourceById', {
        value: new Map([
            ['bunkbed-47e016ce52d5', '/foxhole/assets/icons/fortimodbunkbedicon.webp'],
        ]),
        enumerable: false,
    });
    Object.defineProperty(manifest, '__sharedModificationSourceById', {
        value: new Map([
            ['bridge-4be359fc14a5', {
                defaultIconSourceUrl: '/foxhole/assets/icons/trenchbridgeicon.webp',
                renderedIconSourceUrl: '/foxhole/assets/shared/modifications/bridge-4be359fc14a5/bridge-4be359fc14a5.icon.rendered.webp',
            }],
        ]),
        enumerable: false,
    });

    assert.deepEqual(
        [...collectSharedModificationSourceIconKeys(manifest)].sort(),
        ['fortimodbunkbedicon', 'trenchbridgeicon'],
    );
});

test('removeUnreferencedPublicIcons deletes only icons outside the keep set', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-unreferenced-icons-'));
    const iconsRoot = resolve(tempRoot, 'icons');
    await mkdir(iconsRoot, { recursive: true });
    await writeFile(resolve(iconsRoot, 'keepme.webp'), Buffer.from('keep'));
    await writeFile(resolve(iconsRoot, 'fortimodbunkbedicon.webp'), Buffer.from('orphan'));
    await writeFile(resolve(iconsRoot, 'readme.txt'), Buffer.from('ignore'));

    const removed = [];
    const count = await removeUnreferencedPublicIcons(
        iconsRoot,
        new Set(['keepme']),
        {
            pathExists: async () => true,
            unlink: async (filePath) => {
                removed.push(filePath.replace(/\\/g, '/').split('/').pop());
            },
            walkFiles: async function* walk(directory) {
                yield resolve(directory, 'keepme.webp');
                yield resolve(directory, 'fortimodbunkbedicon.webp');
                yield resolve(directory, 'readme.txt');
            },
        },
    );

    assert.equal(count, 1);
    assert.deepEqual(removed, ['fortimodbunkbedicon.webp']);
});

test('removeUnreferencedPublicIcons skips when keep set is empty', async () => {
    const count = await removeUnreferencedPublicIcons(
        '/tmp/unused',
        new Set(),
        {
            pathExists: async () => true,
            unlink: async () => {
                throw new Error('should not unlink');
            },
            walkFiles: async function* () {
                yield '/tmp/unused/fortimodbunkbedicon.webp';
            },
        },
    );

    assert.equal(count, 0);
});
