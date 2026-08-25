import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    DEFAULT_BLENDER_BATCH_LIMITS,
    MEBIBYTE,
    analyzeBlenderSceneIndex,
    createBlenderSceneBatches,
    createWeightedBlenderBatches,
    orderBlenderGroupsByObservedCost,
    resolveBlenderBatchSceneLimit,
} from './blender-batches.mjs';

describe('FoxWatch Blender process batching', () => {
    it('keeps every structure dependency group in one process', () => {
        const batches = createBlenderSceneBatches({
            scenes: [
                { structureId: 'alpha', outputPath: 'alpha/components/left.scene.json' },
                { structureId: 'alpha', outputPath: 'alpha/components/right.scene.json' },
                { structureId: 'bravo', outputPath: 'bravo/scene.json' },
                { structureId: 'charlie', outputPath: 'charlie/scene.json' },
            ],
        }, { maxScenes: 2 });

        assert.deepEqual(batches, [
            {
                dependencyGroups: ['alpha'],
                sceneEntries: [
                    'alpha/components/left.scene.json',
                    'alpha/components/right.scene.json',
                ],
            },
            {
                dependencyGroups: ['bravo', 'charlie'],
                sceneEntries: ['bravo/scene.json', 'charlie/scene.json'],
            },
        ]);
    });

    it('allows one oversized dependency group instead of splitting it', () => {
        const batches = createBlenderSceneBatches({
            scenes: [
                { structureId: 'fortt3', outputPath: 'fortt3/components/a.scene.json' },
                { structureId: 'fortt3', outputPath: 'fortt3/components/b.scene.json' },
                { structureId: 'fortt3', outputPath: 'fortt3/components/c.scene.json' },
            ],
        }, { maxScenes: 2 });

        assert.equal(batches.length, 1);
        assert.equal(batches[0].sceneEntries.length, 3);
    });

    it('rejects duplicate scene entries so no output is rendered twice', () => {
        assert.throws(() => createBlenderSceneBatches({
            scenes: [
                { structureId: 'alpha', outputPath: 'alpha/scene.json' },
                { structureId: 'alpha', outputPath: 'alpha/scene.json' },
            ],
        }), /duplicate outputPath/);
    });

    it('uses a bounded default and validates overrides', () => {
        assert.equal(resolveBlenderBatchSceneLimit(undefined), 32);
        assert.equal(resolveBlenderBatchSceneLimit('75'), 75);
        assert.throws(() => resolveBlenderBatchSceneLimit('0'), /positive integer/);
        assert.throws(() => resolveBlenderBatchSceneLimit('many'), /positive integer/);
    });

    it('builds deterministic weighted batches without splitting dependency groups', () => {
        const groups = [
            group('alpha', 12, 20 * MEBIBYTE, 100, 2),
            group('bravo', 10, 20 * MEBIBYTE, 100, 2),
            group('charlie', 12, 20 * MEBIBYTE, 100, 2),
        ];
        const batches = createWeightedBlenderBatches(groups);

        assert.deepEqual(batches.map(batch => batch.dependencyGroups), [
            ['alpha', 'bravo'],
            ['charlie'],
        ]);
        assert.equal(batches[0].sceneEntries.length, 22);
        assert.equal(batches[0].uniqueMeshBytes, 40 * MEBIBYTE);
    });

    it('moves previously expensive dependency groups forward without reordering unknown peers', () => {
        const groups = [group('alpha', 1, 1, 1, 0), group('bravo', 1, 1, 1, 0), group('charlie', 1, 1, 1, 0)];
        assert.deepEqual(orderBlenderGroupsByObservedCost(groups, {
            groups: { charlie: { estimateMs: 40_000 } },
        }).map(entry => entry.dependencyGroup), ['charlie', 'alpha', 'bravo']);
    });

    it('runs heavy dependency groups alone', () => {
        const batches = createWeightedBlenderBatches([
            group('light-a', 4, 2 * MEBIBYTE, 20, 1),
            group('naval', 2, DEFAULT_BLENDER_BATCH_LIMITS.heavyMeshBytes, 80, 0),
            group('light-b', 4, 2 * MEBIBYTE, 20, 1),
        ]);

        assert.deepEqual(batches.map(batch => ({ groups: batch.dependencyGroups, exclusive: batch.exclusive })), [
            { groups: ['light-a'], exclusive: false },
            { groups: ['naval'], exclusive: true },
            { groups: ['light-b'], exclusive: false },
        ]);
    });

    it('runs a node-heavy group and an oversized ordinary group exclusively', () => {
        const batches = createWeightedBlenderBatches([
            group('node-heavy', 2, 1 * MEBIBYTE, DEFAULT_BLENDER_BATCH_LIMITS.heavyNodes, 0),
            group('oversized', 33, 1 * MEBIBYTE, 20, 0),
        ]);

        assert.equal(batches.length, 2);
        assert.ok(batches.every(batch => batch.exclusive));
        assert.equal(batches[0].heavy, true);
        assert.equal(batches[1].heavy, false);
    });

    it('enforces default-icon and node caps for ordinary batches', () => {
        const batches = createWeightedBlenderBatches([
            group('alpha', 2, 1, 100, 7),
            group('bravo', 2, 1, 100, 2),
            group('charlie', 2, 1, 550, 1),
        ], { heavyNodes: 1_000 });

        assert.deepEqual(batches.map(batch => batch.dependencyGroups), [
            ['alpha'],
            ['bravo'],
            ['charlie'],
        ]);
    });

    it('analyzes unique mesh bytes, recursive nodes, and generated icons', async () => {
        const index = {
            scenes: [
                { structureId: 'alpha', outputPath: 'alpha/base.scene.json' },
                { structureId: 'alpha', outputPath: 'alpha/component.scene.json' },
            ],
        };
        const documents = {
            'base.scene.json': sceneDocument('alpha', 'alpha', ['one.glb', 'shared.glb'], 2, true),
            'component.scene.json': sceneDocument('alpha', 'components/part', ['shared.glb'], 3, false),
        };
        const analysis = await analyzeBlenderSceneIndex(index, {
            renderDataRoot: 'C:/renders',
            foxwatchOutputRoot: 'C:/assets',
            readJson: async filePath => documents[filePath.replace(/\\/g, '/').split('/').at(-1)],
            stat: async filePath => ({ size: filePath.endsWith('one.glb') ? 5 : 7 }),
        });

        assert.equal(analysis.groups.length, 1);
        assert.equal(analysis.groups[0].uniqueMeshBytes, 12);
        assert.equal(analysis.groups[0].nodeCount, 5);
        assert.equal(analysis.groups[0].defaultIconCount, 1);
    });

    it('rejects planned output collisions before workers launch', async () => {
        const index = {
            scenes: [
                { structureId: 'alpha', outputPath: 'alpha/a.scene.json' },
                { structureId: 'alpha', outputPath: 'alpha/b.scene.json' },
            ],
        };
        await assert.rejects(() => analyzeBlenderSceneIndex(index, {
            renderDataRoot: 'C:/renders',
            foxwatchOutputRoot: 'C:/assets',
            readJson: async () => sceneDocument('alpha', 'same-output', [], 1, false),
            stat: async () => ({ size: 0 }),
        }), /output collision/);
    });
});

function group(dependencyGroup, sceneCount, uniqueMeshBytes, nodeCount, defaultIconCount) {
    return {
        dependencyGroup,
        sceneEntries: Array.from({ length: sceneCount }, (_, index) => `${dependencyGroup}/${index}.scene.json`),
        uniqueMeshBytes,
        nodeCount,
        defaultIconCount,
        heavy: false,
    };
}

function sceneDocument(structureId, outputKey, meshPaths, nodeCount, generateDefaultIcon) {
    let root = null;
    for (let index = 0; index < nodeCount; index += 1) {
        root = { id: `node-${index}`, children: root ? [root] : [] };
    }
    return {
        structure: { id: structureId, assetType: 'structures' },
        render: { outputKey, generateDefaultIcon },
        scene: { roots: root ? [root] : [] },
        assets: { meshes: meshPaths.map(exportUrl => ({ exportUrl })) },
    };
}
