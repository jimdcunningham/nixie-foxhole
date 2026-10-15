import assert from 'node:assert/strict';
import test from 'node:test';
import {
    executeFoxholeMapPlaceAssistantTool,
    queryNearestFoxholeMapPlaces,
    resolveFoxholeMapPlaces,

} from '../app/plugins/foxhole/nixie/map/place-assistant-tools.ts';
import type { FoxholeMapPlaceSnapshotEntry } from '../app/plugins/foxhole/nixie/map/place-assistant-tools.ts';
import { createFoxholeMapPlaceAssistantToolContext } from '../app/plugins/foxhole/nixie/map/place-assistant-host.ts';
import { normalizeNixieSceneAssistantContext } from '../../../nixie/app/plugins/nixie/assistant/scene-assistant-host.ts';

const FIXTURE_ENTRIES: FoxholeMapPlaceSnapshotEntry[] = [
    {
        id: 'region:DeadLandsHex',
        type: 'region',
        label: 'Deadlands',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: 0,
        y: 0,
    },
    {
        id: 'town:DeadLandsHex:0:abandoned ward',
        type: 'town',
        label: 'Abandoned Ward',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: 1000,
        y: 1000,
    },
    {
        id: 'district:DeadLandsHex:1:sunhaven gateway',
        type: 'district',
        label: 'Sunhaven Gateway',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: 1800,
        y: 900,
    },
    {
        id: 'town:DeadLandsHex:2:callahan\'s gate',
        type: 'town',
        label: 'Callahan\'s Gate',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: 4200,
        y: 3800,
    },
    {
        id: 'resource_field:DeadLandsHex:20:0:salvage field',
        type: 'resource_field',
        label: 'Salvage Field',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: -1000,
        y: -500,
    },
    {
        id: 'region:EndlessShoreHex',
        type: 'region',
        label: 'Endless Shore',
        regionKey: 'EndlessShoreHex',
        regionLabel: 'Endless Shore',
        x: 20000,
        y: 0,
    },
    {
        id: 'town:EndlessShoreHex:0:saltbrook channel',
        type: 'town',
        label: 'Saltbrook Channel',
        regionKey: 'EndlessShoreHex',
        regionLabel: 'Endless Shore',
        x: 21000,
        y: 500,
    },
    {
        id: 'district:DrownedValeHex:8:sop fields',
        type: 'district',
        label: 'Sop Fields',
        regionKey: 'DrownedValeHex',
        regionLabel: 'The Drowned Vale',
        x: 53805,
        y: 40715,
    },
    {
        id: 'town:DrownedValeHex:0:bootnap',
        type: 'town',
        label: 'Bootnap',
        regionKey: 'DrownedValeHex',
        regionLabel: 'The Drowned Vale',
        x: 73970,
        y: 33764,
    },
    {
        id: 'resource_field:DrownedValeHex:20:0:salvage field',
        type: 'resource_field',
        label: 'Salvage Field',
        regionKey: 'DrownedValeHex',
        regionLabel: 'The Drowned Vale',
        x: 60000,
        y: 35000,
    },
    {
        id: 'resource_field:DeadLandsHex:20:0:salvage field',
        type: 'resource_field',
        label: 'Salvage Field',
        regionKey: 'DeadLandsHex',
        regionLabel: 'Deadlands',
        x: 5000,
        y: 2000,
    },
];

test('resolveFoxholeMapPlaces ranks Deadlands docks toward Sunhaven Gateway', () => {
    const resolved = resolveFoxholeMapPlaces('Deadlands near the docks', FIXTURE_ENTRIES, { limit: 5 });
    assert.ok(resolved.length > 0);
    assert.equal(resolved[0]?.entry.regionKey, 'DeadLandsHex');
    assert.ok(resolved.some(row => row.entry.label === 'Sunhaven Gateway'));
    const sunhaven = resolved.find(row => row.entry.label === 'Sunhaven Gateway');
    assert.ok(sunhaven);
    assert.ok((sunhaven?.score ?? 0) >= (resolved.find(row => row.entry.label === 'Callahan\'s Gate')?.score ?? 0));
});

