import type {
    NixieAssistantOpenAiChatMessage,
    NixieAssistantOpenAiToolCall,
    NixieAssistantOpenAiToolDefinition,
    NixieAssistantToolTraceEntry,
} from '#nixie/plugins/nixie/assistant/types.ts';
import {
    FOXHOLE_SCENE_ASSISTANT_TOOLS,
    executeFoxholeSceneAssistantTool,
    normalizeFoxholeSceneAssistantContext,
} from './scene-assistant-tools.ts';
import type { FoxholeSceneAssistantToolContext } from './scene-assistant-tools.ts';

export const FOXHOLE_SCENE_ASSISTANT_MAX_ROUNDS = 10;

export {
    normalizeFoxholeSceneAssistantContext,
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

export function buildFoxholeSceneAssistantOpenAiTools(
    tools = FOXHOLE_SCENE_ASSISTANT_TOOLS,
): NixieAssistantOpenAiToolDefinition[] {
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

export function statusLabelForFoxholeSceneAssistantTool(toolName: string): string {
    const name = normalizeString(toolName);
    const match = FOXHOLE_SCENE_ASSISTANT_TOOLS.find(tool => tool.name === name);
    if (match?.statusLabel) {
        return match.statusLabel;
    }
    return name ? `Running ${name}…` : 'Running tool…';
}

export function parseFoxholeSceneAssistantToolArguments(
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

export function executeFoxholeSceneAssistantToolCalls(
    toolCalls: readonly NixieAssistantOpenAiToolCall[],
    context: FoxholeSceneAssistantToolContext,
): {
    toolMessages: NixieAssistantOpenAiChatMessage[];
    toolTrace: NixieAssistantToolTraceEntry[];
} {
    const toolMessages: NixieAssistantOpenAiChatMessage[] = [];
    const toolTrace: NixieAssistantToolTraceEntry[] = [];

    for (const call of toolCalls) {
        const callId = normalizeString(call.id) || `tool_${toolTrace.length}`;
        const name = normalizeString(call.function?.name);
        const args = parseFoxholeSceneAssistantToolArguments(call.function?.arguments);
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

        const executed = executeFoxholeSceneAssistantTool(name, args, context);
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
