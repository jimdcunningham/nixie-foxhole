import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';
import { buildFoxholeItemCatalog, buildFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';
import { resolveFacilityPipeSideSocketPlacements, resolveConnectorPathStyle, resolveConnectorSpanCrossHalfWidth } from '../../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import { resolveFoxholeSplinePathConstraints } from '../../app/plugins/foxhole/nixie/spline-connector-guides.ts';
import { resolveEffectiveConnectorPathStyle, resolveConnectorSocketSnapStemRotation, FOXHOLE_BOARD_SPRITE_SCALE } from '../../app/plugins/foxhole/nixie/spline-connector.ts';
import { resolveFoxholeSplineConnectorRenderLayers } from '../../app/plugins/foxhole/nixie/spline-connector-upgrade-layers.ts';
import type { FoxholeSplineConnectorState } from '../../app/plugins/foxhole/nixie/spline-connector.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';
import { resolveFoxholeBuildSocketPosition } from '../../app/plugins/foxhole/nixie/structure-socket-resolution.ts';
import { resolveFacilityPipeSideSocketsFromPath } from '../../app/plugins/foxhole/nixie/connector-side-sockets.ts';
import { resolveLegacyPlanSocketName } from '../../app/plugins/foxhole/legacy/plan-socket-id-map.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');
const structureCatalog = buildFoxholeStructureCatalog(manifest);
const itemCatalog = buildFoxholeItemCatalog(manifest);

function worldPoint(state: FoxholeSplineConnectorState, local: { x: number; y: number; }) {
    const cos = Math.cos(state.rotation);
    const sin = Math.sin(state.rotation);
    return { x: state.x + local.x * cos - local.y * sin, y: state.y + local.x * sin + local.y * cos };
}

test('legacy pipe side IDs retain their physical side in Nixie', () => {
    const sockets = resolveFacilityPipeSideSocketsFromPath({
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        lengths: [0, 100],
        totalLength: 100,
    }, 8);
    // Foxhole Planner uses the curve's normal at t=.5. For a rightward span,
    // its socket rotations 180° and 0° place IDs 1 and 2 at y=+8 and y=-8.
    for (const key of ['pipeline', 'pipeline_insulation']) {
        for (const [id, legacyY] of [[1, 8], [2, -8]] as const) {
            const name = resolveLegacyPlanSocketName(key, id);
            const socket = sockets.find(candidate => candidate.name === name);
            assert.ok(socket);
            assert.ok(Math.abs(socket.y - legacyY) < 1e-9, `${key} socket ${id} mapped to the opposite side`);
        }
    }
});

test('repositions an underground pipe endpoint connected to a ground pipe midpoint', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            { id: 11, key: 'pipeline', x: 230.936, y: -5.547, rotation: 0, layer: 0, sortOffset: 7,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 1.064, y: 132.878, rotation: 0 }],
                connections: { 1: { 12: 1 } } },
            { id: 12, key: 'pipeline_underground', x: 166.936, y: -149.547, rotation: 0, layer: 0, sortOffset: 6,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 91, y: 211, rotation: 179.541 }],
                connections: { 1: { 11: 1 } } },
        ],
    };
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave(save);
    const pipe = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-11')?.state as FoxholeSplineConnectorState;
    const underground = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-12')?.state as FoxholeSplineConnectorState;
    assert.ok(pipe && underground);

    const structure = structureCatalog.structureByKey[pipe.foxholeKey]!;
    const asset = structureCatalog.assetByKey[pipe.foxholeKey]!;
    const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(structure.connector), pipe.foxholeKey);
    const layers = resolveFoxholeSplineConnectorRenderLayers({ asset, modificationVariantIds: pipe.modificationVariantIds });
    const span = layers.find(layer => layer.id.toLowerCase() === 'span') ?? layers.find(layer => layer.id.toLowerCase() === 'underlay');
    const side = resolveFacilityPipeSideSocketPlacements(pipe.start, pipe.end,
        resolveFoxholeSplinePathConstraints(pipe, pathStyle, structure.connector?.maxBufferCm ?? structure.connector?.minLengthCm ?? 0),
        pathStyle, pipe.foxholeKey, { lateralOffset: resolveConnectorSpanCrossHalfWidth(span, FOXHOLE_BOARD_SPRITE_SCALE) })
        .find(socket => socket.name === 'RightSocket');
    assert.ok(side);
    const target = worldPoint(pipe, side);
    assert.deepEqual(underground.socketAttachments?.FrontSocket, { nodeId: 'legacy-11', socketName: 'RightSocket' });
    const actual = worldPoint(underground, underground.end);
    assert.ok(Math.hypot(target.x - actual.x, target.y - actual.y) < 0.75,
        `underground pipe endpoint is ${Math.hypot(target.x - actual.x, target.y - actual.y).toFixed(3)} px from pipe side socket`);
});

