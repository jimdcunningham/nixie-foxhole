import type { NxAssistantChatBlock, NxAssistantChatPlaceBlock } from '#nixie/components/nx-assistant-chat.model.ts';
import { FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE } from '../assistant-grounding.ts';
import {
    isFoxholeMapSearchEntryType,

} from './search.ts';
import type { FoxholeMapSearchEntry, FoxholeMapSearchEntryType } from './search.ts';

export type FoxholeMapPlaceSnapshotEntry = {
    id: string;
    type: FoxholeMapSearchEntryType;
    label: string;
    regionKey: string;
    regionLabel: string;
    x: number;
    y: number;
};

export type FoxholeMapPlaceAssistantToolContext = {
    mapPlaces?: {
        entries?: readonly FoxholeMapPlaceSnapshotEntry[];
    } | null;
    /** Camera center from the open scene (world coords), used as default nearest-places origin. */
    sceneViewport?: {
        centerX?: number;
        centerY?: number;
    } | null;
};

export type FoxholeMapPlaceAssistantToolDescriptor = {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
    statusLabel?: string;
};

export type FoxholeMapPlaceAssistantToolResult
    = | { ok: true; tool: string; result: unknown; }
        | { ok: false; tool: string; error: string; };

const LANDMARK_ALIAS_GROUPS: ReadonlyArray<{
    triggers: readonly string[];
    boostTokens: readonly string[];
}> = [
    {
        triggers: ['docks', 'dock', 'port', 'ports', 'seaport', 'harbor', 'harbour', 'shipyard'],
        boostTokens: ['dock', 'port', 'seaport', 'shipyard', 'harbor', 'harbour', 'gateway', 'haven', 'wharf', 'pier'],
    },
];

const RESOURCE_PLACE_QUERY_GROUPS: ReadonlyArray<{
    triggers: readonly string[];
    type: FoxholeMapSearchEntryType;
    labelNeedles: readonly string[];
}> = [
    {
        triggers: ['salvage field', 'salvage fields'],
        type: 'resource_field',
        labelNeedles: ['salvage field'],
    },
    {
        triggers: ['component field', 'component fields', 'components field', 'components fields'],
        type: 'resource_field',
        labelNeedles: ['component field'],
    },
    {
        triggers: ['sulfur field', 'sulfur fields'],
        type: 'resource_field',
        labelNeedles: ['sulfur field'],
    },
    {
        triggers: ['coal field', 'coal fields'],
        type: 'resource_field',
        labelNeedles: ['coal field'],
    },
    {
        triggers: ['oil field', 'oil fields'],
        type: 'resource_field',
        labelNeedles: ['oil field'],
    },
    {
        triggers: ['resource field', 'resource fields'],
        type: 'resource_field',
        labelNeedles: [],
    },
    {
        triggers: ['salvage mine', 'salvage mines'],
        type: 'resource_mine',
        labelNeedles: ['salvage mine'],
    },
    {
        triggers: ['component mine', 'component mines'],
        type: 'resource_mine',
        labelNeedles: ['component mine'],
    },
    {
        triggers: ['sulfur mine', 'sulfur mines'],
        type: 'resource_mine',
        labelNeedles: ['sulfur mine'],
    },
];

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function normalizePhrase(value: unknown): string {
    return normalizeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value: string): string[] {
    return normalizePhrase(value).split(' ').filter(Boolean);
}

/** Pronouns / filler that must never be resolved as map place names. */
const PLACE_QUERY_STOPWORDS = new Set([
    'a',
    'am',
    'an',
    'are',
    'at',
    'here',
    'i',
    'is',
    'me',
    'my',
    'near',
    'the',
    'there',
    'this',
    'that',
    'where',
    'you',
]);

/**
 * True when the query still has a meaningful place token after stripping
 * stopwords (e.g. "where am I" → empty; "Deadlands docks" → kept).
 */
export function isUsableFoxholeMapPlaceQuery(query: string): boolean {
    const tokens = tokenize(query).filter(token => (
        token.length >= 2 && !PLACE_QUERY_STOPWORDS.has(token)
    ));
    return tokens.length > 0;
}

