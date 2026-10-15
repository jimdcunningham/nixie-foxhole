import { getRouterParam } from 'h3';
import { getFoxholeLegacyBlueprint } from '#foxhole-server/utils/legacy-blueprints.ts';

export default defineEventHandler(async event => ({ blueprint: await getFoxholeLegacyBlueprint(event, getRouterParam(event, 'listingId') ?? '') }));
