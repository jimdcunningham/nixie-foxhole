import type { FoxholeSceneV2StructureRange } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_NIGHT_RANGE_SETTING_IDS } from './night-ranges.ts';

export const FOXHOLE_STRUCTURE_RANGE_DEFINITIONS = {
    supply: { label: 'Supply', description: 'Show maintenance supply coverage ranges.', icon: 'ph:package', type: 'preventDecay', color: 0x4ECDC4, legacy: 'logistics.utility' },
    garrison: { label: 'Garrison', description: 'Show garrison coverage ranges.', icon: 'ph:shield-check', type: 'garrison', color: 0xD2B48C, legacy: 'coverage.support' },
    harvest: { label: 'Harvest', description: 'Show resource field ranges.', icon: 'ph:plant', type: 'resourceField', color: 0x5BC0FF, legacy: 'logistics.utility' },
    crane: { label: 'Crane', description: 'Show crane operating ranges.', icon: 'ph:crane', type: 'crane', color: 0x70D6FF, legacy: 'logistics.utility' },
    rifle: { label: 'Rifle', description: 'Show rifle garrison ranges.', icon: 'ph:crosshair', type: 'killbox', color: 0xE16931, legacy: 'defense.smallArms' },
    machineGun: { label: 'MG', description: 'Show machine gun garrison ranges.', icon: 'ph:crosshair-simple', type: 'killboxMG', color: 0x3A86FF, legacy: 'defense.smallArms' },
    antiTank: { label: 'Anti-Tank', description: 'Show anti-tank engagement ranges.', icon: 'ph:tank', type: 'killboxAT', color: 0xF45B69, legacy: 'defense.antiTank' },
    artillery: { label: 'Artillery', description: 'Show artillery engagement ranges.', icon: 'ph:target', type: 'killboxArty', color: 0xF6D55C, legacy: 'defense.artillery' },
    rpg: { label: 'RPG', description: 'Show rocket engagement ranges.', icon: 'ph:rocket-launch', type: 'killboxRocket', color: 0xE16931, legacy: 'defense.artillery' },
    antiAir: { label: 'Anti-Air', description: 'Show anti-air engagement ranges.', icon: 'ph:airplane-tilt', type: 'killboxAA', color: 0xFF6B35, legacy: 'defense.artillery' },
    intel: { label: 'Intel', description: 'Show intelligence coverage ranges.', icon: 'ph:radar', type: 'intel', color: 0x9D7CFF, legacy: 'coverage.support' },
    overlap: { label: 'Overlap', description: 'Show crane overlap exclusion ranges.', icon: 'ph:circles-three', type: 'overlap', color: 0xFF6B6B, legacy: 'logistics.utility' },
} as const;

export const FOXHOLE_STRUCTURE_RANGE_SETTING_IDS = ['foxhole.ranges.selectionOnly', ...FOXHOLE_NIGHT_RANGE_SETTING_IDS, ...Object.keys(FOXHOLE_STRUCTURE_RANGE_DEFINITIONS).map(key => `foxhole.ranges.${key}`),
    ...[...new Set(Object.values(FOXHOLE_STRUCTURE_RANGE_DEFINITIONS).map(value => value.legacy))].map(key => `foxhole.ranges.${key}`), 'foxhole.debug.ranges.vehicleWeapons', 'foxhole.structure.lineOfSight'];

export function isFoxholeStructureRangeVisible(range: FoxholeSceneV2StructureRange, settings: Readonly<Record<string, boolean>>, selected: boolean, isVehicle = false): boolean {
    if (isVehicle && range.type.startsWith('killbox') && settings['foxhole.debug.ranges.vehicleWeapons'] !== true) {
        return false;
    }
    const entry = Object.entries(FOXHOLE_STRUCTURE_RANGE_DEFINITIONS).find(([, definition]) => definition.type === range.type);
    if (!entry) {
        return false;
    }
    const [key, definition] = entry;
    const enabled = settings[`foxhole.ranges.${key}`] ?? settings[`foxhole.ranges.${definition.legacy}`] ?? false;
    return enabled || ((settings['foxhole.ranges.selectionOnly'] ?? true) && selected);
}

export function foxholeStructureRangeColor(type: string): number {
    return Object.values(FOXHOLE_STRUCTURE_RANGE_DEFINITIONS).find(definition => definition.type === type)?.color ?? 0xE7E3DA;
}