test('aligns imported power-line endpoints to fixed power sockets', async () => {
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave({
        version: '1.0.5',
        entities: [
            { id: 1, key: 'power_box', x: 0, y: 0, rotation: 0, connections: { 0: { 2: 0 } } },
            { id: 2, key: 'power_line', x: 100, y: 0, rotation: 0,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 100, y: 0, rotation: 0 }],
                connections: { 0: { 1: 0 }, 1: { 3: 0 } } },
            { id: 3, key: 'power_box', x: 250, y: 0, rotation: 0, connections: { 0: { 2: 1 } } },
        ],
    });
    const box = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-1')?.state as { x: number; y: number; foxholeKey: string; };
    const line = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-2')?.state as FoxholeSplineConnectorState;
    const socket = structureCatalog.structureByKey[box.foxholeKey]?.buildSockets.find(candidate => candidate.name === 'PowerSocket');
    assert.ok(box && line && socket);
    const position = resolveFoxholeBuildSocketPosition(socket)!;
    const target = { x: box.x + position.x * 0.32, y: box.y + position.y * 0.32 };
    const actual = worldPoint(line, line.start);
    assert.ok(Math.hypot(target.x - actual.x, target.y - actual.y) < 0.75);
    assert.deepEqual(line.startAttachment, { nodeId: 'legacy-1', socketName: 'PowerSocket' });
    const otherBox = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-3')?.state as { x: number; y: number; };
    const otherTarget = { x: otherBox.x + position.x * 0.32, y: otherBox.y + position.y * 0.32 };
    const otherActual = worldPoint(line, line.end);
    assert.ok(Math.hypot(otherTarget.x - otherActual.x, otherTarget.y - otherActual.y) < 0.75);
    assert.deepEqual(line.endAttachment, { nodeId: 'legacy-3', socketName: 'PowerSocket' });
});

test('disconnects an impossible pipe side link while keeping fixed structures in place', async () => {
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave({
        version: '1.0.5',
        entities: [
            { id: 1, key: 'stationary_harvester_coal', x: 0, y: 0, rotation: 0, connections: { 0: { 4: 0 } } },
            { id: 2, key: 'stationary_harvester_coal', x: 200, y: 0, rotation: 0, connections: { 0: { 4: 3 } } },
            { id: 3, key: 'stationary_harvester_coal', x: 1000, y: 0, rotation: 0, connections: { 0: { 4: 1 } } },
            { id: 4, key: 'pipeline', x: 0, y: 0, rotation: 0,
                bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 200, y: 0, rotation: 0 }],
                connections: { 0: { 1: 0 }, 3: { 2: 0 }, 1: { 3: 0 } } },
        ],
    });
    for (const id of [1, 2, 3]) {
        const state = result.boardSnapshots.find(snapshot => snapshot.id === `legacy-${id}`)?.state as { socketAttachments?: Record<string, unknown>; };
        if (id === 3) {
            assert.deepEqual(state.socketAttachments, {});
        } else {
            assert.ok(state.socketAttachments?.PipeInput0);
        }
    }
    assert.equal(result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-4')?.state.socketAttachments?.RightSocket, undefined);
    assert.equal(result.report.unresolvedSocketFindings.at(-1)?.reason, 'misaligned_after_import');
    assert.equal(result.report.hasReportableFindings, true);
    assert.equal(result.report.issueCount, 1);
});

