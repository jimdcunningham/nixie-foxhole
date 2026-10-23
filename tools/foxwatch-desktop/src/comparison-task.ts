export function comparisonTask<T>(message: unknown, signal: AbortSignal, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Comparison cancelled.')); return; }
    const worker = new Worker(new URL('./comparison-worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('Comparison cancelled.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Comparison exceeded its time budget.')); }, 30000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    worker.onerror = () => { cleanup(); reject(new Error('The comparison worker could not run.')); };
    worker.postMessage(message, transfer);
  });
}
