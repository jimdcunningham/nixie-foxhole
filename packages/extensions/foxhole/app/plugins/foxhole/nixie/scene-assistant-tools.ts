import type { NixieAssistantClientAction } from '#nixie/plugins/nixie/assistant/client-actions.ts';
import { FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE } from './assistant-grounding.ts';
import { getFoxholeStructureCatalog } from './catalog.ts';
import type { FoxholeStructureAsset, FoxholeStructureCatalog } from './catalog.ts';
import { resolveFoxholeRegionEdgePoint } from './map/region-edge.ts';
import { createContributionId } from '#nixie/plugins/nixie/contributions/shared/id.ts';

export const FOXHOLE_SCENE_SYSTEM_PROMPT_EXTRA = [
    'When the user asks to place Foxhole structures on the open scene, use place_foxhole_structure (after resolving the asset name/key).',
    'To power a facility from another, place both at distinct nearby coordinates then call connect_foxhole_power with their node ids from tool results.',
    'For binocular / observation lines between map places and region edges, resolve places with resolve_map_place, use resolve_region_edge for region borders, then create_foxhole_binocular_line.',
    'Do not invent foxholeKeys — resolve from catalog via place_foxhole_structure query matching; if not found, say so.',
    'Scene must be open and editable (sceneActive/canEdit from context). Prefer viewport center when coordinates are omitted.',
    'Never write Foxhole codenames in visible reply text — use player-facing display names from tool labels.',
].join(' ');

export type FoxholeSceneAssistantToolContext = {
    sceneActive?: boolean;
    sceneId?: string;
    sceneCanEdit?: boolean;
    sceneViewport?: { centerX?: number; centerY?: number; } | null;
    baseAssetsUrl?: string;
};

export type FoxholeSceneAssistantToolDescriptor = {
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

export type FoxholeSceneAssistantToolResult
    = | { ok: true; tool: string; result: unknown; }
        | { ok: false; tool: string; error: string; };

export const FOXHOLE_SCENE_ASSISTANT_TOOLS: FoxholeSceneAssistantToolDescriptor[] = [
    {
        name: 'place_foxhole_structure',
        description: 'Place a Foxhole structure/vehicle into the open scene by catalog key or display name. Returns the new node id.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Structure display name or foxholeKey (e.g. "Oil Refinery", facilityrefineryoil).',
                },
                foxholeKey: {
                    type: 'string',
                    description: 'Optional exact catalog key when already known from tools.',
                },
                x: { type: 'number', description: 'World X; defaults to viewport center.' },
                y: { type: 'number', description: 'World Y; defaults to viewport center.' },
                label: { type: 'string', description: 'Optional node label override.' },
            },
            additionalProperties: false,
        },
        statusLabel: 'Placing Foxhole structure…',
    },
    {
        name: 'connect_foxhole_power',
        description: 'Create a power line between two placed Foxhole structure nodes (power sockets) and attach them.',
        parameters: {
            type: 'object',
            properties: {
                fromNodeId: {
                    type: 'string',
                    description: 'Source structure node id (typically a power plant).',
                },
                toNodeId: {
                    type: 'string',
                    description: 'Target structure node id (facility to power).',
                },
            },
            required: ['fromNodeId', 'toNodeId'],
            additionalProperties: false,
        },
        statusLabel: 'Connecting power…',
    },
    {
        name: 'resolve_region_edge',
        description: 'Resolve a world point on the edge of a Foxhole map region toward/from a start coordinate (e.g. edge of Acrithia from a Deadlands port).',
        parameters: {
            type: 'object',
            properties: {
                towardRegion: {
                    type: 'string',
                    description: 'Region name or key (e.g. Acrithia, AcrithiaHex).',
                },
                fromX: { type: 'number', description: 'Start world X.' },
                fromY: { type: 'number', description: 'Start world Y.' },
            },
            required: ['towardRegion', 'fromX', 'fromY'],
            additionalProperties: false,
        },
        statusLabel: 'Resolving region edge…',
    },
    {
        name: 'create_foxhole_binocular_line',
        description: 'Create a binocular observation line on the open scene from flat world points [x0,y0,x1,y1,…].',
        parameters: {
            type: 'object',
            properties: {
                points: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'Flat world polyline points, at least two vertices.',
                },
                startX: { type: 'number', description: 'Optional start X if points omitted.' },
                startY: { type: 'number', description: 'Optional start Y if points omitted.' },
                endX: { type: 'number', description: 'Optional end X if points omitted.' },
                endY: { type: 'number', description: 'Optional end Y if points omitted.' },
            },
            additionalProperties: false,
        },
        statusLabel: 'Creating binocular line…',
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

