import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

export const FOXHOLE_CATALOG_LOCALES = ['en', 'de', 'fr', 'pt', 'ru', 'zh'] as const;

export function resolveFoxholeCatalogLocale(value: unknown, browserLocale = 'en'): string {
    const locale = String(value && value !== 'auto' ? value : browserLocale).toLowerCase().split(/[-_]/u)[0]!;
    return FOXHOLE_CATALOG_LOCALES.includes(locale as typeof FOXHOLE_CATALOG_LOCALES[number]) ? locale : 'en';
}

/** Presentation choices never alter canonical product, asset, slot or variant IDs. */
export function presentFoxholeCatalogAssets(assets: Readonly<Record<string, FoxholeSceneV2AssetMetadata>>,
    strings: Readonly<Record<string, string>>, rendered: boolean): Record<string, FoxholeSceneV2AssetMetadata> {
    const translate = (id: string | undefined, fallback: string | undefined) => (id ? strings[id]?.trim() : '') || fallback;
    return Object.fromEntries(Object.entries(assets).map(([id, asset]) => [id, {
        ...asset,
        label: translate(asset.localizedText?.name, asset.label)!,
        description: translate(asset.localizedText?.description, asset.description),
        categoryLabel: translate(asset.localizedText?.category, asset.categoryLabel),
        browserIcon: rendered ? asset.browserRenderedIcon ?? asset.browserIcon : asset.browserIcon,
        modifications: Object.fromEntries(Object.entries(asset.modifications).map(([slotId, slot]) => [slotId, { ...slot,
            variants: Object.fromEntries(Object.entries(slot.variants).map(([variantId, variant]) => [variantId, { ...variant,
                label: translate(variant.localizedText?.name, variant.label),
                description: translate(variant.localizedText?.description, variant.description),
                browserIcon: rendered ? variant.browserRenderedIcon ?? variant.browserIcon : variant.browserIcon,
            }])),
        }])),
    }]));
}
