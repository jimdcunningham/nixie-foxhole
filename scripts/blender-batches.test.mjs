import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createBlenderSceneBatches,
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
        assert.equal(resolveBlenderBatchSceneLimit(undefined), 50);
        assert.equal(resolveBlenderBatchSceneLimit('75'), 75);
        assert.throws(() => resolveBlenderBatchSceneLimit('0'), /positive integer/);
        assert.throws(() => resolveBlenderBatchSceneLimit('many'), /positive integer/);
    });
});
