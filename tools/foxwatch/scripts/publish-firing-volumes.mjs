import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { alignFiringVolume } from './firing-volume-metadata.mjs';

const identity = range => JSON.stringify([range.type ?? range.t, range.codeName ?? range.c ?? '',
    range.min ?? range.mn ?? null, range.max ?? range.mx ?? null]);

/** Metadata-only contract migration: preserve every unrelated catalog/image/model field. */
export function publishFiringVolumes(source, published) {
    const sourceAssets = new Map(source.assets.map(asset => [asset.id, asset]));
    const result = structuredClone(published);
    let count = 0;
    for (const asset of result.assets) {
        const ranges = new Map();
        for (const range of sourceAssets.get(asset.id)?.ranges ?? []) {
            const key = identity(range);
            if (!ranges.has(key)) ranges.set(key, []);
            ranges.get(key).push(range);
        }
        for (const range of asset.ranges ?? []) {
            const sourceRange = ranges.get(identity(range))?.shift();
            if (!sourceRange?.firingVolume) continue;
            const volume = alignFiringVolume(range, sourceRange.firingVolume);
            const compact = range.t !== undefined;
            range[compact ? 'fv' : 'firingVolume'] = volume;
            if ((range.arc ?? range.a) !== undefined && volume.maxYaw - volume.minYaw < 360)
                range[compact ? 'a' : 'arc'] = (volume.maxYaw - volume.minYaw) / 2;
            count++;
        }
    }
    return { manifest: result, count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [sourcePath, ...targets] = process.argv.slice(2);
    if (!sourcePath || !targets.length) throw new Error('Usage: publish-firing-volumes.mjs <extracted-manifest> <catalog> [catalog...]');
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    for (const target of targets) {
        const text = await readFile(target, 'utf8');
        const { manifest, count } = publishFiringVolumes(source, JSON.parse(text));
        if (!count) throw new Error(`No matching source-backed firing volumes in ${target}`);
        const encoded = JSON.stringify(manifest).replace(/[^\x00-\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
        await writeFile(target, encoded + (text.endsWith('\n') ? '\n' : ''));
        console.log(`Updated ${count} firing envelopes in ${target}`);
    }
}
