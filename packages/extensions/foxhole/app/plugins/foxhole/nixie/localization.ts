import { createNixieLocalizationV1 } from '@nixiejs/extension-sdk';
import { createFoxholeAssetsBaseUrl, getFoxholeLocalizationStrings } from './catalog.ts';
import { FOXHOLE_LOCALE_OPTIONS, FOXHOLE_LOCALE_SETTING_ID } from './asset-settings.ts';
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

const localization = createNixieLocalizationV1({ defaultLocale: DEFAULT_FOXHOLE_LOCALE,
    supportedLocales: FOXHOLE_LOCALE_OPTIONS.filter(option => option.value !== 'auto').map(option => option.value) });

export function getFoxholePreferredLocale(explicitLocale?: string | null): string {
    return localization.resolveLocale(explicitLocale || getFoxholeUserLocalePreference());
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
