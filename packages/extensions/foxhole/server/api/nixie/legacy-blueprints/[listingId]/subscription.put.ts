import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { legacyBlueprintSourceId } from '../../../../../../../nixie/app/utils/legacy-blueprints.ts';
import { requireBlueprintSubscriptions } from '../../../../../../../nixie/server/utils/blueprint-subscriptions.ts';
import { changeBlueprintSubscription } from '../../../../../../../nixie/server/utils/blueprint-subscription-store.ts';
import { getFoxholeLegacyBlueprint } from '../../../../utils/legacy-blueprints.ts';

export default defineEventHandler(async event => {
    const store = await requireBlueprintSubscriptions(event);
    const body = await readBody<{ subscribed?: unknown; }>(event);
    if (typeof body?.subscribed !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: 'Choose a subscription state.' });
    }
    const listingId = getRouterParam(event, 'listingId') ?? '';
    try {
        legacyBlueprintSourceId(listingId);
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    return changeBlueprintSubscription(store, id => getFoxholeLegacyBlueprint(event, id), listingId, body.subscribed);
});
