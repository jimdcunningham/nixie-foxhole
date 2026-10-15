import { parseNixieTagList, serializeNixieTagList } from '#nixie/utils/nixie-tags.ts';
import type { LegacyPlanSave } from './plan-types.ts';

/**
 * Project identity fields written into Nixie document settings on legacy import.
 * Legacy `authors` is freeform credit junk — mapped to `credits`, not accounts.
 */
export type LegacyPlanIdentitySettings = {
    description?: string;
    credits?: string;
    tags?: string;
};

function normalizeText(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

/** Coerce legacy authors (string, or occasional array/list junk) into credits text. */
export function mapLegacyPlanAuthorsToCredits(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(entry => normalizeText(entry))
            .filter(Boolean)
            .join('\n');
    }
    return normalizeText(value);
}

/**
 * Map upgraded legacy save identity fields into Nixie project settings values.
 * Omits empty keys so callers can spread into document settings safely.
 */
export function mapLegacyPlanIdentitySettings(
    save: Pick<LegacyPlanSave, 'description' | 'authors' | 'tags'> | null | undefined,
): LegacyPlanIdentitySettings {
    const description = normalizeText(save?.description);
    const credits = mapLegacyPlanAuthorsToCredits(save?.authors);
    const tags = serializeNixieTagList(parseNixieTagList(save?.tags));

    const next: LegacyPlanIdentitySettings = {};
    if (description) {
        next.description = description;
    }
    if (credits) {
        next.credits = credits;
    }
    if (tags) {
        next.tags = tags;
    }
    return next;
}
