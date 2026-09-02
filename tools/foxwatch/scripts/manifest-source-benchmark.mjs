export function resolveManifestBenchmarkIterations(value) {
    const parsed = Number.parseInt(String(value ?? '1'), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
        throw new Error('Manifest source benchmark iterations must be an integer from 1 through 5.');
    }
    return parsed;
}

export function summarizeManifestBenchmarkTimings(values) {
    if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error('Manifest source benchmark timings require non-negative finite values.');
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
    return {
        runsMs: values.map(value => Math.round(value)),
        minMs: Math.round(sorted[0]),
        medianMs: Math.round(medianMs),
        maxMs: Math.round(sorted.at(-1)),
    };
}

export function createManifestSourceBenchmarkReport({
    pakFingerprint,
    steamBuildId,
    snapshotDirectory,
    snapshotReused,
    snapshotBuildMs,
    snapshotFileCount,
    snapshotBytes,
    decodedSnapshotDirectory,
    decodedSnapshotReused,
    decodedSnapshotBuildMs,
    decodedSnapshotPackageCount,
    decodedSnapshotBytes,
    decodedUnsupportedPackageCount,
    directTimings,
    snapshotTimings,
    decodedTimings,
    decodedDirectTimings,
    manifestBytes,
    manifestSha256,
}) {
    const direct = summarizeManifestBenchmarkTimings(directTimings);
    const snapshot = summarizeManifestBenchmarkTimings(snapshotTimings);
    const decoded = summarizeManifestBenchmarkTimings(decodedTimings);
    const decodedDirect = summarizeManifestBenchmarkTimings(decodedDirectTimings);
    return {
        schemaVersion: 3,
        createdAt: new Date().toISOString(),
        pakFingerprint,
        steamBuildId: steamBuildId ?? null,
        snapshot: {
            directory: snapshotDirectory,
            reused: snapshotReused,
            buildMs: Math.round(snapshotBuildMs),
            fileCount: snapshotFileCount,
            bytes: snapshotBytes,
        },
        decodedSnapshot: {
            directory: decodedSnapshotDirectory,
            reused: decodedSnapshotReused,
            buildMs: Math.round(decodedSnapshotBuildMs),
            packageCount: decodedSnapshotPackageCount,
            bytes: decodedSnapshotBytes,
            unsupportedPackageCount: decodedUnsupportedPackageCount,
        },
        manifest: {
            bytes: manifestBytes,
            sha256: manifestSha256,
            byteIdentical: true,
        },
        direct,
        looseSnapshot: snapshot,
        decoded,
        decodedDirect,
        medianSpeedup: snapshot.medianMs === 0
            ? null
            : Number((direct.medianMs / snapshot.medianMs).toFixed(3)),
        medianSavingsMs: direct.medianMs - snapshot.medianMs,
        decodedMedianSpeedup: decoded.medianMs === 0
            ? null
            : Number((direct.medianMs / decoded.medianMs).toFixed(3)),
        decodedMedianSavingsMs: direct.medianMs - decoded.medianMs,
        decodedDirectMedianSpeedup: decodedDirect.medianMs === 0
            ? null
            : Number((direct.medianMs / decodedDirect.medianMs).toFixed(3)),
        decodedDirectMedianSavingsMs: direct.medianMs - decodedDirect.medianMs,
    };
}
