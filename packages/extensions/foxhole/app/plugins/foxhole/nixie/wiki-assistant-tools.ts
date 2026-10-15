import {
    readFoxholeWikiPage,
    searchFoxholeWiki,

} from './wiki.ts';
import type { FoxholeWikiFetch } from './wiki.ts';

export type FoxholeWikiAssistantJsonSchema = {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
};

export type FoxholeWikiAssistantToolDescriptor = {
    name: string;
    description: string;
    parameters: FoxholeWikiAssistantJsonSchema;
    statusLabel?: string;
};

export type FoxholeWikiAssistantToolContext = {
    fetchImpl?: FoxholeWikiFetch;
};

export type FoxholeWikiAssistantToolResult
    = | { ok: true; tool: string; result: unknown; }
        | { ok: false; tool: string; error: string; };

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function optionalPositiveInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

export const FOXHOLE_WIKI_ASSISTANT_TOOLS: readonly FoxholeWikiAssistantToolDescriptor[] = [
    {
        name: 'search_foxhole_wiki',
        description: [
            'Search foxhole.wiki.gg for pages matching a query.',
            'Use for Foxhole lore, mechanics, structure/vehicle/item rules, and anything not covered by production or map tools.',
            'Returns titles, URLs, and short snippets — call read_foxhole_wiki_page for full page text.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search text, e.g. "Rifle Garrison", "structural integrity", "Large Assembly Station".',
                },
                limit: {
                    type: 'integer',
                    description: 'Max results to return (1-10, default 5).',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
        statusLabel: 'Searching foxhole.wiki.gg…',
    },
    {
        name: 'read_foxhole_wiki_page',
        description: [
            'Fetch plain-text content from a foxhole.wiki.gg page by title or wiki URL.',
            'Prefer after search_foxhole_wiki when you need construction rules, stats, or detailed mechanics.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Wiki page title or full https://foxhole.wiki.gg/wiki/... URL.',
                },
                maxChars: {
                    type: 'integer',
                    description: 'Max characters of extract to return (500-12000, default 6000).',
                },
            },
            required: ['title'],
            additionalProperties: false,
        },
        statusLabel: 'Reading foxhole.wiki.gg…',
    },
];

export async function executeFoxholeWikiAssistantTool(
    name: string,
    args: Record<string, unknown>,
    context: FoxholeWikiAssistantToolContext = {},
): Promise<FoxholeWikiAssistantToolResult> {
    const tool = normalizeString(name);
    const fetchImpl = context.fetchImpl;

    try {
        if (tool === 'search_foxhole_wiki') {
            const query = normalizeString(args.query);
            if (!query) {
                return { ok: false, tool, error: 'query is required' };
            }
            const result = await searchFoxholeWiki({
                query,
                limit: optionalPositiveInt(args.limit, 5),
                fetchImpl,
            });
            return { ok: true, tool, result };
        }

        if (tool === 'read_foxhole_wiki_page') {
            const title = normalizeString(args.title);
            if (!title) {
                return { ok: false, tool, error: 'title is required' };
            }
            const result = await readFoxholeWikiPage({
                title,
                maxChars: optionalPositiveInt(args.maxChars, 6_000),
                fetchImpl,
            });
            return { ok: true, tool, result };
        }

        return { ok: false, tool, error: `unknown tool "${tool}"` };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, tool: tool || name, error: message };
    }
}

export function parseFoxholeWikiAssistantToolArguments(
    raw: string | null | undefined,
): Record<string, unknown> {
    const text = normalizeString(raw);
    if (!text) {
        return {};
    }
    try {
        return asRecord(JSON.parse(text));
    } catch {
        return { _parseError: 'invalid JSON arguments', raw: text };
    }
}
