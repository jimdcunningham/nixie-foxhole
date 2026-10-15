import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadFunction(path, name, dependencies) {
    const source = ts.createSourceFile('source.ts', readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    return new Function(...Object.keys(dependencies), `${ts.transpile(declaration.getText(source), { target: ts.ScriptTarget.ES2022 })}; return ${name};`)(...Object.values(dependencies));
}
const build = loadFunction('./runtime.ts', 'buildTownOwnershipEvents', {
    buildTownOwnershipIndex: summary => new Map(summary.ownership.map(town => [town.name, town])),
    normalizeTownOwnershipTeamId: team => team || 'NONE',
});
const town = (name, teamId) => ({ name, teamId, x: 0.5, y: 0.5 });
const shard = { id: 'live', warData: { warId: 'war-141', warNumber: 141 } };

test('War-start map hydration establishes ownership without generating captures', () => {
    const ownership = Array.from({ length: 20 }, (_, i) => town(`Town ${i}`, 'WARDENS'));
    assert.deepEqual(build(shard, 'HowlCountyHex', 'dynamic-map', 1790874304369, { ownership: [] }, { ownership }), []);
});
test('Newly discovered towns do not mask genuine changes to observed towns', () => {
    const events = build(shard, 'Map', 'dynamic-map', 100, { ownership: [town('Known', 'COLONIALS')] },
        { ownership: [town('Known', 'WARDENS'), town('New', 'WARDENS')] });
    assert.equal(events.length, 1);
    assert.equal(events[0].data.townName, 'Known');
});
test('Previously observed neutral towns still generate captures, and owned towns neutralize', () => {
    const events = build(shard, 'Map', 'dynamic-map', 100, { ownership: [town('Neutral', 'NONE'), town('Owned', 'WARDENS')] },
        { ownership: [town('Neutral', 'COLONIALS'), town('Owned', 'NONE')] });
    assert.deepEqual(events.map(event => event.eventType), ['town-captured', 'town-neutralized']);
});
test('Live poll bursts are limited without affecting manual previews or future notifications', () => {
    const calls = [];
    const toastedEventIds = new Set();
    const liveToastTimes = [];
    let now = 100;
    const toast = loadFunction('../../app/composables/useFoxholePlaybackEventService.ts', 'maybeToastPlaybackEvent', {
        bindings: { mapSettings: { value: { eventFeedToasts: true } } }, toastedEventIds, liveToastTimes,
        LIVE_TOAST_WINDOW_MS: 10000, LIVE_TOAST_WINDOW_LIMIT: 3, getSelectedShardId: () => 'live',
        previewFoxholePlaybackEventToast: event => calls.push(event.id), Date: { now: () => now },
    });
    for (let i = 0; i < 100; i++) toast({ id: `event-${i}`, shardId: 'live' });
    assert.equal(calls.length, 3);
    assert.equal(toastedEventIds.size, 100);
    now += 10000;
    toast({ id: 'later', shardId: 'live' });
    toast({ id: 'event-99', shardId: 'live' });
    assert.deepEqual(calls, ['event-0', 'event-1', 'event-2', 'later']);
});
