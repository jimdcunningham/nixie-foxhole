import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createManifestSourceBenchmarkReport,
    resolveManifestBenchmarkIterations,
    summarizeManifestBenchmarkTimings,
} from './manifest-source-benchmark.mjs';

describe('FoxWatch manifest source benchmark', () => {
    it('accepts a bounded iteration count', () => {
        assert.equal(resolveManifestBenchmarkIterations(undefined), 1);
        assert.equal(resolveManifestBenchmarkIterations('3'), 3);
        assert.throws(() => resolveManifestBenchmarkIterations('0'));
        assert.throws(() => resolveManifestBenchmarkIterations('6'));
        assert.throws(() => resolveManifestBenchmarkIterations('nope'));
    });

    it('summarizes timings using the median', () => {
        assert.deepEqual(summarizeManifestBenchmarkTimings([30, 10, 20]), {
            runsMs: [30, 10, 20],
            minMs: 10,
            medianMs: 20,
            maxMs: 30,
        });
        assert.equal(summarizeManifestBenchmarkTimings([10, 20]).medianMs, 15);
    });

    it('reports snapshot speedup without including snapshot build time', () => {
        const report = createManifestSourceBenchmarkReport({
            pakFingerprint: 'pak',
            steamBuildId: '123',
            snapshotDirectory: 'snapshot',
            snapshotReused: false,
            snapshotBuildMs: 60_000,
            snapshotFileCount: 10,
            snapshotBytes: 100,
            decodedSnapshotDirectory: 'decoded',
            decodedSnapshotReused: false,
            decodedSnapshotBuildMs: 30_000,
            decodedSnapshotPackageCount: 9,
            decodedSnapshotBytes: 20,
            decodedUnsupportedPackageCount: 1,
            directTimings: [120_000],
            snapshotTimings: [30_000],
            decodedTimings: [20_000],
            decodedDirectTimings: [18_000],
            manifestBytes: 50,
            manifestSha256: 'hash',
        });

        assert.equal(report.medianSpeedup, 4);
        assert.equal(report.medianSavingsMs, 90_000);
        assert.equal(report.snapshot.buildMs, 60_000);
        assert.equal(report.manifest.byteIdentical, true);
        assert.equal(report.decodedMedianSpeedup, 6);
        assert.equal(report.decodedMedianSavingsMs, 100_000);
        assert.equal(report.decodedSnapshot.unsupportedPackageCount, 1);
        assert.equal(report.decodedDirectMedianSpeedup, 6.667);
        assert.equal(report.decodedDirectMedianSavingsMs, 102_000);
        assert.equal(report.schemaVersion, 3);
    });
});
