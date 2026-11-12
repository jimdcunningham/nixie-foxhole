import { foxholeColorLabel } from './color-label.ts';
import { localizedFoxholeCatalog } from './catalog-localization.ts';
import { resolveFoxholeSdkProductionOrderLimit } from './production-statistics.ts';
import { FOXHOLE_MAINTENANCE_CATEGORIES, includesFoxholeMaintenanceNeighbor, isFoxholeMaintenanceTunnel, normalizeFoxholeMaintenanceFilters, resolveFoxholeMaintenanceCoverage } from './maintenance-supply.ts';
import type { NixieComponentJsonObjectV1, NixieInspectorFieldV1,
    NixieInspectorActionV1, NixieInspectorReadoutV1, NixieInspectorRequestV1, NixieInspectorResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets, { productionOutputsByRecipeId, productionRecipesById } from '#foxhole-scene-v2-assets';
import { createFoxholeInspectorRelationships } from './scene-v2-inspector-relationships.ts';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import { buildFoxholeInspectorModificationAvailability } from './scene-v2-modification-availability.ts';
import { resolveFoxholeSceneV2HitboxFrame } from './scene-v2-renderers.ts';
import { FOXHOLE_HITBOX_SETTING_ID, resolveFoxholeDefaultHitboxPolygons } from './scene-v2-hitbox-overlays.ts';
import { formatFoxholeStockpileLimits, labelFoxholeStockpileGroups } from './stockpile-groups.ts';
import { usesPipeCurveScale } from './pipe-spline-constraints.ts';
import { hasFoxholeModificationTypeConflict, hasFoxholeSameWallModificationConflict } from './modification-wall-conflicts.ts';
import { FOXHOLE_TACTICAL_PRESET_FIELDS, FOXHOLE_TACTICAL_PRESET_CHOICES } from './tactical-line-presets.ts';

export const FOXHOLE_INSPECTOR_SYSTEM_ID = 'inspect.structure';
export const FOXHOLE_CONNECTOR_INSPECTOR_SYSTEM_ID = 'inspect.spline-connector';

/** Geometry uses Nixie's handles; measurement scale and preset identity remain domain-owned metadata. */
export function inspectFoxholeSceneV2PlanningPath(request: NixieInspectorRequestV1): NixieInspectorResultV1 {
    const component = request.subject.components.find(candidate => ['range', 'binocular-line', 'tactical-line', 'triangulation'].includes(candidate.componentId));
    return { contractVersion: 1, components: component
        ? [{ componentId: component.componentId,
            fields: component.componentId === 'tactical-line'
                ? [{ path: [], title: 'Tactical Preset', description: 'Apply the complete preset styling while preserving the line vertices.',
                    choices: { valuePropertyIds: FOXHOLE_TACTICAL_PRESET_FIELDS, options: FOXHOLE_TACTICAL_PRESET_CHOICES } },
                { path: ['presetId'], hidden: true }]
                : [{ path: ['meterPixels'], hidden: true }] }]
        : [] };
}
const OWNER = 'nixie.foxhole-planner';
function label(value: string, maxLength = 128): string {
    return value.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength).trimEnd();
}

function inspectorSummary(assetId: string, asset: (typeof assets)[string]) {
    const canonicalLabel = assets[assetId]?.label ?? asset.label;
    const tier = /\(Tier (\d)\)/u.exec(canonicalLabel);
    const wikiPage = (tier ? canonicalLabel.slice(0, tier.index) : canonicalLabel).trim().replaceAll(' ', '_');
    return {
        title: label(asset.label), identifier: '#' + assetId, image: asset.browserPreview ?? asset.browserIcon,
        link: { label: 'wiki.gg', host: 'foxhole.wiki.gg', path: ['wiki', wikiPage],
            ...(tier ? { fragment: `Tier_${tier[1]}-0` } : {}) },
    };
}

