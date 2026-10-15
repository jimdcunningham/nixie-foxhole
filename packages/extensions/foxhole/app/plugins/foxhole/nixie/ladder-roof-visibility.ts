import type {
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
    FoxholeStructureRenderLayerAsset,
} from './catalog.ts';
import { isFoxholeRoofRenderLayer } from './structure-render-layer-visibility.ts';

type RoofLayer = Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentName' | 'componentTags'>;
type Selection = {
    slot: Pick<FoxholeStructureModificationSlotAsset, 'name' | 'componentType'>;
    variant: Pick<FoxholeStructureModificationSlotVariantAsset, 'id' | 'isUpgrade' | 'textureUrl'>;
};

/** A native Ladder roof template replaces its own slot's complete Default roof. */
export function resolveFoxholeLadderReplacedRoofLayerIds(
    layers: readonly RoofLayer[],
    selections: readonly Selection[],
    structureCodeName?: string | null,
): ReadonlySet<string> {
    const replaced = new Set<string>();
    const terminal = (value: string | null | undefined) => String(value ?? '').split(':').at(-1)!.trim().toLowerCase();
    for (const { slot, variant } of selections) {
        if (variant.id.trim().toLowerCase() !== 'ladder'
            || slot.componentType.trim().toLowerCase() !== 'bpfortroofmodslot_c'
            || variant.isUpgrade || !variant.textureUrl?.trim()) continue;
        const name = terminal(slot.name);
        if (!name) continue;
        const matches = layers.filter(layer => layer.id.trim()
            && isFoxholeRoofRenderLayer({ id: layer.id, componentTags: [...layer.componentTags] }, structureCodeName)
            && terminal(layer.componentName) === name);
        // Missing or ambiguous native identities must retain the existing roof.
        if (matches.length === 1) replaced.add(matches[0]!.id);
    }
    return replaced;
}
