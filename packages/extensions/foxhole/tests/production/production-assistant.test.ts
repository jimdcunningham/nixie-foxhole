import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA,
    FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA,
} from '../../app/plugins/foxhole/nixie/assistant-grounding.ts';
import {
    FOXHOLE_PRODUCTION_ASSISTANT_TOOLS,
} from '../../app/plugins/foxhole/nixie/production/assistant-tools.ts';
import type {
    FoxholeProductionIndex,
    FoxholeProductionRecipe,
} from '../../app/plugins/foxhole/nixie/production/types.ts';
import {
    buildFoxholeProductionAssistantOpenAiTools,
    executeFoxholeProductionAssistantToolCalls,
    normalizeFoxholeProductionAssistantMessages,
    parseFoxholeProductionAssistantToolArguments,
    statusLabelForFoxholeProductionAssistantTool,
} from '../../app/plugins/foxhole/nixie/production/assistant-host.ts';

function recipe(partial: Partial<FoxholeProductionRecipe> & Pick<FoxholeProductionRecipe, 'id' | 'sourceStructureId' | 'sourceStructureName'>): FoxholeProductionRecipe {
    return {
        sourceType: 'structure',
        sourceStructureKey: partial.sourceStructureId,
        sourceSlotId: null,
        sourceSlotName: null,
        sourceVariantId: null,
        sourceVariantName: null,
        sourceModificationId: null,
        isUpgrade: false,
        durationSeconds: 10,
        powerDelta: -1000,
        consumesResourceNodes: false,
        itemInput: {},
        crateInput: {},
        liquidInput: {},
        itemOutput: {},
        crateOutput: {},
        liquidOutput: {},
        buildOutput: {},
        ...partial,
    };
}

function createTestIndex(): FoxholeProductionIndex {
    const bmatsRecipe = recipe({
        id: 'structure:facilityrefinery1:recipe:0',
        sourceStructureId: 'facilityrefinery1',
        sourceStructureName: 'Materials Factory',
        durationSeconds: 25,
        itemInput: { Metal: { quantity: 10, icon: null } },
        itemOutput: { Cloth: { quantity: 20, icon: null } },
    });

    return {
        recipeById: {
            [bmatsRecipe.id]: bmatsRecipe,
        },
        recipeIdsByOutput: {
            'item:Cloth': [bmatsRecipe.id],
        },
        structureRecipeIdsByStructureId: {
            facilityrefinery1: [bmatsRecipe.id],
        },
        modificationRecipeIdsBySlotVariantKey: {},
        parentBuildTargetIdByTargetId: {},
    };
}

test('buildFoxholeProductionAssistantOpenAiTools maps descriptors to OpenAI tool schema', () => {
    const tools = buildFoxholeProductionAssistantOpenAiTools(FOXHOLE_PRODUCTION_ASSISTANT_TOOLS);
    assert.equal(tools.length, FOXHOLE_PRODUCTION_ASSISTANT_TOOLS.length);
    for (const tool of tools) {
        assert.equal(tool.type, 'function');
        assert.ok(tool.function.name);
        assert.ok(tool.function.description.length > 0);
        assert.equal(tool.function.parameters.type, 'object');
        assert.ok(tool.function.parameters.properties);
    }
    assert.ok(tools.some(tool => tool.function.name === 'query_production_itinerary'));
});

test('normalizeFoxholeProductionAssistantMessages keeps valid turns only', () => {
    const messages = normalizeFoxholeProductionAssistantMessages([
        { role: 'user', content: 'how do I make bmats?' },
        { role: 'assistant', content: 'Use the Refinery.' },
        { role: 'system', content: 'ignore me' },
        { role: 'user', content: '   ' },
        { role: 'tool', content: '{}' },
    ]);
    assert.deepEqual(messages, [
        { role: 'user', content: 'how do I make bmats?' },
        { role: 'assistant', content: 'Use the Refinery.' },
    ]);
});

test('parseFoxholeProductionAssistantToolArguments parses JSON objects', () => {
    assert.deepEqual(
        parseFoxholeProductionAssistantToolArguments('{"query":"bmats","quantity":100}'),
        { query: 'bmats', quantity: 100 },
    );
    const invalid = parseFoxholeProductionAssistantToolArguments('{nope');
    assert.equal(invalid._parseError, 'invalid JSON arguments');
});

test('executeFoxholeProductionAssistantToolCalls runs tools without network', () => {
    const index = createTestIndex();
    const { toolMessages, toolTrace } = executeFoxholeProductionAssistantToolCalls(
        [{
            id: 'call_1',
            function: {
                name: 'resolve_production_output',
                arguments: JSON.stringify({ query: 'Cloth' }),
            },
        }],
        {
            baseAssetsUrl: '/foxhole/assets/',
            index,
        },
    );

    assert.equal(toolTrace.length, 1);
    assert.equal(toolTrace[0]?.ok, true);
    assert.equal(toolTrace[0]?.name, 'resolve_production_output');
    assert.equal(toolMessages.length, 1);
    assert.equal(toolMessages[0]?.role, 'tool');
    assert.equal(toolMessages[0]?.tool_call_id, 'call_1');
    const payload = JSON.parse(String(toolMessages[0]?.content ?? '{}')) as { commodityKey?: string; };
    assert.equal(payload.commodityKey, 'item:Cloth');
});

test('statusLabelForFoxholeProductionAssistantTool maps known tools', () => {
    assert.equal(
        statusLabelForFoxholeProductionAssistantTool('search_production_outputs'),
        'Searching production outputs…',
    );
    assert.equal(
        statusLabelForFoxholeProductionAssistantTool('query_production_itinerary'),
        'Building production itinerary…',
    );
});

test('foxhole packs compose grounding prompt extras onto Nixie', () => {
    assert.match(FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA, /User insistence does not override tool results/i);
    assert.match(FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA, /no helicopters/i);
    assert.match(FOXHOLE_PRODUCTION_SYSTEM_PROMPT_EXTRA, /generate_project_image/i);
    assert.match(FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA, /found is false or error is not_found/i);
    assert.match(FOXHOLE_MAP_PLACE_SYSTEM_PROMPT_EXTRA, /describe_map_location/i);
});
