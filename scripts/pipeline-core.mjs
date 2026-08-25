import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function computeBuildProvenance(repoRoot) {
    const entries = [];
    const root = path.join(repoRoot, 'tools', 'foxwatch');
    for (const absolutePath of await walkFiles(root, {
        ignoredSegments: new Set(['bin', 'local', 'obj', 'tmp', 'vendor', '__pycache__']),
    })) {
        const relativePath = slash(path.relative(repoRoot, absolutePath));
        if (!relativePath.endsWith('.cs')
            && !relativePath.endsWith('.csproj')
            && !relativePath.endsWith('.props')
            && !relativePath.endsWith('.targets')) {
            continue;
        }
        entries.push([relativePath, sha256(await fs.readFile(absolutePath))]);
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return {
        schemaVersion: 1,
        configuration: 'Debug|net8.0',
        fingerprint: sha256(JSON.stringify(entries)),
        entries,
    };
}

export async function writeJsonAtomic(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
}

export async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function buildPakInventory(directory) {
    const files = await walkFiles(directory);
    const entries = [];
    for (const filePath of files) {
        if (!/\.(?:pak|utoc|ucas)$/i.test(filePath)) {
            continue;
        }
        const stat = await fs.stat(filePath, { bigint: true });
        entries.push({
            path: slash(path.relative(directory, filePath)),
            size: stat.size.toString(),
            mtimeNs: stat.mtimeNs.toString(),
        });
    }
    entries.sort((left, right) => left.path.localeCompare(right.path));
    const steamBuildId = await readSteamBuildId(directory);
    return {
        directory: path.resolve(directory),
        steamBuildId,
        entries,
        fingerprint: sha256(JSON.stringify({ steamBuildId, entries })),
    };
}

async function walkFiles(root, { ignoredSegments = new Set() } = {}) {
    const output = [];
    async function visit(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return;
            }
            throw error;
        }
        for (const entry of entries) {
            if (ignoredSegments.has(entry.name)) {
                continue;
            }
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath);
            } else if (entry.isFile()) {
                output.push(absolutePath);
            }
        }
    }
    await visit(root);
    return output.sort();
}

async function readSteamBuildId(directory) {
    let current = path.resolve(directory);
    for (let depth = 0; depth < 10; depth += 1) {
        const manifestPath = path.join(current, 'appmanifest_505460.acf');
        try {
            const manifest = await fs.readFile(manifestPath, 'utf8');
            return manifest.match(/"buildid"\s+"([0-9]+)"/i)?.[1] ?? null;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return null;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function slash(value) {
    return value.replaceAll('\\', '/');
}
