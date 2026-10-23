import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Mirror a completed staging tree while the caller keeps discovery behind its build marker. */
export async function mirrorCompletedBuild(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true });
    const sourceEntries = await readdir(source, { withFileTypes: true });
    const sourceNames = new Set(sourceEntries.map(entry => entry.name));
    for (const entry of sourceEntries) {
        const from = join(source, entry.name);
        const to = join(target, entry.name);
        if (entry.isDirectory()) {
            await mirrorCompletedBuild(from, to);
        } else if (entry.isFile()) {
            await copyFile(from, to);
        }
    }
    for (const entry of await readdir(target, { withFileTypes: true })) {
        if (!sourceNames.has(entry.name)) {
            await rm(join(target, entry.name), { recursive: true, force: true });
        }
    }
}

export function isBuildPublishLockError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM';
}

interface CompletedBuildPublisherOperations {
    mirror: typeof mirrorCompletedBuild;
    rename: typeof rename;
    rm: typeof rm;
    retainSource?: boolean;
}

/** Publish staging without renaming the live directory during a watched development build. */
export async function publishCompletedBuild(
    source: string,
    target: string,
    previous: string,
    watchMode: boolean,
    operations: CompletedBuildPublisherOperations = { mirror: mirrorCompletedBuild, rename, rm },
): Promise<void> {
    await operations.rm(previous, { recursive: true, force: true });
    if (watchMode) {
        await operations.mirror(source, target);
        if (!operations.retainSource) await operations.rm(source, { recursive: true, force: true });
        return;
    }
    let movedTarget = false;
    try {
        await operations.rename(target, previous);
        movedTarget = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !isBuildPublishLockError(error)) {
            throw error;
        }
        if (isBuildPublishLockError(error)) {
            await operations.mirror(source, target);
            await operations.rm(source, { recursive: true, force: true });
            return;
        }
    }
    if (!movedTarget) {
        await operations.rename(source, target);
        return;
    }
    try {
        await operations.rename(source, target);
    } catch (error) {
        if (!isBuildPublishLockError(error)) {
            await operations.rename(previous, target).catch(() => undefined);
            throw error;
        }
        await operations.mirror(source, target);
        await operations.rm(source, { recursive: true, force: true });
    }
}
