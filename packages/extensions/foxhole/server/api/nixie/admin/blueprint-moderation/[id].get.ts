import { createError, getQuery, getRouterParam } from 'h3';
import { serverSupabaseServiceRole } from '#supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDiscoveryAdmin } from '#nixie-internal/server/utils/discovery-metrics.ts';
import { loadBlueprintModerationContent } from '../../../../utils/blueprint-moderation.ts';
import { BlueprintManualReviewError } from '../../../../utils/blueprint-moderation-archive.ts';
import type { BlueprintModerationJob } from '../../../../utils/blueprint-moderation.ts';
import { LEGACY_BLUEPRINT_UUID } from '#nixie-internal/app/utils/legacy-blueprints.ts';

export default defineEventHandler(async event => {
    await requireDiscoveryAdmin(event);
    const id = getRouterParam(event, 'id') || '';
    if (!LEGACY_BLUEPRINT_UUID.test(id)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid blueprint ID.' });
    }
    const client = serverSupabaseServiceRole(event) as SupabaseClient;
    const row = await client.from('nixie_blueprint_moderation').select('*').eq('blueprint_id', id).single();
    if (row.error) {
        throw createError({ statusCode: 404, statusMessage: 'Review is unavailable.' });
    }
    const job = row.data as BlueprintModerationJob;
    const revision = await client.rpc('nixie_blueprint_moderation_fingerprint', { p_id: id });
    if (revision.error || revision.data !== job.fingerprint) {
        throw createError({ statusCode: 409, statusMessage: 'This upload changed. Wait for its next moderation pass.' });
    }
    let content;
    try {
        content = await loadBlueprintModerationContent(client, job);
    } catch (error) {
        throw createError({ statusCode: error instanceof BlueprintManualReviewError ? 422 : 503,
            statusMessage: error instanceof BlueprintManualReviewError ? 'This archive needs a compatible export before it can be previewed.' : 'The preview could not be loaded. Try again shortly.' });
    }
    if (job.archive_sha256 && content.archiveSha256 !== job.archive_sha256) {
        throw createError({ statusCode: 409, statusMessage: 'The archive changed. Wait for its next moderation pass.' });
    }
    const offset = Math.max(0, Math.floor(Number(getQuery(event).offset) || 0));
    return { title: content.title, fingerprint: job.fingerprint, archiveSha256: content.archiveSha256,
        reason: job.reason, state: job.state, text: content.text, blank: content.blank, evidence: job.evidence, warnings: content.warnings,
        images: content.images.slice(offset, offset + 8), imageCount: content.images.length, offset };
});