test('resolveFoxholeMapPlaces prefers the region for a bare region name', () => {
    const resolved = resolveFoxholeMapPlaces('Deadlands', FIXTURE_ENTRIES, { limit: 5 });
    assert.ok(resolved.length > 0);
    assert.equal(resolved[0]?.entry.type, 'region');
    assert.equal(resolved[0]?.entry.label, 'Deadlands');
    assert.ok(resolved[0]!.score > (resolved.find(row => row.entry.type === 'resource_field')?.score ?? 0));
});

test('queryNearestFoxholeMapPlaces ranks by distance from origin', () => {
    const nearest = queryNearestFoxholeMapPlaces({
        entries: FIXTURE_ENTRIES,
        origin: { x: 1800, y: 900 },
        regionKey: 'DeadLandsHex',
        type: 'town',
        limit: 3,
    });
    assert.ok(nearest.length > 0);
    assert.equal(nearest[0]?.entry.label, 'Abandoned Ward');
    assert.ok((nearest[0]?.distance ?? 0) < (nearest[1]?.distance ?? Number.POSITIVE_INFINITY));
});

test('resolve_map_place tool returns uiBlocks', () => {
    const result = executeFoxholeMapPlaceAssistantTool(
        'resolve_map_place',
        { query: 'Abandoned Ward' },
        { mapPlaces: { entries: FIXTURE_ENTRIES } },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found?: boolean;
        places: Array<{ label: string; }>;
        uiBlocks: Array<{ kind: string; label?: string; }>;
    };
    assert.equal(payload.found, true);
    assert.ok(payload.places.some(place => place.label === 'Abandoned Ward'));
    assert.ok(payload.uiBlocks.some(block => block.kind === 'place'));
});

test('resolve_map_place returns found false when no matches', () => {
    const result = executeFoxholeMapPlaceAssistantTool(
        'resolve_map_place',
        { query: 'zzzzqxqvwxzz' },
        {
            mapPlaces: {
                entries: [{
                    id: 'town:TestHex:0:alpha',
                    type: 'town',
                    label: 'Alpha',
                    regionKey: 'TestHex',
                    regionLabel: 'Test',
                    x: 0,
                    y: 0,
                }],
            },
        },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found: boolean;
        error: string;
        query: string;
        places: unknown[];
        top: null;
        guidance: string;
    };
    assert.equal(payload.found, false);
    assert.equal(payload.error, 'not_found');
    assert.equal(payload.places.length, 0);
    assert.equal(payload.top, null);
    assert.match(payload.guidance, /do not invent/i);
});

test('resolve_map_place rejects pronoun where-am-I queries', () => {
    for (const query of ['I', 'here', 'Where am I', 'where am i']) {
        const result = executeFoxholeMapPlaceAssistantTool(
            'resolve_map_place',
            { query },
            { mapPlaces: { entries: FIXTURE_ENTRIES } },
        );
        assert.equal(result.ok, true);
        if (!result.ok) {
            continue;
        }
        const payload = result.result as {
            found?: boolean;
            error?: string;
            places: unknown[];
        };
        assert.equal(payload.found, false);
        assert.ok(payload.error === 'not_a_place_query' || payload.error === 'not_found');
        assert.equal(payload.places.length, 0);
    }
});

test('resolveFoxholeMapPlaces does not match Coal Field for letter I or here', () => {
    const withCoal: FoxholeMapPlaceSnapshotEntry[] = [
        ...FIXTURE_ENTRIES,
        {
            id: 'resource_field:WeatheredExpanseHex:61:0:coal field',
            type: 'resource_field',
            label: 'Coal Field',
            regionKey: 'WeatheredExpanseHex',
            regionLabel: 'Weathered Expanse',
            x: 86906,
            y: -79355,
        },
    ];
    assert.equal(resolveFoxholeMapPlaces('I', withCoal).length, 0);
    assert.equal(resolveFoxholeMapPlaces('here', withCoal).length, 0);
    assert.equal(resolveFoxholeMapPlaces('Where am I', withCoal).length, 0);
});

