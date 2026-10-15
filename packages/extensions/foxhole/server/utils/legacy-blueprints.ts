import { createError, setHeader } from 'h3';
import type { H3Event } from 'h3';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#nixie-internal/types/database.types.ts';
import { serverSupabaseServiceRole } from '#supabase/server';
import { useRuntimeConfig } from '#imports';
import { legacyBlueprintFlag, legacyBlueprintSourceId } from '#nixie-internal/app/utils/legacy-blueprints.ts';
import { isEligibleLegacyBlueprint, foxholeLegacyBlueprintCursor, foxholeLegacyBlueprintSearchText, toLegacyBlueprintListing } from './legacy-blueprint-source.ts';
import { decodeDiscoveryCursor, discoveryPosition, discoveryBeforeFilter, encodeDiscoveryCursor } from '#nixie-internal/server/utils/discovery-cursor.ts';
import type { LegacyBlueprintRow, LegacyBlueprintVersion } from './legacy-blueprint-source.ts';

const COLUMNS = 'id,name,description,authors,game,privacy,approved,deleted_at,version,updated_at,bp_tags(tags(name,key))';
type Client = SupabaseClient<Database>;

export function requireFoxholeLegacyBlueprintFeature(event: H3Event, feature = 'Discovery'): void {
    // Includes disabled/error responses; never retain a revoked catalogue, icon or archive.
    setHeader(event, 'Cache-Control', 'private, no-store');
    const config = useRuntimeConfig(event);
    if (!legacyBlueprintFlag(config.public[`legacyBlueprint${feature}Enabled` as keyof typeof config.public])) {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint bridge is unavailable.' });
    }
}

function eligibleQuery(client: Client) {
    return client.from('blueprints').select(COLUMNS).eq('game', 'foxhole').eq('privacy', 'public')
        .eq('approved', true).is('deleted_at', null).not('version', 'is', null);
}

export async function getFoxholeLegacyBlueprint(event: H3Event, listingId: string) {
    requireFoxholeLegacyBlueprintFeature(event);
    let id: string;
    try {
        id = legacyBlueprintSourceId(listingId);
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    const client = serverSupabaseServiceRole(event);
    const { data, error } = await eligibleQuery(client).eq('id', id).maybeSingle();
    const row = data as unknown as LegacyBlueprintRow | null;
    if (error) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint eligibility could not be checked.' });
    }
    if (!isEligibleLegacyBlueprint(row)) {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    const version = await client.from('bp_versions').select('id,blueprint_id,version,created_at').eq('id', row.version!)
        .eq('blueprint_id', row.id).maybeSingle();
    if (version.error) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint version could not be checked.' });
    }
    if (!version.data) {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    return toLegacyBlueprintListing(row, version.data as LegacyBlueprintVersion);
}

export async function searchFoxholeLegacyBlueprints(event: H3Event, options: { q?: unknown; cursor?: unknown; limit?: unknown; tag?: unknown; ids?: string[]; } = {}) {
    requireFoxholeLegacyBlueprintFeature(event);
    const client = serverSupabaseServiceRole(event);
    const limit = Math.min(48, Math.max(1, Math.floor(Number(options.limit) || 24)));
    const cursor = options.cursor ? discoveryPosition(decodeDiscoveryCursor(options.cursor)) : null;
    if (cursor) foxholeLegacyBlueprintCursor(cursor.id);
    const q = foxholeLegacyBlueprintSearchText(options.q);
    let request = eligibleQuery(client).order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (options.ids) request = request.in('id', options.ids.map(legacyBlueprintSourceId));
    if (cursor) {
        request = request.or(discoveryBeforeFilter(cursor));
    }
    if (q) {
        request = request.or(`name.ilike.%${q}%,description.ilike.%${q}%,authors.ilike.%${q}%`);
    }
    // Tags use their own explicit filter rather than interpolating relation predicates.
    if (options.tag) {
        const tag = foxholeLegacyBlueprintSearchText(options.tag);
        const matches = await client.from('tags').select('id').eq('game', 'foxhole').eq('key', tag).limit(1);
        if (matches.error) {
            throw createError({ statusCode: 503, statusMessage: 'Blueprint tags could not be checked.' });
        }
        if (!matches.data?.length) {
            return { blueprints: [], nextCursor: null };
        }
        const links = await client.from('bp_tags').select('blueprint_id').eq('tag_id', matches.data[0]!.id).limit(5000);
        if (links.error || links.data?.length === 5000) {
            throw createError({ statusCode: 503, statusMessage: 'Blueprint tag search is unavailable.' });
        }
        if (!links.data?.length) {
            return { blueprints: [], nextCursor: null };
        }
        request = request.in('id', links.data.map(link => link.blueprint_id));
    }
    const { data, error } = await request;
    if (error) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint catalogue could not be checked.' });
    }
    const rows = (data ?? []) as unknown as LegacyBlueprintRow[];
    const page = rows.slice(0, limit);
    const ids = page.map(row => row.version).filter(Boolean) as string[];
    const versions = ids.length ? await client.from('bp_versions').select('id,blueprint_id,version').in('id', ids) : { data: [], error: null };
    if (versions.error) {
        throw createError({ statusCode: 503, statusMessage: 'Blueprint versions could not be checked.' });
    }
    const byId = new Map((versions.data ?? []).map(version => [version.id, version as LegacyBlueprintVersion]));
    return {
        blueprints: page.flatMap(row => {
            const version = byId.get(row.version!);
            return isEligibleLegacyBlueprint(row) && version?.blueprint_id === row.id ? [toLegacyBlueprintListing(row, version)] : [];
        }),
        nextCursor: rows.length > limit ? encodeDiscoveryCursor({ updatedAt: page.at(-1)!.updated_at, id: page.at(-1)!.id }) : null,
    };
}
