import { checkLegacyBlueprintSave } from '#foxhole/utils/legacy-blueprint-save.ts';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { checkLegacyBlueprintZip, LEGACY_BLUEPRINT_LIMITS } from '../../../../nixie/app/utils/legacy-blueprint-archive-bounds.ts';
import { readCheckedZipEntry } from '../../../../nixie/app/utils/discovery-archive.ts';
import { legacyHasPublicationContent } from '#foxhole/utils/legacy-blueprint-save.ts';
import { blueprintTextChunks } from './blueprint-moderation-policy.ts';

export type BlueprintImage = { name: string; sha256: string; dataUrl: string; };
export class BlueprintManualReviewError extends Error {}

export async function prepareBlueprintImage(name: string, bytes: Buffer): Promise<BlueprintImage> {
    try {
        const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
        const metadata = await image.metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
            throw new Error('Animated or unsupported image needs manual review.');
        }
        const preview = await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).timeout({ seconds: 5 }).toBuffer();
        return { name, sha256: createHash('sha256').update(bytes).digest('hex'), dataUrl: `data:image/webp;base64,${preview.toString('base64')}` };
    } catch (error) {
        throw new BlueprintManualReviewError(`${name}: ${error instanceof Error ? error.message : 'Image could not be decoded.'}`);
    }
}

export async function inspectBlueprintArchive(bytes: Buffer, metadata: Record<string, unknown>) {
    const expected = checkLegacyBlueprintZip(bytes);
    const archive = await JSZip.loadAsync(bytes, { createFolders: false });
    const deadline = Date.now() + LEGACY_BLUEPRINT_LIMITS.elapsedMs;
    const projectFile = archive.file('project.json');
    if (!projectFile) {
        throw new BlueprintManualReviewError('Compressed project.lzma needs manual review.');
    }
    const project = JSON.parse(new TextDecoder().decode(await readCheckedZipEntry(projectFile, expected.get('project.json')!, deadline)));
    checkLegacyBlueprintSave(project);
    if (!legacyHasPublicationContent(project.entities)) {
        return {
            archiveSha256: createHash('sha256').update(bytes).digest('hex'), blank: true, text: [], images: [] as BlueprintImage[],
        };
    }
    const imageBuffers: { name: string; bytes: Buffer; }[] = [];
    for (const [name, size] of expected) {
        if (name.startsWith('assets/') && !name.endsWith('/')) {
            imageBuffers.push({ name, bytes: Buffer.from(await readCheckedZipEntry(archive.file(name)!, size, deadline)) });
        }
    }
    for (const entity of project.entities) {
        if (entity.type !== 'image') {
            continue;
        }
        if (entity.textureFile && !expected.has(`assets/${entity.textureFile}`) && !expected.has(entity.textureFile)) {
            throw new BlueprintManualReviewError('Referenced image is missing or external.');
        }
        if (entity.textureData) {
            const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(entity.textureData);
            if (!match) {
                throw new BlueprintManualReviewError('Unsupported embedded image needs manual review.');
            }
            imageBuffers.push({ name: `embedded-${entity.id}`, bytes: Buffer.from(match[1]!, 'base64') });
        }
    }
    if (imageBuffers.length > LEGACY_BLUEPRINT_LIMITS.images) {
        throw new BlueprintManualReviewError('Too many images for automatic review.');
    }
    const images: BlueprintImage[] = [];
    const imageDeadline = Date.now() + 20_000;
    for (const image of imageBuffers) {
        if (Date.now() > imageDeadline) {
            throw new BlueprintManualReviewError('Images exceed the automatic processing time limit.');
        }
        images.push(await prepareBlueprintImage(image.name, image.bytes));
    }
    return {
        archiveSha256: createHash('sha256').update(bytes).digest('hex'),
        blank: !legacyHasPublicationContent(project.entities),
        text: blueprintTextChunks({ metadata, project }), images,
    };
}
