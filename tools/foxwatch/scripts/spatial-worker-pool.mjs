import { fork, execFile } from 'node:child_process';
import { availableParallelism, freemem } from 'node:os';

export function spatialWorkerCount(requested, { cpus = availableParallelism(), freeBytes = freemem() } = {}) {
    const value = requested === undefined ? 2 : Number(requested);
    if (!Number.isInteger(value) || value < 1 || value > 4) throw Error('spatial-workers must be between 1 and 4');
    return Math.max(1, Math.min(value, Math.max(1, Math.floor((cpus - 2) / 2)), Math.floor((freeBytes / 2 ** 30 - 4) / 3)));
}

/** Persistent CPU processes own disjoint asset groups; only the coordinator writes the manifest. */
export async function runSpatialWorkerPool(ids, { count, workerPath, options, onEvent = () => {}, onResult = async () => {}, signal }) {
    if (!ids.length) return;
    let next = 0, completed = 0, settled = false, commit = Promise.resolve();
    const workers = new Set(), terminations = [];
    let failure;
    try { await new Promise((resolve, reject) => {
        const close = error => {
            if (settled) return; settled = true;
            signal?.removeEventListener('abort', abort);
            for (const child of workers) {
                // Windows terminates Node without running SIGTERM handlers. Kill the
                // worker's whole tree before disconnecting so Blender cannot survive cancellation.
                if (error && process.platform === 'win32' && child.exitCode === null && child.pid) {
                    terminations.push(new Promise(done => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => done())));
                } else { if (child.connected) child.disconnect(); child.kill(); }
            }
            error ? reject(error) : resolve();
        };
        const abort = () => close(signal.reason ?? Error('3D export cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        const dispatch = (child, worker) => {
            if (settled) return;
            if (next >= ids.length) { if (completed === ids.length) close(); return; }
            const id = ids[next++]; child.currentAsset = id;
            onEvent({ kind: 'spatial-asset-start', worker, assetId: id });
            child.send({ kind: 'asset', id });
        };
        for (let worker = 1; worker <= Math.min(count, ids.length); worker++) {
            const child = fork(workerPath, [], { windowsHide: true, serialization: 'advanced',
                execArgv: ['--max-old-space-size=2048'], env: { ...process.env, UV_THREADPOOL_SIZE: '2' },
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
            workers.add(child);
            child.stdout.on('data', chunk => process.stdout.write(chunk));
            child.stderr.on('data', chunk => process.stderr.write(chunk));
            child.on('error', close);
            child.on('exit', (code, exitSignal) => { if (!settled) close(Error(`3D worker ${worker} exited during ${child.currentAsset ?? 'startup'} (${exitSignal ?? code})`)); });
            child.on('message', message => {
                if (settled) return;
                if (message.kind === 'ready') { dispatch(child, worker); return; }
                if (message.kind === 'phase') { onEvent({ kind: 'spatial-phase', worker, assetId: child.currentAsset, phase: message.phase, modelId: message.modelId }); return; }
                if (message.kind === 'fatal') { close(Error(message.error)); return; }
                if (message.kind !== 'result' || message.id !== child.currentAsset) { close(Error('Invalid 3D worker result')); return; }
                commit = commit.then(async () => {
                    if (settled) return;
                    await onResult(message.result);
                    completed++;
                    onEvent({ kind: 'spatial-asset', worker, assetId: message.id, completed, result: message.result.timing });
                    dispatch(child, worker);
                }).catch(close);
            });
            child.send({ kind: 'initialize', options });
        }
    }); } catch (error) { failure = error; }
    await commit;
    await Promise.all(terminations);
    if (failure) throw failure;
}
