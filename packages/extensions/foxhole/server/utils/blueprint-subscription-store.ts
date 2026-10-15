import { createError } from 'h3';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#nixie-internal/types/database.types.ts';
import { LEGACY_BLUEPRINT_PREFIX, legacyBlueprintSourceId } from '#nixie/utils/legacy-blueprints.ts';
import type { LegacyBlueprintListing } from '#nixie/utils/legacy-blueprints.ts';
import type { BlueprintLibraryItem } from '#nixie/utils/blueprint-subscriptions.ts';

/** Uses the authenticated client, preserving existing bp_subscriptions grants and RLS. */
export function foxholeBlueprintSubscriptionStore(client: SupabaseClient<Database>, actorId: string) {
    const fail = () => createError({ statusCode: 503, statusMessage: 'Blueprint subscriptions are unavailable.' });
    return {
        async has(sourceId: string): Promise<boolean> {
            const { data, error } = await client.from('bp_subscriptions').select('blueprint_id')
                .eq('user_id', actorId).eq('blueprint_id', sourceId).limit(1);
            if (error) {
                throw fail();
            }
            return !!data?.length;
        },
        async subscribe(sourceId: string): Promise<void> {
            // DO NOTHING needs INSERT only, unlike DO UPDATE. The pair index is a launch prerequisite.
            const { error } = await client.from('bp_subscriptions').upsert(
                { user_id: actorId, blueprint_id: sourceId },
                { onConflict: 'user_id,blueprint_id', ignoreDuplicates: true },
            );
            if (error) {
                throw fail();
            }
        },
        async unsubscribe(sourceId: string): Promise<void> {
            const { error } = await client.from('bp_subscriptions').delete()
                .eq('user_id', actorId).eq('blueprint_id', sourceId);
            if (error) {
                throw fail();
            }
        },
        async page(cursor: string | null, limit: number) {
            let query = client.from('bp_subscriptions').select('blueprint_id,created_at')
                .eq('user_id', actorId).order('blueprint_id').limit(limit + 1);
            if (cursor) {
                query = query.gt('blueprint_id', cursor);
            }
            const { data, error } = await query;
            if (error) {
                throw fail();
            }
            const ids = (data ?? []).map(row => row.blueprint_id);
            return { ids: ids.slice(0, limit), nextCursor: ids.length > limit ? ids[limit - 1]! : null,
                subscribedAt: Object.fromEntries((data ?? []).filter(row => row.created_at).map(row => [row.blueprint_id, row.created_at])) };
        },
    };
}
