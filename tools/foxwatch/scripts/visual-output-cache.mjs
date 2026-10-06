import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './pipeline-core.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

export class VisualOutputCache {
    constructor(directory, provenance) {
        this.directory = directory;
        this.provenance = provenance;
        this.pending = new Map();
    }

    static async create(directory, sourceFiles, versions) {
        const sources = await Promise.all(sourceFiles.map(async filePath => [path.basename(filePath), digest(await readFile(filePath))]));
        return new VisualOutputCache(directory, { sources, versions });
    }

    identity(key, inputs, settings, outputs) {
        return {
            recordPath: path.join(this.directory, `${digest(key)}.json`),
            fingerprint: digest(JSON.stringify(canonical({
                schemaVersion: 1, provenance: this.provenance,
                inputs: inputs.map(value => value === null ? null : digest(value)),
                settings, outputs: outputs.map(value => path.resolve(value)),
            }))),
            outputs,
        };
    }

    async matches(identity) {
        try {
            const record = JSON.parse(await readFile(identity.recordPath, 'utf8'));
            if (record.schemaVersion !== 1 || record.fingerprint !== identity.fingerprint
                || !Array.isArray(record.outputs) || record.outputs.length !== identity.outputs.length) return false;
            for (let index = 0; index < identity.outputs.length; index += 1) {
                if (record.outputs[index].path !== path.resolve(identity.outputs[index])
                    || record.outputs[index].hash !== digest(await readFile(identity.outputs[index]))) return false;
            }
            return identity.outputs.length > 0;
        } catch {
            return false;
        }
    }

    schedule(identity) {
        this.pending.set(identity.recordPath, identity);
    }

    async flush() {
        // Multiple publication roles can write the same image. Verify and record
        // the final bytes only after all composition, aliases, and pruning finish.
        for (const identity of this.pending.values()) {
            try {
                await this.record(identity);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }
        this.pending.clear();
    }

    async record(identity) {
        const outputs = await Promise.all(identity.outputs.map(async filePath => ({
            path: path.resolve(filePath), hash: digest(await readFile(filePath)),
        })));
        await writeJsonAtomic(identity.recordPath, { schemaVersion: 1, fingerprint: identity.fingerprint, outputs });
    }
}
