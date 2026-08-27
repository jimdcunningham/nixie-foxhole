import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    GIBIBYTE,
    canRunBlenderBatchesConcurrently,
    canLaunchSecondBlenderWorker,
    dequeueNextConcurrentBlenderBatch,
    describeConcurrentBlenderWait,
    formatBlenderWorkerLine,
    mergeBlenderPeakMemory,
    parseBlenderProgressLine,
    parseWindowsProcessMemoryLine,
    resolveRecycledSceneEntries,
    resolveBlenderWorkerCount,
    shouldSuppressRoutineBlenderLine,
    shouldRequestBlenderRecycle,
} from './blender-runner.mjs';

describe('FoxWatch Blender worker controls', () => {
    it('defaults to two workers only on systems with at least 24 GiB', () => {
        assert.equal(resolveBlenderWorkerCount(undefined, undefined, 24 * GIBIBYTE), 2);
        assert.equal(resolveBlenderWorkerCount(undefined, undefined, 23 * GIBIBYTE), 1);
    });

    it('prefers the CLI worker value over the environment and validates both', () => {
        assert.equal(resolveBlenderWorkerCount('1', '2', 64 * GIBIBYTE), 1);
        assert.equal(resolveBlenderWorkerCount(undefined, '2', 8 * GIBIBYTE), 2);
        assert.throws(() => resolveBlenderWorkerCount('3', undefined, 64 * GIBIBYTE), /must be 1 or 2/);
    });

    it('requires 12 GiB available before launching the second worker', () => {
        assert.equal(canLaunchSecondBlenderWorker(12 * GIBIBYTE), true);
        assert.equal(canLaunchSecondBlenderWorker(12 * GIBIBYTE - 1), false);
    });

    it('allows complementary batches within a bounded combined footprint', () => {
        const large = { uniqueMeshBytes: 60 * 1024 * 1024, nodeCount: 500, defaultIconCount: 4 };
        assert.equal(canRunBlenderBatchesConcurrently(large, {
            uniqueMeshBytes: 20 * 1024 * 1024,
            nodeCount: 300,
            defaultIconCount: 6,
        }), true);
        assert.equal(canRunBlenderBatchesConcurrently(large, {
            uniqueMeshBytes: 21 * 1024 * 1024,
            nodeCount: 100,
            defaultIconCount: 1,
        }), false);
        assert.equal(canRunBlenderBatchesConcurrently(large, {
            uniqueMeshBytes: 1,
            nodeCount: 301,
            defaultIconCount: 1,
        }), false);
        assert.equal(canRunBlenderBatchesConcurrently(large, {
            uniqueMeshBytes: 1,
            nodeCount: 1,
            defaultIconCount: 7,
        }), false);
        assert.equal(canRunBlenderBatchesConcurrently(large, {
            uniqueMeshBytes: 1,
            nodeCount: 1,
            defaultIconCount: 1,
            exclusive: true,
        }), false);
    });

    it('finds a complementary second-worker batch beyond incompatible and exclusive work', () => {
        const active = { uniqueMeshBytes: 60 * 1024 * 1024, nodeCount: 500, defaultIconCount: 4 };
        const blocked = { id: 'blocked', uniqueMeshBytes: 30 * 1024 * 1024, nodeCount: 100, defaultIconCount: 1 };
        const secondWorker = { id: 'second-worker', uniqueMeshBytes: 2 * 1024 * 1024, nodeCount: 20, defaultIconCount: 1 };
        const exclusive = { id: 'exclusive', uniqueMeshBytes: 1, nodeCount: 1, exclusive: true };
        const laterEligible = { id: 'later-eligible', uniqueMeshBytes: 3 * 1024 * 1024, nodeCount: 30, defaultIconCount: 1 };
        const queue = [blocked, secondWorker, exclusive, laterEligible];

        assert.equal(dequeueNextConcurrentBlenderBatch(queue, active), secondWorker);
        assert.deepEqual(queue, [blocked, exclusive, laterEligible]);
        assert.equal(dequeueNextConcurrentBlenderBatch(queue, active), laterEligible);
        assert.deepEqual(queue, [blocked, exclusive]);
    });

    it('explains why a free worker cannot take another batch', () => {
        const active = {
            plannedBatchNumber: 62,
            uniqueMeshBytes: 20 * 1024 * 1024,
            nodeCount: 500,
            defaultIconCount: 2,
        };
        const queue = [{
            uniqueMeshBytes: 10 * 1024 * 1024,
            nodeCount: 350,
            defaultIconCount: 1,
        }];

        assert.equal(
            describeConcurrentBlenderWait(active, queue),
            'No queued batch can run beside planned batch 62 without exceeding the 800-node limit.',
        );
        assert.equal(describeConcurrentBlenderWait(active, []), 'No queued batches remain; waiting for planned batch 62 to finish.');
        assert.equal(describeConcurrentBlenderWait({ ...active, exclusive: true }, queue), 'Planned batch 62 must run alone.');
        assert.equal(describeConcurrentBlenderWait(active, [{ ...queue[0], nodeCount: 200 }]), null);
    });

    it('requeues Blender\'s untouched scene partition after memory recycling', () => {
        const planned = ['alpha.scene.json', 'bravo.scene.json', 'charlie.scene.json'];
        assert.deepEqual(resolveRecycledSceneEntries(planned, {
            status: 'recycle',
            completedSceneEntries: ['bravo.scene.json'],
            remainingSceneEntries: ['alpha.scene.json', 'charlie.scene.json'],
        }), ['alpha.scene.json', 'charlie.scene.json']);
        assert.throws(() => resolveRecycledSceneEntries(planned, {
            status: 'recycle',
            completedSceneEntries: ['bravo.scene.json'],
            remainingSceneEntries: ['alpha.scene.json', 'unknown.scene.json'],
        }), /exact partition/);
    });

    it('uses externally sampled Windows memory for peak reporting and recycling', () => {
        assert.deepEqual(parseWindowsProcessMemoryLine('6442450944,7516192768'), {
            rss: 6 * GIBIBYTE,
            private: 7 * GIBIBYTE,
        });
        assert.equal(parseWindowsProcessMemoryLine('not-memory'), null);
        assert.equal(shouldRequestBlenderRecycle({ rss: 6 * GIBIBYTE, private: 1 }), true);
        assert.equal(shouldRequestBlenderRecycle({ rss: 1, private: 8 * GIBIBYTE }), true);
        assert.equal(shouldRequestBlenderRecycle({ rss: 5 * GIBIBYTE, private: 7 * GIBIBYTE }), false);
        assert.deepEqual(mergeBlenderPeakMemory({ peakMemory: { rss: 1, private: 9 } }, { rss: 7, private: 3 }).peakMemory, {
            rss: 7,
            private: 9,
        });
    });
});

