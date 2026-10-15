/** Start independent CPU 3D export and GPU 2D rendering at the same readiness barrier. */
export async function runAssetGenerationStages({ export3D, render2D }) {
    // Observe both failures immediately, retain completed outputs, and never publish
    // until both stages have settled. Stopping the runner still stops its process tree.
    const results = await Promise.allSettled([Promise.resolve().then(export3D), Promise.resolve().then(render2D)]);
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Asset generation failed; completed outputs remain cached.');
}
