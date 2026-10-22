import { FOXHOLE_WORLD_LAYER_DEFINITIONS } from '../map-settings.ts';
import type { FoxholeWorldLayerKey } from '../map-settings.ts';

/** Panel groups write the existing individual preferences; there is no second visibility state. */
export const FOXHOLE_WORLD_LAYER_GROUPS = [
    { id: 'terrain', label: 'Terrain', layers: ['terrain', 'shell'] },
    { id: 'buildings', label: 'Buildings', layers: ['building'] },
    { id: 'props', label: 'Props', layers: ['structures'] },
    { id: 'nature', label: 'Nature', layers: ['rocks', 'vegetation'] },
    { id: 'transport', label: 'Transport', layers: ['infrastructure', 'roads'] },
    { id: 'water', label: 'Water', layers: ['water'] },
    { id: 'surface-detail', label: 'Surface Detail', layers: ['decals', 'puddles'] },
    { id: 'effects', label: 'Effects', layers: ['effects'] },
] as const satisfies readonly { id: string; label: string; layers: readonly FoxholeWorldLayerKey[]; }[];

export function activeWorldLayerGroups(layers: Record<FoxholeWorldLayerKey, boolean>): string[] {
    // A partly visible group remains active. Turning it off hides every member;
    // toggling another group preserves any older, individually saved preferences.
    return FOXHOLE_WORLD_LAYER_GROUPS.filter(group => group.layers.some(key => layers[key])).map(group => group.id);
}

export function worldLayerGroupPatch(id: string, enabled: boolean): Record<string, boolean> {
    const group = FOXHOLE_WORLD_LAYER_GROUPS.find(group => group.id === id);
    return Object.fromEntries((group?.layers ?? []).map(key => [
        FOXHOLE_WORLD_LAYER_DEFINITIONS.find(layer => layer.id === key)!.settingId,
        enabled,
    ]));
}
