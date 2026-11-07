import { zipSync } from 'fflate';
import { buildMapPak, encodeBc7 } from './deadlands-pak-export.mjs';
import { PakImporter } from './mod-pak.js';

const width = 2048;
const height = 1776;
const payloadSize = width * height;

function readTemplates(buffer: ArrayBuffer) {
    const importer = new PakImporter(buffer);
    const templates = new Map<string, { path: string; data: Uint8Array<ArrayBuffer>; offset: number }>();
    for (const map of importer.exportHexMaps({ skipDecode: true })) {
        const { uasset, uexp, ubulk } = map.raw;
        if (!uasset || uexp || ubulk) continue;
        const info = importer.extractGeneratorBc7PayloadMeta({ files: map.raw });
        if (!info || info.width !== width || info.height !== height || info.payloadSize !== payloadSize
            || !info.formatCandidates.includes('bc7') || info.footerLen !== 28
            || info.start + payloadSize + 28 !== uasset.byteLength) continue;
        const key = map.assetPath.split('/').at(-1)?.toLowerCase();
        if (!key) continue;
        if (templates.has(key)) throw new Error('Duplicate map texture template: ' + map.assetPath);
        templates.set(key, { path: map.assetPath + '.uasset', data: new Uint8Array(uasset), offset: info.start });
    }
    return templates;
}

export async function exportFoxholeFullMap(
    reference: File,
    regions: readonly { key: string; textureKey: string; name: string }[],
    bake: (key: string, onStage: (stage: string) => void) => Promise<{ png: Blob }>,
    signal: AbortSignal,
    onProgress: (message: string) => void,
) {
    if (!regions.length) throw new Error('The world has no map regions.');
    const templates = readTemplates(await reference.arrayBuffer());
    const missing = regions.filter(region => !templates.has(region.textureKey.toLowerCase()));
    if (missing.length) throw new Error('The reference Pak is missing 2K textures for: ' + missing.map(region => region.name).join(', '));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not read the baked map pixels.');
    const entries = [];
    const pngs: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const [index, region] of regions.entries()) {
        signal.throwIfAborted();
        const label = `${index + 1}/${regions.length} · ${region.name}`;
        const { png } = await bake(region.key, stage => onProgress(`${label} · ${stage}`));
        onProgress(`${label} · Encoding BC7`);
        signal.throwIfAborted();
        const bitmap = await createImageBitmap(png);
        try {
            if (bitmap.width !== width || bitmap.height !== height) throw new Error('Unexpected bake size for ' + region.name);
            context.clearRect(0, 0, width, height);
            context.drawImage(bitmap, 0, 0);
        } finally {
            bitmap.close();
        }
        const template = templates.get(region.textureKey.toLowerCase())!;
        template.data.set(encodeBc7(context.getImageData(0, 0, width, height).data), template.offset);
        entries.push(template);
        pngs[region.textureKey + '.png'] = new Uint8Array(await png.arrayBuffer());
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    onProgress('Packaging Pak and PNGs…');
    const pak = await buildMapPak(entries);
    signal.throwIfAborted();
    // PNG data is already compressed.
    const archive = new Blob([Uint8Array.from(zipSync(pngs, { level: 0 }))], { type: 'application/zip' });
    return { pak, archive };
}
