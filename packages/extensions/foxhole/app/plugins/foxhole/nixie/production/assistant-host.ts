import {
    FOXHOLE_PRODUCTION_ASSISTANT_TOOLS,
    executeFoxholeProductionAssistantTool,
} from './assistant-tools.ts';
import type { FoxholeProductionAssistantToolContext } from './assistant-tools.ts';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../catalog.ts';
import { getFoxholeProductionIndex } from './index.ts';
import type { FoxholeProductionStructureSnapshotLike } from './types.ts';

export const FOXHOLE_PRODUCTION_ASSISTANT_MAX_ROUNDS = 8;

export type FoxholeProductionAssistantChatRole = 'user' | 'assistant';

export type FoxholeProductionAssistantChatMessage = {
    role: FoxholeProductionAssistantChatRole;
    content: string;
};

export type FoxholeProductionAssistantToolTraceEntry = {
    name: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    result?: unknown;
    error?: string;
};

export type FoxholeProductionAssistantOpenAiToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type FoxholeProductionAssistantOpenAiToolCall = {
    id: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
};

export type FoxholeProductionAssistantOpenAiChatMessage
    = | { role: 'system'; content: string; }
        | { role: 'user'; content: string; }
        | { role: 'assistant'; content?: string | null; tool_calls?: FoxholeProductionAssistantOpenAiToolCall[]; }
        | { role: 'tool'; tool_call_id: string; content: string; };

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

export function buildFoxholeProductionAssistantOpenAiTools(
    tools = FOXHOLE_PRODUCTION_ASSISTANT_TOOLS,
): FoxholeProductionAssistantOpenAiToolDefinition[] {
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: tool.parameters.type,
                properties: tool.parameters.properties,
                ...(tool.parameters.required ? { required: tool.parameters.required } : {}),
                ...(tool.parameters.additionalProperties === undefined
                    ? {}
                    : { additionalProperties: tool.parameters.additionalProperties }),
            },
        },
    }));
}

export function statusLabelForFoxholeProductionAssistantTool(toolName: string): string {
    const name = normalizeString(toolName);
    const match = FOXHOLE_PRODUCTION_ASSISTANT_TOOLS.find(tool => tool.name === name);
    if (match?.statusLabel) {
        return match.statusLabel;
    }
    return name ? `Running ${name}…` : 'Running tool…';
}

export function normalizeFoxholeProductionAssistantMessages(
    value: unknown,
): FoxholeProductionAssistantChatMessage[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const messages: FoxholeProductionAssistantChatMessage[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const role = normalizeString(record.role);
        const content = normalizeString(record.content);
        if ((role !== 'user' && role !== 'assistant') || !content) {
            continue;
        }
        messages.push({ role, content });
    }
    return messages;
}

export function normalizeFoxholeProductionAssistantSceneSnapshots(
    value: unknown,
): FoxholeProductionStructureSnapshotLike[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(entry => entry && typeof entry === 'object') as FoxholeProductionStructureSnapshotLike[];
}

export function createFoxholeProductionAssistantToolContext(options: {
    baseAssetsUrl?: string;
    sceneSnapshots?: readonly FoxholeProductionStructureSnapshotLike[];
    /** Preserve unrelated context keys from the client (e.g. mapPlaces). */
    passthrough?: Record<string, unknown>;
}): FoxholeProductionAssistantToolContext & Record<string, unknown> {
    const baseAssetsUrl = normalizeString(options.baseAssetsUrl) || '/foxhole/assets/';
    const sceneSnapshots = options.sceneSnapshots ?? [];
    return {
        ...(options.passthrough ?? {}),
        baseAssetsUrl,
        index: getFoxholeProductionIndex(baseAssetsUrl),
        itemCatalog: getFoxholeItemCatalog(baseAssetsUrl),
        structureCatalog: getFoxholeStructureCatalog(baseAssetsUrl),
        sceneSnapshots,
        includeBoard: sceneSnapshots.length > 0,
    };
}

export function parseFoxholeProductionAssistantToolArguments(
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

export function executeFoxholeProductionAssistantToolCalls(
    toolCalls: readonly FoxholeProductionAssistantOpenAiToolCall[],
    context: FoxholeProductionAssistantToolContext,
): {
    toolMessages: FoxholeProductionAssistantOpenAiChatMessage[];
    toolTrace: FoxholeProductionAssistantToolTraceEntry[];
} {
    const toolMessages: FoxholeProductionAssistantOpenAiChatMessage[] = [];
    const toolTrace: FoxholeProductionAssistantToolTraceEntry[] = [];

    for (const call of toolCalls) {
        const callId = normalizeString(call.id) || `tool_${toolTrace.length}`;
        const name = normalizeString(call.function?.name);
        const args = parseFoxholeProductionAssistantToolArguments(call.function?.arguments);
        if (!name) {
            const error = 'missing tool name';
            toolTrace.push({ name: '', arguments: args, ok: false, error });
            toolMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify({ ok: false, error }),
            });
            continue;
        }

        const executed = executeFoxholeProductionAssistantTool(name, args, context);
        if (executed.ok) {
            toolTrace.push({
                name: executed.tool,
                arguments: args,
                ok: true,
                result: executed.result,
            });
            toolMessages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify(executed.result),
            });
            continue;
        }

        toolTrace.push({
            name: executed.tool || name,
            arguments: args,
            ok: false,
            error: executed.error,
        });
        toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({ ok: false, error: executed.error }),
        });
    }

    return { toolMessages, toolTrace };
}
