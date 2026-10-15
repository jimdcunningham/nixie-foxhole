import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';
import { buildFoxholeStructureCatalog, buildFoxholeItemCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import {
    LEGACY_SETTINGS_MAX_BYTES,
    buildLegacySettingsPatch,
    buildLegacySettingsUndo,
    createLegacySettingsAssetIndex,
    parseLegacySettings,
} from '../../app/utils/nixie-legacy-settings.ts';
import type { AssetContribution } from '../../../../nixie/app/plugins/nixie/registry/types.ts';
import type { NixieUserSettings } from '../../../../nixie/app/stores/settings.ts';

// Use the published catalog identifiers and authored first-keyword contract of
// structures.contrib.ts, with no editor/Pixi or live account initialization.
const manifest = getFoxholeManifest('/foxhole/assets/');
const structures = buildFoxholeStructureCatalog(manifest);
const items = buildFoxholeItemCatalog(manifest);
const contribution: AssetContribution = {
    id: 'foxhole.structures', name: 'Foxhole',
    assets: [
        ...structures.assets.map(asset => ({
            id: asset.foxholeKey, name: asset.name, keywords: [asset.buildingKey],
            metadata: { foxholeKey: asset.foxholeKey }, createSnapshot: () => {
                throw new Error('Never place during import');
            },
        })),
        ...items.assets.map(asset => ({
            id: `item:${asset.resourceKey}`, name: asset.name, keywords: [asset.resourceKey],
            metadata: { foxholeKey: asset.resourceKey, isItem: true }, createSnapshot: () => {
                throw new Error('Never place during import');
            },
        })),
    ],
};
const assets = createLegacySettingsAssetIndex([contribution]);
const fixture = (name: string): string => readFileSync(hostSourceUrl(`./fixtures/legacy-settings/${name}.json`, import.meta.url), 'utf8');

function current(): NixieUserSettings {
    return {
        values: { 'nixie.viewport.snapToGrid': false, 'nixie.viewport.snapRotation': true, 'nixie.security.untouched': true },
        keybindings: { 'nixie.project.undo': { primary: { key: 'z', ctrl: true } } },
        toolOptions: { 'nixie.text': { size: 99 } }, toolPresets: {}, toolDefaultPresetLabels: {},
        paletteRows: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null)),
        selectedPaletteRow: 0, paletteDock: 'bottom', paletteBuildMode: 'create', shellLayout: { leftSidebarViewId: 'custom' },
    };
}

function merge(base: NixieUserSettings, patch: ReturnType<typeof buildLegacySettingsPatch>): NixieUserSettings {
    return { ...base, ...patch, values: { ...base.values, ...patch.values } };
}

test('maps the real export wrapper to explicit user preferences and published asset identifiers', () => {
    const report = parseLegacySettings(fixture('export-v2'), assets);
    assert.equal(report.version, 2);
    assert.equal(report.changes.length, 25);
    assert.equal(report.slots.length, 4);
    const patch = buildLegacySettingsPatch(current(), report);
    assert.equal(patch.values?.['nixie.assets.hideCategories'], true);
    assert.equal(patch.values?.['foxhole.assets.filter.showPreviousTiers'], true);
    assert.equal(patch.values?.['foxhole.assets.filter.tier'], '2');
    assert.equal(patch.values?.['nixie.assets.iconScale'], '3');
    assert.equal(patch.values?.['nixie.viewport.rotationSnapDegrees'], 15);
    assert.equal(patch.values?.['nixie.viewport.keyboardRotationDegrees'], 45);
    assert.equal(patch.paletteBuildMode, 'exchange-all');
    assert.equal(patch.selectedPaletteRow, 2);
    assert.deepEqual(report.slots.map(item => [item.row, item.slot, item.binding.kind === 'asset' && item.binding.assetId]), [
        [0, 0, 'fortt1'], [0, 1, 'crane'], [0, 2, 'item:metal'], [2, 9, 'greatmarchroad'],
    ]);
    assert.equal(report.slots.every(item => item.binding.kind === 'asset' && item.binding.sourceId === 'foxhole.structures'), true);
    assert.equal(report.skipped.length, 12);
    for (const path of ['toolbelts.0.3', 'toolbelts.0.4', 'toolbelts.0.5', 'toolbelts.0.6', 'toolbelts.0.7', 'toolbeltFilters', 'bindings']) {
        assert.ok(report.skipped.some(item => item.source === path));
    }
});