test('describe_map_location uses viewport center for nearest towns', () => {
    const result = executeFoxholeMapPlaceAssistantTool(
        'describe_map_location',
        { limit: 3 },
        {
            mapPlaces: { entries: FIXTURE_ENTRIES },
            sceneViewport: { centerX: 1800, centerY: 900 },
        },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        found?: boolean;
        region?: { label: string; } | null;
        places: Array<{ label: string; type: string; }>;
        error?: string;
    };
    assert.equal(payload.found, true);
    assert.ok(!payload.error);
    assert.equal(payload.region?.label, 'Deadlands');
    assert.ok(payload.places.some(place => place.label === 'Abandoned Ward' || place.label === 'Sunhaven Gateway'));
    assert.ok(!payload.places.some(place => place.label === 'Coal Field'));
});

test('query_nearest_places falls back to viewport when origin omitted', () => {
    const result = executeFoxholeMapPlaceAssistantTool(
        'query_nearest_places',
        { type: 'town', limit: 2 },
        {
            mapPlaces: { entries: FIXTURE_ENTRIES },
            sceneViewport: { centerX: 1800, centerY: 900 },
        },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        places: Array<{ label: string; }>;
        origin?: { source?: string; };
    };
    assert.equal(payload.origin?.source, 'viewport');
    assert.equal(payload.places[0]?.label, 'Abandoned Ward');
});

test('query_nearest_places tool requires an origin', () => {
    const result = executeFoxholeMapPlaceAssistantTool(
        'query_nearest_places',
        { query: 'town' },
        { mapPlaces: { entries: FIXTURE_ENTRIES } },
    );
    assert.equal(result.ok, false);
});

test('query_nearest_places for salvage field ignores Sop Fields district', () => {
    const bootnap = FIXTURE_ENTRIES.find(entry => entry.label === 'Bootnap');
    assert.ok(bootnap);
    const result = executeFoxholeMapPlaceAssistantTool(
        'query_nearest_places',
        {
            originPlaceId: bootnap!.id,
            query: 'salvage field',
            limit: 3,
        },
        { mapPlaces: { entries: FIXTURE_ENTRIES } },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as {
        places: Array<{ label: string; type: string; }>;
        error?: string;
    };
    assert.ok(!payload.error);
    assert.ok(payload.places.length > 0);
    assert.equal(payload.places[0]?.label, 'Salvage Field');
    assert.equal(payload.places[0]?.type, 'resource_field');
    assert.ok(!payload.places.some(place => place.label === 'Sop Fields'));
});

test('query_nearest_places reports missing resource icon data', () => {
    const bootnap = FIXTURE_ENTRIES.find(entry => entry.label === 'Bootnap');
    assert.ok(bootnap);
    const withoutFields = FIXTURE_ENTRIES.filter(entry => (
        entry.type !== 'resource_field' && entry.type !== 'resource_mine'
    ));
    const result = executeFoxholeMapPlaceAssistantTool(
        'query_nearest_places',
        {
            originPlaceId: bootnap!.id,
            query: 'salvage field',
        },
        { mapPlaces: { entries: withoutFields } },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { error?: string; places: unknown[]; };
    assert.equal(payload.error, 'no_resource_field_data');
    assert.equal(payload.places.length, 0);
});

test('map place context keeps viewport through nixie.scene normalize', () => {
    const mapped = createFoxholeMapPlaceAssistantToolContext({
        mapPlaces: { entries: FIXTURE_ENTRIES },
        sceneViewport: { centerX: 1800, centerY: 900 },
    });
    const afterScene = normalizeNixieSceneAssistantContext(mapped);
    assert.ok(afterScene.sceneViewport);
    assert.equal(afterScene.sceneViewport?.centerX, 1800);
    assert.equal(afterScene.sceneViewport?.centerY, 900);

    const result = executeFoxholeMapPlaceAssistantTool(
        'describe_map_location',
        {},
        afterScene,
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
        return;
    }
    const payload = result.result as { found?: boolean; error?: string; };
    assert.equal(payload.found, true);
    assert.ok(!payload.error);
});
