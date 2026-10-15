import type { FoxholeStockpileSelectionGroup } from '../../../../../../../extensions/foxhole-planner/src/stockpile-groups.ts';
export * from '../../../../../../../extensions/foxhole-planner/src/stockpile-groups.ts';
import type { FoxholeItemAsset, FoxholeStructureAsset } from './catalog.ts';

export function resolveFoxholeStockpileOptions(group: FoxholeStockpileSelectionGroup, items: FoxholeItemAsset[], structures: FoxholeStructureAsset[], label: (asset: FoxholeItemAsset | FoxholeStructureAsset) => string) {
    return group.allowed.map(codename => {
        const key = codename.toLowerCase();
        const item = group.entryType === 'Items' ? items.find(asset => asset.codeName.toLowerCase() === key) ?? null : null;
        const structure = group.entryType !== 'Items'
            ? structures.find(asset => asset.codeName.toLowerCase() === key && asset.isVehicle === (group.entryType === 'Vehicles')) ?? null : null;
        return { value: codename, label: item || structure ? label((item || structure)!) : codename, item, structure };
    });
}
