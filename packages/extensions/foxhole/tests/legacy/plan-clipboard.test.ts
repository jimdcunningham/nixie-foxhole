import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isLegacyPlanClipboardText,
    LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX,
    parseLegacyPlanClipboardText,
    serializeLegacyPlanClipboardText,
} from '../../app/plugins/foxhole/legacy/plan-clipboard.ts';
import { importLegacyPlanClipboardText } from '../../app/plugins/foxhole/legacy/plan-clipboard-import.ts';
import { resolveLegacyPlanOrientationOffsetDeg } from '../../app/plugins/foxhole/legacy/plan-orientation-map.ts';
import type { FoxholeStructureState } from '../../app/plugins/foxhole/nixie/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = join(__dirname, '../fixtures/legacy-plans/sample-project.json');
const RAD_TO_DEG = 180 / Math.PI;

test('parseLegacyPlanClipboardText reads plain payloads', () => {
    const save = {
        version: '1.0.5',
        entities: [
            { id: 1, key: 'fortt1', x: 0, y: 0, rotation: 90 },
        ],
    };
    const text = serializeLegacyPlanClipboardText(save);
    assert.equal(isLegacyPlanClipboardText(text), true);
    assert.ok(text.startsWith(LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX));

    const parsed = parseLegacyPlanClipboardText(text);
    assert.equal(parsed.version, '1.0.5');
    assert.equal(parsed.entities?.[0]?.key, 'fortt1');
    assert.equal(parsed.entities?.[0]?.rotation, 90);
});

test('parseLegacyPlanClipboardText round-trips base64 LZMA payloads', () => {
    const save = {
        version: '1.0.5',
        entities: [
            { id: 7, key: 'diesel_power_plant', x: 10, y: 20, rotation: 0 },
        ],
    };
    const compressed = serializeLegacyPlanClipboardText(save, { compressed: true });
    assert.equal(isLegacyPlanClipboardText(compressed), true);
    assert.ok(compressed.startsWith('data:plan;base64,'));

    const parsed = parseLegacyPlanClipboardText(compressed);
    assert.equal(parsed.entities?.[0]?.key, 'diesel_power_plant');
    assert.equal(parsed.entities?.[0]?.x, 10);
});

test('importLegacyPlanClipboardText converts sample clipboard to foxhole assets', async () => {
    const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
    const clipboard = serializeLegacyPlanClipboardText({
        version: sample.version,
        entities: sample.entities.filter((entity: { key?: string; }) => Boolean(entity.key)),
    });

    const items = await importLegacyPlanClipboardText(clipboard);
    assert.ok(items);
    assert.ok(items.length >= 1);

    const fort = items.find(item => (item.snapshot.state as FoxholeStructureState).foxholeKey === 'fortt1');
    assert.ok(fort);
    const state = fort.snapshot.state as FoxholeStructureState;
    const expectedDeg = 90 + resolveLegacyPlanOrientationOffsetDeg('fortt1');
    const actualDeg = Number(state.rotation) * RAD_TO_DEG;
    assert.ok(Math.abs(actualDeg - expectedDeg) < 1e-6, `expected ${expectedDeg}deg, got ${actualDeg}`);
});

test('legacy clipboard import applies image-origin corrections before paste', async () => {
    const clipboard = serializeLegacyPlanClipboardText({
        version: '1.0.5',
        entities: [
            { id: 1, key: 'aircraftbomberc', x: 100, y: 200, rotation: 0 },
            { id: 2, key: 'fortt1', x: 100, y: 200, rotation: 0 },
            { id: 3, key: 'oil_refinery_reformer', x: 100, y: 200, rotation: 0 },
            { id: 4, key: 'coal_refinery_coke_furnace', x: 100, y: 200, rotation: 0 },
        ],
    });

    const items = await importLegacyPlanClipboardText(clipboard);
    assert.ok(items);
    const bomber = items.find(item => (item.snapshot.state as FoxholeStructureState).foxholeKey === 'aircraftbomberc');
    const fort = items.find(item => (item.snapshot.state as FoxholeStructureState).foxholeKey === 'fortt1');
    const refinery = items.find(item => item.snapshot.id === 'legacy-3');
    const coalRefinery = items.find(item => item.snapshot.id === 'legacy-4');
    assert.ok(bomber);
    assert.ok(fort);
    assert.ok(refinery);
    assert.ok(coalRefinery);
    assert.equal((bomber.snapshot.state as FoxholeStructureState).x, 232);
    assert.equal((bomber.snapshot.state as FoxholeStructureState).y, 196);
    assert.equal((fort.snapshot.state as FoxholeStructureState).x, 100);
    assert.equal((fort.snapshot.state as FoxholeStructureState).y, 200);
    assert.equal((refinery.snapshot.state as FoxholeStructureState).foxholeKey, 'facilityrefineryoil');
    assert.equal((refinery.snapshot.state as FoxholeStructureState).x, 111);
    assert.equal((refinery.snapshot.state as FoxholeStructureState).y, 185);
    assert.equal((coalRefinery.snapshot.state as FoxholeStructureState).foxholeKey, 'facilityrefinerycoal');
    assert.equal((coalRefinery.snapshot.state as FoxholeStructureState).x, 97);
    assert.equal((coalRefinery.snapshot.state as FoxholeStructureState).y, 199);
});

test('clipboard snapshot generator emits a valid legacy payload', () => {
    const scriptPath = join(__dirname, '../../tools/legacy-plans/generate-clipboard-snapshots.mjs');
    const outName = 'orientation-smoke';
    const result = spawnSync(process.execPath, [
        scriptPath,
        '--only',
        'facilitypowerdiesel,facilitycrane',
        '--out',
        outName,
    ], {
        encoding: 'utf8',
        cwd: join(__dirname, '../..'),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const txtPath = join(__dirname, '../../tools/legacy-plans/clipboard-snapshots', `${outName}.txt`);
    const text = readFileSync(txtPath, 'utf8');
    assert.equal(isLegacyPlanClipboardText(text), true);

    const parsed = parseLegacyPlanClipboardText(text);
    const keys = new Set(
        (parsed.entities ?? [])
            .map(entity => entity.key)
            .filter((key): key is string => typeof key === 'string'),
    );
    // facilitycrane is orientation-QA confirmed, so uncertain mode may omit it.
    assert.ok(keys.has('diesel_power_plant'));

    const diesel = (parsed.entities ?? []).filter(entity => entity.key === 'diesel_power_plant');
    assert.equal(diesel.length, 1);
    assert.equal(diesel[0]?.rotation, 0);
});
