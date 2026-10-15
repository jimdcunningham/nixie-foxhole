import { normalizeFoxholeColorHex } from './types.ts';
import type { FoxholeStructureState } from './types.ts';
import { normalizeFoxholeModificationSelectionMap } from './modification-slots.ts';
import { normalizeMarkedItemCodenames } from './hold-profile.ts';
import { normalizeFoxholeStructureProductionOrders } from './production/orders.ts';

export const DEFAULT_FOXHOLE_STRUCTURE_STATE: FoxholeStructureState = {
    foxholeKey: '',
    faction: null,
    destroyed: false,
    packaged: false,
    blueprint: false,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    locked: false,
    anchorX: 0.5,
    anchorY: 0.5,
    modificationVariantIds: {},
    socketAttachments: {},
    markedItemCodenames: [],
    productionOrders: [],
    disableProduction: false,
};

export function normalizeFoxholeStructureState(state: FoxholeStructureState): FoxholeStructureState {
    const colorHex = normalizeFoxholeColorHex(state.colorHex) ?? undefined;
    const packaged = state.packaged === true;
    const tint = Number.isFinite(state.tint) && Number(state.tint) !== 0xFFFFFF
        ? (Number(state.tint) >>> 0)
        : undefined;
    const brightness = Number.isFinite(state.brightness) && Number(state.brightness) !== 1
        ? Number(state.brightness)
        : undefined;
    return {
        ...state,
        colorHex,
        destroyed: packaged ? false : state.destroyed === true,
        packaged,
        blueprint: packaged ? false : state.blueprint === true,
        tint,
        brightness,
        modificationVariantIds: normalizeFoxholeModificationSelectionMap(state.modificationVariantIds),
        markedItemCodenames: normalizeMarkedItemCodenames(state.markedItemCodenames),
        productionOrders: normalizeFoxholeStructureProductionOrders(state.productionOrders),
        disableProduction: state.disableProduction === true,
    };
}
