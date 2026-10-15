import { defineEventHandler, getRouterParam, createError } from 'h3';
import { legacyBlueprintSourceId } from '#nixie-internal/app/utils/legacy-blueprints.ts';
import { requireBlueprintSubscriptions } from '#nixie-internal/server/utils/blueprint-subscriptions.ts';

export default defineEventHandler(async event => {
    const store = await requireBlueprintSubscriptions(event);
    let sourceId: string;
    try {
        sourceId = legacyBlueprintSourceId(getRouterParam(event, 'listingId') ?? '');
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    return { subscribed: await store.has(sourceId) };
});
