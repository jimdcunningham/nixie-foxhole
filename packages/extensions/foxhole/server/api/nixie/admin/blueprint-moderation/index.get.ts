import { createError, getQuery } from 'h3';
import { serverSupabaseServiceRole } from '#supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDiscoveryAdmin } from '../../../../../../../nixie/server/utils/discovery-metrics.ts';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async event => {
    await requireDiscoveryAdmin(event);
    const client = serverSupabaseServiceRole(event) as SupabaseClient;
    const state = String(getQuery(event).state || 'needs_review');
    const outcome = String(getQuery(event).outcome || 'all');
    const filterParam = getQuery(event).filters;
    const clauses: Record<string, string> = {
        needs_review: 'state.eq.needs_review',
        rejected: 'state.eq.rejected',
        rejected_automatic: 'and(state.eq.rejected,reviewed_by.is.null)',
        rejected_manual: 'and(state.eq.rejected,reviewed_by.not.is.null)',
        retry: 'state.eq.retry',
        approved: 'state.eq.approved',
    };
    const filters = filterParam === undefined ? null : String(filterParam).split(',');
    if (filters && (!filters.length || filters.some(value => !Object.hasOwn(clauses, value)))) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid moderation outcome filter.' });
    }
    if (!['all', 'automatic', 'manual'].includes(outcome)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid rejection outcome filter.' });
    }
    if (!['needs_review', 'rejected', 'retry', 'pending', 'processing', 'approved'].includes(state)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid review filter.' });
    }
    const query = client.from('nixie_blueprint_moderation').select('blueprint_id,version_id,fingerprint,published_at,state,attempts,reason,archive_sha256,evidence,updated_at,blueprints!inner(name,privacy,deleted_at)', { count: 'exact' })
        .is('blueprints.deleted_at', null).in('blueprints.privacy', ['public', 'unlisted'])
        .order('published_at', { ascending: false }).order('blueprint_id', { ascending: false }).limit(50);
    if (filters) {
        // Rejected is the selected parent of either subtype, rather than an extra all-rejections clause.
        const hasRejectionSubtype = filters.some(value => value === 'rejected_automatic' || value === 'rejected_manual');
        query.or([...new Set(filters)].filter(value => value !== 'rejected' || !hasRejectionSubtype).map(value => clauses[value]).join(','));
    } else {
        query.eq('state', state);
    }
    if (!filters && state === 'rejected' && outcome === 'manual') {
        query.not('reviewed_by', 'is', null);
    } else if (!filters && state === 'rejected' && outcome === 'automatic') {
        query.is('reviewed_by', null);
    }
    const result = await query;
    if (result.error) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint moderation needs its database migration.' });
    }
    const config = useRuntimeConfig(event);
    return { items: result.data, count: result.count, enabled: [true, 'true'].includes(config.nixieBlueprintModerationEnabled as boolean | string), configured: Boolean(config.nixieChatModerationApiKey) };
});
