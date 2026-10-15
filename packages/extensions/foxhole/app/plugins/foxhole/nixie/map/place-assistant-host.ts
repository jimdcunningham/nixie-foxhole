import {
    FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS,
    executeFoxholeMapPlaceAssistantTool,
    normalizeFoxholeMapPlaceEntries,

} from './place-assistant-tools.ts';
import type { FoxholeMapPlaceAssistantToolContext } from './place-assistant-tools.ts';

export const FOXHOLE_MAP_PLACE_ASSISTANT_MAX_ROUNDS = 6;

export type FoxholeMapPlaceAssistantOpenAiToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type FoxholeMapPlaceAssistantOpenAiToolCall = {
    id: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
};

export type FoxholeMapPlaceAssistantOpenAiChatMessage
    = | { role: 'tool'; tool_call_id: string; content: string; };

export type FoxholeMapPlaceAssistantToolTraceEntry = {
    name: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    result?: unknown;
    error?: string;
};

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

export function buildFoxholeMapPlaceAssistantOpenAiTools(
    tools = FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS,
): FoxholeMapPlaceAssistantOpenAiToolDefinition[] {
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

export function statusLabelForFoxholeMapPlaceAssistantTool(toolName: string): string {
    const name = normalizeString(toolName);
    const match = FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS.find(tool => tool.name === name);
    if (match?.statusLabel) {
        return match.statusLabel;
    }
    return name ? `Running ${name}…` : 'Running tool…';
}

export function createFoxholeMapPlaceAssistantToolContext(options: {
    mapPlaces?: unknown;
    sceneViewport?: unknown;
    passthrough?: Record<string, unknown>;
}): FoxholeMapPlaceAssistantToolContext & Record<string, unknown> {
    const record = asRecord(options.mapPlaces);
    const viewportRecord = asRecord(options.sceneViewport);
    const centerX = Number(viewportRecord.centerX);
    const centerY = Number(viewportRecord.centerY);
    const minX = Number(viewportRecord.minX);
    const minY = Number(viewportRecord.minY);
    const maxX = Number(viewportRecord.maxX);
    const maxY = Number(viewportRecord.maxY);
    const hasCenter = Number.isFinite(centerX) && Number.isFinite(centerY);
    const hasBounds = [minX, minY, maxX, maxY].every(Number.isFinite);
    return {
        ...(options.passthrough ?? {}),
        mapPlaces: {
            entries: normalizeFoxholeMapPlaceEntries(record.entries),
        },
        // Keep full viewport fields so later pack normalizers (nixie.scene) do not
        // discard a center-only snapshot.
        sceneViewport: hasCenter
            ? {
                centerX,
                centerY,
                minX: hasBounds ? minX : centerX - 500,
                minY: hasBounds ? minY : centerY - 500,
                maxX: hasBounds ? maxX : centerX + 500,
                maxY: hasBounds ? maxY : centerY + 500,
            }
            : null,
    };
}

export function parseFoxholeMapPlaceAssistantToolArguments(
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

export function executeFoxholeMapPlaceAssistantToolCalls(
    toolCalls: readonly FoxholeMapPlaceAssistantOpenAiToolCall[],
    context: FoxholeMapPlaceAssistantToolContext,
): {
    toolMessages: FoxholeMapPlaceAssistantOpenAiChatMessage[];
    toolTrace: FoxholeMapPlaceAssistantToolTraceEntry[];
} {
    const toolMessages: FoxholeMapPlaceAssistantOpenAiChatMessage[] = [];
    const toolTrace: FoxholeMapPlaceAssistantToolTraceEntry[] = [];

    for (const call of toolCalls) {
        const callId = normalizeString(call.id) || `tool_${toolTrace.length}`;
        const name = normalizeString(call.function?.name);
        const args = parseFoxholeMapPlaceAssistantToolArguments(call.function?.arguments);
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

        const executed = executeFoxholeMapPlaceAssistantTool(name, args, context);
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
