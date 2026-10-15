import {
    FOXHOLE_WIKI_ASSISTANT_TOOLS,
    executeFoxholeWikiAssistantTool,
    parseFoxholeWikiAssistantToolArguments,

} from './wiki-assistant-tools.ts';
import type { FoxholeWikiAssistantToolContext } from './wiki-assistant-tools.ts';

export const FOXHOLE_WIKI_ASSISTANT_MAX_ROUNDS = 6;

export type FoxholeWikiAssistantOpenAiToolDefinition = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type FoxholeWikiAssistantOpenAiToolCall = {
    id: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
};

export type FoxholeWikiAssistantOpenAiChatMessage
    = | { role: 'tool'; tool_call_id: string; content: string; };

export type FoxholeWikiAssistantToolTraceEntry = {
    name: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    result?: unknown;
    error?: string;
};

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function buildFoxholeWikiAssistantOpenAiTools(
    tools = FOXHOLE_WIKI_ASSISTANT_TOOLS,
): FoxholeWikiAssistantOpenAiToolDefinition[] {
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

export function statusLabelForFoxholeWikiAssistantTool(toolName: string): string {
    const name = normalizeString(toolName);
    const match = FOXHOLE_WIKI_ASSISTANT_TOOLS.find(tool => tool.name === name);
    if (match?.statusLabel) {
        return match.statusLabel;
    }
    return name ? `Running ${name}…` : 'Running tool…';
}

export function createFoxholeWikiAssistantToolContext(options: {
    fetchImpl?: FoxholeWikiAssistantToolContext['fetchImpl'];
    passthrough?: Record<string, unknown>;
}): FoxholeWikiAssistantToolContext & Record<string, unknown> {
    return {
        ...(options.passthrough ?? {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };
}

export async function executeFoxholeWikiAssistantToolCalls(
    toolCalls: readonly FoxholeWikiAssistantOpenAiToolCall[],
    context: FoxholeWikiAssistantToolContext = {},
): Promise<{
    toolMessages: FoxholeWikiAssistantOpenAiChatMessage[];
    toolTrace: FoxholeWikiAssistantToolTraceEntry[];
}> {
    const toolMessages: FoxholeWikiAssistantOpenAiChatMessage[] = [];
    const toolTrace: FoxholeWikiAssistantToolTraceEntry[] = [];

    for (const call of toolCalls) {
        const callId = normalizeString(call.id) || `tool_${toolTrace.length}`;
        const name = normalizeString(call.function?.name);
        const args = parseFoxholeWikiAssistantToolArguments(call.function?.arguments);
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

        const executed = await executeFoxholeWikiAssistantTool(name, args, context);
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