function connectorVariantMenu(key: string, asset: (typeof assets)[string] | undefined) {
    return asset?.canBlueprint && !resolveConnectorBehavior(key, asset.connector).powerline
        ? { label: 'Variants', toggles: [{ componentId: 'spline-connector', propertyId: 'blueprint', label: 'Blueprint', icon: 'ph:blueprint' }] }
        : undefined;
}

export function inspectFoxholeSceneV2SplineConnector(request: NixieInspectorRequestV1): NixieInspectorResultV1 {
    const assets = localizedFoxholeCatalog(request.locale);
    const spline = request.subject.components.find(component => component.ownerId === OWNER && component.componentId === 'spline-connector')?.data;
    if (!spline) {
        return { contractVersion: 1, components: [] };
    }
    const key = typeof spline.foxholeKey === 'string' ? spline.foxholeKey : '';
    const asset = Object.hasOwn(assets, key) ? assets[key] : undefined;
    const fields: NixieInspectorFieldV1[] = [
        { path: ['foxholeKey'], title: 'Asset', hidden: Boolean(asset), readOnly: true,
            description: 'This asset is unavailable in the installed catalog.' },
        ...['startX', 'startY', 'startRotation', 'startHandleLength', 'endX', 'endY', 'endRotation', 'endHandleLength',
            'minLength', 'maxLength', 'minRadius', 'maxRadius', 'maxBuffer', 'maxTargetAngleDeg', 'maxArcAngleDeg',
            'startSocketName', 'endSocketName', 'startAttachmentNodeId', 'startAttachmentSocketName',
            'endAttachmentNodeId', 'endAttachmentSocketName'].map(property => ({ path: [property], hidden: true })),
        { path: ['curveT'], title: 'Curvature', hidden: !usesPipeCurveScale(asset?.connector?.pathStyle, key, asset?.connector) },
        ...['blueprint', 'tint', 'brightness'].map(property => ({ path: [property], hidden: true })),
    ];
    const menu = connectorVariantMenu(key, asset);
    const hasAsset = request.subject.components.some(component => component.ownerId === OWNER && component.componentId === 'asset');
    return { contractVersion: 1,
        ...(!hasAsset ? { layout: {
            title: 'Foxhole (SDK)',
            batch: { label: 'Foxhole Nodes', hint: 'Batch edit the selected Foxhole nodes.' },
            summary: asset ? inspectorSummary(key, asset) : { title: 'Unknown Connector', identifier: '#' + key },
            ...(menu ? { menu } : {}),
            tabs: fields.some(field => !field.hidden)
                ? [{ id: 'connector', label: 'Connector', componentIds: ['spline-connector'] }] : [],
        } } : {}),
        components: [{ componentId: 'spline-connector', fields }] };
}

