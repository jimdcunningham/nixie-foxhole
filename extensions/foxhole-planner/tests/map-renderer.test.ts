import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalDocumentRenderResultV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { renderFoxholePlanningMap } from '../src/scene-v2-map-renderer.ts';
import maps from '../src/scene-v2-map-data-node.ts';

test('saved map rendering selects terrain resources and clipped labels without adding authored entities', () => {
    const request = { contractVersion: 1 as const, settings: { 'foxhole.map.enabled': true, 'foxhole.map.regionKeys': 'DeadLandsHex', 'foxhole.map.background': false,
        'foxhole.map.colors': true, 'foxhole.map.roads': true, 'foxhole.map.crop.enabled': true, 'foxhole.map.crop.x': -500, 'foxhole.map.crop.y': 200,
        'foxhole.map.crop.width': 1000, 'foxhole.map.crop.height': 800 }, viewport: { renderScale: 80 }, theme: 'dark' as const };
    const before = structuredClone(request);
    const result = parseNixieExperimentalDocumentRenderResultV1(renderFoxholePlanningMap(request));
    assert.deepEqual(result.clip, { minX: -500, minY: 200, maxX: 500, maxY: 1000 });
    const region = maps.regions.find(value => value.key === 'DeadLandsHex')!;
    const nodes = result.plan.root.kind === 'group' ? result.plan.root.children : [];
    const terrain = nodes.find(node => node.id === 'region-mapdeadlandshex');
    assert.equal(terrain?.kind, 'group');
    if (terrain?.kind === 'group') {
        assert.deepEqual(terrain.children.map(node => node.kind === 'sprite' ? node.resourceId : null), [region.textures.topo, region.textures.roads]);
    }
    assert.deepEqual(request, before);
    const disabled = renderFoxholePlanningMap({ ...request, settings: { 'foxhole.map.enabled': false } });
    assert.equal(disabled.worldBounds, undefined);
    assert.equal(disabled.clip, undefined);
    assert.deepEqual(disabled.plan.root, { id: 'planning-map', kind: 'group', children: [] });
});
test('all region/layer and zoomed-out background plans remain inside SDK rendering budgets', () => {
    for (const scale of [0.5, 80, 400, 2000]) {
        const settings = { 'foxhole.map.enabled': true, ...Object.fromEntries(['base_map_full', 'roads', 'roads_tiers', 'rdz', 'dark_rdz', 'glaciers', 'bulwark', 'rail_bridge', 'rocks', 'underwater_rocks_stripes'].map(key => [`foxhole.map.${key}`, true])) };
        assert.doesNotThrow(() => parseNixieExperimentalDocumentRenderResultV1(renderFoxholePlanningMap({ contractVersion: 1, settings, viewport: { renderScale: scale }, theme: 'dark' })));
    }
});