describe('FoxWatch quiet Blender output', () => {
    it('parses structured per-scene progress without accepting malformed values', () => {
        assert.deepEqual(parseBlenderProgressLine(
            'FOXWATCH_BLENDER_PROGRESS {"completed":3,"total":12,"sceneEntry":"foo/scene.json","structureId":"foo"}',
        ), {
            completed: 3,
            total: 12,
            sceneEntry: 'foo/scene.json',
            structureId: 'foo',
        });
        assert.equal(parseBlenderProgressLine('ordinary Blender output'), null);
        assert.equal(parseBlenderProgressLine('FOXWATCH_BLENDER_PROGRESS {"completed":13,"total":12}'), null);
        assert.equal(parseBlenderProgressLine('FOXWATCH_BLENDER_PROGRESS not-json'), null);
    });

    it('suppresses known routine Blender chatter', () => {
        for (const line of [
            'Blender 5.1.0 (hash abc)',
            '00:00.437  blend            | Read blend: "render-template.blend"',
            '11:03:25 | INFO: Data are loaded, start creating Blender stuff',
            '11:03:25 | INFO: Blender create Mesh node SK_Test',
            '11:03:25 | INFO: glTF import finished in 0.08s',
            "03:00.375  render           | Saved: 'asset.preview.png'",
            'Applying debug color [0.68, 0.4, 0.25, 1] to playerc:mesh-1 from HeadM.glb',
            'render_render_scenes: rendered 32 structure(s) to output',
            'Blender quit',
        ]) {
            assert.equal(shouldSuppressRoutineBlenderLine(line), true, line);
        }
    });

    it('retains warnings, tracebacks, and unmatched output', () => {
        for (const line of [
            'WARNING: missing material',
            'Traceback (most recent call last):',
            'Created debug marker for rail socket',
            '00:01.000 image.read | ERROR could not load image',
        ]) {
            assert.equal(shouldSuppressRoutineBlenderLine(line), false, line);
        }
        assert.equal(formatBlenderWorkerLine(2, 'warning'), '[Blender W2] warning');
    });
});
