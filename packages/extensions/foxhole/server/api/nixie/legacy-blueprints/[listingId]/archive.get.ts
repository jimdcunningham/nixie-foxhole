import { getQuery, getRouterParam } from 'h3';
import { deliverLegacyBlueprintArchive } from '#foxhole-server/utils/legacy-blueprint-delivery.ts';

export default defineEventHandler(event => deliverLegacyBlueprintArchive(event, getRouterParam(event, 'listingId') ?? '', getQuery(event).intent === 'insert' ? 'Insert' : 'Copy'));