/** Match phrase against text via whole tokens — never raw substring ("i" ⊂ "field"). */
function phraseMatchesTokens(text: string, phrase: string): boolean {
    const hayTokens = tokenize(text);
    const needleTokens = tokenize(phrase);
    if (!hayTokens.length || !needleTokens.length) {
        return false;
    }
    if (needleTokens.length === 1) {
        const needle = needleTokens[0]!;
        return hayTokens.some(token => (
            token === needle
            // Query may be a prefix of a place token ("abandon" → "abandoned"), never the reverse
            // ("gateway" must not boost "gate" in Callahan's Gate).
            || (needle.length >= 3 && token.startsWith(needle))
        ));
    }
    for (let index = 0; index <= hayTokens.length - needleTokens.length; index += 1) {
        if (needleTokens.every((token, offset) => hayTokens[index + offset] === token)) {
            return true;
        }
    }
    return false;
}

export function compactFoxholeMapPlaceEntries(
    entries: readonly FoxholeMapSearchEntry[],
): FoxholeMapPlaceSnapshotEntry[] {
    return entries.map(entry => ({
        id: entry.id,
        type: entry.type,
        label: entry.label,
        regionKey: entry.regionKey,
        regionLabel: entry.regionLabel,
        x: entry.worldPosition.x,
        y: entry.worldPosition.y,
    }));
}

export function normalizeFoxholeMapPlaceEntries(value: unknown): FoxholeMapPlaceSnapshotEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const entries: FoxholeMapPlaceSnapshotEntry[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const id = normalizeString(record.id);
        const type = normalizeString(record.type);
        const label = normalizeString(record.label);
        const regionKey = normalizeString(record.regionKey);
        const regionLabel = normalizeString(record.regionLabel) || regionKey;
        const x = Number(record.x ?? asRecord(record.worldPosition).x);
        const y = Number(record.y ?? asRecord(record.worldPosition).y);
        if (
            !id
            || !label
            || !regionKey
            || !isFoxholeMapSearchEntryType(type)
            || !Number.isFinite(x)
            || !Number.isFinite(y)
        ) {
            continue;
        }
        entries.push({
            id,
            type,
            label,
            regionKey,
            regionLabel,
            x,
            y,
        });
    }
    return entries;
}

function distanceBetween(
    left: { x: number; y: number; },
    right: { x: number; y: number; },
): number {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    return Math.hypot(dx, dy);
}

function placeBlockFromEntry(entry: FoxholeMapPlaceSnapshotEntry): NxAssistantChatPlaceBlock {
    return {
        id: `place:${entry.id}`,
        kind: 'place',
        placeId: entry.id,
        label: entry.label,
        placeType: entry.type,
        regionKey: entry.regionKey,
        worldPosition: { x: entry.x, y: entry.y },
    };
}

function compactPlace(entry: FoxholeMapPlaceSnapshotEntry, distance?: number) {
    return {
        id: entry.id,
        type: entry.type,
        label: entry.label,
        regionKey: entry.regionKey,
        regionLabel: entry.regionLabel,
        worldPosition: { x: entry.x, y: entry.y },
        ...(typeof distance === 'number' ? { distance } : {}),
    };
}

function detectLandmarkBoostTokens(query: string): string[] {
    const phrase = normalizePhrase(query);
    const tokens = new Set<string>();
    for (const group of LANDMARK_ALIAS_GROUPS) {
        if (group.triggers.some(trigger => phrase.includes(trigger))) {
            for (const token of group.boostTokens) {
                tokens.add(token);
            }
        }
    }
    return [...tokens];
}

export function detectFoxholeMapResourcePlaceQuery(query: string): {
    type: FoxholeMapSearchEntryType;
    labelNeedles: readonly string[];
} | null {
    const phrase = normalizePhrase(query);
    if (!phrase) {
        return null;
    }
    for (const group of RESOURCE_PLACE_QUERY_GROUPS) {
        if (group.triggers.some(trigger => phrase === trigger || phrase.includes(trigger))) {
            return { type: group.type, labelNeedles: group.labelNeedles };
        }
    }
    return null;
}