test('leaves unrelated structural links to their existing import rules', async () => {
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave({
        version: '1.0.5',
        entities: [
            { id: 1, key: 'stationary_harvester_coal', x: 0, y: 0, rotation: 0, connections: { 0: { 2: 0 } } },
            { id: 2, key: 'stationary_harvester_coal', x: 200, y: 0, rotation: 0, connections: { 0: { 1: 0 } } },
        ],
    });
    assert.deepEqual(result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-1')?.state.socketAttachments?.PipeInput0,
        { nodeId: 'legacy-2', socketName: 'PipeInput0' });
    assert.equal(result.report.unresolvedSocketFindings.length, 0);
});

test('cascades a pipe-side correction through connected small structures', async () => {
    const entities: NonNullable<LegacyPlanSave['entities']> = [
        { id: 1, key: 'stationary_harvester_coal', x: 0, y: 0, rotation: 0, connections: { 0: { 2: 0 } } },
        { id: 2, key: 'pipeline', x: 100, y: 100, rotation: 0,
            bezier: [{ x: 0, y: 0, rotation: 180 }, { x: 200, y: 0, rotation: 0 }],
            connections: { 0: { 1: 0 }, 1: { 3: 0 } } },
        { id: 3, key: 'pipeline_valve', x: 0, y: 200, rotation: 0,
            connections: { 0: { 2: 1 }, 1: { 4: 0 } } },
        { id: 4, key: 'pipeline_valve', x: 0, y: 250, rotation: 0,
            connections: { 0: { 3: 1 } } },
    ];
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave({ version: '1.0.5', entities });
    const baseline = await importer.importSave({ version: '1.0.5', entities: entities.map(entity => ({ ...entity, connections: {} })) });
    const state = (id: number, snapshots = result.boardSnapshots) => snapshots.find(snapshot => snapshot.id === `legacy-${id}`)?.state as FoxholeSplineConnectorState;
    const firstValve = state(3);
    const secondValve = state(4);
    assert.ok(Math.hypot(firstValve.x - state(3, baseline.boardSnapshots).x,
        firstValve.y - state(3, baseline.boardSnapshots).y) > 1);
    assert.ok(Math.hypot(secondValve.x - state(4, baseline.boardSnapshots).x,
        secondValve.y - state(4, baseline.boardSnapshots).y) > 1);
    const firstFront = structureCatalog.structureByKey[firstValve.foxholeKey]?.buildSockets.find(socket => socket.name === 'FrontSocket');
    const secondBack = structureCatalog.structureByKey[secondValve.foxholeKey]?.buildSockets.find(socket => socket.name === 'BackSocket');
    assert.ok(firstFront && secondBack);
    const firstPosition = resolveFoxholeBuildSocketPosition(firstFront);
    const secondPosition = resolveFoxholeBuildSocketPosition(secondBack);
    assert.ok(firstPosition && secondPosition);
    const firstWorld = worldPoint(firstValve, { x: firstPosition.x * 0.32, y: firstPosition.y * 0.32 });
    const secondWorld = worldPoint(secondValve, { x: secondPosition.x * 0.32, y: secondPosition.y * 0.32 });
    assert.ok(Math.hypot(firstWorld.x - secondWorld.x, firstWorld.y - secondWorld.y) < 0.75);
    assert.deepEqual(secondValve.socketAttachments?.BackSocket, { nodeId: 'legacy-3', socketName: 'FrontSocket' });
    assert.equal(result.report.unresolvedSocketFindings.length, 0);
});