test('accepts raw browser-local settings, legacy arrays and unversioned partial settings', () => {
    const report = parseLegacySettings(fixture('raw-v1'), assets);
    assert.equal(report.version, 1);
    assert.deepEqual(report.slots.map(item => [item.row, item.slot]), [[0, 0], [0, 2], [0, 9]]);
    assert.equal(report.changes.find(item => item.source === 'selectedFaction')?.value, 'all');
    assert.equal(parseLegacySettings('{"enableGrid":false}', assets).changes.length, 1);
    assert.equal(parseLegacySettings('{"version":"2","toolbelts":{}}', assets).version, 2);
});

test('imports independent degree increments, skips invalid angles and preserves later edits on undo', () => {
    const before = current();
    before.values['nixie.viewport.rotationSnapDegrees'] = 15;
    before.values['nixie.viewport.keyboardRotationDegrees'] = 45;
    const report = parseLegacySettings(JSON.stringify({ settings: { version: 2, snapRotationDegrees: 7.5, keySnapRotationDegrees: 30 } }), assets);
    assert.deepEqual(report.changes.map(change => [change.source, change.value]), [['snapRotationDegrees', 7.5], ['keySnapRotationDegrees', 30]]);
    assert.equal(report.skipped.length, 0);
    assert.deepEqual(buildLegacySettingsPatch(before, report, false, true).values, undefined);
    const patch = buildLegacySettingsPatch(before, report);
    const applied = merge(before, patch);
    assert.equal(applied.values['nixie.viewport.rotationSnapDegrees'], 7.5);
    assert.equal(applied.values['nixie.viewport.keyboardRotationDegrees'], 30);
    assert.deepEqual(merge(applied, buildLegacySettingsPatch(applied, report)), applied);
    applied.values['nixie.viewport.keyboardRotationDegrees'] = 60;
    const undone = merge(applied, buildLegacySettingsUndo(applied, before, patch));
    assert.equal(undone.values['nixie.viewport.rotationSnapDegrees'], 15);
    assert.equal(undone.values['nixie.viewport.keyboardRotationDegrees'], 60);
    for (const value of [null, '30', 0, -1, 361, true, {}, []]) {
        const invalid = parseLegacySettings(JSON.stringify({ snapRotationDegrees: value, keySnapRotationDegrees: value }), assets);
        assert.equal(invalid.changes.length, 0);
        assert.deepEqual(invalid.skipped.map(item => item.source), ['snapRotationDegrees', 'keySnapRotationDegrees']);
        assert.ok(invalid.skipped.every(item => item.reason.includes('1 to 360 degrees')));
    }
    const infinite = parseLegacySettings('{"snapRotationDegrees":1e400}', assets);
    assert.equal(infinite.changes.length, 0);
    assert.equal(infinite.skipped.length, 1);
    const partial = parseLegacySettings('{"snapRotationDegrees":360,"keySnapRotationDegrees":0}', assets);
    assert.equal(partial.changes.length, 1);
    assert.equal(partial.skipped.length, 1);
});

test('merges mapped slots in place while preserving empty, skipped, unrelated and unselected preferences', () => {
    const before = current();
    before.paletteRows[0]![3] = { kind: 'tool', toolId: 'existing-blueprint-slot' };
    before.paletteRows[0]![8] = { kind: 'tool', toolId: 'unmentioned-slot' };
    before.paletteRows[9]![9] = { kind: 'tool', toolId: 'unrelated-row' };
    const report = parseLegacySettings(fixture('export-v2'), assets);
    const result = merge(before, buildLegacySettingsPatch(before, report));
    assert.deepEqual(result.paletteRows[0]![3], before.paletteRows[0]![3]);
    assert.deepEqual(result.paletteRows[0]![8], before.paletteRows[0]![8]);
    assert.deepEqual(result.paletteRows[9], before.paletteRows[9]);
    assert.equal(result.values['nixie.security.untouched'], true);
    for (const key of ['keybindings', 'toolOptions', 'shellLayout'] as const) {
        assert.deepEqual(result[key], before[key]);
    }
    const preferences = buildLegacySettingsPatch(before, report, true, false);
    assert.equal(preferences.paletteRows, undefined);
    assert.equal(preferences.values?.['nixie.palette.show'], undefined);
    const toolbelts = buildLegacySettingsPatch(before, report, false, true);
    assert.deepEqual(toolbelts.values, { 'nixie.palette.show': true });
    assert.deepEqual(buildLegacySettingsPatch(before, report, false, false), {});
    assert.deepEqual(before.paletteRows[0]![0], null);
});

