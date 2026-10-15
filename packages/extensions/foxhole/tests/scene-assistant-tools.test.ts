import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveFoxholeRegionEdgePoint,
    resolveFoxholeMapRegionByQuery,
} from '../app/plugins/foxhole/nixie/map/region-edge.ts';
import {
    FOXHOLE_SCENE_ASSISTANT_TOOLS,
    executeFoxholeSceneAssistantTool,
    resolveFoxholeStructureForScenePlacement,
} from '../app/plugins/foxhole/nixie/scene-assistant-tools.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { extractNixieAssistantClientActionsFromToolResult } from '#nixie/plugins/nixie/assistant/client-actions.ts';

test('foxhole scene tools expose place, connect, edge, and binocular descriptors', () => {
    assert.deepEqual(
        FOXHOLE_SCENE_ASSISTANT_TOOLS.map(tool => tool.name),
        [
            'place_foxhole_structure',
            'connect_foxhole_power',
            'resolve_region_edge',
            'create_foxhole_binocular_line',
        ],
    );
});

test('resolveFoxholeMapRegionByQuery finds Acrithia', () => {
    const region = resolveFoxholeMapRegionByQuery('Acrithia');
    assert.ok(region);
    assert.match(region!.key, /Acrithia/i);
});

test('resolveFoxholeRegionEdgePoint returns a border point toward Acrithia', () => {
    const region = resolveFoxholeMapRegionByQuery('Acrithia');
    assert.ok(region);
    const fromX = 0;
    const fromY = 0;
    const edge = resolveFoxholeRegionEdgePoint({
        fromX,
        fromY,
        towardRegion: 'Acrithia',
    });
    assert.ok(edge);
    assert.equal(edge!.regionKey, region!.key);
    assert.ok(Number.isFinite(edge!.x));
    assert.ok(Number.isFinite(edge!.y));
});

test('resolveFoxholeStructureForScenePlacement matches oil refinery and diesel plant', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const oil = resolveFoxholeStructureForScenePlacement(catalog, { query: 'Oil Refinery' });
    const diesel = resolveFoxholeStructureForScenePlacement(catalog, { query: 'Diesel Power Plant' });
    assert.ok(oil);
    assert.equal(oil!.foxholeKey, 'facilityrefineryoil');
    assert.ok(diesel);
    assert.equal(diesel!.foxholeKey, 'facilitypowerdiesel');
});

test('place_foxhole_structure queues foxhole.scene.mutate', () => {
    const result = executeFoxholeSceneAssistantTool('place_foxhole_structure', {
        query: 'Oil Refinery',
        x: 1000,
        y: 2000,
    }, {
        sceneActive: true,
        sceneId: 'scene_1',
        sceneCanEdit: true,
        baseAssetsUrl: '/foxhole/assets/',
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found: boolean;
        foxholeKey: string;
        clientActions: unknown;
    };
    assert.equal(payload.found, true);
    assert.equal(payload.foxholeKey, 'facilityrefineryoil');
    const actions = extractNixieAssistantClientActionsFromToolResult(payload);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.type, 'foxhole.scene.mutate');
});

test('connect_foxhole_power queues powerline op', () => {
    const result = executeFoxholeSceneAssistantTool('connect_foxhole_power', {
        fromNodeId: 'a',
        toNodeId: 'b',
    }, {
        sceneActive: true,
        sceneId: 'scene_1',
        sceneCanEdit: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const actions = extractNixieAssistantClientActionsFromToolResult(result.result);
    assert.equal(actions[0]?.type, 'foxhole.scene.mutate');
    if (actions[0]?.type === 'foxhole.scene.mutate') {
        assert.equal(actions[0].ops[0]?.op, 'connectPower');
    }
});

test('create_foxhole_binocular_line queues points', () => {
    const result = executeFoxholeSceneAssistantTool('create_foxhole_binocular_line', {
        startX: 1,
        startY: 2,
        endX: 3,
        endY: 4,
    }, {
        sceneActive: true,
        sceneId: 'scene_1',
        sceneCanEdit: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const actions = extractNixieAssistantClientActionsFromToolResult(result.result);
    assert.equal(actions[0]?.type, 'foxhole.scene.mutate');
    if (actions[0]?.type === 'foxhole.scene.mutate') {
        assert.equal(actions[0].ops[0]?.op, 'createBinocularLine');
        if (actions[0].ops[0]?.op === 'createBinocularLine') {
            assert.deepEqual(actions[0].ops[0].points, [1, 2, 3, 4]);
        }
    }
});

test('resolve_region_edge returns coordinates', () => {
    const result = executeFoxholeSceneAssistantTool('resolve_region_edge', {
        towardRegion: 'Acrithia',
        fromX: 0,
        fromY: 0,
    }, {});
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { found: boolean; x: number; y: number; };
    assert.equal(payload.found, true);
    assert.ok(Number.isFinite(payload.x));
    assert.ok(Number.isFinite(payload.y));
});
