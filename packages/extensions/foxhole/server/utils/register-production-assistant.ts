import { NIXIE_ASSISTANT_ID } from '#nixie/plugins/nixie/assistant/ids.ts';
import { registerNixieAssistantToolPack } from '#nixie-server/utils/assistant-provider-registry';
import {
    FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA,
    FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA,
    FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA,
} from '#foxhole/plugins/foxhole/nixie/assistant-grounding.ts';
import {
    FOXHOLE_MAP_PLACE_ASSISTANT_MAX_ROUNDS,
    buildFoxholeMapPlaceAssistantOpenAiTools,
    createFoxholeMapPlaceAssistantToolContext,
    executeFoxholeMapPlaceAssistantToolCalls,
    statusLabelForFoxholeMapPlaceAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/map/place-assistant-host.ts';
import {
    FOXHOLE_PRODUCTION_ASSISTANT_MAX_ROUNDS,
    buildFoxholeProductionAssistantOpenAiTools,
    createFoxholeProductionAssistantToolContext,
    executeFoxholeProductionAssistantToolCalls,
    normalizeFoxholeProductionAssistantSceneSnapshots,
    statusLabelForFoxholeProductionAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/production/assistant-host.ts';
import {
    FOXHOLE_SCENE_ASSISTANT_MAX_ROUNDS,
    buildFoxholeSceneAssistantOpenAiTools,
    executeFoxholeSceneAssistantToolCalls,
    normalizeFoxholeSceneAssistantContext,
    statusLabelForFoxholeSceneAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/scene-assistant-host.ts';
import { FOXHOLE_SCENE_SYSTEM_PROMPT_EXTRA } from '#foxhole/plugins/foxhole/nixie/scene-assistant-tools.ts';
import {
    FOXHOLE_WIKI_ASSISTANT_MAX_ROUNDS,
    buildFoxholeWikiAssistantOpenAiTools,
    createFoxholeWikiAssistantToolContext,
    executeFoxholeWikiAssistantToolCalls,
    statusLabelForFoxholeWikiAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/wiki-assistant-host.ts';

export {
    FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA,
    FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA,
    FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA,
} from '#foxhole/plugins/foxhole/nixie/assistant-grounding.ts';
export { FOXHOLE_SCENE_SYSTEM_PROMPT_EXTRA } from '#foxhole/plugins/foxhole/nixie/scene-assistant-tools.ts';

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

const FOXHOLE_PRODUCTION_TOOL_PACK_ID = 'foxhole.production.tools';
const FOXHOLE_MAP_PLACE_TOOL_PACK_ID = 'foxhole.map.tools';
const FOXHOLE_WIKI_TOOL_PACK_ID = 'foxhole.wiki.tools';
const FOXHOLE_SCENE_TOOL_PACK_ID = 'foxhole.scene.tools';

export function registerFoxholeProductionAssistantProvider(): void {
    registerNixieAssistantToolPack({
        id: FOXHOLE_PRODUCTION_TOOL_PACK_ID,
        assistantId: NIXIE_ASSISTANT_ID,
        systemPromptExtra: FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA,
        maxRounds: FOXHOLE_PRODUCTION_ASSISTANT_MAX_ROUNDS,
        buildOpenAiTools: () => buildFoxholeProductionAssistantOpenAiTools(),
        normalizeContext: context => {
            const record = asRecord(context);
            const {
                baseAssetsUrl: _baseAssetsUrl,
                sceneSnapshots: _sceneSnapshots,
                index: _index,
                itemCatalog: _itemCatalog,
                structureCatalog: _structureCatalog,
                includeBoard: _includeBoard,
                ...passthrough
            } = record;
            return createFoxholeProductionAssistantToolContext({
                baseAssetsUrl: typeof record.baseAssetsUrl === 'string' ? record.baseAssetsUrl : undefined,
                sceneSnapshots: normalizeFoxholeProductionAssistantSceneSnapshots(record.sceneSnapshots),
                passthrough,
            });
        },
        executeToolCalls: (toolCalls, context) => executeFoxholeProductionAssistantToolCalls(
            toolCalls,
            context as ReturnType<typeof createFoxholeProductionAssistantToolContext>,
        ),
        statusLabelForTool: statusLabelForFoxholeProductionAssistantTool,
    });

    registerNixieAssistantToolPack({
        id: FOXHOLE_MAP_PLACE_TOOL_PACK_ID,
        assistantId: NIXIE_ASSISTANT_ID,
        systemPromptExtra: FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA,
        maxRounds: FOXHOLE_MAP_PLACE_ASSISTANT_MAX_ROUNDS,
        buildOpenAiTools: () => buildFoxholeMapPlaceAssistantOpenAiTools(),
        normalizeContext: context => {
            const record = asRecord(context);
            const { mapPlaces: _mapPlaces, sceneViewport: _sceneViewport, ...passthrough } = record;
            return createFoxholeMapPlaceAssistantToolContext({
                mapPlaces: record.mapPlaces,
                sceneViewport: record.sceneViewport,
                passthrough,
            });
        },
        executeToolCalls: (toolCalls, context) => executeFoxholeMapPlaceAssistantToolCalls(
            toolCalls,
            context as ReturnType<typeof createFoxholeMapPlaceAssistantToolContext>,
        ),
        statusLabelForTool: statusLabelForFoxholeMapPlaceAssistantTool,
    });

    registerNixieAssistantToolPack({
        id: FOXHOLE_WIKI_TOOL_PACK_ID,
        assistantId: NIXIE_ASSISTANT_ID,
        systemPromptExtra: FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA,
        maxRounds: FOXHOLE_WIKI_ASSISTANT_MAX_ROUNDS,
        buildOpenAiTools: () => buildFoxholeWikiAssistantOpenAiTools(),
        normalizeContext: context => {
            const record = asRecord(context);
            return createFoxholeWikiAssistantToolContext({
                passthrough: record,
            });
        },
        executeToolCalls: (toolCalls, context) => executeFoxholeWikiAssistantToolCalls(
            toolCalls,
            context as ReturnType<typeof createFoxholeWikiAssistantToolContext>,
        ),
        statusLabelForTool: statusLabelForFoxholeWikiAssistantTool,
    });

    registerNixieAssistantToolPack({
        id: FOXHOLE_SCENE_TOOL_PACK_ID,
        assistantId: NIXIE_ASSISTANT_ID,
        systemPromptExtra: FOXHOLE_SCENE_SYSTEM_PROMPT_EXTRA,
        maxRounds: FOXHOLE_SCENE_ASSISTANT_MAX_ROUNDS,
        buildOpenAiTools: () => buildFoxholeSceneAssistantOpenAiTools(),
        normalizeContext: context => normalizeFoxholeSceneAssistantContext(context),
        executeToolCalls: (toolCalls, context) => executeFoxholeSceneAssistantToolCalls(
            toolCalls,
            context as ReturnType<typeof normalizeFoxholeSceneAssistantContext>,
        ),
        statusLabelForTool: statusLabelForFoxholeSceneAssistantTool,
    });
}