function scorePlaceEntry(
    entry: FoxholeMapPlaceSnapshotEntry,
    query: string,
    options: {
        regionKey?: string;
        landmarkBoostTokens?: readonly string[];
        resourceLabelNeedles?: readonly string[];
    } = {},
): number {
    const phrase = normalizePhrase(query);
    if (!phrase) {
        return 0;
    }
    const label = normalizePhrase(entry.label);
    const regionLabel = normalizePhrase(entry.regionLabel);
    let score = 0;

    if (options.resourceLabelNeedles?.length) {
        const matchedNeedle = options.resourceLabelNeedles.some(needle => (
            label === needle || phraseMatchesTokens(label, needle)
        ));
        if (!matchedNeedle) {
            return 0;
        }
        score += 140;
    } else if (entry.type === 'resource_field' || entry.type === 'resource_mine') {
        if (label === phrase) {
            score += 120;
        } else if (phraseMatchesTokens(label, phrase) || phraseMatchesTokens(phrase, label)) {
            score += 90;
        }
    }

    // Exact place name beats "in this region" — otherwise "Deadlands" ranks every
    // Salvage Field whose regionLabel is Deadlands above the region itself.
    if (label === phrase) {
        score += 120;
    } else if (regionLabel === phrase) {
        score += 35;
    } else if (phrase.length >= 3 && label.startsWith(phrase)) {
        score += 80;
    } else if (phrase.length >= 3 && regionLabel.startsWith(phrase)) {
        score += 45;
    } else if (phraseMatchesTokens(label, phrase)) {
        score += 55;
    } else if (phraseMatchesTokens(regionLabel, phrase)) {
        score += 30;
    } else if (phraseMatchesTokens(phrase, label)) {
        // Query contains this place name ("Deadlands near the docks")
        score += 70;
    } else if (phraseMatchesTokens(phrase, regionLabel)) {
        score += 40;
    }

    // Allow filters like query="town" without matching every label that contains those letters.
    if (phrase === entry.type || phrase === entry.type.replaceAll('_', ' ')) {
        score += 50;
    }

    for (const token of tokenize(phrase)) {
        if (token.length < 2 || PLACE_QUERY_STOPWORDS.has(token)) {
            continue;
        }
        // Avoid ranking districts like "Sop Fields" for queries such as "salvage field"
        // from the lone token "field" / "fields".
        if (
            (token === 'field' || token === 'fields')
            && entry.type !== 'resource_field'
            && entry.type !== 'resource_mine'
        ) {
            continue;
        }
        if (label === token) {
            score += 28;
        } else if (regionLabel === token) {
            score += 12;
        } else if (phraseMatchesTokens(label, token)) {
            score += 14;
        } else if (phraseMatchesTokens(regionLabel, token)) {
            score += 6;
        }
    }

    if (options.regionKey && entry.regionKey === options.regionKey) {
        score += 35;
    }

    for (const boost of options.landmarkBoostTokens ?? []) {
        if (phraseMatchesTokens(label, boost)) {
            score += 40;
        }
    }

    // Type bonuses are tie-breakers only — never invent a hit from type alone.
    if (score <= 0) {
        return 0;
    }

    if (entry.type === 'region' && label === phrase) {
        score += 25;
    } else if (entry.type === 'town') {
        score += 4;
    } else if (entry.type === 'region') {
        score += 2;
    } else if (entry.type === 'resource_field' || entry.type === 'resource_mine') {
        score += 6;
    }

    return score;
}

function resolveRegionConstraint(
    query: string,
    entries: readonly FoxholeMapPlaceSnapshotEntry[],
): string | undefined {
    const phrase = normalizePhrase(query);
    let best: { regionKey: string; score: number; } | null = null;
    for (const entry of entries) {
        if (entry.type !== 'region') {
            continue;
        }
        const score = scorePlaceEntry(entry, phrase);
        if (score < 40) {
            continue;
        }
        if (!best || score > best.score) {
            best = { regionKey: entry.regionKey, score };
        }
    }
    return best?.regionKey;
}

export function resolveFoxholeMapPlaces(
    query: string,
    entries: readonly FoxholeMapPlaceSnapshotEntry[],
    options: { limit?: number; } = {},
): Array<{ entry: FoxholeMapPlaceSnapshotEntry; score: number; }> {
    const phrase = normalizePhrase(query);
    if (!phrase || !isUsableFoxholeMapPlaceQuery(phrase) || !entries.length) {
        return [];
    }
    const limit = Math.min(25, Math.max(1, Math.floor(options.limit ?? 8)));
    const regionKey = resolveRegionConstraint(phrase, entries);
    const landmarkBoostTokens = detectLandmarkBoostTokens(phrase);
    const resourceQuery = detectFoxholeMapResourcePlaceQuery(phrase);
    const scored = entries
        .map(entry => ({
            entry,
            score: scorePlaceEntry(entry, phrase, {
                regionKey,
                landmarkBoostTokens,
                resourceLabelNeedles: resourceQuery?.labelNeedles,
            }),
        }))
        .filter(row => row.score > 0)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.entry.label.localeCompare(right.entry.label);
        });
    return scored.slice(0, limit);
}

