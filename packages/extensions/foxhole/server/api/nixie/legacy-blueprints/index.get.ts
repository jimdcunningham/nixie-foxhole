import { getQuery } from 'h3';
import { searchFoxholeLegacyBlueprints } from '#foxhole-server/utils/legacy-blueprints.ts';

export default defineEventHandler(event => searchFoxholeLegacyBlueprints(event, getQuery(event)));
