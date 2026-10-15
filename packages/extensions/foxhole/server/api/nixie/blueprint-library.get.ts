import { defineEventHandler, getQuery } from 'h3';
import { requireBlueprintSubscriptions } from '../../../../../nixie/server/utils/blueprint-subscriptions.ts';
import { readBlueprintLibrary } from '../../../../../nixie/server/utils/blueprint-subscription-store.ts';
import { getFoxholeLegacyBlueprint } from '../../utils/legacy-blueprints.ts';
import { foxholeLegacyBlueprintCursor } from '../../utils/legacy-blueprint-source.ts';

export default defineEventHandler(async event => {
    const store = await requireBlueprintSubscriptions(event);
    const query = getQuery(event);
    const cursor = foxholeLegacyBlueprintCursor(query.cursor);
    return readBlueprintLibrary(store, id => getFoxholeLegacyBlueprint(event, id), cursor, 24);
});
