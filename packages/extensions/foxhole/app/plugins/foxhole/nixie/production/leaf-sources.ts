import type { FoxholeStructureCatalog } from '../catalog.ts';

/**
 * Authored gather / world sources for raw commodities that FoxWatch does not
 * emit as conversion recipes (resource fields have no gather entries).
 *
 * @see https://foxhole.wiki.gg/wiki/Resource_Field
 */
export type FoxholeProductionLeafGatherSourceKind
    = | 'resource_field'
        | 'resource_mine'
        | 'stationary_harvester';

export type FoxholeProductionLeafGatherSource = {
    structureId: string;
    label: string;
    kind: FoxholeProductionLeafGatherSourceKind;
    /** Short player-facing how-to note (sentence case). */
    note?: string;
    /** Catalog flavor text for the structure, when available. */
    description?: string;
};

type AuthoredLeafGatherSource = {
    structureId: string;
    fallbackLabel: string;
    kind: FoxholeProductionLeafGatherSourceKind;
    note?: string;
};

export const FOXHOLE_PRODUCTION_LEAF_GATHER_COMMODITY_KEYS = [
    'item:Metal',
    'item:Components',
    'item:Sulfur',
    'item:Coal',
    'item:Copper',
    'item:Aluminum',
    'item:Iron',
] as const;

const LEAF_GATHER_SOURCES_BY_COMMODITY: Readonly<Record<string, readonly AuthoredLeafGatherSource[]>> = {
    'item:Metal': [
        {
            structureId: 'salvagefield',
            fallbackLabel: 'Salvage Field',
            kind: 'resource_field',
            note: 'Gather Salvage by hand, or place a Stationary Harvester (Salvage) on the field.',
        },
        {
            structureId: 'scrapmine',
            fallbackLabel: 'Salvage Mine',
            kind: 'resource_mine',
            note: 'World mine that outputs Salvage while fueled. Diesel is low efficiency; Petrol is high efficiency (about triple Salvage per liter). Collect from its stockpile.',
        },
        {
            structureId: 'facilitymineresource1',
            fallbackLabel: 'Stationary Harvester (Salvage)',
            kind: 'stationary_harvester',
            note: 'Requires a Salvage Field resource node and Petrol.',
        },
    ],
    'item:Components': [
        {
            structureId: 'componentsfield',
            fallbackLabel: 'Component Field',
            kind: 'resource_field',
            note: 'Gather Components by hand, or place a Stationary Harvester (Components) on the field.',
        },
        {
            structureId: 'componentmine',
            fallbackLabel: 'Component Mine',
            kind: 'resource_mine',
            note: 'World mine that outputs Components while fueled. Diesel is low efficiency; Petrol is high efficiency. Collect from its stockpile.',
        },
        {
            structureId: 'facilitymineresource2',
            fallbackLabel: 'Stationary Harvester (Components)',
            kind: 'stationary_harvester',
            note: 'Requires a Component Field resource node and Petrol.',
        },
    ],
    'item:Sulfur': [
        {
            structureId: 'sulfurfield',
            fallbackLabel: 'Sulfur Field',
            kind: 'resource_field',
            note: 'Gather Sulfur by hand, or place a Stationary Harvester (Sulfur) on the field.',
        },
        {
            structureId: 'sulfurmine',
            fallbackLabel: 'Sulfur Mine',
            kind: 'resource_mine',
            note: 'World mine that outputs Sulfur while fueled. Diesel is low efficiency; Petrol is high efficiency. Collect from its stockpile.',
        },
        {
            structureId: 'facilitymineresource3',
            fallbackLabel: 'Stationary Harvester (Sulfur)',
            kind: 'stationary_harvester',
            note: 'Requires a Sulfur Field resource node and Petrol.',
        },
    ],
    'item:Coal': [
        {
            structureId: 'coalfield',
            fallbackLabel: 'Coal Field',
            kind: 'resource_field',
            note: 'Gather Coal by hand, or place a Stationary Harvester (Coal) on the field.',
        },
        {
            structureId: 'facilitymineresource4',
            fallbackLabel: 'Stationary Harvester (Coal)',
            kind: 'stationary_harvester',
            note: 'Requires a Coal Field resource node and Petrol.',
        },
    ],
    /**
     * Tech materials (tmats) spawn as special nodes on Salvage Fields after Salvage is harvested.
     * There are no Copper / Aluminum / Iron mines or dedicated resource fields.
     * @see https://foxhole.wiki.gg/wiki/Copper
     */
    'item:Copper': [
        {
            structureId: 'salvagefield',
            fallbackLabel: 'Salvage Field',
            kind: 'resource_field',
            note: 'Mine Copper tech nodes that can spawn on Salvage Fields after harvesting Salvage. There are no Copper Mines. A field may spawn no Copper.',
        },
    ],
    'item:Aluminum': [
        {
            structureId: 'salvagefield',
            fallbackLabel: 'Salvage Field',
            kind: 'resource_field',
            note: 'Mine Aluminum tech nodes that can spawn on Salvage Fields after harvesting Salvage. There are no Aluminum Mines. A field may spawn no Aluminum.',
        },
    ],
    'item:Iron': [
        {
            structureId: 'salvagefield',
            fallbackLabel: 'Salvage Field',
            kind: 'resource_field',
            note: 'Mine Iron tech nodes that can spawn on Salvage Fields after harvesting Salvage. There are no Iron Mines. A field may spawn no Iron.',
        },
    ],
};

function resolveStructureLabel(
    structureId: string,
    fallbackLabel: string,
    structureCatalog?: Pick<FoxholeStructureCatalog, 'assetByKey'> | null,
): string {
    const name = String(structureCatalog?.assetByKey?.[structureId]?.name ?? '').trim();
    return name || fallbackLabel;
}

export function listFoxholeProductionLeafGatherSources(
    commodityKey: string,
    structureCatalog?: Pick<FoxholeStructureCatalog, 'assetByKey'> | null,
): FoxholeProductionLeafGatherSource[] {
    const authored = LEAF_GATHER_SOURCES_BY_COMMODITY[String(commodityKey ?? '').trim()];
    if (!authored?.length) {
        return [];
    }
    return authored.map(entry => {
        const structure = structureCatalog?.assetByKey?.[entry.structureId]
            ?? structureCatalog?.assetByKey?.[entry.structureId.toLowerCase()];
        const description = String(structure?.description ?? '').trim();
        return {
            structureId: entry.structureId,
            kind: entry.kind,
            label: resolveStructureLabel(entry.structureId, entry.fallbackLabel, structureCatalog),
            ...(entry.note ? { note: entry.note } : {}),
            ...(description ? { description } : {}),
        };
    });
}

/** Compact obtain-step / assistant summary for the primary gather source. */
export function formatFoxholeProductionLeafGatherSummary(
    commodityKey: string,
    structureCatalog?: Pick<FoxholeStructureCatalog, 'assetByKey'> | null,
): string | null {
    const sources = listFoxholeProductionLeafGatherSources(commodityKey, structureCatalog);
    const field = sources.find(source => source.kind === 'resource_field');
    if (!field) {
        return null;
    }
    const mine = sources.find(source => source.kind === 'resource_mine');
    if (mine) {
        return `Gather from ${field.label} (or ${mine.label})`;
    }
    return `Gather from ${field.label}`;
}
