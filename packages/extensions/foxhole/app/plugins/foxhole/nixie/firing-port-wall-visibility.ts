import type {
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
    FoxholeStructureRenderLayerAsset,
} from './catalog.ts';
import { isFoxholeWallRenderLayer } from './structure-render-layer-visibility.ts';

type WallLayer = Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentName' | 'componentTags'>;
type Selection = {
    slot: Pick<FoxholeStructureModificationSlotAsset, 'name' | 'componentType'>;
    variant: Pick<FoxholeStructureModificationSlotVariantAsset, 'id' | 'isUpgrade' | 'textureUrl'>;
};

function componentName(value: string | null | undefined): string {
    return String(value ?? '').split(':').at(-1)!.trim().toLowerCase();
}

/** A native wall slot's firing-port template replaces only that slot's default wall. */
export function resolveFoxholeFiringPortReplacedWallLayerIds(
    layers: readonly WallLayer[],
    selections: readonly Selection[],
): ReadonlySet<string> {
    const replaced = new Set<string>();
    for (const { slot, variant } of selections) {
        if (variant.id.trim().toLowerCase() !== 'firingport'
            || slot.componentType.trim().toLowerCase() !== 'bpfortwallmodslot_c'
            || variant.isUpgrade || !variant.textureUrl?.trim()) {
            continue;
        }

        const name = componentName(slot.name);
        if (!name) continue;
        const matches = layers.filter(layer => layer.id.trim()
            && isFoxholeWallRenderLayer({ id: layer.id, componentTags: [...layer.componentTags] })
            && componentName(layer.componentName) === name);
        // Unknown or ambiguous component identities must leave the existing art visible.
        if (matches.length === 1) replaced.add(matches[0]!.id);
    }
    return replaced;
}
