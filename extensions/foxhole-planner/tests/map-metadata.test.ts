import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseNixieExtensionManifestV1, resolveNixieResourceV1 } from '@nixiejs/extension-sdk';
import maps from '../src/scene-v2-map-data-node.ts';
import {catalog} from '../build/catalog-node.ts';
const foxholeMapResources = catalog.sharedResources.filter(row => row.id.startsWith('map.')).map(row => ({...row, id: 'foxhole.map.' + row.id.slice(4)}));
import { createFoxholeSceneV2MapMetadata, foxholeSceneV2MapBounds, foxholeSceneV2MapRegions } from '../src/scene-v2-map-metadata.ts';

test('all catalog map resources resolve through the declared texture template', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
    const warRegions = foxholeSceneV2MapRegions(maps, []);
    const standaloneRegions = maps.regions.filter(region => region.standalone);
    assert.equal(warRegions.length, 53);
    assert.equal(Object.keys(maps.icons).length, 39);
    assert.equal(foxholeMapResources.length, 763 + standaloneRegions.length);
    assert.equal(warRegions.reduce((total, region) => total + region.labels.length, 0), 987);
    assert.equal(warRegions.reduce((total, region) => total + region.staticIcons.length, 0), 135);
    for (const region of standaloneRegions) {
        assert.deepEqual(Object.keys(region.textures), ['terrain']);
        assert.ok(foxholeMapResources.some(resource => resource.id === region.textures.terrain));
    }
    assert.equal(new Set(foxholeMapResources.map(resource => resource.path)).size, foxholeMapResources.length);
    for (const resource of foxholeMapResources) {
        assert.equal(resolveNixieResourceV1(manifest.contributes.resources ?? [],
            manifest.contributes.resourceTemplates ?? [], resource.id)?.path, resource.path, resource.id);
        assert.match(resource.path, /^maps\/[a-z0-9/._-]+\.webp$/);
        assert.match(resource.sha256, /^[a-f0-9]{64}$/);
    }
});

test('standalone Home Regions use processed terrain and require an explicit selection', () => {
    const { metadata, resources } = createFoxholeSceneV2MapMetadata({
        maps: {
            DeadLandsHex: { textureKey: 'MapDeadLandsHex' },
            HomeRegionC: { textureKey: 'MapHomeRegionC', standalone: true, gridCoord: { x: -5, y: 5 } },
        },
        mapIcons: {},
    });
    assert.deepEqual(foxholeSceneV2MapRegions(metadata, []).map(region => region.key), ['DeadLandsHex']);
    const home = foxholeSceneV2MapRegions(metadata, ['HomeRegionC'])[0]!;
    assert.deepEqual(home.textures, { terrain: 'foxhole.map.terrain-maphomeregionc' });
    assert.deepEqual(resources.filter(resource => resource.sourcePath.includes('MapHomeRegionC')).map(resource => resource.sourcePath),
        ['maps/HexMaps/Processed/MapHomeRegionC.webp']);
    assert.notDeepEqual(foxholeSceneV2MapBounds(metadata, [], false), foxholeSceneV2MapBounds(metadata, [home.key], false));
});

test('map bounds retain world and selected-region coordinates without inventing unknown regions', () => {
    const region = maps.regions.find(value => value.key === 'DeadLandsHex')!;
    assert.deepEqual(foxholeSceneV2MapBounds(maps, [region.key], false), { minX: region.x - maps.regionWidth / 2, minY: region.y - maps.regionHeight / 2,
        maxX: region.x + maps.regionWidth / 2, maxY: region.y + maps.regionHeight / 2 });
    assert.deepEqual(foxholeSceneV2MapBounds(maps, [], true), { minX: -maps.worldSize.width / 2, minY: -maps.worldSize.height / 2,
        maxX: maps.worldSize.width / 2, maxY: maps.worldSize.height / 2 });
    assert.deepEqual(foxholeSceneV2MapBounds(maps, ['unresolved-region'], false),
        { minX: -maps.regionWidth / 2, minY: -maps.regionHeight / 2, maxX: maps.regionWidth / 2, maxY: maps.regionHeight / 2 });
});

test('published paths cannot escape build inputs and projected labels are detached', () => {
    assert.throws(() => createFoxholeSceneV2MapMetadata({ maps: { bad: { textureKey: '../outside' } }, mapIcons: {} }), /filename/);
    assert.throws(() => createFoxholeSceneV2MapMetadata({ maps: {}, mapIcons: { bad: { icon: 'https://example.test/icon' } } }), /filename/);
    assert.throws(() => createFoxholeSceneV2MapMetadata({ maps: { bad: { textureKey: 'Unsupported_Value' } }, mapIcons: {} }), /filename/);
    assert.throws(() => createFoxholeSceneV2MapMetadata({ maps: { one: { textureKey: 'Good' }, two: { textureKey: 'good' } }, mapIcons: {} }), /Ambiguous/);
    assert.throws(() => createFoxholeSceneV2MapMetadata({ maps: { bad: { textureKey: 'Good', gridCoord: { x: Infinity } } }, mapIcons: {} }), /coordinates/);
    const input = { maps: { one: { textureKey: 'Good', name: 'Good' } }, mapIcons: {},
        warApiFallback: { maps: { one: { labels: { items: [{ text: 'Town', x: 0.5, y: 0.5 }] } } } } };
    const result = createFoxholeSceneV2MapMetadata(input);
    result.metadata.regions[0]!.labels[0]!.text = 'Changed';
    assert.equal(input.warApiFallback.maps.one.labels.items[0]!.text, 'Town');
});
