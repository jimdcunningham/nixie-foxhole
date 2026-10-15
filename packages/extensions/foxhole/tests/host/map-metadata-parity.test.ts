import assert from 'node:assert/strict';
import test from 'node:test';
import maps from '../../../../../extensions/foxhole-planner/src/scene-v2-map-data-node.ts';
import { FOXHOLE_MAP_REGIONS, FOXHOLE_MAP_ICONS, FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT, FOXHOLE_WORLD_BACKGROUND_SIZE,
    getFoxholeRegionPosition } from '../../app/plugins/foxhole/nixie/map/constants.ts';
import { buildFoxholePublishedMapFallbackCache } from '../../app/plugins/foxhole/nixie/map/data.ts';

test('offline Planner metadata retains all Native regions, static markers, labels and icon identities', () => {
    assert.deepEqual(maps.regions.map(region => region.key), FOXHOLE_MAP_REGIONS.map(region => region.key));
    assert.deepEqual([maps.regionWidth, maps.regionHeight, maps.worldSize], [FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT, FOXHOLE_WORLD_BACKGROUND_SIZE]);
    const fallback = buildFoxholePublishedMapFallbackCache();
    for (const region of FOXHOLE_MAP_REGIONS) {
        const actual = maps.regions.find(value => value.key === region.key)!;
        assert.deepEqual({ x: actual.x, y: actual.y }, getFoxholeRegionPosition(region), region.key);
        assert.deepEqual([actual.name, actual.textureKey, actual.gridCoord, actual.showForResistance],
            [region.name, region.textureKey, region.gridCoord, region.showForResistance], region.key);
        assert.deepEqual(actual.staticIcons.map(value => ({ ...value, teamId: value.teamId, flags: value.flags })), region.staticIcons, region.key);
        assert.deepEqual(actual.labels, fallback[region.key]?.labels?.items ?? [], region.key);
    }
    for (const [key, icon] of Object.entries(FOXHOLE_MAP_ICONS)) {
        const { resourceId: _resourceId, tooltipCategory: _category, previewResourceId: _preview, ...actual } = maps.icons[key]!;
        assert.deepEqual(actual, icon, key);
    }
});
