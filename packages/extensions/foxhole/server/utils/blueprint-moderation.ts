import { useRuntimeConfig } from '#imports';
import { createError } from 'h3';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createNixieServiceRoleClient } from '#nixie-internal/server/utils/nixie-workspaces.ts';
import { readBoundedBlueprintResponse } from './legacy-blueprint-resolver.ts';
import { communityTitleIssue } from '#nixie-internal/app/utils/community-submission.ts';
import { LEGACY_BLUEPRINT_LIMITS } from '#nixie-internal/app/utils/legacy-blueprint-archive-bounds.ts';
import { requireNixieModerationApiResult } from '#nixie-internal/server/utils/nixie-moderation.ts';
import { BLUEPRINT_MODERATION_POLICY, blueprintModerationFlags, requireBlueprintModerationResult } from './blueprint-moderation-policy.ts';
import type { ModerationResult } from './blueprint-moderation-policy.ts';
import { BlueprintManualReviewError, inspectBlueprintArchive, prepareBlueprintImage } from './blueprint-moderation-archive.ts';
import { createHash } from 'node:crypto';

export interface BlueprintModerationJob {
    blueprint_id: string; version_id: string | null; fingerprint: string; published_at: string;
    state: string; attempts: number; lease_token: string | null; archive_sha256: string | null;
    reason: string | null; evidence: Record<string, unknown>;
}

export class BlueprintModerationBudgetError extends Error {}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function loadBlueprintModerationContent(client: SupabaseClient, job: BlueprintModerationJob) {
    const row = await client.from('blueprints').select('id,name,description,authors,game,privacy,version,deleted_at,bp_tags(tags(name,key))').eq('id', job.blueprint_id).single();
    if (row.error || !row.data) {
        throw new Error('Blueprint could not be loaded.');
    }
    if (row.data.deleted_at || !['public', 'unlisted'].includes(row.data.privacy) || row.data.version !== job.version_id) {
        throw new Error('Blueprint changed during review.');
    }
    if (!job.version_id) {
        throw new BlueprintManualReviewError('Blueprint has no current version.');
    }
    const version = await client.from('bp_versions').select('version,changelog').eq('id', job.version_id).eq('blueprint_id', job.blueprint_id).single();
    if (version.error) {
        throw new BlueprintManualReviewError('Blueprint version is missing.');
    }
    async function download(path: string, maxBytes: number, optional = false) {
        const { data } = client.storage.from('blueprints').getPublicUrl(path);
        const url = new URL(data.publicUrl);
        url.searchParams.set('moderation', job.fingerprint);
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) {
            // Storage can return HTTP 400 for a missing object; inspect its bounded error body.
            let missing = response.status === 404;
            try {
                const error = JSON.parse((await readBoundedBlueprintResponse(response, 4096)).toString('utf8'));
                missing ||= error.code === 'NoSuchKey' || error.error === 'not_found';
            } catch {
                await response.body?.cancel();
            }
            if (optional && missing) {
                return null;
            }
            const file = optional ? 'Published icon' : 'Blueprint archive';
            throw new Error(missing ? `${file} is missing from storage.` : `${file} could not be downloaded (HTTP ${response.status}).`);
        }
        return readBoundedBlueprintResponse(response, maxBytes);
    }
    const archive = await download(`${job.blueprint_id}/versions/${job.version_id}.zip`, LEGACY_BLUEPRINT_LIMITS.archiveBytes);
    let content;
    try {
        content = await inspectBlueprintArchive(archive!, { ...row.data, release: { versionLabel: version.data.version, changelog: version.data.changelog } });
    } catch (error) {
        throw new BlueprintManualReviewError(error instanceof Error ? error.message : 'Archive could not be read.');
    }
    // Blank archives are rejected without spending API requests or fetching an unused icon.
    const warnings: string[] = [];
    if (!content.blank) {
        const icon = await download(`${job.blueprint_id}/icon.webp`, 5 * 1024 * 1024, true);
        if (icon) {
            content.images.push(await prepareBlueprintImage('icon.webp', icon));
        } else {
            warnings.push('Published icon is missing. The archive and its uploaded images are still available for review.');
        }
    }
    return { ...content, title: row.data.name, warnings };
}

export async function reviewBlueprintContent(
    content: Awaited<ReturnType<typeof inspectBlueprintArchive>>,
    check: (kind: 'text' | 'image', value: string, sha256?: string) => Promise<ModerationResult>,
) {
    if (content.blank) {
        return { state: 'rejected', reason: 'Add content to this project before publishing.', evidence: { policy: BLUEPRINT_MODERATION_POLICY } };
    }
    const checks: { kind: string; name?: string; sha256?: string; categories: string[]; }[] = [];
    for (const text of content.text) {
        checks.push({ kind: 'text', categories: blueprintModerationFlags(await check('text', text)) });
    }
    const seen = new Map<string, string[]>();
    for (const image of content.images) {
        let flags = seen.get(image.sha256);
        if (!flags) {
            flags = blueprintModerationFlags(await check('image', image.dataUrl, image.sha256));
            seen.set(image.sha256, flags);
        }
        checks.push({ kind: 'image', name: image.name, sha256: image.sha256, categories: flags });
    }
    const flags = [...new Set(checks.flatMap(item => item.categories))];
    return { state: flags.length ? 'needs_review' : 'approved', reason: flags.length ? `Review flagged content: ${flags.join(', ')}.` : 'Text and images passed moderation.',
        evidence: { policy: BLUEPRINT_MODERATION_POLICY, checks } };
}