function supplyReadouts(request: NixieInspectorRequestV1, filters: unknown): NixieInspectorReadoutV1[] {
    const assets = localizedFoxholeCatalog(request.locale);
    const nearby = request.nearby;
    if (!nearby || nearby.truncated) {
        return [{ title: 'Coverage', rows: [], hint: nearby?.truncated
            ? 'Too many nearby structures to calculate upkeep and coverage.'
            : 'Select one placed tunnel to inspect coverage.' }];
    }
    function projectAsset(key: unknown, destroyed: unknown, packaged: unknown) {
        const asset = typeof key === 'string' && Object.hasOwn(assets, key) ? assets[key] : undefined;
        if (!asset || asset.isItem) {
            return null;
        }
        const drain = asset.statistics?.decaySupplyDrain ?? 0;
        return { assetId: String(key), category: asset.category,
            drain: drain > 0 ? drain : asset.statistics?.decays === true ? 1 : 0,
            operational: destroyed !== true && packaged !== true };
    }

    function project(entity: typeof request.subject, position: { x: number; y: number; }) {
        const key = entity.components.find(component => component.ownerId === OWNER && component.componentId === 'asset')?.data.assetId;
        const appearance = entity.components.find(component => component.ownerId === OWNER && component.componentId === 'appearance')?.data;
        const asset = projectAsset(key, appearance?.destroyed, appearance?.packaged);
        return asset ? { ...asset, ...position, id: entity.entityId } : null;
    }
    const tunnel = project(request.subject, nearby.origin);
    if (!tunnel) {
        return [];
    }
    const counts = new Map<string, number>();
    let suppliesPerHour = 0;
    function add(candidate: { assetId: string; drain: number; }, count = 1): void {
        counts.set(candidate.assetId, (counts.get(candidate.assetId) ?? 0) + count);
        suppliesPerHour += candidate.drain * count;
    }
    if (nearby.groups) {
        if (tunnel.operational) {
            add(tunnel);
            const { exclusions } = normalizeFoxholeMaintenanceFilters(filters);
            for (const { values: [key, destroyed, packaged], count } of nearby.groups) {
                const candidate = projectAsset(key, destroyed, packaged);
                if (candidate && includesFoxholeMaintenanceNeighbor(candidate, exclusions)) add(candidate, count);
            }
        }
    } else {
        const candidates = nearby.entities.flatMap(({ entity, position }) => {
            const candidate = project(entity, position);
            return candidate ? [candidate] : [];
        });
        for (const structure of resolveFoxholeMaintenanceCoverage(tunnel, candidates, filters).structures) add(structure);
    }
    const rows = Array.from(counts, ([key, count]) => ({
        label: assets[key]?.label ?? key, value: 'x' + count.toLocaleString(), image: assets[key]?.browserIcon,
    })).sort((left, right) => left.label.localeCompare(right.label));
    const supply = assets.maintenancesupplies;
    return [
        { title: 'Upkeep', hint: 'Estimated upkeep, including this tunnel. Other supply sources can change actual consumption.',
            rows: [{ label: supply?.label ?? 'Maintenance Supplies', image: supply?.browserIcon, valueTone: 'cost',
                value: '~' + suppliesPerHour.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' / hour' }] },
        { title: 'Coverage', rows },
    ];
}