test('keeps a facility fixed while cascading a corrected pipe midpoint through a valve', async () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/legacy-plans/extracted/bp-077c528c-7ae1-489b-82eb-4f8e04c62155.json', import.meta.url), 'utf8')) as LegacyPlanSave;
    const ids = new Set([13, 45, 49, 53]);
    const entities = (fixture.entities ?? []).filter(entity => ids.has(entity.id)).map(entity => ({
        ...entity,
        connections: Object.fromEntries(Object.entries(entity.connections ?? {}).flatMap(([socket, peers]) => {
            const kept = Object.fromEntries(Object.entries(peers ?? {}).filter(([id]) => ids.has(Number(id))));
            return Object.keys(kept).length ? [[socket, kept]] : [];
        })),
    }));
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave({ version: '1.0.5', entities });
    const baseline = await importer.importSave({ version: '1.0.5', entities: entities.map(entity => ({ ...entity, connections: {} })) });
    const state = (id: number, snapshots = result.boardSnapshots) => snapshots.find(snapshot => snapshot.id === `legacy-${id}`)?.state as FoxholeSplineConnectorState;
    const factory = state(45);
    const valve = state(49);
    const pipe = state(13);
    const branch = state(53);
    assert.ok(factory && valve && pipe && branch);
    assert.deepEqual({ x: factory.x, y: factory.y }, { x: state(45, baseline.boardSnapshots).x, y: state(45, baseline.boardSnapshots).y });
    assert.ok(Math.hypot(valve.x - state(49, baseline.boardSnapshots).x, valve.y - state(49, baseline.boardSnapshots).y) > 1,
        'valve should follow the corrected midpoint instead of staying at its legacy position');
    const structure = structureCatalog.structureByKey[pipe.foxholeKey]!;
    const asset = structureCatalog.assetByKey[pipe.foxholeKey]!;
    const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(structure.connector), pipe.foxholeKey);
    const layers = resolveFoxholeSplineConnectorRenderLayers({ asset, modificationVariantIds: pipe.modificationVariantIds });
    const span = layers.find(layer => layer.id.toLowerCase() === 'span') ?? layers.find(layer => layer.id.toLowerCase() === 'underlay');
    const side = resolveFacilityPipeSideSocketPlacements(pipe.start, pipe.end,
        resolveFoxholeSplinePathConstraints(pipe, pathStyle, structure.connector?.maxBufferCm ?? structure.connector?.minLengthCm ?? 0),
        pathStyle, pipe.foxholeKey, { lateralOffset: resolveConnectorSpanCrossHalfWidth(span, FOXHOLE_BOARD_SPRITE_SCALE) })
        .find(socket => socket.name === 'RightSocket');
    assert.ok(side);
    const sideWorld = worldPoint(pipe, side);
    assert.ok(Math.hypot(sideWorld.x - valve.x, sideWorld.y - valve.y) < 0.75);
    assert.ok(valve.socketAttachments?.BackSocket);
    const valveBack = structureCatalog.structureByKey[valve.foxholeKey]?.buildSockets.find(socket => socket.name === 'BackSocket');
    assert.ok(valveBack);
    const facingError = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b - Math.PI), Math.cos(a - b - Math.PI)));
    assert.ok(facingError(pipe.rotation + side.rotation, valve.rotation + (Number(valveBack.rotation ?? 0) * Math.PI / 180)) < 1e-3,
        'the moved valve should rotate so its back socket faces the pipe midpoint');
    assert.ok(branch.socketAttachments?.FrontSocket);
    const valveFront = structureCatalog.structureByKey[valve.foxholeKey]?.buildSockets.find(socket => socket.name === 'FrontSocket');
    assert.ok(valveFront);
    const frontPosition = resolveFoxholeBuildSocketPosition(valveFront);
    assert.ok(frontPosition);
    const frontWorld = worldPoint(valve, { x: frontPosition.x * 0.32, y: frontPosition.y * 0.32 });
    const branchWorld = worldPoint(branch, branch.end);
    assert.ok(Math.hypot(frontWorld.x - branchWorld.x, frontWorld.y - branchWorld.y) < 0.75,
        'the branch pipe should follow the moved valve');
    assert.ok(facingError(valve.rotation + (Number(valveFront.rotation ?? 0) * Math.PI / 180),
        resolveConnectorSocketSnapStemRotation('end', branch.end.rotation, branch.rotation, branch.foxholeKey)) < 1e-3,
    'the branch pipe handle should turn to face the valve socket');
    assert.equal(result.report.unresolvedSocketFindings.length, 0);
});
