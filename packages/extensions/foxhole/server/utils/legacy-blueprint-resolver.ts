import { createHash } from 'node:crypto';
import { createError } from 'h3';
import type { LegacyBlueprintListing } from '../../../../nixie/app/utils/legacy-blueprints.ts';
import { LEGACY_BLUEPRINT_LIMITS, checkLegacyBlueprintZip } from '../../../../nixie/app/utils/legacy-blueprint-archive-bounds.ts';

export async function readBoundedBlueprintResponse(response: Response, maxBytes: number): Promise<Buffer> {
    if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw createError({ statusCode: 413, statusMessage: 'Blueprint download exceeds the size limit.' });
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint download is empty.' });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                throw createError({ statusCode: 413, statusMessage: 'Blueprint download exceeds the size limit.' });
            }
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel();
        throw error;
    }
    if (!total) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint upload is pending.' });
    }
    return Buffer.concat(chunks, total);
}

/** Dependencies make race/visibility behavior testable without touching a live source. */
export async function resolveLegacyBlueprintArchive(options: {
    lookup: () => Promise<LegacyBlueprintListing>;
    download: (sourceId: string, versionId: string) => Promise<Response>;
    wait?: (ms: number) => Promise<void>;
}) {
    const listing = await options.lookup();
    let bytes: Buffer | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        const current = await options.lookup();
        if (current.version.id !== listing.version.id) {
            throw createError({ statusCode: 409, statusMessage: 'Blueprint changed. Refresh and try again.' });
        }
        const response = await options.download(listing.sourceId, listing.version.id);
        if (response.ok) {
            bytes = await readBoundedBlueprintResponse(response, LEGACY_BLUEPRINT_LIMITS.archiveBytes);
            break;
        }
        await response.body?.cancel();
        if (![404, 429].includes(response.status) && response.status < 500) {
            throw createError({ statusCode: 503, statusMessage: 'Blueprint archive is unavailable.' });
        }
        if (attempt < 2) {
            await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(250 * 2 ** attempt);
        }
    }
    if (!bytes) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint upload is pending. Try again shortly.' });
    }
    try {
        checkLegacyBlueprintZip(bytes);
    } catch {
        throw createError({ statusCode: 422, statusMessage: 'Blueprint archive is invalid or exceeds import limits.' });
    }
    const current = await options.lookup();
    if (current.version.id !== listing.version.id) {
        throw createError({ statusCode: 409, statusMessage: 'Blueprint changed. Refresh and try again.' });
    }
    return { listing: current, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