function normalizeFiniteNumber(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function requireEditableScene(
    tool: string,
    context: FoxholeSceneAssistantToolContext,
): { sceneId: string; } | FoxholeSceneAssistantToolResult {
    const sceneId = normalizeString(context.sceneId);
    if (!context.sceneActive || !sceneId) {
        return {
            ok: true,
            tool,
            result: {
                found: false,
                error: 'no_open_scene',
                guidance: 'Tell the user no scene is open. Do not invent placements.',
            },
        };
    }
    if (context.sceneCanEdit !== true) {
        return { ok: false, tool, error: 'scene is read-only' };
    }
    return { sceneId };
}

function scoreStructureMatch(asset: FoxholeStructureAsset, needle: string): number {
    const key = asset.foxholeKey.toLowerCase();
    const code = asset.codeName.toLowerCase();
    const name = asset.name.toLowerCase();
    const search = asset.searchText.toLowerCase();
    if (key === needle || code === needle) {
        return 100;
    }
    if (name === needle) {
        return 90;
    }
    if (key.includes(needle) || code.includes(needle)) {
        return 70;
    }
    if (name.includes(needle)) {
        return 60;
    }
    if (search.includes(needle)) {
        return 40;
    }
    for (const alias of asset.aliases ?? []) {
        const a = String(alias).toLowerCase();
        if (a === needle) {
            return 85;
        }
        if (a.includes(needle)) {
            return 50;
        }
    }
    return 0;
}

export function resolveFoxholeStructureForScenePlacement(
    catalog: FoxholeStructureCatalog,
    options: { query?: string; foxholeKey?: string; },
): FoxholeStructureAsset | null {
    const exactKey = normalizeString(options.foxholeKey);
    if (exactKey) {
        return catalog.assetByKey[exactKey]
            ?? catalog.assetByKey[exactKey.toLowerCase()]
            ?? null;
    }
    const needle = normalizeString(options.query).toLowerCase();
    if (!needle) {
        return null;
    }
    let best: FoxholeStructureAsset | null = null;
    let bestScore = 0;
    for (const asset of catalog.assets) {
        const score = scoreStructureMatch(asset, needle);
        if (score > bestScore) {
            best = asset;
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}

function defaultPlacementPoint(context: FoxholeSceneAssistantToolContext): { x: number; y: number; } {
    const x = normalizeFiniteNumber(context.sceneViewport?.centerX) ?? 0;
    const y = normalizeFiniteNumber(context.sceneViewport?.centerY) ?? 0;
    return { x, y };
}

function executePlaceFoxholeStructure(
    args: Record<string, unknown>,
    context: FoxholeSceneAssistantToolContext,
): FoxholeSceneAssistantToolResult {
    const gate = requireEditableScene('place_foxhole_structure', context);
    if (!('sceneId' in gate)) {
        return gate;
    }

    const baseAssetsUrl = normalizeString(context.baseAssetsUrl) || '/foxhole/assets/';
    const catalog = getFoxholeStructureCatalog(baseAssetsUrl);
    const asset = resolveFoxholeStructureForScenePlacement(catalog, {
        query: typeof args.query === 'string' ? args.query : undefined,
        foxholeKey: typeof args.foxholeKey === 'string' ? args.foxholeKey : undefined,
    });
    if (!asset) {
        return {
            ok: true,
            tool: 'place_foxhole_structure',
            result: {
                found: false,
                error: 'not_found',
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
            },
        };
    }

    const fallback = defaultPlacementPoint(context);
    const x = normalizeFiniteNumber(args.x) ?? fallback.x;
    const y = normalizeFiniteNumber(args.y) ?? fallback.y;
    const id = createContributionId('foxhole-structure');
    const label = normalizeString(args.label) || asset.name;

    const clientActions: NixieAssistantClientAction[] = [{
        type: 'foxhole.scene.mutate',
        sceneId: gate.sceneId,
        ops: [{
            op: 'placeStructure',
            foxholeKey: asset.foxholeKey,
            x,
            y,
            label,
            id,
        }],
    }];

    return {
        ok: true,
        tool: 'place_foxhole_structure',
        result: {
            ok: true,
            found: true,
            nodeId: id,
            foxholeKey: asset.foxholeKey,
            label,
            x,
            y,
            summary: `Queued place for ${label}.`,
            clientActions,
        },
    };
}

function executeConnectFoxholePower(
    args: Record<string, unknown>,
    context: FoxholeSceneAssistantToolContext,
): FoxholeSceneAssistantToolResult {
    const gate = requireEditableScene('connect_foxhole_power', context);
    if (!('sceneId' in gate)) {
        return gate;
    }

    const fromNodeId = normalizeString(args.fromNodeId);
    const toNodeId = normalizeString(args.toNodeId);
    if (!fromNodeId || !toNodeId) {
        return { ok: false, tool: 'connect_foxhole_power', error: 'fromNodeId and toNodeId are required' };
    }
    if (fromNodeId === toNodeId) {
        return { ok: false, tool: 'connect_foxhole_power', error: 'fromNodeId and toNodeId must differ' };
    }

    const id = createContributionId('foxhole-powerline');
    const clientActions: NixieAssistantClientAction[] = [{
        type: 'foxhole.scene.mutate',
        sceneId: gate.sceneId,
        ops: [{
            op: 'connectPower',
            fromNodeId,
            toNodeId,
            id,
        }],
    }];

    return {
        ok: true,
        tool: 'connect_foxhole_power',
        result: {
            ok: true,
            powerlineNodeId: id,
            fromNodeId,
            toNodeId,
            summary: 'Queued power connection.',
            clientActions,
        },
    };
}

function executeResolveRegionEdge(
    args: Record<string, unknown>,
    context: FoxholeSceneAssistantToolContext,
): FoxholeSceneAssistantToolResult {
    void context;
    const towardRegion = normalizeString(args.towardRegion);
    const fromX = normalizeFiniteNumber(args.fromX);
    const fromY = normalizeFiniteNumber(args.fromY);
    if (!towardRegion || fromX === undefined || fromY === undefined) {
        return {
            ok: false,
            tool: 'resolve_region_edge',
            error: 'towardRegion, fromX, and fromY are required',
        };
    }

    const edge = resolveFoxholeRegionEdgePoint({
        towardRegion,
        fromX,
        fromY,
    });
    if (!edge) {
        return {
            ok: true,
            tool: 'resolve_region_edge',
            result: {
                found: false,
                error: 'not_found',
                guidance: FOXHOLE_ASSISTANT_NOT_FOUND_GUIDANCE,
            },
        };
    }

    return {
        ok: true,
        tool: 'resolve_region_edge',
        result: {
            found: true,
            ...edge,
        },
    };
}

function executeCreateFoxholeBinocularLine(
    args: Record<string, unknown>,
    context: FoxholeSceneAssistantToolContext,
): FoxholeSceneAssistantToolResult {
    const gate = requireEditableScene('create_foxhole_binocular_line', context);
    if (!('sceneId' in gate)) {
        return gate;
    }

    let points: number[] = [];
    if (Array.isArray(args.points)) {
        points = args.points.map(Number).filter(Number.isFinite);
    }
    if (points.length < 4) {
        const startX = normalizeFiniteNumber(args.startX);
        const startY = normalizeFiniteNumber(args.startY);
        const endX = normalizeFiniteNumber(args.endX);
        const endY = normalizeFiniteNumber(args.endY);
        if (
            startX !== undefined
            && startY !== undefined
            && endX !== undefined
            && endY !== undefined
        ) {
            points = [startX, startY, endX, endY];
        }
    }
    if (points.length < 4) {
        return {
            ok: false,
            tool: 'create_foxhole_binocular_line',
            error: 'points must include at least two vertices (four numbers)',
        };
    }

    const id = createContributionId('foxhole-binocular-line');
    const clientActions: NixieAssistantClientAction[] = [{
        type: 'foxhole.scene.mutate',
        sceneId: gate.sceneId,
        ops: [{
            op: 'createBinocularLine',
            points,
            id,
        }],
    }];

    return {
        ok: true,
        tool: 'create_foxhole_binocular_line',
        result: {
            ok: true,
            nodeId: id,
            pointCount: Math.floor(points.length / 2),
            summary: 'Queued binocular line.',
            clientActions,
        },
    };
}

export function executeFoxholeSceneAssistantTool(
    name: string,
    args: Record<string, unknown>,
    context: FoxholeSceneAssistantToolContext,
): FoxholeSceneAssistantToolResult {
    const toolName = normalizeString(name);
    switch (toolName) {
        case 'place_foxhole_structure':
            return executePlaceFoxholeStructure(args, context);
        case 'connect_foxhole_power':
            return executeConnectFoxholePower(args, context);
        case 'resolve_region_edge':
            return executeResolveRegionEdge(args, context);
        case 'create_foxhole_binocular_line':
            return executeCreateFoxholeBinocularLine(args, context);
        default:
            return {
                ok: false,
                tool: toolName || name,
                error: `unknown tool: ${toolName || name}`,
            };
    }
}

export function normalizeFoxholeSceneAssistantContext(
    context: unknown,
): FoxholeSceneAssistantToolContext & Record<string, unknown> {
    const record = asRecord(context);
    const viewport = record.sceneViewport && typeof record.sceneViewport === 'object' && !Array.isArray(record.sceneViewport)
        ? record.sceneViewport as { centerX?: number; centerY?: number; }
        : null;
    return {
        ...record,
        sceneActive: Boolean(record.sceneActive),
        sceneId: normalizeString(record.sceneId) || undefined,
        sceneCanEdit: Boolean(record.sceneCanEdit),
        sceneViewport: viewport,
        baseAssetsUrl: normalizeString(record.baseAssetsUrl) || undefined,
    };
}