export async function processBlueprintModerationBatch() {
    const config = useRuntimeConfig();
    if (![true, 'true'].includes(config.nixieBlueprintModerationEnabled as boolean | string)) {
        return { enabled: false, processed: 0 };
    }
    if (!config.nixieChatModerationApiKey) {
        return { enabled: true, processed: 0, error: 'Content safety service is not configured.' };
    }
    const client = createNixieServiceRoleClient() as SupabaseClient;
    const limit = Math.min(5, Math.max(1, Math.floor(Number(config.nixieBlueprintModerationBatchSize) || 3)));
    const order = String(config.nixieBlueprintModerationOrder ?? 'oldest').trim().toLowerCase() === 'newest' ? 'newest' : 'oldest';
    const deadline = Date.now() + 50_000;
    let requests = 0;
    let processed = 0;
    let stop = false;
    const counts: Record<string, number> = {};
    const check = async (kind: 'text' | 'image', value: string, sha256?: string): Promise<ModerationResult> => {
        const model = String(config.nixieChatModerationModel || 'omni-moderation-latest');
        const id = createHash('sha256').update(`${BLUEPRINT_MODERATION_POLICY}:${model}:${kind}:${sha256 || value}`).digest('hex');
        const cached = await client.from('nixie_blueprint_moderation_checks').select('result').eq('id', id).gte('checked_at', new Date(Date.now() - 90 * 86400_000).toISOString()).maybeSingle();
        if (cached.error) {
            throw new Error('Moderation cache is unavailable.');
        }
        if (cached.data) {
            return requireBlueprintModerationResult(cached.data.result, kind);
        }
        if (requests >= 12 || Date.now() >= deadline) {
            throw new BlueprintModerationBudgetError('Batch limit reached; remaining content will resume in a later batch.');
        }
        requests++;
        await wait(1_000);
        const result = requireBlueprintModerationResult(await requireNixieModerationApiResult(kind === 'text' ? value : [{ type: 'image_url', image_url: { url: value } }], `blueprint-${kind}`), kind);
        const saved = await client.from('nixie_blueprint_moderation_checks').upsert({ id, result, checked_at: new Date().toISOString() });
        if (saved.error) {
            throw new Error('Moderation result could not be saved.');
        }
        return result;
    };
    while (processed < limit && !stop && Date.now() < deadline) {
        const claim = await client.rpc('nixie_claim_blueprint_moderation', { p_limit: 1, p_order: order });
        if (claim.error) {
            throw createError({ statusCode: 503, statusMessage: 'Blueprint moderation needs its database migration.' });
        }
        const job = claim.data?.[0] as BlueprintModerationJob | undefined;
        if (!job) {
            break;
        }
        let decision: { state: string; reason: string; evidence: Record<string, unknown>; };
        let archiveSha256: string | null = null;
        try {
            const row = await client.from('blueprints').select('name').eq('id', job.blueprint_id).single();
            if (row.error) {
                throw new Error('Blueprint could not be loaded.');
            }
            const titleIssue = communityTitleIssue(row.data.name);
            if (titleIssue) {
                decision = { state: 'rejected', reason: titleIssue, evidence: { policy: BLUEPRINT_MODERATION_POLICY } };
            } else {
                const content = await loadBlueprintModerationContent(client, job);
                archiveSha256 = content.archiveSha256;
                decision = await reviewBlueprintContent(content, check);
                decision.evidence = { ...decision.evidence, warnings: content.warnings };
            }
        } catch (error) {
            const manual = error instanceof BlueprintManualReviewError;
            const budget = error instanceof BlueprintModerationBudgetError;
            decision = { state: manual || (!budget && job.attempts >= 8) ? 'needs_review' : 'retry',
                reason: error instanceof Error ? error.message : 'Moderation could not complete.', evidence: { policy: BLUEPRINT_MODERATION_POLICY, retryKind: budget ? 'budget' : 'failure' } };
            // Back off the entire run on provider/storage failure, including 429, without discarding cached work.
            stop = !manual;
        }
        const finished = await client.rpc('nixie_finish_blueprint_moderation', {
            p_id: job.blueprint_id, p_fingerprint: job.fingerprint, p_lease: job.lease_token,
            p_state: decision.state, p_reason: decision.reason, p_archive_sha256: archiveSha256, p_evidence: decision.evidence,
        });
        if (finished.error) {
            throw new Error('Moderation decision could not be saved.');
        }
        const outcome = finished.data ? decision.state : 'changed';
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        processed++;
    }
    return { enabled: true, order, processed, requests, counts };
}
