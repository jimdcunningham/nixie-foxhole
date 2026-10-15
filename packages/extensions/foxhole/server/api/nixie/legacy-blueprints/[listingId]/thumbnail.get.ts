import { getRouterParam } from 'h3';
import { deliverLegacyBlueprintThumbnail } from '#foxhole-server/utils/legacy-blueprint-delivery.ts';

export default defineEventHandler(event => deliverLegacyBlueprintThumbnail(event, getRouterParam(event, 'listingId') ?? ''));
