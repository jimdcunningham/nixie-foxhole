import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalDocumentRenderResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import maps from '../src/scene-v2-map-data-node.ts';
import { renderFoxholePlanningMapIcons } from '../src/scene-v2-map-icons.ts';
import { renderFoxholePlanningMap } from '../src/scene-v2-map-renderer.ts';

test('published static markers respect local categories/blacklists and settled zoom without changing source data', () => {
    const before = structuredClone(maps);
    const all = renderFoxholePlanningMapIcons(maps, maps.regions, {}, 25);
    assert.equal(all.length, 135);
    assert.equal(renderFoxholePlanningMapIcons(maps, maps.regions, { 'foxhole.map.icons': false }, 25).length, 0);
    assert.equal(renderFoxholePlanningMapIcons(maps, maps.regions, { 'foxhole.map.iconCategories.resources': false }, 25).length, 0);
    assert.equal(renderFoxholePlanningMapIcons(maps, maps.regions, { 'foxhole.map.iconBlacklist': ' -2, -3, -4, -5, -6, -7, -8, -9 ' }, 25).length, 0);
    assert.equal(renderFoxholePlanningMapIcons(maps, maps.regions, {}, 350).length, 0);
    assert.deepEqual(maps, before);
    const ordered = renderFoxholePlanningMap({ contractVersion: 1, settings: { 'foxhole.map.enabled': true, 'foxhole.map.regionKeys': 'DeadLandsHex' },
        viewport: { renderScale: 25 }, theme: 'dark' }).plan.root;
    if (ordered.kind === 'group') {
        const iconIndex = ordered.children.findIndex(node => node.id.startsWith('map-icon-'));
        const labelIndex = ordered.children.findIndex(node => node.id.startsWith('label-'));
        const nameIndex = ordered.children.findIndex(node => node.id.startsWith('name-'));
        assert.ok(iconIndex >= 0 && labelIndex > iconIndex && nameIndex > labelIndex);
    }
    for (const scale of [0.5, 80, 349, 350, 2000]) {
        assert.doesNotThrow(() => parseNixieExperimentalDocumentRenderResultV1(renderFoxholePlanningMap({
            contractVersion: 1, settings: { 'foxhole.map.enabled': true }, viewport: { renderScale: scale }, theme: 'dark' })));
    }
});

test('faction and scorched colors retain precedence, and victory backgrounds remain separate graphics', () => {
    const region = maps.regions[0]!;
    const iconType = '-2';
    for (const [teamId, flags, expected] of [['COLONIALS', 1, 0x516C4B], ['WARDENS', 1, 0x245682], ['COLONIALS', 17, 0x9a4e52], ['NONE', 1, maps.icons[iconType]!.color]] as const) {
        const nodes = renderFoxholePlanningMapIcons(maps, [{ ...region, staticIcons: [{ iconType, x: 0.5, y: 0.5, teamId, flags }] }], { 'foxhole.map.coloredIcons': true }, 40);
        const node = nodes[0]!;
        assert.equal(node.kind, 'group');
        if (node.kind !== 'group') {
            continue;
        }
        assert.deepEqual([node.x, node.y, node.scaleX, node.scaleY], [region.x, region.y, 28, 28]);
        const sprite = node.children.at(-1)!;
        assert.equal(sprite.kind, 'sprite');
        if (sprite.kind === 'sprite') {
            assert.equal(sprite.tint, expected ?? 0xffffff);
        }
        assert.equal(node.children[0]!.kind, 'graphics');
        assert.equal(node.children[0]!.alpha, 0.35);
    }
});
