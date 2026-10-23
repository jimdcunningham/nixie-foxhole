// Keep this ID stable for existing local preferences and saved viewpoints.
export const FOXHOLE_SCENE_FACTION_SETTING_ID = 'nixie.scene.foxholeFaction';
export const FOXHOLE_SCENE_FACTION_OPTIONS = [
    { value: 'asset-default', label: 'Asset Default' },
    { value: 'colonial', label: 'Colonial' },
    { value: 'warden', label: 'Warden' },
] as const;

export function normalizeFoxholeSceneFaction(value: unknown): typeof FOXHOLE_SCENE_FACTION_OPTIONS[number]['value'] {
    return value === 'colonial' || value === 'warden' ? value : 'asset-default';
}
