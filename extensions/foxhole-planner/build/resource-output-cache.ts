import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function stamp(path: string): Promise<string | null> {
    try {
        const value = await lstat(path);
        if (!value.isFile() || value.isSymbolicLink()) throw new Error('Expected a regular build file: ' + path);
        return `${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Retain outputs only inside the caller's validated staging directory. */
export async function pruneBuildOutputs(root: string, keep: ReadonlySet<string>): Promise<number> {
    let removed = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Build output may not contain links.');
        if (entry.isDirectory()) {
            removed += await pruneBuildOutputs(path, keep);
            if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
        } else if (!keep.has(resolve(path))) {
            await rm(path);
            removed++;
        }
    }
    return removed;
}

/** File stamps avoid reading untouched inputs; content hashes ignore identical regenerations. */
export function createResourceOutputCache() {
    const inputs = new Map<string, { stamp: string; hash: string; }>();
    const outputs = new Map<string, { key: string; stamp: string; }>();
    let reads = new Map<string, Promise<string>>();
    let desired = new Set<string>();
    let stats = { copied: 0, generated: 0, written: 0, reused: 0, removed: 0 };

    function inputHash(path: string): Promise<string> {
        path = resolve(path);
        let pending = reads.get(path);
        if (!pending) {
            pending = (async () => {
                const before = await stamp(path);
                if (before === null) throw new Error('Missing resource input: ' + path);
                const cached = inputs.get(path);
                if (cached?.stamp === before) return cached.hash;
                const hash = digest(await readFile(path));
                if (await stamp(path) !== before) throw new Error('Resource changed while building: ' + path);
                inputs.set(path, { stamp: before, hash });
                return hash;
            })();
            reads.set(path, pending);
        }
        return pending;
    }

    async function update(path: string, key: string, write: () => Promise<void>, kind: 'copied' | 'generated' | 'written') {
        path = resolve(path);
        desired.add(path);
        const cached = outputs.get(path);
        if (cached?.key === key && await stamp(path) === cached.stamp) {
            stats.reused++;
            return;
        }
        await mkdir(dirname(path), { recursive: true });
        await write();
        outputs.set(path, { key, stamp: (await stamp(path))! });
        stats[kind]++;
    }

    return {
        begin() {
            reads = new Map();
            desired = new Set();
            stats = { copied: 0, generated: 0, written: 0, reused: 0, removed: 0 };
        },
        async copy(source: string, destination: string) {
            const key = await inputHash(source);
            await update(destination, key, () => copyFile(source, destination), 'copied');
        },
        async generate(destination: string, dependencies: readonly string[], generate: () => Promise<Uint8Array>) {
            const keys = await Promise.all(dependencies.map(async path => [resolve(path), await inputHash(path)]));
            await update(destination, JSON.stringify(keys), async () => { await writeFile(destination, await generate()); }, 'generated');
        },
        async write(destination: string, text: string) {
            await update(destination, digest(Buffer.from(text)), () => writeFile(destination, text), 'written');
        },
        async finish(root: string, bundleFiles: readonly string[]) {
            const keep = new Set([...desired, ...bundleFiles.map(path => resolve(root, path))]);
            stats.removed = await pruneBuildOutputs(root, keep);
            for (const path of outputs.keys()) if (!desired.has(path)) outputs.delete(path);
            const usedInputs = new Set(reads.keys());
            for (const path of inputs.keys()) if (!usedInputs.has(path)) inputs.delete(path);
            return { ...stats };
        },
    };
}

/** Publish only changed bytes while retaining the complete staged resource tree. */
export function createIncrementalBuildMirror(onCopy?: (path: string) => void) {
    const cache = new Map<string, { source: string; target: string; hash: string; }>();
    return async (source: string, target: string): Promise<void> => {
        const keep = new Set<string>();
        const seen = new Set<string>();
        async function visit(directory: string): Promise<void> {
            const entries = await readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const from = join(directory, entry.name);
                if (entry.isSymbolicLink()) throw new Error('Build output may not contain links.');
                if (entry.isDirectory()) { await visit(from); continue; }
                const to = resolve(target, relative(source, from));
                keep.add(to);
                seen.add(from);
                const sourceStamp = (await stamp(from))!;
                const targetStamp = await stamp(to);
                const previous = cache.get(from);
                if (previous?.source === sourceStamp && previous.target === targetStamp) continue;
                const hash = digest(await readFile(from));
                if (!previous || previous.hash !== hash || previous.target !== targetStamp) {
                    await mkdir(dirname(to), { recursive: true });
                    await copyFile(from, to);
                    onCopy?.(to);
                }
                cache.set(from, { source: sourceStamp, target: (await stamp(to))!, hash });
            }
        }
        await mkdir(target, { recursive: true });
        await visit(source);
        await pruneBuildOutputs(target, keep);
        for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
    };
}