export function queryNearestFoxholeMapPlaces(options: {
    entries: readonly FoxholeMapPlaceSnapshotEntry[];
    origin: { x: number; y: number; };
    limit?: number;
    type?: FoxholeMapSearchEntryType | null;
    query?: string;
    regionKey?: string;
}): Array<{ entry: FoxholeMapPlaceSnapshotEntry; distance: number; score: number; }> {
    const limit = Math.min(25, Math.max(1, Math.floor(options.limit ?? 8)));
    const query = normalizePhrase(options.query);
    const resourceQuery = detectFoxholeMapResourcePlaceQuery(query);
    const typeFilter = options.type ?? resourceQuery?.type ?? null;
    const regionKey = normalizeString(options.regionKey);
    const landmarkBoostTokens = detectLandmarkBoostTokens(query);

    const ranked = options.entries
        .filter(entry => {
            if (typeFilter && entry.type !== typeFilter) {
                return false;
            }
            if (regionKey && entry.regionKey !== regionKey) {
                return false;
            }
            if (!query) {
                return true;
            }
            return scorePlaceEntry(entry, query, {
                regionKey: regionKey || undefined,
                landmarkBoostTokens,
                resourceLabelNeedles: resourceQuery?.labelNeedles,
            }) > 0;
        })
        .map(entry => ({
            entry,
            distance: distanceBetween(options.origin, { x: entry.x, y: entry.y }),
            score: query
                ? scorePlaceEntry(entry, query, {
                    regionKey: regionKey || undefined,
                    landmarkBoostTokens,
                    resourceLabelNeedles: resourceQuery?.labelNeedles,
                })
                : 0,
        }))
        .sort((left, right) => {
            // Prefer strong query matches before raw distance so districts named
            // "* Fields" do not beat actual Salvage Field icons.
            if (query && right.score !== left.score) {
                return right.score - left.score;
            }
            return left.distance - right.distance;
        });

    return ranked.slice(0, limit);
}

export const FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS: readonly FoxholeMapPlaceAssistantToolDescriptor[] = [
    {
        name: 'resolve_map_place',
        statusLabel: 'Resolving map place…',
        description:
            'Resolve a natural-language Foxhole place phrase (region, town, district, or resource field/mine), e.g. "Deadlands near the docks", "Abandoned Ward", or "Salvage Field". Do not pass pronouns ("I", "me", "here") — use describe_map_location for "where am I".',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Free-text place phrase from the player (a real place name, not "I" / "here").',
                },
                limit: {
                    type: 'integer',
                    description: 'Max ranked candidates (default 8).',
                    minimum: 1,
                    maximum: 25,
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'describe_map_location',
        statusLabel: 'Locating map view…',
        description:
            'Describe where the open map camera is (region + nearest towns/districts) using the viewport center. Use for "where am I", "what region is this", or "where is the camera".',
        parameters: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: 'Max nearby places to return (default 6).',
                    minimum: 1,
                    maximum: 25,
                },
            },
            required: [],
            additionalProperties: false,
        },
    },
    {
        name: 'query_nearest_places',
        statusLabel: 'Finding nearest places…',
        description:
            'Rank nearby map places from an origin place id, world coordinates, or (when omitted) the current map viewport center. For resource fields (Salvage Field, Component Field, etc.), set query to that field name or type=resource_field — never treat districts named "* Fields" as resource fields. Use after resolve_map_place when the player asks what is closest to a named place.',
        parameters: {
            type: 'object',
            properties: {
                originPlaceId: {
                    type: 'string',
                    description: 'Place id from resolve_map_place (preferred for named origins).',
                },
                originX: {
                    type: 'number',
                    description: 'World X when originPlaceId is omitted.',
                },
                originY: {
                    type: 'number',
                    description: 'World Y when originPlaceId is omitted.',
                },
                query: {
                    type: 'string',
                    description: 'Optional filter phrase such as "salvage field", "town", "docks", or a label fragment.',
                },
                type: {
                    type: 'string',
                    enum: ['region', 'town', 'district', 'resource_field', 'resource_mine'],
                    description: 'Optional place type filter. Use resource_field for Salvage/Component/Sulfur/Coal/Oil fields.',
                },
                regionKey: {
                    type: 'string',
                    description: 'Optional region key constraint (e.g. DeadLandsHex). Omit to search the whole world.',
                },
                limit: {
                    type: 'integer',
                    description: 'Max results (default 8).',
                    minimum: 1,
                    maximum: 25,
                },
            },
            required: [],
            additionalProperties: false,
        },
    },
] as const;

