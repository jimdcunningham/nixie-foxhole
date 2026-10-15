import { createError } from 'h3';
import { LEGACY_BLUEPRINT_PREFIX, LEGACY_BLUEPRINT_UUID } from '../../../../nixie/app/utils/legacy-blueprints.ts';
import type { LegacyBlueprintListing } from '../../../../nixie/app/utils/legacy-blueprints.ts';

export interface LegacyBlueprintRow {
    id: string; name: string; description: string | null; authors: string | null;
    game: string | null; privacy: string; approved: boolean | null; deleted_at: string | null;
    version: string | null; updated_at: string;
    bp_tags?: { tags: { name: string | null; key: string; } | null; }[];
}
export interface LegacyBlueprintVersion { id: string; blueprint_id: string; version: string | null; created_at?: string; }

export function isEligibleLegacyBlueprint(row: LegacyBlueprintRow | null): row is LegacyBlueprintRow {
    return Boolean(row && LEGACY_BLUEPRINT_UUID.test(row.id) && row.game === 'foxhole'
        && row.privacy === 'public' && row.deleted_at === null && row.approved === true
        && row.version && LEGACY_BLUEPRINT_UUID.test(row.version));
}

function text(value: unknown, max: number): string {
    // Render as text only; strip controls and bound untrusted legacy metadata.
    // eslint-disable-next-line no-control-regex -- Legacy text is untrusted.
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

export function toLegacyBlueprintListing(row: LegacyBlueprintRow, version: LegacyBlueprintVersion): LegacyBlueprintListing {
    if (!isEligibleLegacyBlueprint(row) || version.id !== row.version || version.blueprint_id !== row.id) {
        throw createError({ statusCode: 404, statusMessage: 'Blueprint is unavailable.' });
    }
    const id = `${LEGACY_BLUEPRINT_PREFIX}${row.id}`;
    return {
        sourceKind: 'legacy-foxhole-blueprint', id, sourceId: row.id,
        title: text(row.name, 160), description: text(row.description, 10000), credits: text(row.authors, 1000),
        tags: [...new Set((row.bp_tags ?? []).map(tag => text(tag.tags?.name || tag.tags?.key, 100)).filter(Boolean))].slice(0, 50),
        updatedAt: row.updated_at,
        sourceUrl: `https://foxholeplanner.com/?hub=blueprints&page=view/${row.id}`,
        thumbnailUrl: `/api/nixie/legacy-blueprints/${id}/thumbnail`,
        requiredExtensionIds: ['foxhole'], format: 'foxhole-legacy-plan',
        version: { id: version.id, label: text(version.version, 120), ...(version.created_at ? { publishedAt: version.created_at } : {}) },
    };
}

export function foxholeLegacyBlueprintSearchText(value: unknown): string {
    // No PostgREST filter grammar or wildcard characters from the request.
    return text(value, 120).replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
}

export function foxholeLegacyBlueprintCursor(value: unknown): string | null {
    if (value == null || value === '') {
        return null;
    }
    if (typeof value !== 'string' || !LEGACY_BLUEPRINT_UUID.test(value)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Blueprint cursor.' });
    }
    return value.toLowerCase();
}
