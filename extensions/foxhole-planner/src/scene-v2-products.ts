import type {
    NixieExperimentalComponentProductTemplateV1,
    NixieExperimentalProductQueryV1,
    NixieExperimentalProductResultV1,
    NixieExperimentalProductPresentationV1,
    NixieExperimentalProductDetailCellV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import foxholeSceneV2Assets, { productionRecipesById } from '#foxhole-scene-v2-assets';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { createFoxholeSceneV2SplineProductData } from './scene-v2-connector-products.ts';

export const FOXHOLE_SCENE_V2_PRODUCT_PROVIDER_SYSTEM_ID = 'products.assets';

interface AssetProductEntry {
    assetId: string;
    metadata: FoxholeSceneV2AssetMetadata;
    productId?: string;
    selections?: Array<{ slotId: string; variantId: string; }>;
}

const assets: AssetProductEntry[] = Object.entries(
    foxholeSceneV2Assets as Record<string, FoxholeSceneV2AssetMetadata>,
).map(([assetId, metadata]) => ({ assetId, metadata }))
    .sort((left, right) => left.metadata.label.localeCompare(right.metadata.label));
const upgrades: AssetProductEntry[] = assets.flatMap(({ assetId, metadata }) => Object.entries(metadata.modifications)
    .flatMap(([slotId, slot], slotIndex) => Object.entries(slot.variants).flatMap(([variantId, variant], variantIndex) => variant.isUpgrade
        ? [{ assetId, metadata: { ...metadata, label: `${metadata.label} (${variant.label ?? variantId})`, isUpgrade: true,
            description: variant.description,
            ...(metadata.statistics
                ? { statistics: { ...metadata.statistics, cost: Object.fromEntries(
                    [...new Set([...Object.keys(metadata.statistics.cost), ...Object.keys(metadata.statistics.modificationCosts[slotId]?.[variantId] ?? {})])]
                        .map(id => [id, (metadata.statistics!.cost[id] ?? 0) + (metadata.statistics!.modificationCosts[slotId]?.[variantId]?.[id] ?? 0)]),
                ) } }
                : {}),
            browserIcon: variant.browserIcon ?? metadata.browserIcon, browserPreview: variant.browserPreview ?? metadata.browserPreview,
            order: (metadata.order ?? 0) + variantIndex + 1 },
        productId: `upgrade.${assetId}.${slotIndex}.${variantIndex}`, selections: [{ slotId, variantId }] }]
        : [])));

const resourcesByCode = new Map(Object.values(foxholeSceneV2Assets).map(asset => [asset.codeName.toLowerCase(), asset]));
function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) { return '—'; }
    const rounded = Math.round(seconds);
    const days = Math.floor(rounded / 86400);
    const hours = Math.floor(rounded % 86400 / 3600);
    const minutes = Math.floor(rounded % 3600 / 60);
    const remainder = rounded % 60;
    if (days) { return hours ? `${days}d ${hours}h` : `${days}d`; }
    if (hours) { return minutes ? `${hours}h ${minutes}m` : `${hours}h`; }
    return minutes ? `${minutes}m${remainder ? ` ${remainder}s` : ''}` : `${remainder}s`;
}

