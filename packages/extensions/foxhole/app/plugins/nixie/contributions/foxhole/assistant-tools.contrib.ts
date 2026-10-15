import { useRuntimeConfig } from '#imports';
import { NIXIE_ASSISTANT_ID } from '#nixie/plugins/nixie/assistant/ids.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import type { NxAssistantChatBlock } from '#nixie/components/nx-assistant-chat.model.ts';
import type { NixieAssistantClientAction } from '#nixie/plugins/nixie/assistant/client-actions.ts';
import { resolveNixieEditorRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { readNixieAssistantShellLocation } from '#nixie/plugins/nixie/assistant/shell-location.ts';
import { buildNixieSceneAssistantViewportSnapshot } from '#nixie/plugins/nixie/assistant/scene-snapshots.ts';
import { activeNixieViewport } from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { focusFoxholeMapSearchEntry } from '#foxhole/composables/foxholeMapNavigation.ts';
import FoxholeAssistantItemChip from '#foxhole/components/nixie/foxhole/FoxholeAssistantItemChip.vue';
import FoxholeAssistantPlaceChip from '#foxhole/components/nixie/foxhole/FoxholeAssistantPlaceChip.vue';
import FoxholeAssistantRecipeBlock from '#foxhole/components/nixie/foxhole/FoxholeAssistantRecipeBlock.vue';
import { createFoxholeAssetsBaseUrl } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { setFoxholeMapAssistantHighlights } from '#foxhole/plugins/foxhole/nixie/map/assistant-highlights.ts';
import { registerNixieAgentBridgePackToolExecutor } from '#nixie/plugins/nixie/assistant/agent-bridge-tools.ts';
import {
    FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS,
    compactFoxholeMapPlaceEntries,
    executeFoxholeMapPlaceAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/map/place-assistant-tools.ts';
import {
    buildFoxholeMapSearchDataset,
    foxholeMapSearchCacheRef,
} from '#foxhole/plugins/foxhole/nixie/map/search.ts';
import type { FoxholeMapSearchEntry } from '#foxhole/plugins/foxhole/nixie/map/search.ts';
import { FOXHOLE_MAP_SETTING_KEYS, readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { FOXHOLE_PRODUCTION_ASSISTANT_TOOLS } from '#foxhole/plugins/foxhole/nixie/production/assistant-tools.ts';
import { collectFoxholeProductionSnapshots } from '#foxhole/plugins/foxhole/nixie/production/scene-snapshots.ts';
import { applyNixieAssistantFoxholeSceneMutate } from '#foxhole/plugins/foxhole/nixie/scene-assistant-apply.ts';
import {
    FOXHOLE_SCENE_ASSISTANT_TOOLS,
    executeFoxholeSceneAssistantTool,
} from '#foxhole/plugins/foxhole/nixie/scene-assistant-tools.ts';
import { FOXHOLE_WIKI_ASSISTANT_TOOLS } from '#foxhole/plugins/foxhole/nixie/wiki-assistant-tools.ts';

function buildFoxholeAssistantContext() {
    const runtimeConfig = useRuntimeConfig();
    const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
    const location = readNixieAssistantShellLocation();

    // Hub / non-project pages: do not dump the world place index or leftover viewport.
    if (!location.projectOpen) {
        return {
            baseAssetsUrl: assetsBaseUrl,
            sceneSnapshots: [],
            mapPlaces: { entries: [] },
            sceneViewport: null,
        };
    }

    const runtime = resolveNixieEditorRuntime();
    if (!runtime) {
        return {
            baseAssetsUrl: assetsBaseUrl,
            sceneSnapshots: [],
            mapPlaces: { entries: [] },
            sceneViewport: null,
        };
    }

    const project = runtime.projectStore.project;
    // Full world place index for NL resolution (not limited to currently visible hexes).
    const mapDataset = buildFoxholeMapSearchDataset(foxholeMapSearchCacheRef.value);
    const mapPlaces = {
        entries: compactFoxholeMapPlaceEntries(mapDataset.entries),
    };
    // Prefer the live board camera — do not rely on scene-active gating from nixie.scene.context
    // (that path can leave sceneViewport null even while the Foxhole map is on screen).
    const sceneViewport = buildNixieSceneAssistantViewportSnapshot(
        runtime.session.viewportRef.value ?? activeNixieViewport.value,
    );

    if (!project) {
        return {
            baseAssetsUrl: assetsBaseUrl,
            sceneSnapshots: [],
            mapPlaces,
            sceneViewport,
        };
    }
    void project.scene.revision.value;
    return {
        baseAssetsUrl: assetsBaseUrl,
        sceneSnapshots: collectFoxholeProductionSnapshots(project.scene.getRoots().slice()),
        mapPlaces,
        sceneViewport,
    };
}

function applyPlaceUiBlocks(blocks: readonly NxAssistantChatBlock[]): void {
    const placeBlocks = blocks.filter(block => block.kind === 'place');
    if (!placeBlocks.length) {
        return;
    }

    const runtime = resolveNixieEditorRuntime();
    const project = runtime?.projectStore.project;
    if (!runtime || !project) {
        return;
    }

    setFoxholeMapAssistantHighlights(placeBlocks.map(block => ({
        id: block.placeId,
        label: block.label,
        worldPosition: block.worldPosition,
    })));

    const primary = placeBlocks[0];
    if (!primary) {
        return;
    }

    const entry: FoxholeMapSearchEntry = {
        id: primary.placeId,
        type: primary.placeType,
        label: primary.label,
        regionKey: primary.regionKey,
        regionLabel: primary.regionKey,
        searchLabel: primary.label,
        worldPosition: {
            x: primary.worldPosition.x,
            y: primary.worldPosition.y,
        },
    };

    focusFoxholeMapSearchEntry({
        runtime,
        mapSettings: readFoxholeMapSettings(project.settings.value),
        entry,
        shardId: String(project.settings.value?.[FOXHOLE_MAP_SETTING_KEYS.shardId] ?? '').trim(),
        ensureMapEnabled: true,
        clearPlaybackPreview: true,
        reason: 'foxhole-assistant:ui-place-blocks',
    });
}

import { normalizeFoxholeAssistantAction } from '#foxhole/utils/assistant-client-actions.ts';

function applyFoxholeClientActions(actions: readonly NixieAssistantClientAction[]): void {
    for (const action of actions) {
        const normalized = normalizeFoxholeAssistantAction(action);
        if (normalized) {
            void applyNixieAssistantFoxholeSceneMutate(normalized);
        }
    }
}

const FOXHOLE_MAP_PLACE_TOOL_NAMES = new Set(
    FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS.map(tool => tool.name),
);
const FOXHOLE_SCENE_TOOL_NAMES = new Set(
    FOXHOLE_SCENE_ASSISTANT_TOOLS.map(tool => tool.name),
);

registerNixieAgentBridgePackToolExecutor((name, args, context) => {
    if (FOXHOLE_MAP_PLACE_TOOL_NAMES.has(name)) {
        return executeFoxholeMapPlaceAssistantTool(name, args, context as any);
    }
    if (FOXHOLE_SCENE_TOOL_NAMES.has(name)) {
        return executeFoxholeSceneAssistantTool(name, args, context as any);
    }
    return null;
});

export default defineContribution({
    assistantTools: [
        ...FOXHOLE_PRODUCTION_ASSISTANT_TOOLS.map((tool, index) => ({
            id: `foxhole.production.${tool.name}`,
            assistantId: NIXIE_ASSISTANT_ID,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            statusLabel: tool.statusLabel,
            order: (index + 1) * 10,
        })),
        ...FOXHOLE_MAP_PLACE_ASSISTANT_TOOLS.map((tool, index) => ({
            id: `foxhole.map.${tool.name}`,
            assistantId: NIXIE_ASSISTANT_ID,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            statusLabel: tool.statusLabel,
            order: 200 + ((index + 1) * 10),
        })),
        ...FOXHOLE_WIKI_ASSISTANT_TOOLS.map((tool, index) => ({
            id: `foxhole.wiki.${tool.name}`,
            assistantId: NIXIE_ASSISTANT_ID,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            statusLabel: tool.statusLabel,
            order: 300 + ((index + 1) * 10),
        })),
        ...FOXHOLE_SCENE_ASSISTANT_TOOLS.map((tool, index) => ({
            id: `foxhole.scene.${tool.name}`,
            assistantId: NIXIE_ASSISTANT_ID,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            statusLabel: tool.statusLabel,
            order: 400 + ((index + 1) * 10),
        })),
    ],
    assistantContexts: [
        {
            id: 'foxhole.production.context',
            assistantId: NIXIE_ASSISTANT_ID,
            order: 100,
            buildContext: buildFoxholeAssistantContext,
            onUiBlocks: applyPlaceUiBlocks,
            onClientActions: applyFoxholeClientActions,
        },
    ],
    assistantChatRenderers: [
        {
            id: 'foxhole.assistant.item',
            kind: 'item',
            order: 10,
            component: FoxholeAssistantItemChip,
        },
        {
            id: 'foxhole.assistant.recipe',
            kind: 'recipe',
            order: 20,
            component: FoxholeAssistantRecipeBlock,
        },
        {
            id: 'foxhole.assistant.place',
            kind: 'place',
            order: 30,
            component: FoxholeAssistantPlaceChip,
        },
    ],
});
