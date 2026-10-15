import { issueDiscoveryReuseReceipt } from '#nixie-internal/server/utils/discovery-metrics.ts';
import { createError, setHeader } from 'h3';
import type { H3Event } from 'h3';
import { serverSupabaseServiceRole } from '#supabase/server';
import { resolveNixieSupabaseUser } from '#nixie-internal/server/utils/nixie-auth.ts';
import { getFoxholeLegacyBlueprint, requireFoxholeLegacyBlueprintFeature } from './legacy-blueprints.ts';
import { readBoundedBlueprintResponse, resolveLegacyBlueprintArchive } from './legacy-blueprint-resolver.ts';
import { LEGACY_BLUEPRINT_CONVERTER_REVISION } from '#nixie-internal/app/utils/legacy-blueprints.ts';

export async function requireLegacyBlueprintImportActor(event: H3Event, feature: 'Copy' | 'Insert') {
    requireFoxholeLegacyBlueprintFeature(event, feature);
    const user = await resolveNixieSupabaseUser(event);
    if (!user?.id || user.is_anonymous) {
        if (feature === 'Copy') {
            return null;
        }
        throw createError({ statusCode: 401, statusMessage: 'Sign in to reuse a Blueprint.' });
    }
    return user.id;
}

function storageUrl(event: H3Event, path: string): string {
    // Only SDK-generated URLs for fixed bucket + validated UUID-derived paths.
    return serverSupabaseServiceRole(event).storage.from('blueprints').getPublicUrl(path).data.publicUrl;
}

async function storageFetch(event: H3Event, path: string): Promise<Response> {
    try {
        return await fetch(storageUrl(event, path), { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' });
    } catch {
        return new Response(null, { status: 503 });
    }
}

export async function deliverLegacyBlueprintArchive(event: H3Event, listingId: string, feature: 'Copy' | 'Insert') {
    await requireLegacyBlueprintImportActor(event, feature);
    const resolved = await resolveLegacyBlueprintArchive({
        lookup: () => getFoxholeLegacyBlueprint(event, listingId),
        download: (id, versionId) => storageFetch(event, `${id}/versions/${versionId}.zip`),
    });
    setHeader(event, 'Content-Type', 'application/zip');
    setHeader(event, 'Content-Disposition', 'attachment; filename="blueprint.plan"');
    setHeader(event, 'X-Blueprint-Provenance', encodeURIComponent(JSON.stringify({
        sourceKind: resolved.listing.sourceKind, sourceId: resolved.listing.sourceId,
        versionId: resolved.listing.version.id, archiveSha256: resolved.sha256,
        converterRevision: LEGACY_BLUEPRINT_CONVERTER_REVISION, sourceUrl: resolved.listing.sourceUrl,
        credits: resolved.listing.credits,
    })));
    await issueDiscoveryReuseReceipt(event, 'legacy-foxhole-blueprint', resolved.listing.id, feature === 'Insert' ? 'insert' : 'copy');
    return resolved.bytes;
}

export async function deliverLegacyBlueprintThumbnail(event: H3Event, listingId: string) {
    const listing = await getFoxholeLegacyBlueprint(event, listingId);
    const response = await storageFetch(event, `${listing.sourceId}/icon.webp`);
    if (!response.ok) {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint thumbnail is unavailable.' });
    }
    const bytes = await readBoundedBlueprintResponse(response, 2 * 1024 * 1024);
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint thumbnail is unavailable.' });
    }
    await getFoxholeLegacyBlueprint(event, listingId);
    setHeader(event, 'Content-Type', 'image/webp');
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    return bytes;
}
