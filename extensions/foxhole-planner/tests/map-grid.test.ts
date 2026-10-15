import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalDocumentRenderResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholePlanningGrid } from '../src/scene-v2-map-grid.ts';

test('planning grids stay derived, pick only displayed regions and retain clipped/zoomed-out behavior', () => {
    const request = { contractVersion: 1 as const, settings: { 'foxhole.map.enabled': true, 'foxhole.map.grid': true, 'foxhole.map.regionKeys': 'DeadLandsHex',
        'foxhole.map.crop.enabled': true, 'foxhole.map.crop.x': -1000, 'foxhole.map.crop.y': -2000, 'foxhole.map.crop.width': 4000, 'foxhole.map.crop.height': 5000 },
    viewport: { renderScale: 50, pointer: { x: 3000, y: 5000 }, visibleBounds: { minX: -5000, minY: -8000, maxX: 9000, maxY: 10000 } }, theme: 'dark' as const };
    const before = structuredClone(request);
    const result = parseNixieExperimentalDocumentRenderResultV1(renderFoxholePlanningGrid(request));
    assert.deepEqual(result.clip, { minX: -1000, minY: -2000, maxX: 3000, maxY: 3000 });
    assert.equal(result.worldBounds, undefined);
    assert.ok(result.plan.root.children.length);
    assert.deepEqual(request, before);
    for (const changes of [{ settings: { ...request.settings, 'foxhole.map.grid': false } }, { viewport: { ...request.viewport, renderScale: 100 } },
        { settings: { ...request.settings, 'foxhole.map.regionKeys': 'unknown' } }]) {
        assert.deepEqual(renderFoxholePlanningGrid({ ...request, ...changes }).plan.root.children, []);
    }
});
