import type { NixieComponentJsonObjectV1,
    NixieInspectorActionV1, NixieInspectorRequestV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { getFoxholeSceneV2ModelComponentData } from './scene-v2-models.ts';

const OWNER = 'nixie.foxhole-planner';
type Patches = NonNullable<NixieInspectorActionV1['patches']>;
type AssetCatalog = Readonly<Record<string, FoxholeSceneV2AssetMetadata>>;

function objects(value: unknown): NixieComponentJsonObjectV1[] {
    return Array.isArray(value) ? value.filter((entry): entry is NixieComponentJsonObjectV1 =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
}

function cargoPatch(cargo: NixieComponentJsonObjectV1, source: FoxholeSceneV2AssetMetadata, target: FoxholeSceneV2AssetMetadata): Patches[number] {
    const original = Array.isArray(cargo.items) ? cargo.items.filter((item): item is string => typeof item === 'string') : [];
    const nativeNonItems = new Set((source.cargo?.groups ?? []).filter(group => group.entryType !== 'Items')
        .flatMap(group => group.allowed.map(code => code.toLowerCase())));
    const nativeItems = new Set((source.cargo?.groups ?? []).filter(group => group.entryType === 'Items')
        .flatMap(group => group.allowed.map(code => code.toLowerCase())));
    const allowed = new Set((target.cargo?.allowedItems ?? []).map(code => code.toLowerCase()));
    const items = original.filter(code => target.cargo?.allowsAnyItem
        ? !nativeNonItems.has(code.toLowerCase()) || nativeItems.has(code.toLowerCase())
        : allowed.has(code.toLowerCase())).slice(0, target.cargo?.limit ?? 256);
    const groups = target.cargo?.groups ?? [];
    const stored = cargo.stockpileItems;
    const set: NixieComponentJsonObjectV1 = { items };
    if (Array.isArray(stored) && groups.length) {
        const rows = objects(stored);
        set.stockpileItems = groups.flatMap(group => {
            const allowedByCode = new Map(group.allowed.map(code => [code.toLowerCase(), code]));
            const selected = rows.filter(row => row.groupKey === group.key).flatMap(row => typeof row.codename === 'string' ? [row.codename] : []);
            return selected.flatMap(code => {
                const canonical = allowedByCode.get(code.toLowerCase());
                return canonical ? [{ groupKey: group.key, codename: canonical }] : [];
            });
        });
    }
    return { componentId: 'cargo', set, ...(stored !== undefined && !groups.length ? { unset: ['stockpileItems'] } : {}) };
}

export function createFoxholeInspectorRelationships(assets: AssetCatalog) {
    const assetByCode = new Map(Object.entries(assets).map(([key, asset]) => [asset.codeName.toLowerCase(), key]));
    const resolve = (key: string | null | undefined) => key && (Object.hasOwn(assets, key) ? key : assetByCode.get(key.toLowerCase())) || undefined;
    const upgradeTarget = (asset: FoxholeSceneV2AssetMetadata) => resolve(asset.upgradeStructureId) ?? resolve(asset.statistics?.upgradeCodeName);
    const conversionTargets = (asset: FoxholeSceneV2AssetMetadata) => (asset.conversionStructureIds ?? []).flatMap(key => {
        const resolved = resolve(key);
        return resolved && assets[resolved]?.isVehicle === asset.isVehicle ? [resolved] : [];
    });
    const conversionParents = new Map<string, string>();
    for (const [key, asset] of Object.entries(assets)) {
        if (asset.isUpgrade || asset.isDestroyed || asset.isBreached) continue;
        for (const targetKey of conversionTargets(asset)) {
            const resolved = resolve(targetKey);
            const target = resolved && assets[resolved];
            if (resolved && target && resolved !== key && target.isVehicle === asset.isVehicle
                && (target.tier == null || asset.tier === target.tier) && !conversionParents.has(resolved)) {
                conversionParents.set(resolved, key);
            }
        }
    }
    return (request: NixieInspectorRequestV1, assetId: string): NixieInspectorActionV1[] => {
        const asset = assets[assetId]!;
        const data = (id: string) => request.subject.components.find(component => component.ownerId === OWNER && component.componentId === id)?.data;
        const appearance = data('appearance');
        const modification = data('modification');
        const selections = objects(modification?.selections);
        const hasUpgrade = selections.some(row => typeof row.slotId === 'string' && typeof row.variantId === 'string'
            && asset.modifications[row.slotId]?.variants[row.variantId]?.isUpgrade);
        const editable = appearance?.destroyed !== true && appearance?.packaged !== true;
        const patchesFor = (targetId: string, clearUpgrade = false): Patches => {
            const target = assets[targetId]!;
            const patches: Patches = [];
            if (!clearUpgrade) {
                patches.push({ componentId: 'asset', set: { assetId: targetId } });
                if (target.model) {
                    const next = getFoxholeSceneV2ModelComponentData(target.model);
                    const current = data('model');
                    const set = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
                    const unset = Object.keys(current ?? {}).filter(key => !Object.hasOwn(set, key));
                    patches.push({ componentId: 'model', set, ...(unset.length ? { unset } : {}) });
                }
                const cargo = data('cargo');
                if (cargo) {
                    patches.push(cargoPatch(cargo, asset, target));
                } else if (target.cargo) {
                    patches.push({ componentId: 'cargo', set: { items: [] } });
                }
                if (target.supportsProduction && !data('production-order')) {
                    patches.push({ componentId: 'production-order', set: { orders: [] } });
                }
            }
            if (modification) {
                patches.push({ componentId: 'modification', set: { selections: selections.filter(row => {
                    if (typeof row.slotId !== 'string' || typeof row.variantId !== 'string') return false;
                    const variant = target.modifications[row.slotId]?.variants[row.variantId];
                    return Boolean(variant && (!clearUpgrade || !variant.isUpgrade));
                }) } });
            }
            return patches;
        };
        const up = upgradeTarget(asset);
        const down = resolve(asset.downgradeStructureId) ?? conversionParents.get(assetId);
        const headers: NixieInspectorActionV1[] = (['down', 'up'] as const).map(direction => {
            const isDown = direction === 'down';
            const clearUpgrade = isDown && hasUpgrade;
            const targetId = clearUpgrade ? assetId : isDown ? down : up;
            const icon = isDown ? 'ph:arrow-down' : 'ph:arrow-up';
            if (!editable || !targetId || (targetId === assetId && !clearUpgrade)) {
                return { id: direction, label: isDown ? 'No lower tier available' : 'No higher tier available', icon };
            }
            return { id: direction, icon, label: 'Tier ' + (isDown ? 'Down' : 'Up') + ' to ' + assets[targetId]!.label,
                patches: patchesFor(targetId, clearUpgrade) };
        });
        if (!editable || !modification) return headers;
        const upgradeSource = down && upgradeTarget(assets[down]!) === assetId ? down : undefined;
        const conversionParent = conversionParents.get(assetId);
        const sourceId = conversionTargets(asset).length ? assetId : conversionParent ?? upgradeSource;
        const source = sourceId ? assets[sourceId] : undefined;
        const targets = new Set([up, ...(source ? [upgradeTarget(source), ...conversionTargets(source)] : [])].filter((key): key is string => Boolean(key)));
        const tiles: NixieInspectorActionV1[] = Array.from(targets, (key, index) => {
            const target = assets[key]!;
            const selected = key === assetId;
            const destination = selected ? conversionParent ?? upgradeSource : key;
            return { id: 'relationship-' + index, icon: 'ph:arrows-left-right', label: target.label,
                tile: { componentId: 'modification', propertyId: 'selections', image: target.browserIcon ?? asset.browserIcon, selected },
                ...(destination && destination !== assetId ? { patches: patchesFor(destination) } : {}) };
        });
        return [...headers, ...tiles];
    };
}
