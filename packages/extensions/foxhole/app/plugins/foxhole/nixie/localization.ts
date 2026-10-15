import { createFoxholeAssetsBaseUrl, getFoxholeLocalizationStrings } from './catalog.ts';
import { FOXHOLE_LOCALE_SETTING_ID } from './asset-settings.ts';
import { resolveFoxholeLocalizedText as resolveFoxholeLocalizedTextInternal } from './localization-text.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

export { resolveFoxholeLocalizedText } from './localization-text.ts';

export const DEFAULT_FOXHOLE_LOCALE = 'en';

function getFoxholeUserLocalePreference(): string | null {
    try {
        const settingsStore = useNixieSettingsStore();
        const value = String(settingsStore.getValue(FOXHOLE_LOCALE_SETTING_ID) ?? '').trim().toLowerCase();
        if (!value || value === 'auto') {
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

export function getFoxholePreferredLocale(explicitLocale?: string | null): string {
    const preferred = String(explicitLocale ?? '').trim();
    if (preferred) {
        return preferred;
    }

    const userPreference = getFoxholeUserLocalePreference();
    if (userPreference) {
        return userPreference;
    }

    if (typeof navigator !== 'undefined') {
        const browserLocale = navigator.languages?.find(Boolean) ?? navigator.language;
        if (browserLocale) {
            return browserLocale;
        }
    }

    if (typeof document !== 'undefined') {
        const documentLocale = document.documentElement?.lang;
        if (documentLocale) {
            return documentLocale;
        }
    }

    return DEFAULT_FOXHOLE_LOCALE;
}

export function getFoxholeLocalizedText(
    appBaseUrl: string,
    localizationId: string | null | undefined,
    fallback: string | null | undefined,
    preferredLocale?: string | null,
): string {
    const locale = getFoxholePreferredLocale(preferredLocale);
    const strings = getFoxholeLocalizationStrings(createFoxholeAssetsBaseUrl(appBaseUrl), locale);
    return resolveFoxholeLocalizedTextInternal(strings, localizationId, fallback);
}