test('invalid field types and unknown identifiers are reported without coercion or fallback guesses', () => {
    const report = parseLegacySettings(JSON.stringify({
        enableGrid: 'false', selectedTier: '2', selectedFaction: 'neutral', selectedToolbelt: 10, toolbeltMode: 99,
        buildingListFilters: { facilities: 1, futureCategory: true, bunkers: false },
        toolbelts: { 10: {}, 0: { 10: {}, 0: { type: 'building', subtype: 'Fort T1' }, 1: { type: 'icon', subtype: 'fortt1' } } },
    }), assets);
    assert.equal(report.changes.length, 1);
    assert.equal(report.slots.length, 0);
    assert.equal(report.skipped.length, 11);
    const ambiguous = parseLegacySettings('{"toolbelts":{"0":{"0":{"type":"building","subtype":"fortt1"}}}}', [...assets, assets.find(item => item.legacyKey === 'fortt1')!]);
    assert.equal(ambiguous.slots.length, 0);
    assert.match(ambiguous.skipped[0]!.reason, /ambiguous/);
});

test('rejects malformed, future, oversized, excessive-depth and unsafe-property input', () => {
    for (const text of ['{', 'null', '[]', '42', '{"settings":[]}', '{"version":3,"enableGrid":true}', '{"version":1,"settings":{"values":{"foo":true}}}', '{"project":{"name":"Plan"}}']) {
        assert.throws(() => parseLegacySettings(text, assets));
    }
    assert.throws(() => parseLegacySettings(' '.repeat(LEGACY_SETTINGS_MAX_BYTES + 1), assets), /5 MB/);
    assert.throws(() => parseLegacySettings(JSON.stringify({ enableGrid: true, junk: '💫'.repeat(LEGACY_SETTINGS_MAX_BYTES / 3) }), assets), /5 MB/);
    let deep: unknown = true;
    for (let i = 0; i < 13; i++) {
        deep = { inner: deep };
    }
    assert.throws(() => parseLegacySettings(JSON.stringify({ enableGrid: true, deep }), assets), /complex/);
    assert.throws(() => parseLegacySettings(JSON.stringify({ enableGrid: true, junk: Array(20001).fill(null) }), assets), /complex/);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        assert.throws(() => parseLegacySettings(`{"enableGrid":true,"${key}":{}}`, assets), /invalid property/);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('ignores Nixie/account/security payloads and input icon URLs entirely', () => {
    const text = JSON.stringify({ enableGrid: true, values: { 'nixie.security.untouched': false }, account: { email: 'attacker' }, toolbelts: { 0: { 0: { type: 'building', subtype: 'fortt1', icon: 'javascript:alert(1)' } } } });
    const report = parseLegacySettings(text, assets);
    const patch = buildLegacySettingsPatch(current(), report);
    assert.deepEqual(patch.values, { 'nixie.viewport.snapToGrid': true });
    assert.equal(report.skipped.length, 2);
    assert.doesNotMatch(JSON.stringify(patch), /javascript|attacker/);
});

test('repeated imports are idempotent and undo preserves subsequent edits', () => {
    const before = current();
    before.values['foxhole.assets.filter.faction'] = 'w';
    const report = parseLegacySettings(fixture('raw-v1'), assets);
    const applied = buildLegacySettingsPatch(before, report);
    const after = merge(before, applied);
    assert.deepEqual(merge(after, buildLegacySettingsPatch(after, report)), after);
    assert.deepEqual(merge(after, buildLegacySettingsUndo(after, before, applied)), before);
    const edited = structuredClone(after);
    edited.values['nixie.viewport.snapToGrid'] = true;
    edited.paletteRows[0]![0] = { kind: 'tool', toolId: 'subsequent-edit' };
    edited.paletteRows[4]![4] = { kind: 'tool', toolId: 'unrelated-edit' };
    const undone = merge(edited, buildLegacySettingsUndo(edited, before, applied));
    assert.equal(undone.values['nixie.viewport.snapToGrid'], true);
    assert.deepEqual(undone.paletteRows[0]![0], edited.paletteRows[0]![0]);
    assert.deepEqual(undone.paletteRows[4]![4], edited.paletteRows[4]![4]);
    assert.equal(undone.paletteRows[0]![2], null);
});

test('asset index excludes destroyed/generated variants and ignores alternate search keywords', () => {
    const original = contribution.assets.find(item => item.id === 'fortt1')!;
    const index = createLegacySettingsAssetIndex([{ ...contribution, assets: [
        { ...original, keywords: ['fortt1', 'friendly-name'] },
        { ...original, id: 'fortt1:destroyed' },
        { ...original, id: 'fortt1:upgrade:abc' },
    ] }]);
    assert.deepEqual(index.map(item => item.legacyKey), ['fortt1']);
    assert.equal(createLegacySettingsAssetIndex([]).length, 0);
});
