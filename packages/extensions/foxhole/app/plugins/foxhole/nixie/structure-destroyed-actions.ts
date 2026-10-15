import type { FoxholeStructureAsset, FoxholeStructureCatalog } from './catalog.ts';
import type { FoxholeStructureState } from './types.ts';

export function isFoxholeStructureDestroyed(
    asset: FoxholeStructureAsset | null | undefined,
    state: Partial<FoxholeStructureState>,
): boolean {
    return Boolean(asset && (asset.intactStructureId || state.destroyed === true));
}

export function resolveFoxholeStructureDestroyedMutation(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    state: Partial<FoxholeStructureState>,
    nextDestroyed: boolean,
): Partial<FoxholeStructureState> | null {
    const asset = catalog.assetByKey[String(state.foxholeKey ?? '').trim()];
    if (!asset || !(asset.destroyed || asset.destroyedStructureId || asset.intactStructureId)
        || isFoxholeStructureDestroyed(asset, state) === nextDestroyed) {
        return null;
    }

    // Keep the intact identity: several bunker types share the same wreck.
    const patch: Partial<FoxholeStructureState> = { destroyed: nextDestroyed };
    if (asset.intactStructureId) {
        const intact = catalog.assetByKey[asset.intactStructureId];
        if (!intact) {
            return null;
        }
        // A wreck placed directly has no original intact identity to restore.
        patch.foxholeKey = intact.foxholeKey;
        patch.destroyed = false;
    }
    if (state.packaged === true && (nextDestroyed || asset.intactStructureId)) {
        patch.packaged = false;
    }
    return patch;
}
