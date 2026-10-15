import { computed, shallowRef, watch } from 'vue';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeLocalizationStrings,
    loadFoxholeLocalizationStrings,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    getFoxholePreferredLocale,
    resolveFoxholeLocalizedText,
} from '#foxhole/plugins/foxhole/nixie/localization.ts';

export function useFoxholeLocalization() {
    const runtimeConfig = useRuntimeConfig();
    const assetBaseUrl = computed(() => createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL));
    const locale = computed(() => getFoxholePreferredLocale());
    const strings = shallowRef<Record<string, string>>({});

    watch([assetBaseUrl, locale], async ([nextAssetBaseUrl, nextLocale]) => {
        strings.value = getFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
        if (typeof window === 'undefined') {
            return;
        }

        try {
            strings.value = await loadFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
        } catch {
            strings.value = getFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
        }
    }, { immediate: true });

    function t(localizationId: string | null | undefined, fallback: string | null | undefined): string {
        return resolveFoxholeLocalizedText(strings.value, localizationId, fallback);
    }

    return {
        assetBaseUrl,
        locale,
        strings,
        t,
    };
}
