import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeWikiPageUrl,
    normalizeFoxholeWikiPageTitle,
    readFoxholeWikiPage,
    searchFoxholeWiki,
    stripFoxholeWikiHtml,
} from '../app/plugins/foxhole/nixie/wiki.ts';
import {
    executeFoxholeWikiAssistantTool,
    FOXHOLE_WIKI_ASSISTANT_TOOLS,
} from '../app/plugins/foxhole/nixie/wiki-assistant-tools.ts';
import {
    buildFoxholeWikiAssistantOpenAiTools,
    executeFoxholeWikiAssistantToolCalls,
} from '../app/plugins/foxhole/nixie/wiki-assistant-host.ts';
import { FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA } from '../app/plugins/foxhole/nixie/assistant-grounding.ts';

test('wiki system prompt requires grounded writes and forbids roleplay', () => {
    assert.match(FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA, /search_foxhole_wiki/);
    assert.match(FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA, /read_foxhole_wiki_page/);
    assert.match(FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA, /Before writing Foxhole mechanics/i);
    assert.match(FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA, /paraphrase or quote tool results only/i);
    assert.match(FOXHOLE_WIKI_SYSTEM_PROMPT_EXTRA, /Never roleplay Foxhole/i);
});

test('buildFoxholeWikiPageUrl matches inspector card slug rules', () => {
    assert.equal(
        buildFoxholeWikiPageUrl('Rifle Garrison (Tier 2)'),
        'https://foxhole.wiki.gg/wiki/Rifle_Garrison#Tier_2-0',
    );
    assert.equal(
        buildFoxholeWikiPageUrl('Resource Field'),
        'https://foxhole.wiki.gg/wiki/Resource_Field',
    );
    assert.equal(buildFoxholeWikiPageUrl('  '), '');
});

test('normalizeFoxholeWikiPageTitle accepts titles and wiki URLs', () => {
    assert.equal(normalizeFoxholeWikiPageTitle('Rifle_Garrison'), 'Rifle Garrison');
    assert.equal(
        normalizeFoxholeWikiPageTitle('https://foxhole.wiki.gg/wiki/Rifle_Garrison#Tier_2-0'),
        'Rifle Garrison',
    );
});

test('stripFoxholeWikiHtml removes MediaWiki highlight markup', () => {
    assert.equal(
        stripFoxholeWikiHtml('The <span class="searchmatch">Rifle</span> Garrison'),
        'The Rifle Garrison',
    );
});

test('wiki assistant tools are exported for OpenAI + client contrib', () => {
    assert.deepEqual(
        FOXHOLE_WIKI_ASSISTANT_TOOLS.map(tool => tool.name),
        ['search_foxhole_wiki', 'read_foxhole_wiki_page'],
    );
    assert.equal(buildFoxholeWikiAssistantOpenAiTools().length, 2);
});

test('searchFoxholeWiki maps MediaWiki search hits', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        query: {
            searchinfo: { totalhits: 2 },
            search: [
                {
                    ns: 0,
                    title: 'Rifle Garrison',
                    pageid: 2640,
                    size: 9938,
                    snippet: 'The <span class="searchmatch">Rifle</span> Garrison is a bunker mod',
                },
            ],
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await searchFoxholeWiki({
        query: 'Rifle Garrison',
        limit: 3,
        fetchImpl,
    });

    assert.equal(result.query, 'Rifle Garrison');
    assert.equal(result.totalHits, 2);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.title, 'Rifle Garrison');
    assert.equal(result.results[0]?.url, 'https://foxhole.wiki.gg/wiki/Rifle_Garrison');
    assert.equal(result.results[0]?.snippet, 'The Rifle Garrison is a bunker mod');
    assert.match(result.searchUrl, /Special:Search/);
});

test('readFoxholeWikiPage truncates long extracts', async () => {
    const longExtract = 'A'.repeat(800);
    const fetchImpl = async () => new Response(JSON.stringify({
        query: {
            pages: {
                2640: {
                    pageid: 2640,
                    title: 'Rifle Garrison',
                    extract: longExtract,
                },
            },
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const page = await readFoxholeWikiPage({
        title: 'Rifle_Garrison',
        maxChars: 500,
        fetchImpl,
    });

    assert.equal(page.title, 'Rifle Garrison');
    assert.equal(page.truncated, true);
    assert.equal(page.extract.endsWith('…'), true);
    assert.ok(page.extract.length <= 501);
});

test('executeFoxholeWikiAssistantTool search path returns tool result', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        query: {
            searchinfo: { totalhits: 1 },
            search: [{ title: 'Factory', pageid: 1, snippet: 'A logistics structure' }],
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const executed = await executeFoxholeWikiAssistantTool(
        'search_foxhole_wiki',
        { query: 'Factory' },
        { fetchImpl },
    );

    assert.equal(executed.ok, true);
    if (!executed.ok) {
        return;
    }
    const result = executed.result as { results: Array<{ title: string; }>; };
    assert.equal(result.results[0]?.title, 'Factory');
});

test('executeFoxholeWikiAssistantToolCalls is async-compatible', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        query: {
            pages: {
                1: {
                    pageid: 1,
                    title: 'Factory',
                    extract: 'The Factory crafts crates.',
                },
            },
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const executed = await executeFoxholeWikiAssistantToolCalls(
        [{
            id: 'call_1',
            function: {
                name: 'read_foxhole_wiki_page',
                arguments: JSON.stringify({ title: 'Factory' }),
            },
        }],
        { fetchImpl },
    );

    assert.equal(executed.toolTrace.length, 1);
    assert.equal(executed.toolTrace[0]?.ok, true);
    assert.equal(executed.toolMessages[0]?.tool_call_id, 'call_1');
});
