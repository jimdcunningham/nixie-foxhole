import { getFoxholeManifestRevision } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
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

    watch([assetBaseUrl, locale, getFoxholeManifestRevision], async ([nextAssetBaseUrl, nextLocale], _previous, onCleanup) => {
        let current = true;
        onCleanup(() => { current = false; });
        strings.value = getFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
        if (typeof window === 'undefined') {
            return;
        }

        try {
            const loaded = await loadFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
            if (current) strings.value = loaded;
        } catch {
            if (current) strings.value = getFoxholeLocalizationStrings(nextAssetBaseUrl, nextLocale);
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
