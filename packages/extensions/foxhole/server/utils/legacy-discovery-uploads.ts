import { createError } from 'h3';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#nixie-internal/types/database.types.ts';
import { LEGACY_BLUEPRINT_PREFIX } from '#nixie/utils/legacy-blueprints.ts';
import { discoveryBeforeFilter, discoveryPosition, decodeDiscoveryCursor, encodeDiscoveryCursor } from '#nixie-server/utils/discovery-cursor.ts';
export async function readFoxholeLegacyUploads(client: SupabaseClient<Database>, actorId: string, cursor?: unknown) {
    const position = cursor ? discoveryPosition(decodeDiscoveryCursor(cursor)) : null;
    const limit = 24;
        let request = client.from('blueprints')
            .select('id,name,description,privacy,approved,version,created_at,updated_at')
            .eq('user_id', actorId).eq('game', 'foxhole').is('deleted_at', null)
            .order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
        if (position) {
            request = request.or(discoveryBeforeFilter(position));
        }
        const { data, error } = await request;
        if (error) {
            throw createError({ statusCode: 503, statusMessage: 'Uploads could not be loaded.' });
        }
        const rows = data ?? [];
        const page = rows.slice(0, limit);
        return {
            items: page.map(row => ({
                id: `${LEGACY_BLUEPRINT_PREFIX}${row.id}`, sourceKind: 'legacy-foxhole-blueprint' as const, title: row.name,
                description: row.description ?? '', visibility: row.privacy,
                status: row.approved === true ? 'Approved' : row.approved === false ? 'Not Approved' : 'Pending Review',
                createdAt: row.created_at, updatedAt: row.updated_at, projectId: null,
                sourceUrl: `https://foxholeplanner.com/?hub=blueprints&page=view/${row.id}`,
                canView: row.privacy === 'public' && row.approved === true && Boolean(row.version),
            })),
            nextCursor: rows.length > limit ? encodeDiscoveryCursor({ updatedAt: page.at(-1)!.updated_at, id: page.at(-1)!.id }) : null,
        };

}