function readEntries(context: FoxholeMapPlaceAssistantToolContext): FoxholeMapPlaceSnapshotEntry[] {
    return normalizeFoxholeMapPlaceEntries(context.mapPlaces?.entries);
}

function readViewportOrigin(
    context: FoxholeMapPlaceAssistantToolContext,
): { x: number; y: number; } | null {
    const x = Number(context.sceneViewport?.centerX);
    const y = Number(context.sceneViewport?.centerY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return { x, y };
}

function executeResolve(
    args: Record<string, unknown>,
    context: FoxholeMapPlaceAssistantToolContext,
): FoxholeMapPlaceAssistantToolResult {
    const query = normalizeString(args.query);
    if (!query) {
        return { ok: false, tool: 'resolve_map_place', error: 'query is required' };
    }
    if (!isUsableFoxholeMapPlaceQuery(query)) {
        return {
            ok: true,
            tool: 'resolve_map_place',
            result: {
                found: false,
                error: 'not_a_place_query',
                query,
                places: [],
                top: null,
                guidance: 'That query is not a place name. For "where am I", call describe_map_location instead of resolve_map_place.',
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }
    const entries = readEntries(context);
    if (!entries.length) {
        return {
            ok: true,
            tool: 'resolve_map_place',
            result: {
                error: 'no_map_place_data',
                places: [],
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }
    const limitRaw = Number(args.limit ?? 8);
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 8;
    const resolved = resolveFoxholeMapPlaces(query, entries, { limit });
    const places = resolved.map(row => ({
        ...compactPlace(row.entry),
        score: row.score,
    }));
    const uiBlocks = resolved.slice(0, 5).map(row => placeBlockFromEntry(row.entry));
    if (places.length === 0) {
        return {
            ok: true,
            tool: 'resolve_map_place',
            result: {
                found: false,
                error: 'not_found',
                query,
                places: [],
                top: null,
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }
    return {
        ok: true,
        tool: 'resolve_map_place',
        result: {
            found: true,
            query,
            places,
            top: places[0] ?? null,
            uiBlocks,
        },
    };
}

function resolveNearestOrigin(
    args: Record<string, unknown>,
    context: FoxholeMapPlaceAssistantToolContext,
    entries: readonly FoxholeMapPlaceSnapshotEntry[],
): {
    origin: { x: number; y: number; } | null;
    originEntry: FoxholeMapPlaceSnapshotEntry | null;
    originSource: 'place' | 'coordinates' | 'viewport' | null;
} {
    const originPlaceId = normalizeString(args.originPlaceId);
    let originEntry: FoxholeMapPlaceSnapshotEntry | null = null;
    if (originPlaceId) {
        originEntry = entries.find(entry => entry.id === originPlaceId) ?? null;
        if (originEntry) {
            return {
                origin: { x: originEntry.x, y: originEntry.y },
                originEntry,
                originSource: 'place',
            };
        }
    }
    const x = Number(args.originX);
    const y = Number(args.originY);
    if (Number.isFinite(x) && Number.isFinite(y)) {
        return { origin: { x, y }, originEntry: null, originSource: 'coordinates' };
    }
    const viewport = readViewportOrigin(context);
    if (viewport) {
        return { origin: viewport, originEntry: null, originSource: 'viewport' };
    }
    return { origin: null, originEntry: null, originSource: null };
}

function executeNearest(
    args: Record<string, unknown>,
    context: FoxholeMapPlaceAssistantToolContext,
): FoxholeMapPlaceAssistantToolResult {
    const entries = readEntries(context);
    if (!entries.length) {
        return {
            ok: true,
            tool: 'query_nearest_places',
            result: {
                error: 'no_map_place_data',
                places: [],
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }

    const { origin, originEntry, originSource } = resolveNearestOrigin(args, context, entries);
    if (!origin) {
        return {
            ok: false,
            tool: 'query_nearest_places',
            error: 'provide originPlaceId, originX+originY, or open a map scene (viewport)',
        };
    }

    const query = normalizeString(args.query);
    const resourceQuery = detectFoxholeMapResourcePlaceQuery(query);
    const typeRaw = normalizeString(args.type);
    const type = isFoxholeMapSearchEntryType(typeRaw)
        ? typeRaw
        : (resourceQuery?.type ?? null);

    // Resource-field nearest queries should search the whole world by default —
    // the closest salvage field is often in a neighboring region.
    const regionKeyArg = normalizeString(args.regionKey);
    const regionKey = regionKeyArg
        || ((type === 'resource_field' || type === 'resource_mine' || resourceQuery)
            ? ''
            : (originEntry?.regionKey ?? ''));

    if (
        (type === 'resource_field' || type === 'resource_mine')
        && !entries.some(entry => entry.type === type)
    ) {
        return {
            ok: true,
            tool: 'query_nearest_places',
            result: {
                error: 'no_resource_field_data',
                message: 'Live map resource icons are not loaded yet. Resource fields come from war map icon data, not town/district labels.',
                places: [],
                uiBlocks: originEntry ? [placeBlockFromEntry(originEntry)] : [],
            },
        };
    }

    const limitRaw = Number(args.limit ?? 8);
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 8;
    const nearest = queryNearestFoxholeMapPlaces({
        entries,
        origin,
        limit: limit + (originEntry ? 1 : 0),
        type,
        query,
        regionKey: regionKey || undefined,
    }).filter(row => !originEntry || row.entry.id !== originEntry.id)
        .slice(0, limit);

    const places = nearest.map(row => compactPlace(row.entry, row.distance));
    const uiBlocks: NxAssistantChatBlock[] = [
        ...(originEntry ? [placeBlockFromEntry(originEntry)] : []),
        ...nearest.slice(0, 6).map(row => placeBlockFromEntry(row.entry)),
    ];

    return {
        ok: true,
        tool: 'query_nearest_places',
        result: {
            origin: originEntry
                ? compactPlace(originEntry)
                : { worldPosition: origin, source: originSource },
            places,
            uiBlocks,
        },
    };
}

function executeDescribeLocation(
    args: Record<string, unknown>,
    context: FoxholeMapPlaceAssistantToolContext,
): FoxholeMapPlaceAssistantToolResult {
    const entries = readEntries(context);
    if (!entries.length) {
        return {
            ok: true,
            tool: 'describe_map_location',
            result: {
                error: 'no_map_place_data',
                places: [],
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }

    const origin = readViewportOrigin(context);
    if (!origin) {
        return {
            ok: true,
            tool: 'describe_map_location',
            result: {
                found: false,
                error: 'no_viewport',
                message: 'Map camera position is unavailable right now. Pan the Foxhole map once, then ask again.',
                places: [],
                uiBlocks: [] as NxAssistantChatBlock[],
            },
        };
    }

    const limitRaw = Number(args.limit ?? 6);
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 6;

    const nearestRegion = queryNearestFoxholeMapPlaces({
        entries,
        origin,
        type: 'region',
        limit: 1,
    })[0] ?? null;

    const nearby = queryNearestFoxholeMapPlaces({
        entries,
        origin,
        limit: limit + 4,
    }).filter(row => (
        row.entry.type === 'town'
        || row.entry.type === 'district'
        || row.entry.type === 'region'
    )).slice(0, limit);

    const region = nearestRegion ? compactPlace(nearestRegion.entry, nearestRegion.distance) : null;
    const places = nearby.map(row => compactPlace(row.entry, row.distance));
    const uiBlocks = nearby.slice(0, 6).map(row => placeBlockFromEntry(row.entry));

    return {
        ok: true,
        tool: 'describe_map_location',
        result: {
            found: true,
            viewport: { worldPosition: origin },
            region,
            places,
            uiBlocks,
        },
    };
}

export function executeFoxholeMapPlaceAssistantTool(
    name: string,
    args: unknown,
    context: FoxholeMapPlaceAssistantToolContext,
): FoxholeMapPlaceAssistantToolResult {
    const tool = normalizeString(name);
    const record = asRecord(args);
    switch (tool) {
        case 'resolve_map_place':
            return executeResolve(record, context);
        case 'describe_map_location':
            return executeDescribeLocation(record, context);
        case 'query_nearest_places':
            return executeNearest(record, context);
        default:
            return {
                ok: false,
                tool: tool || String(name ?? ''),
                error: `unknown tool: ${tool || '(empty)'}`,
            };
    }
}
