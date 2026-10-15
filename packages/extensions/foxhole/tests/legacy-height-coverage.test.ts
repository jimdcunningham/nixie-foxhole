import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_PLAN_BUILDING_KEY_MAP } from '../app/plugins/foxhole/legacy/plan-building-key-map.ts';
import { getFoxholeStructureAsset } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeStructurePrimaryRenderLane } from '../app/plugins/foxhole/nixie/render-lanes.ts';

test('both legacy AA guns resolve to published assets at vehicle height', () => {
    for (const [oldId, newId] of [['emplacedaircraftc', 'emplacedaac'], ['emplacedaircraftw', 'emplacedaaw']]) {
        const mapped = LEGACY_PLAN_BUILDING_KEY_MAP[oldId!];
        assert.equal(mapped, newId);
        const asset = getFoxholeStructureAsset(mapped!);
        assert.ok(asset);
        assert.ok(resolveFoxholeStructurePrimaryRenderLane(mapped).laneOrder
            > resolveFoxholeStructurePrimaryRenderLane('facilityrefinery1').laneOrder);
    }
});