function productDetails(assetId: string, selections?: AssetProductEntry['selections']): Pick<NixieExperimentalProductPresentationV1, 'details'> {
    const recipes = Object.values(productionRecipesById).filter(recipe => recipe.sourceStructureId === assetId
        && (selections?.length ? selections.some(selection => selection.variantId === recipe.sourceVariantId) : recipe.sourceVariantId === null));
    if (!recipes.length) {
        return {};
    }
    const resources = (items: Record<string, number>, crates: Record<string, number>, liquids: Record<string, number>) =>
        [[items, false], [crates, true], [liquids, false]].flatMap(([entries, crate]) =>
            Object.entries(entries as Record<string, number>).map(([id, quantity]) => {
                const asset = resourcesByCode.get(id.toLowerCase()) ?? foxholeSceneV2Assets[id];
                return { label: `${asset?.label ?? id}${crate ? ' (Crate)' : ''}`,
                    value: `x${quantity.toLocaleString('en-US', { maximumFractionDigits: 1 })}`,
                    ...(asset?.browserIcon ? { icon: asset.browserIcon } : {}) };
            }).sort((a, b) => a.label.localeCompare(b.label)));
    const rows = recipes.map(recipe => {
        const inputs = resources(recipe.itemInput, recipe.crateInput, recipe.liquidInput);
        const outputs = resources(recipe.itemOutput, recipe.crateOutput, recipe.liquidOutput);
        const power = recipe.powerDelta || foxholeSceneV2Assets[assetId]?.production?.powerDelta || 0;
        return { inputs, outputs, power, duration: recipe.durationSeconds };
    });
    // Like Native, large factories expose an output list rather than hundreds of recipe rows.
    const outputOnly = recipes.length > 12;
    if (outputOnly) {
        return { details: { title: 'Production', columns: ['Outputs'], layout: 'list',
            rows: [...new Set(rows.flatMap(row => row.outputs.map(resource => resource.label)))].sort((a, b) => a.localeCompare(b))
                .map(text => [{ text, tone: 'success' }]) } };
    }
    const hasPower = rows.some(row => row.power !== 0);
    const hasDuration = rows.some(row => row.duration != null && row.duration > 0);
    const resourceCell = (entries: ReturnType<typeof resources>, showLabels: boolean): NixieExperimentalProductDetailCellV1 => entries.length
        ? { resources: entries, showLabels, tone: showLabels ? 'success' : 'danger' } : { text: '—', tone: 'muted' };
    return { details: { title: 'Production', columns: [{ label: 'Inputs', compact: true }, 'Outputs',
        ...(hasPower ? [{ label: 'Power', compact: true, align: 'center' as const }] : []),
        ...(hasDuration ? [{ label: 'Time', compact: true, align: 'center' as const }] : [])],
    rows: rows.map(row => [resourceCell(row.inputs, false), resourceCell(row.outputs, true),
        ...(hasPower ? [{ text: row.power ? `${row.power > 0 ? '+' : ''}${Number.isInteger(row.power / 1000) ? row.power / 1000 : (row.power / 1000).toFixed(1)} MW` : '—', tone: 'warning' as const }] : []),
        ...(hasDuration ? [{ text: formatDuration(row.duration ?? 0), tone: 'info' as const }] : [])]),
    } };
}

/** Preserve the existing browser's tier/category overrides using immutable catalog signals. */
export function matchesFoxholeSceneV2ProductFilters(metadata: FoxholeSceneV2AssetMetadata,
    settings: Readonly<Record<string, boolean | string>>): boolean {
    const enabled = (id: string, fallback = false) => typeof settings[`foxhole.assets.filter.${id}`] === 'boolean'
        ? settings[`foxhole.assets.filter.${id}`] === true
        : fallback;
    const faction = settings['foxhole.assets.filter.faction'];
    if (enabled('3dReady') && !metadata.model) {
        return false;
    }
    if ((faction === 'c' || faction === 'w') && metadata.faction && metadata.faction !== faction) {
        return false;
    }
    const tier = Math.max(1, Math.min(3, Number(settings['foxhole.assets.filter.tier'] ?? 3) || 3));
    const previous = enabled('showPreviousTiers');
    if (metadata.techId && tier < (metadata.techId === 'unlockfacilitytier3' ? 3 : 2)) {
        return false;
    }
    if (metadata.tier != null) {
        if (previous ? metadata.tier > tier : metadata.tier !== tier && !(metadata.tier < tier && !metadata.hasHigherTierSibling)) {
            return false;
        }
    } else if (!previous && metadata.hasHigherTierSibling && metadata.implicitUpgradeTier !== tier) {
        return false;
    }
    if (metadata.isUpgrade && !enabled('upgrades')) {
        return false;
    }
    const destroyed = enabled('destroyed');
    const breached = enabled('breached');
    if (metadata.isBreached ? !destroyed && !breached : metadata.isDestroyed && !destroyed) {
        return false;
    }
    // Vehicles and explicitly requested damaged states override category exclusions in the Native browser.
    if ((metadata.isVehicle && enabled('category.vehicles', true))
        || (destroyed && (metadata.isDestroyed || metadata.isBreached)) || (breached && metadata.isBreached)) {
        return true;
    }
    return !(metadata.isVehicle && !enabled('category.vehicles', true))
        && !(metadata.isBunker && !enabled('category.bunkers', true))
        && !(metadata.isFacility && !enabled('category.facilities', true))
        && !(metadata.isWorldStructure && !enabled('category.world', true))
        && !(metadata.isItem && !enabled('category.items', true));
}

