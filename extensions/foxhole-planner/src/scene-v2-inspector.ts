import type { NixieExperimentalComponentJsonObjectV1, NixieExperimentalInspectorFieldV1,
    NixieExperimentalInspectorRequestV1, NixieExperimentalInspectorResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets, { productionOutputsByRecipeId } from '#foxhole-scene-v2-assets';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import { formatFoxholeStockpileLimits } from './stockpile-groups.ts';
import { usesPipeCurveScale } from './pipe-spline-constraints.ts';
import { hasFoxholeModificationTypeConflict, hasFoxholeSameWallModificationConflict } from './modification-wall-conflicts.ts';
import { FOXHOLE_TACTICAL_PRESET_FIELDS, FOXHOLE_TACTICAL_PRESET_CHOICES } from './tactical-line-presets.ts';

export const FOXHOLE_INSPECTOR_SYSTEM_ID = 'inspect.structure';
export const FOXHOLE_CONNECTOR_INSPECTOR_SYSTEM_ID = 'inspect.spline-connector';

/** Geometry uses Nixie's handles; measurement scale and preset identity remain domain-owned metadata. */
export function inspectFoxholeSceneV2PlanningPath(request: NixieExperimentalInspectorRequestV1): NixieExperimentalInspectorResultV1 {
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
const items = Object.values(assets).filter(asset => asset.isItem);
const itemByCode = new Map(items.map(item => [item.codeName.toLowerCase(), item]));
function label(value: string): string {
    return value.replace(/([a-z\d])([A-Z])/gu, '$1 $2').replace(/[_-]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 128);
}

export function inspectFoxholeSceneV2SplineConnector(request: NixieExperimentalInspectorRequestV1): NixieExperimentalInspectorResultV1 {
    const spline = request.subject.components.find(component => component.ownerId === OWNER && component.componentId === 'spline-connector')?.data;
    if (!spline) {
        return { contractVersion: 1, components: [] };
    }
    const key = typeof spline.foxholeKey === 'string' ? spline.foxholeKey : '';
    const asset = Object.hasOwn(assets, key) ? assets[key] : undefined;
    const powerline = resolveConnectorBehavior(key, asset?.connector).powerline;
    const fields: NixieExperimentalInspectorFieldV1[] = [
        { path: ['foxholeKey'], title: 'Asset', hidden: Boolean(asset), readOnly: true,
            description: 'This asset is unavailable in the installed catalog.' },
        ...['startX', 'startY', 'startRotation', 'startHandleLength', 'endX', 'endY', 'endRotation', 'endHandleLength',
            'minLength', 'maxLength', 'minRadius', 'maxRadius', 'maxBuffer', 'maxTargetAngleDeg', 'maxArcAngleDeg',
            'startSocketName', 'endSocketName', 'startAttachmentNodeId', 'startAttachmentSocketName',
            'endAttachmentNodeId', 'endAttachmentSocketName'].map(property => ({ path: [property], hidden: true })),
        { path: ['curveT'], title: 'Curvature', hidden: !usesPipeCurveScale(asset?.connector?.pathStyle, key, asset?.connector),
            description: 'Adjust the pipe curve from 0 to 1. Move endpoints with the canvas handles.' },
        { path: ['blueprint'], hidden: !asset?.canBlueprint || powerline },
        { path: ['tint'], hidden: powerline },
        { path: ['brightness'], hidden: powerline },
    ];
    return { contractVersion: 1, components: [{ componentId: 'spline-connector', fields }] };
}

export function inspectFoxholeSceneV2Structure(request: NixieExperimentalInspectorRequestV1): NixieExperimentalInspectorResultV1 {
    const data = (id: string): NixieExperimentalComponentJsonObjectV1 | undefined => request.subject.components
        .find(component => component.ownerId === OWNER && component.componentId === id)?.data;
    const assetId = data('asset')?.assetId;
    const asset = typeof assetId === 'string' && Object.hasOwn(assets, assetId) ? assets[assetId] : undefined;
    const result = new Map<string, NixieExperimentalInspectorFieldV1[]>();
    result.set('asset', [{ path: ['catalogId'], hidden: true }, { path: ['assetId'], readOnly: true,
        hidden: Boolean(asset), description: asset ? 'Catalog identity for this asset.' : 'This asset is unavailable in the installed catalog.' }]);
    if (!asset) {
        return { contractVersion: 1, components: [...result].map(([componentId, fields]) => ({ componentId, fields })) };
    }
    const appearance = data('appearance') ?? {};
    const selected = data('modification')?.selections;
    const selections = Array.isArray(selected)
        ? selected.filter((entry): entry is NixieExperimentalComponentJsonObjectV1 =>
            entry !== null && typeof entry === 'object' && !Array.isArray(entry))
        : [];
    const cargoItems = data('cargo')?.items;
    const defaultState = { destroyed: false, packaged: false, blueprint: false };
    const modes = [{ label: 'Default', value: defaultState },
        ...(asset.canBlueprint && !asset.isDestroyed ? [{ label: 'Blueprint', value: { ...defaultState, blueprint: true } }] : []),
        ...(asset.destroyed
            ? [{ label: 'Destroyed', value: { ...defaultState, destroyed: true } }]
            : []),
        ...(asset.packaged ? [{ label: 'Packaged', value: { ...defaultState, packaged: true } }] : [])];
    result.set('appearance', [{ path: [], title: 'State', choices: { valuePropertyIds: ['destroyed', 'packaged', 'blueprint'],
        matchDefaults: defaultState, options: modes } },
    ...['destroyed', 'packaged', 'blueprint', 'anchorX', 'anchorY'].map(property => ({ path: [property], hidden: true })),
    { path: ['colorHex'], title: 'Color Variant', hidden: !Object.keys(asset.colorVariants).length && appearance.colorHex === undefined,
        choices: { options: Object.keys(asset.colorVariants).map(hex => ({ label: `#${hex.toUpperCase()}`, value: hex })) } },
    { path: ['faction'], hidden: !Object.keys(asset.factionVariants).length && appearance.faction === undefined,
        choices: { options: Object.keys(asset.factionVariants).map(faction => ({ label: faction === 'c' ? 'Colonial' : 'Warden', value: faction })) } }]);
    const wallSelections = selections.flatMap(selection => typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
        && asset.modifications[selection.slotId]?.variants[selection.variantId]
        ? [{ slotId: selection.slotId, variantId: selection.variantId }] : []);
    const modifications = Object.entries(asset.modifications).flatMap(([slotId, slot]) => Object.entries(slot.variants)
        .filter(([variantId]) => !hasFoxholeSameWallModificationConflict(slot, variantId, asset.modifications, wallSelections)
            && !hasFoxholeModificationTypeConflict(slot, variantId, asset.modifications, wallSelections))
        .map(([variantId, variant]) => ({ label: label(`${slotId}: ${variant.label ?? variantId}`), value: { slotId, variantId } })));
    result.set('modification', [{ path: ['selections'], title: 'Modifications',
        description: 'Choose one variant for each slot.', hidden: appearance.destroyed === true || appearance.packaged === true
            || (!modifications.length && !selections.length),
        maxItems: Math.min(64, Object.keys(asset.modifications).length),
        choices: { valuePropertyIds: ['slotId', 'variantId'], uniqueBy: ['slotId'], options: modifications } }]);
    const cargo = asset.cargo;
    const codes = cargo?.allowsAnyItem ? items.map(item => item.codeName) : cargo?.allowedItems ?? [];
    const seen = new Set<string>();
    const cargoOptions = codes.filter(code => {
        const key = code.trim().toLowerCase();
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).map(code => ({ label: label(itemByCode.get(code.toLowerCase())?.label ?? code), value: code }))
        .sort((left, right) => left.label.localeCompare(right.label));
    const groups = cargo?.groups ?? [];
    const stockpileOptions = groups.flatMap(group => group.allowed.map(codename => {
        const match = Object.values(assets).find(candidate => candidate.codeName.toLowerCase() === codename.toLowerCase()
            && (group.entryType === 'Items' ? candidate.isItem : !candidate.isItem && candidate.isVehicle === (group.entryType === 'Vehicles')));
        return { label: label(`${group.label} · ${match?.label ?? codename}`), value: { groupKey: group.key, codename } };
    }));
    result.set('cargo', [{ path: ['items'], title: 'Stored Items', hidden: (Boolean(groups.length) && Array.isArray(data('cargo')?.stockpileItems)) || (!cargoOptions.length && (!Array.isArray(cargoItems) || !cargoItems.length)),
        maxItems: Math.max(0, Math.trunc(Math.min(256, cargo?.limit ?? 256))), choices: { uniqueBy: true, options: cargoOptions } },
    { path: ['stockpileItems'], title: 'Stored Cargo by Hold', hidden: !groups.length,
        description: groups.length ? groups.map(group => `${group.label}: ${formatFoxholeStockpileLimits(group)}`).join(' ') : undefined,
        maxItems: 256, choices: { uniqueBy: ['groupKey', 'codename'], valuePropertyIds: ['groupKey', 'codename'], options: stockpileOptions } }]);
    const hasUpgrade = selections.some(selection => typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
        && asset.modifications[selection.slotId]?.variants[selection.variantId]?.isUpgrade);
    const prefixes = [`structure:${assetId}:recipe:`, ...selections.flatMap(selection =>
        typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
            ? [`modification:${assetId}:${selection.slotId}:${selection.variantId}:recipe:`]
            : [])];
    const recipes = Object.entries(productionOutputsByRecipeId).filter(([id]) => prefixes.some(prefix => id.startsWith(prefix)))
        .map(([recipeId, outputs]) => ({ label: label(`${recipeId.startsWith('structure:') && hasUpgrade ? 'Base: ' : ''}${outputs.map(code => itemByCode.get(code.toLowerCase())?.label ?? code).join(', ') || 'Production'} (${recipeId.split(':').at(-1)})`),
            value: { recipeId, parent: recipeId.startsWith('structure:') && hasUpgrade } }));
    result.set('production-order', [{ path: ['orders'], title: 'Production Orders',
        choices: { valuePropertyIds: ['recipeId', 'parent'], matchDefaults: { parent: false }, options: recipes } }]);
    result.set('socket-attachments', [{ path: ['attachments'], hidden: true }]);
    return { contractVersion: 1, components: [...result].filter(([componentId]) => data(componentId) !== undefined)
        .map(([componentId, fields]) => ({ componentId, fields })) };
}
