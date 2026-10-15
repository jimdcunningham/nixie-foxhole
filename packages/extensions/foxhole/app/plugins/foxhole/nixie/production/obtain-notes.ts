/**
 * Authored obtain notes for items that are not (only) explained by production
 * recipes — spawn gear, public stockpiles, etc.
 *
 * `related` entries become uiBlocks so names cited in the note can auto-link.
 */

export type FoxholeObtainRelatedRef
    = | {
        kind: 'item';
        channel: 'item' | 'crate' | 'liquid';
        resourceId: string;
        label: string;
    }
    | {
        kind: 'structure';
        structureId: string;
        label: string;
    };

type ObtainNoteEntry = {
    note: string;
    related?: readonly FoxholeObtainRelatedRef[];
};

export const FOXHOLE_COMMODITY_OBTAIN_NOTES: Readonly<Record<string, ObtainNoteEntry>> = {
    'item:WorkHammer': {
        note: 'Players spawn with a Hammer. It is not crafted at a Factory. Do not confuse it with the Sledge Hammer (a separate Factory-crate tool).',
        related: [
            {
                kind: 'item',
                channel: 'crate',
                resourceId: 'SledgeHammer',
                label: 'Sledge Hammer',
            },
            {
                kind: 'structure',
                structureId: 'factory',
                label: 'Factory',
            },
        ],
    },
};

/** When Factory/MPF output is a crate, personal use usually means public stockpiles. */
export const FOXHOLE_CRATE_LOGISTICS_NOTE = [
    'Factory and Mass Production Factory outputs are supply crates for logistics.',
    'For a single pair or personal kit, check a Town Base, Seaport, or Storage Depot stockpile first.',
    'Crafting a crate restocks public inventories — it is not the usual way a soldier grabs one item.',
].join(' ');

export const FOXHOLE_CRATE_LOGISTICS_RELATED: readonly FoxholeObtainRelatedRef[] = [
    { kind: 'structure', structureId: 'factory', label: 'Factory' },
    { kind: 'structure', structureId: 'massproduction', label: 'Mass Production Factory' },
    { kind: 'structure', structureId: 'townbase1', label: 'Town Base' },
    { kind: 'structure', structureId: 'seaport', label: 'Seaport' },
    { kind: 'structure', structureId: 'storagefacility', label: 'Storage Depot' },
];

export function getFoxholeCommodityObtainNote(commodityKey: string): string | null {
    const entry = FOXHOLE_COMMODITY_OBTAIN_NOTES[String(commodityKey ?? '').trim()];
    return entry?.note || null;
}

export function listFoxholeCommodityObtainRelated(
    commodityKey: string,
): readonly FoxholeObtainRelatedRef[] {
    const entry = FOXHOLE_COMMODITY_OBTAIN_NOTES[String(commodityKey ?? '').trim()];
    return entry?.related ?? [];
}

export function getFoxholeCrateLogisticsNote(
    channel: string,
    producerCount: number,
): string | null {
    if (String(channel ?? '').toLowerCase() !== 'crate' || producerCount <= 0) {
        return null;
    }
    return FOXHOLE_CRATE_LOGISTICS_NOTE;
}

const AIRCRAFT_SCOUT_OBTAIN_NOTE = [
    'Scout (and amphibious scout) aircraft are built with a Hammer at an Aircraft Hangar on an airfield.',
    'They are not produced at the Aircraft Maintenance Factory.',
].join(' ');

const AIRCRAFT_COMBAT_OBTAIN_NOTE = [
    'Most aircraft frames are produced at a Large Assembly Station with the Aircraft Assembly upgrade, then unpacked at an Aircraft Depot.',
    'Install Aircraft Parts crafted at an Aircraft Maintenance Factory — that factory makes parts only, not the plane itself.',
].join(' ');

const AIRCRAFT_BUILD_RELATED: readonly FoxholeObtainRelatedRef[] = [
    { kind: 'structure', structureId: 'aircraftfactory', label: 'Aircraft Hangar' },
    { kind: 'structure', structureId: 'facilityvehiclefactory2', label: 'Large Assembly Station' },
    { kind: 'structure', structureId: 'aircraftdepot', label: 'Aircraft Depot' },
    { kind: 'structure', structureId: 'facilityfactoryaircraft', label: 'Aircraft Maintenance Factory' },
];

function isAircraftVehicleCommodity(commodityKey: string, resourceId: string): boolean {
    const key = String(commodityKey ?? '');
    const id = String(resourceId ?? '');
    return /(?:^|:)vehicle:aircraft(?!crate)/i.test(key)
        || /^vehicle:aircraft(?!crate)/i.test(id)
        || /^aircraft(?!crate|part|ammo|depot|factory|runway)/i.test(id);
}

function isAircraftScoutResource(resourceId: string): boolean {
    return /aircraftscout/i.test(String(resourceId ?? ''));
}

export function getFoxholeAircraftObtainNote(
    commodityKey: string,
    resourceId: string,
): string | null {
    if (!isAircraftVehicleCommodity(commodityKey, resourceId)) {
        return null;
    }
    return isAircraftScoutResource(resourceId)
        ? AIRCRAFT_SCOUT_OBTAIN_NOTE
        : AIRCRAFT_COMBAT_OBTAIN_NOTE;
}

export function listFoxholeAircraftObtainRelated(
    commodityKey: string,
    resourceId: string,
): readonly FoxholeObtainRelatedRef[] {
    if (!isAircraftVehicleCommodity(commodityKey, resourceId)) {
        return [];
    }
    if (isAircraftScoutResource(resourceId)) {
        return AIRCRAFT_BUILD_RELATED.filter(ref => (
            ref.kind === 'structure' && ref.structureId === 'aircraftfactory'
        ));
    }
    return AIRCRAFT_BUILD_RELATED;
}

export function listFoxholeObtainRelatedForDescribe(
    commodityKey: string,
    channel: string,
    producerCount: number,
    resourceId?: string,
): readonly FoxholeObtainRelatedRef[] {
    const authored = listFoxholeCommodityObtainRelated(commodityKey);
    if (authored.length) {
        return authored;
    }
    const aircraftRelated = listFoxholeAircraftObtainRelated(
        commodityKey,
        resourceId || commodityKey.replace(/^[^:]+:/, ''),
    );
    if (aircraftRelated.length) {
        return aircraftRelated;
    }
    if (getFoxholeCrateLogisticsNote(channel, producerCount)) {
        return FOXHOLE_CRATE_LOGISTICS_RELATED;
    }
    return [];
}
