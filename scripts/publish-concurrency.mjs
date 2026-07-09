import { availableParallelism, cpus } from 'node:os';

export function getDefaultPublishConcurrency() {
    return Math.min(16, Math.max(4, availableParallelism?.() ?? cpus().length));
}

export async function mapWithConcurrency(items, concurrency, mapper) {
    if (items.length === 0) {
        return [];
    }

    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    async function worker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