export function inspectFoxholeSceneV2Structure(request: NixieInspectorRequestV1): NixieInspectorResultV1 {
    const assets = localizedFoxholeCatalog(request.locale);
    const items = Object.values(assets).filter(asset => asset.isItem);
    const itemByCode = new Map(items.map(item => [item.codeName.toLowerCase(), item]));
    const data = (id: string): NixieComponentJsonObjectV1 | undefined => request.subject.components
        .find(component => component.ownerId === OWNER && component.componentId === id)?.data;
    const assetId = data('asset')?.assetId;
    const asset = typeof assetId === 'string' && Object.hasOwn(assets, assetId) ? assets[assetId] : undefined;
    const result = new Map<string, NixieInspectorFieldV1[]>();
    result.set('asset', [{ path: ['catalogId'], hidden: true }, { path: ['assetId'], readOnly: true,
        hidden: Boolean(asset), description: asset ? 'Catalog identity for this asset.' : 'This asset is unavailable in the installed catalog.' }]);
    if (!asset) {
        return { contractVersion: 1, components: [...result].map(([componentId, fields]) => ({ componentId, fields })) };
    }
    const appearance = data('appearance') ?? {};
    const selected = data('modification')?.selections;
    const selections = Array.isArray(selected)
        ? selected.filter((entry): entry is NixieComponentJsonObjectV1 =>
            entry !== null && typeof entry === 'object' && !Array.isArray(entry))
        : [];
    const cargoItems = data('cargo')?.items;
    const defaultState = { destroyed: false, packaged: false, blueprint: false };
    const modes = [{ label: 'Default', value: defaultState },
        ...(asset.destroyed
            ? [{ label: 'Demolished', icon: 'ph:bomb', value: { ...defaultState, destroyed: true } }]
            : []),
        ...(asset.canBlueprint && !asset.isDestroyed ? [{ label: 'Blueprint', icon: 'ph:blueprint', value: { ...defaultState, blueprint: true } }] : []),
        ...(asset.packaged ? [{ label: 'Packaged', icon: 'ph:package', value: { ...defaultState, packaged: true } }] : [])];
    result.set('appearance', [{ path: [], title: 'State', choices: { valuePropertyIds: ['destroyed', 'packaged', 'blueprint'],
        matchDefaults: defaultState, options: modes } },
    ...['destroyed', 'packaged', 'blueprint', 'anchorX', 'anchorY'].map(property => ({ path: [property], hidden: true })),
    { path: ['colorHex'], title: 'Color Variant', hidden: !Object.keys(asset.colorVariants).length && appearance.colorHex === undefined,
        choices: { options: Object.keys(asset.colorVariants).map(hex => ({ label: foxholeColorLabel(hex), value: hex, swatch: `#${hex}` })) } },
    { path: ['faction'], hidden: !Object.keys(asset.factionVariants).length && appearance.faction === undefined,
        choices: { options: Object.keys(asset.factionVariants).map(faction => ({ label: faction === 'c' ? 'Colonial' : 'Warden', value: faction })) } }]);
    const wallSelections = selections.flatMap(selection => typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
        && asset.modifications[selection.slotId]?.variants[selection.variantId]
        ? [{ slotId: selection.slotId, variantId: selection.variantId }] : []);
    const relationshipActions = createFoxholeInspectorRelationships(assets)(request, String(assetId));
    const availableModification = buildFoxholeInspectorModificationAvailability(request, assets);
    const modifications = Object.entries(asset.modifications).flatMap(([slotId, slot]) => Object.entries(slot.variants)
        .filter(([variantId, variant]) => availableModification(slot, variant) && !hasFoxholeSameWallModificationConflict(slot, variantId, asset.modifications, wallSelections)
            && !hasFoxholeModificationTypeConflict(slot, variantId, asset.modifications, wallSelections))
        .map(([variantId, variant]) => {
            const name = label(variant.label ?? variantId);
            const description = variant.description && label(variant.description, 1024);
            return { label: name, value: { slotId, variantId }, image: variant.browserIcon ?? asset.browserIcon,
                ...(description ? { description } : {}),
                ...(variant.isUpgrade ? {} : { tileGroup: {
                    id: `${variantId}:${name}`.slice(0, 128),
                    itemLabel: label((slot.name ?? slotId).replace(/(?:mod)?slot$/iu, '')) || 'Upgrade',
                } }),
            };
        }));
    result.set('modification', [{ path: ['selections'], title: 'Modifications',
        description: 'Choose one variant for each slot.', hidden: appearance.destroyed === true || appearance.packaged === true
            || (!modifications.length && !selections.length && !relationshipActions.some(action => action.tile)),
        maxItems: Math.min(64, Object.keys(asset.modifications).length),
        choices: { presentation: 'tiles', previewOnHover: true, valuePropertyIds: ['slotId', 'variantId'], uniqueBy: ['slotId'], options: modifications } }]);
    const cargo = asset.cargo;
    const holdTarget = asset.isVehicle ? 'vehicle' : 'structure';
    let capacityHint: string | undefined;
    if (cargo?.limit === 1 && cargo.retainsWhenPackaged) {
        capacityHint = `This ${holdTarget} holds one fuel type at a time.`;
    } else if (cargo?.limit) {
        const inventory = !cargo.retainsWhenPackaged;
        const unit = inventory ? 'inventory slot' : 'crate';
        capacityHint = `This ${holdTarget} ${inventory ? 'has' : 'can hold up to'} ${cargo.limit} ${unit}${cargo.limit === 1 ? '' : 's'}.`;
    } else if (cargo?.allowsAnyItem) {
        capacityHint = `This ${holdTarget} can hold any item type.`;
    }
    const codes = cargo?.allowsAnyItem ? items.map(item => item.codeName) : cargo?.allowedItems ?? [];
    const seen = new Set<string>();
    const cargoOptions = codes.filter(code => {
        const key = code.trim().toLowerCase();
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).map(code => {
        const item = itemByCode.get(code.toLowerCase());
        return { label: label(item?.label ?? code), value: code, image: item?.browserIcon };
    })
        .sort((left, right) => left.label.localeCompare(right.label));
    const groups = cargo?.groups ?? [];
    const stockpileLabels = labelFoxholeStockpileGroups(groups);
    const legacyCargo = !Array.isArray(data('cargo')?.stockpileItems) && Array.isArray(cargoItems)
        ? new Set(cargoItems.flatMap(code => typeof code === 'string' ? [code.toLowerCase()] : []))
        : undefined;
    const stockpileOptions = groups.flatMap(group => group.allowed.map(codename => {
        const match = Object.values(assets).find(candidate => candidate.codeName.toLowerCase() === codename.toLowerCase()
            && (group.entryType === 'Items' ? candidate.isItem : !candidate.isItem && candidate.isVehicle === (group.entryType === 'Vehicles')));
        return { label: match?.label ?? codename, value: { groupKey: group.key, codename }, image: match?.browserIcon,
            ...(legacyCargo?.has(codename.toLowerCase()) ? { initiallySelected: true as const } : {}) };
    }));
    result.set('cargo', [{ path: ['items'], title: cargo?.limit === 1 ? 'Select stored item...' : 'Select stored items...',
        hidden: Boolean(groups.length) || (!cargoOptions.length && (!Array.isArray(cargoItems) || !cargoItems.length)),
        description: capacityHint, maxItems: Math.max(0, Math.trunc(Math.min(256, cargo?.limit ?? 256))), choices: { presentation: 'multi-select', uniqueBy: true, options: cargoOptions } },
    { path: ['stockpileItems'], title: 'Select stored cargo...', hidden: !groups.length,
        ...(groups.length ? { maxItems: 256, choices: { uniqueBy: ['groupKey', 'codename'], valuePropertyIds: ['groupKey', 'codename'],
            options: stockpileOptions, groupedSelection: { groupPropertyId: 'groupKey', itemPropertyId: 'codename',
                groups: groups.map(group => {
                    const hint = formatFoxholeStockpileLimits(group);
                    return { value: group.key, label: stockpileLabels.get(group.key)!, ...(hint ? { hint } : {}) };
                }) } } } : {}) }]);
    if (cargo && (groups.length || cargoOptions.length || Array.isArray(cargoItems) && cargoItems.length)) {
        result.get('cargo')!.push(
            { path: ['cargoOffsetX'], title: 'Offset X (px)', suffix: 'px', preview: cargo.offsetX },
            { path: ['cargoOffsetY'], title: 'Offset Y (px)', suffix: 'px', preview: cargo.offsetY },
        );
    }
    const hasUpgrade = selections.some(selection => typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
        && asset.modifications[selection.slotId]?.variants[selection.variantId]?.isUpgrade);
    const productionActions = new Map<string, NixieInspectorActionV1>();
    const recipeFaction = request.settings?.['foxhole.assets.filter.faction'];
    const recipePrefix = `structure:${assetId}:recipe:`;
    const modificationPrefix = `modification:${assetId}:`;
    const assembly = typeof assetId === 'string' && /^facilityvehiclefactory[123]$/iu.test(assetId);
    const recipeEntries = Object.entries(productionOutputsByRecipeId)
        .filter(([recipeId]) => recipeId.startsWith(recipePrefix) || recipeId.startsWith(modificationPrefix))
        .sort(([a], [b]) => Number(b.startsWith(recipePrefix)) - Number(a.startsWith(recipePrefix)));
    const recipes = recipeEntries.flatMap(([recipeId, outputs]) => {
        const recipe = productionRecipesById[recipeId];
        const [source, , slotId, variantId] = recipeId.split(':');
        const slot = slotId && asset.modifications[slotId];
        const variant = source === 'modification' && slot && variantId ? slot.variants[variantId] : undefined;
        const applied = source === 'modification' && selections.some(selection => selection.slotId === slotId && selection.variantId === variantId);
        let actionId: string | undefined;
        if (source === 'modification' && !applied) {
            if (!slot || !slotId || !variant?.isUpgrade || !variantId || !data('modification') || !data('production-order')
                || !modifications.some(option => option.value.slotId === slotId && option.value.variantId === variantId)) return [];
            const key = slotId + ':' + variantId;
            let action = productionActions.get(key);
            if (!action) {
                action = { id: 'production-upgrade-' + (productionActions.size + 1),
                    label: label(variant.label ?? variantId), icon: 'ph:arrow-up',
                    collection: { componentId: 'production-order', propertyId: 'orders' },
                    patches: [{ componentId: 'modification', set: {
                        selections: [...selections.filter(selection => selection.slotId !== slotId), { slotId, variantId }],
                    } }],
                };
                productionActions.set(key, action);
            }
            actionId = action.id;
        }
        const resource = (code: string) => itemByCode.get(code.toLowerCase()) ?? assets[code.toLowerCase()];
        const resourceLabel = (code: string) => resource(code)?.label?.trim() || label(code);
        const rows = (amounts: Record<string, number> | undefined, unit?: string) => Object.entries(amounts ?? {}).map(([code, value]) => {
            const name = resourceLabel(code);
            const assemblyCrate = assembly && unit === 'crates';
            return {
                label: assemblyCrate ? name.slice(0, 120) + ' (Crate)' : name.slice(0, 128),
                value, ...(unit ? { unit } : {}),
                ...(assemblyCrate ? { badgeIcon: 'ph:package' } : {}),
                ...(resource(code)?.browserIcon ? { image: resource(code)!.browserIcon } : {}),
            };
        });
        const factions = outputs.map(code => resource(code)?.faction).filter(faction => faction === 'c' || faction === 'w');
        const omitFromPicker = (recipeFaction === 'c' || recipeFaction === 'w') && factions.length > 0 && !factions.includes(recipeFaction);
        const inputs = [...rows(recipe?.itemInput), ...rows(recipe?.crateInput, 'crates'), ...rows(recipe?.liquidInput, 'L')];
        const products = [...rows(recipe?.itemOutput), ...rows(recipe?.crateOutput, 'crates'), ...rows(recipe?.liquidOutput, 'L')];
        const powerDelta = recipe?.powerDelta || asset.production?.powerDelta;
        const metricPreview = assembly ? 'assembly' : true as const;
        const metrics = [
            ...(powerDelta == null ? [] : [{ label: 'Power', value: powerDelta / 1000, unit: 'MW', icon: 'nx:lightning', preview: metricPreview }]),
            ...(recipe?.durationSeconds == null ? [] : [{ label: 'Duration', value: recipe.durationSeconds, unit: 's', scale: 'repeat' as const, icon: 'ph:timer', preview: metricPreview }]),
        ];
        const name = outputs.map(resourceLabel).join(', ') || 'Production';
        return [{ label: name.slice(0, 128), value: { recipeId, parent: source === 'structure' && hasUpgrade },
            ...(actionId ? { actionId } : {}),
            details: { group: label(variant?.label ?? 'Base Facility'),
                ...(actionId ? { showWhen: 'upgrades' } : {}),
                ...(omitFromPicker ? { omitFromPicker: true as const } : {}),
                metrics, sections: [
                    { title: 'Inputs', preview: assembly ? 'assembly' : true as const, rows: inputs },
                    { title: 'Outputs', preview: true as const, rows: products },
                ] } }];
    });
    result.set('production-order', [{ path: ['orders'], title: 'Production Orders', hidden: !asset.supportsProduction,
        maxItems: Math.min(64, resolveFoxholeSdkProductionOrderLimit(String(assetId), asset.production?.maxOrders)),
        choices: { presentation: 'add-dialog', valuePropertyIds: ['recipeId', 'parent'], matchDefaults: { parent: false }, options: recipes,
            collection: { title: 'Add Production Orders', itemLabel: 'Order', pluralLabel: 'Production Orders',
                detailsTitle: 'Recipe Breakdown', countLabel: 'Orders',
                sectionPresentation: [
                    { title: 'Inputs', displayTitle: 'Production Input', valueFormat: 'count', valueTone: 'cost' },
                    { title: 'Outputs', displayTitle: 'Production Output', valueFormat: 'count', valueTone: 'gain' },
                ],
                metricPresentation: [
                    { label: 'Power', detailsLabel: false },
                    { label: 'Duration', detailsLabel: 'Cycle Time', detailsFormat: 'duration' },
                ],
                labelPropertyId: 'label', repeatPropertyId: 'cycles', repeatLabel: 'Cycles',
                compactWhenOff: 'outputs',
                muteActionGroups: true,
                ...(assembly ? { iconGridWhenOff: 'assembly' } : {}),
                displayOptions: [
                    { id: 'assembly', label: 'Show Assembly Recipes', icon: 'ph:factory' },
                    { id: 'outputs', label: 'Show Output Resources', icon: 'ph:package', enabled: true },
                    { id: 'upgrades', label: 'Show All Upgrades', icon: 'ph:circles-three-plus', enabled: true },
                ] } },
    }, { path: ['disabled'], hidden: true }]);
    result.set('socket-attachments', [{ path: ['attachments'], hidden: true }]);
    const connector = data('spline-connector') ? inspectFoxholeSceneV2SplineConnector(request).components[0] : undefined;
    if (connector) {
        // The connector provider supplies fields; this layout reserves their placement.
        result.set('spline-connector', []);
    }
    const supplyDefaults = isFoxholeMaintenanceTunnel(assetId) && !data('maintenance-supply')
        ? { ...normalizeFoxholeMaintenanceFilters(undefined) } : undefined;
    if (data('maintenance-supply') || supplyDefaults) {
        const categories = ['Defenses', 'Entrenchments', 'Utilities', 'Facilities', 'Harvesters', 'Power', 'Liquid', 'Foundations', 'Shippables'];
        result.set('maintenance-supply', [
            { path: ['range'], title: 'Supply Range', suffix: 'm' },
            { path: ['exclusions'], title: 'Maintained Categories', choices: {
                presentation: 'toggle-grid', invertSelection: true, uniqueBy: true,
                options: FOXHOLE_MAINTENANCE_CATEGORIES.map((value, index) => ({ value, label: categories[index]!,
                    image: { resourceId: 'foxhole.icon.iconfilter' + ['defense', 'bunker', 'general', 'facility', 'mining',
                        'power', 'liquid', 'foundation', 'shippingcontainer'][index] },
                })),
            } },
        ]);
    }
    const tabs = [
        { id: 'upgrades', label: 'Upgrades', componentIds: ['modification'] },
        { id: 'production', label: 'Production', componentIds: ['production-order'] },
        { id: 'supply', label: 'Supply', componentIds: ['maintenance-supply'],
            ...(isFoxholeMaintenanceTunnel(assetId) ? { readouts: supplyReadouts(request, data('maintenance-supply') ?? supplyDefaults) } : {}) },
        { id: 'storage', label: 'Storage', componentIds: ['cargo'] },
        ...(connector?.fields.some(field => !field.hidden)
            ? [{ id: 'connector', label: 'Connector', componentIds: ['spline-connector'] }] : []),
    ].filter(tab => tab.componentIds.some(componentId => (data(componentId) !== undefined || (componentId === 'maintenance-supply' && supplyDefaults))
        && (componentId === 'maintenance-supply' || componentId === 'spline-connector'
            || result.get(componentId)?.some(field => !field.hidden))));
    const hitboxKey = String(assetId).toLowerCase();
    const splineKey = data('spline-connector')?.foxholeKey;
    const splineMenu = typeof splineKey === 'string' ? connectorVariantMenu(splineKey, assets[splineKey]) : undefined;
    return { contractVersion: 1, layout: {
        title: 'Foxhole (SDK)',
        batch: { label: 'Foxhole Nodes', hint: 'Batch edit the selected Foxhole nodes.' },
        ...(!asset.isItem ? { hitboxes: { settingId: FOXHOLE_HITBOX_SETTING_ID, seedDefaultsOnSelection: true, unitsPerDisplayUnit: 32, unit: 'm', clipboardKind: 'foxhole-hitboxes',
            export: {
                fileName: `${hitboxKey}.manifest.json`, property: 'lineOfSightPolygons',
                handoff: {
                    before: [
                        `Update the authored FoxWatch override for \`${hitboxKey}\`.`, '',
                        'Repository: `https://github.com/jimdcunningham/nixie-foxhole`', '',
                        `Edit \`tools/foxwatch/asset-overrides/${hitboxKey}/manifest.json\` and set \`lineOfSightPolygons\` to exactly:`,
                    ].join('\n'),
                    after: `Preserve every other existing manifest property. From the nixie-foxhole repository root, run \`node ./tools/foxwatch/run-foxwatch.mjs refresh --only ${hitboxKey}\` to refresh the generated Foxhole assets. Do not edit generated public manifests directly.`,
                },
            },
            frame: resolveFoxholeSceneV2HitboxFrame(request.subject, String(assetId), asset),
            defaults: resolveFoxholeDefaultHitboxPolygons(asset, wallSelections.map(selection =>
                asset.modifications[selection.slotId]!.variants[selection.variantId]!)).slice(0, 128) } } : {}),
        ...(result.get('cargo')?.some(field => field.preview !== undefined) ? { previewControls: [{
            componentId: 'cargo', title: 'Offset', resetLabel: 'Reset Offset Overrides', fields: [
                { propertyId: 'cargoOffsetX', label: 'X', exportKey: 'offsetX' },
                { propertyId: 'cargoOffsetY', label: 'Y', exportKey: 'offsetY' },
            ], handoff: { label: 'Copy Handoff Prompt', property: 'markedCargoOverlay', before: [
                `Update the storage overlay anchor for ${assetId} using these board-local offsets from the transform center.`,
                'Repository: https://github.com/jimdcunningham/nixie-foxhole',
                `File: tools/foxwatch/asset-overrides/${assetId}/manifest.json`,
                'Merge the following values into the asset override and regenerate its catalog metadata.',
            ].join('\n') },
        }] } : {}),
        actions: [...relationshipActions, ...productionActions.values()],
        summary: inspectorSummary(String(assetId), asset),
        ...(data('appearance') ? { menu: { label: 'Variants', componentId: 'appearance',
            ...((asset.supportsProduction || asset.production?.powerDelta) && data('production-order') ? { toggles: [{ componentId: 'production-order', propertyId: 'disabled',
                label: 'Production Stats', inverted: true, icon: 'ph:chart-bar-horizontal' }] } : {}) } } : splineMenu ? { menu: splineMenu } : {}),
        tabs,
    }, components: [...result].flatMap(([componentId, fields]) => {
        if (data(componentId) !== undefined) return [{ componentId, fields }];
        if (componentId === 'appearance') return [{ componentId, fields, initialData: {} }];
        return componentId === 'maintenance-supply' && supplyDefaults ? [{ componentId, fields, initialData: supplyDefaults }] : [];
    }) };
}