export function listFoxholeSceneV2Products(
    query: NixieExperimentalProductQueryV1,
): NixieExperimentalProductResultV1 {
    const needle = query.query.toLocaleLowerCase();
    const candidates = query.settings?.['foxhole.assets.filter.upgrades'] === true ? [...assets, ...upgrades] : assets;
    const filtered = candidates.filter(({ metadata }) => !query.settings || matchesFoxholeSceneV2ProductFilters(metadata, query.settings))
        .filter(({ assetId, metadata }) => !needle || (
            [metadata.label, metadata.category, metadata.categoryLabel ?? '', assetId, ...metadata.keywords]
                .some(value => value.toLocaleLowerCase().includes(needle))
        )).sort((left, right) => left.metadata.label.localeCompare(right.metadata.label));
    return {
        contractVersion: 1,
        total: filtered.length,
        items: filtered.slice(query.offset, query.offset + query.limit).map(({ assetId, metadata, productId, selections }) => {
            const product: NixieExperimentalProductResultV1['items'][number]['product'] = metadata.isItem
                ? {
                    contractVersion: 1,
                    id: productId ?? `asset.${assetId}`,
                    components: [{
                        ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                        data: { catalogId: 'foxhole.icons', assetId },
                    }, {
                        ownerId: 'nixie.core', componentId: 'icon', version: 1,
                        // Match the ordinary Native item-icon defaults; textures remain owner-qualified resources.
                        data: {
                            label: metadata.label, frameWidth: 128, frameHeight: 128, padding: 20,
                            backgroundColor: 0x0B0B0B, borderColor: 0x00FF00, borderWidth: 3, cornerRadius: 0,
                            iconTint: 0xFFFFFF, labelPosition: 'bottom', labelColor: 0xFFFFFF,
                            labelSize: 28, labelGap: 5, labelWrapWidth: 220, showFrame: true,
                            textureSourcePreserved: false,
                        },
                    }],
                }
                : {
                    contractVersion: 1,
                    id: productId ?? `asset.${assetId}`,
                    components: [{
                        ownerId: 'nixie.foxhole-planner',
                        componentId: 'asset',
                        version: 1,
                        data: { catalogId: 'foxhole.structures', assetId },
                    }, ...(metadata.model
                        ? [{ ownerId: 'nixie.foxhole-planner', componentId: 'model', version: 1, data: { ...metadata.model } }]
                        : []), ...(metadata.connector?.spline
                        ? [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1,
                            data: createFoxholeSceneV2SplineProductData(assetId, metadata.connector) }]
                        : [{ ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, data: {} }]), {
                        ownerId: 'nixie.foxhole-planner',
                        componentId: 'modification',
                        version: 1,
                        data: { selections: selections ?? [] },
                    }, ...(metadata.buildSockets.length
                        ? [{
                            ownerId: 'nixie.foxhole-planner',
                            componentId: 'socket-attachments',
                            version: 1,
                            data: { attachments: [] },
                        } satisfies NixieExperimentalComponentProductTemplateV1]
                        : []), ...(metadata.cargo
                        ? [{
                            ownerId: 'nixie.foxhole-planner',
                            componentId: 'cargo',
                            version: 1,
                            data: { items: [] },
                        } satisfies NixieExperimentalComponentProductTemplateV1]
                        : []), ...(metadata.supportsProduction
                        ? [{
                            ownerId: 'nixie.foxhole-planner',
                            componentId: 'production-order',
                            version: 1,
                            data: { orders: [] },
                        } satisfies NixieExperimentalComponentProductTemplateV1]
                        : [])],
                };
            return {
                label: metadata.label,
                category: metadata.categoryLabel ?? metadata.category,
                keywords: metadata.keywords,
                ...(metadata.browserIcon
                    ? { presentation: {
                        icon: metadata.browserIcon, preview: metadata.browserPreview,
                        description: metadata.description, categoryOrder: metadata.categoryOrder, order: metadata.order,
                        attributes: metadata.browserAttributes ?? [],
                        costs: Object.entries(metadata.statistics?.cost ?? {}).map(([id, quantity]) => {
                            const resource = resourcesByCode.get(id.toLowerCase());
                            return { label: resource?.label ?? id, value: `x${quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
                                ...(resource?.browserIcon ? { icon: resource.browserIcon } : {}) };
                        }),
                        ...productDetails(assetId, selections),
                    } }
                    : {}),
                product,
            };
        }),
    };
}
