import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { alignFiringVolume } from './firing-volume-metadata.mjs';

const identity = range => JSON.stringify([range.type ?? range.t, range.codeName ?? range.c ?? '',
    range.min ?? range.mn ?? null, range.max ?? range.mx ?? null]);

/** Metadata-only contract migration: preserve every unrelated catalog/image/model field. */
export function publishFiringVolumes(source, published, { sourceFrame = false } = {}) {
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
            const candidates = ranges.get(identity(range)) ?? [];
            let candidateIndex = 0;
            if (candidates.length > 1) {
                const matches = candidates.map((candidate,index) => ({candidate,index})).filter(({candidate}) =>
                    Math.hypot((candidate.x??0)-(range.x??0),(candidate.y??0)-(range.y??0)) < 0.01);
                if (matches.length !== 1 && !sourceFrame) throw new Error(`Ambiguous firing range frame: ${asset.id}/${range.codeName??range.c??range.type??range.t}`);
                candidateIndex = matches.length === 1 ? matches[0].index : 0;
            }
            const sourceRange = candidates.splice(candidateIndex,1)[0];
            if (!sourceRange?.firingVolume) continue;
            if (sourceFrame && sourceRange.firingVolume.originSource === 'firing-component'
                && !range.fv && !range.firingVolume) continue;
            // A model-space migration uses the newly extracted source frame. Old
            // generated ground centers may themselves contain the positioning bug.
            const volume = alignFiringVolume(sourceFrame ? sourceRange : range, sourceRange.firingVolume);
            const compact = range.t !== undefined;
            range[compact ? 'fv' : 'firingVolume'] = volume;
            if (!sourceFrame && volume.source === 'mount-dynamic-data' && (range.arc ?? range.a) !== undefined && volume.maxYaw - volume.minYaw < 360)
                range[compact ? 'a' : 'arc'] = (volume.maxYaw - volume.minYaw) / 2;
            count++;
        }
    }
    return { manifest: result, count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const sourceFrame = process.argv.includes('--source-frame');
    const [sourcePath, ...targets] = process.argv.slice(2).filter(arg => arg !== '--source-frame');
    if (!sourcePath || !targets.length) throw new Error('Usage: publish-firing-volumes.mjs <extracted-manifest> <catalog> [catalog...]');
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    for (const target of targets) {
        const text = await readFile(target, 'utf8');
        const { manifest, count } = publishFiringVolumes(source, JSON.parse(text), { sourceFrame });
        if (!count) throw new Error(`No matching source-backed firing volumes in ${target}`);
        const encoded = JSON.stringify(manifest).replace(/[^\x00-\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
        await writeFile(target, encoded + (text.endsWith('\n') ? '\n' : ''));
        console.log(`Updated ${count} firing envelopes in ${target}`);
    }
}
