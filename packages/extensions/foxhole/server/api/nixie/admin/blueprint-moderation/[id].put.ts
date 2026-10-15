import { createError, readBody, getRouterParam } from 'h3';
import { serverSupabaseServiceRole } from '#supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDiscoveryAdmin, requireDiscoverySameOrigin } from '../../../../../../../nixie/server/utils/discovery-metrics.ts';
import { loadBlueprintModerationContent } from '../../../../utils/blueprint-moderation.ts';
import type { BlueprintModerationJob } from '../../../../utils/blueprint-moderation.ts';
import { LEGACY_BLUEPRINT_UUID } from '../../../../../../../nixie/app/utils/legacy-blueprints.ts';
import { communityTitleIssue } from '../../../../../../../nixie/app/utils/community-submission.ts';

export default defineEventHandler(async event => {
    requireDiscoverySameOrigin(event);
    const user = await requireDiscoveryAdmin(event);
    const id = getRouterParam(event, 'id') || '';
    const body = await readBody(event);
    if (!LEGACY_BLUEPRINT_UUID.test(id) || !['approved', 'rejected'].includes(body?.state) || typeof body?.fingerprint !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'Invalid moderation decision.' });
    }
    const client = serverSupabaseServiceRole(event) as SupabaseClient;
    const row = await client.from('nixie_blueprint_moderation').select('*').eq('blueprint_id', id).single();
    if (row.error || row.data.fingerprint !== body.fingerprint) {
        throw createError({ statusCode: 409, statusMessage: 'The review changed. Refresh and try again.' });
    }
    const job = row.data as BlueprintModerationJob;
    if (body.state === 'approved') {
        const content = await loadBlueprintModerationContent(client, job);
        const issue = communityTitleIssue(content.title);
        if (issue || content.blank) {
            throw createError({ statusCode: 422, statusMessage: issue || 'Blank projects cannot be published.' });
        }
        if (content.archiveSha256 !== body.archiveSha256) {
            throw createError({ statusCode: 409, statusMessage: 'The archive changed. Refresh and review it again.' });
        }
    }
    const finished = await client.rpc('nixie_finish_blueprint_moderation', {
        p_id: id, p_fingerprint: job.fingerprint, p_lease: null, p_state: body.state,
        p_reason: body.state === 'approved' ? 'Approved after manual text and image review.' : 'Rejected after manual review.',
        p_archive_sha256: body.state === 'approved' ? body.archiveSha256 : job.archive_sha256,
        p_evidence: job.evidence, p_reviewer: user.id,
    });
    if (finished.error || !finished.data) {
        throw createError({ statusCode: 409, statusMessage: 'This upload changed. Refresh and try again.' });
    }
    return { state: body.state };
});
