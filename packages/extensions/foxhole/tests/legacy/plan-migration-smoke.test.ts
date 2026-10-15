import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '../../app/plugins/foxhole/nixie/spline-connector.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const smokeFixturePath = join(__dirname, '../fixtures/legacy-plans/migration-smoke.json');

test('migration smoke fixture preserves representative legacy planning data', async () => {
    const save = JSON.parse(readFileSync(smokeFixturePath, 'utf8')) as LegacyPlanSave;
    const result = await new LegacyPlanImporter().importSave(save, { fixtureName: 'migration-smoke' });

    assert.equal(result.boardSnapshots.length, 6);
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
    assert.deepEqual(result.report.unresolvedSocketIds, []);
    assert.deepEqual(result.report.unmatchedModslots, []);
    assert.deepEqual(result.report.unresolvedCargoKeys, []);
    assert.deepEqual(result.stubDocument.projectSettings, {
        'foxhole.map.enabled': true,
        'foxhole.map.shardId': 'live-2',
        'foxhole.map.regionKeys': 'DeadLands',
    });

    const frontFort = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-1');
    const backFort = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-2');
    assert.ok(frontFort);
    assert.ok(backFort);
    assert.equal(frontFort.state.x, 100);
    assert.equal(frontFort.state.y, 200);
    assert.equal(frontFort.state.z, 20);
    assert.ok(Math.abs(Number(frontFort.state.rotation) - (Math.PI / 2)) < 1e-9);
    assert.deepEqual(frontFort.state.socketAttachments?.LeftFortSocket, {
        nodeId: 'legacy-2',
        socketName: 'RightFortSocket',
    });

    const pipe = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-3');
    assert.ok(pipe);
    assert.equal(pipe.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.equal(pipe.state.foxholeKey, 'facilitypipe');

    const forge = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-4');
    assert.equal(forge?.state.modificationVariantIds?.UpgradeSlotComponent, 'forge');

    const transfer = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-5');
    assert.deepEqual([...(transfer?.state.markedItemCodenames ?? [])].sort(), ['Coal', 'Metal']);

    const train = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-6');
    assert.equal(train?.state.foxholeKey, 'trainlrartillery');
    assert.equal(train?.state.z, 15);
});
