import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';
import { resolveLegacyPlanSocketName } from '../../app/plugins/foxhole/legacy/plan-socket-id-map.ts';
import { buildFoxholeItemCatalog, buildFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';
import type { FoxholeSplineConnectorState } from '../../app/plugins/foxhole/nixie/spline-connector.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

test('maps base and insulated pipe ends to the imported spline endpoints', () => {
    for (const key of ['pipeline', 'pipeline_insulation']) {
        assert.equal(resolveLegacyPlanSocketName(key, 0), 'BackSocket');
        assert.equal(resolveLegacyPlanSocketName(key, 1), 'RightSocket');
        assert.equal(resolveLegacyPlanSocketName(key, 2), 'LeftSocket');
        assert.equal(resolveLegacyPlanSocketName(key, 3), 'FrontSocket');
    }
    for (const key of ['stationary_harvester_coal', 'stationary_harvester_coal_excavator', 'facilitymineresource4']) {
        assert.equal(resolveLegacyPlanSocketName(key, 0), 'PipeInput0');
    }
    for (const key of ['pipeline_underground', 'pipeline_underground_insulation',
        'pipeline_overhead', 'pipeline_overhead_insulation', 'power_line']) {
        assert.equal(resolveLegacyPlanSocketName(key, 0), 'BackSocket');
        assert.equal(resolveLegacyPlanSocketName(key, 1), 'FrontSocket');
    }
});

test('imports coal miners and branched pipes with reciprocal socket attachments', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            { id: 51, key: 'stationary_harvester_coal', x: -1056, y: -576, rotation: 0, layer: 0, sortOffset: 40, connections: { 0: { 58: 0 } } },
            { id: 52, key: 'stationary_harvester_coal', x: -864, y: -576, rotation: 0, layer: 0, sortOffset: 41, connections: { 0: { 56: 0 } } },
            { id: 53, key: 'stationary_harvester_coal', x: -672, y: -576, rotation: 0, layer: 0, sortOffset: 42, connections: { 0: { 57: 0 } } },
            { id: 57, key: 'pipeline', x: -610.41, y: -457.615, rotation: 90, layer: 0, sortOffset: 32,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 74, y: 206, rotation: -165.53 }],
                connections: { 0: { 53: 0 }, 3: { 58: 2 } } },
            { id: 56, key: 'pipeline', x: -802.41, y: -457.615, rotation: 90, layer: 0, sortOffset: 33,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 128.612, y: -382.219, rotation: 90 }],
                connections: { 0: { 52: 0 }, 1: { 58: 3 } } },
            { id: 58, key: 'pipeline', x: -994.41, y: -457.615, rotation: 90, layer: 0, sortOffset: 34,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 92, y: -361, rotation: 14.712 }],
                connections: { 0: { 51: 0 }, 2: { 57: 3 }, 3: { 56: 1 } } },
        ],
    };
    const manifest = getFoxholeManifest('/foxhole/assets/');
    const importer = new LegacyPlanImporter({
        structureCatalog: buildFoxholeStructureCatalog(manifest),
        itemCatalog: buildFoxholeItemCatalog(manifest),
        fixtureName: 'coal-miner-pipe-wiring',
    });
    const result = await importer.importSave(save);
    const state = (id: number) => {
        const snapshot = result.boardSnapshots.find(node => node.id === `legacy-${id}`);
        assert.ok(snapshot, `missing legacy-${id}`);
        return snapshot.state as FoxholeSplineConnectorState;
    };
    const attachments = (id: number) => state(id).socketAttachments;

    assert.equal(result.report.unresolvedSocketFindings.length, 0);
    for (const [miner, pipe] of [[51, 58], [52, 56], [53, 57]]) {
        assert.deepEqual(attachments(miner)?.PipeInput0, { nodeId: `legacy-${pipe}`, socketName: 'BackSocket' });
        assert.deepEqual(attachments(pipe)?.BackSocket, { nodeId: `legacy-${miner}`, socketName: 'PipeInput0' });
        assert.deepEqual(state(pipe).startAttachment, { nodeId: `legacy-${miner}`, socketName: 'PipeInput0' });
    }
    assert.deepEqual(attachments(58)?.LeftSocket, { nodeId: 'legacy-57', socketName: 'FrontSocket' });
    assert.deepEqual(attachments(57)?.FrontSocket, { nodeId: 'legacy-58', socketName: 'LeftSocket' });
    assert.deepEqual(attachments(58)?.FrontSocket, { nodeId: 'legacy-56', socketName: 'RightSocket' });
    assert.deepEqual(attachments(56)?.RightSocket, { nodeId: 'legacy-58', socketName: 'FrontSocket' });
    assert.deepEqual(state(57).endAttachment, { nodeId: 'legacy-58', socketName: 'LeftSocket' });
    assert.deepEqual(state(58).endAttachment, { nodeId: 'legacy-56', socketName: 'RightSocket' });
});
