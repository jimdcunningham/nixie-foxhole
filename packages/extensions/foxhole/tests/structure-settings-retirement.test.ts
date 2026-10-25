import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { computed, nextTick, reactive, shallowRef, watch } from 'vue';
import { readFoxholeMapSettings, FOXHOLE_MAP_SETTING_KEYS } from '../app/plugins/foxhole/nixie/map-settings.ts';

function parseClass(relative: string, name: string): { source: ts.SourceFile; declaration: ts.ClassDeclaration; } {
    const source = ts.createSourceFile('node.ts', readFileSync(new URL(relative, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name) as ts.ClassDeclaration;
    assert.ok(declaration);
    return { source, declaration };
}

for (const [file, className, expectedUpdates] of [
    ['foxhole-structure', 'FoxholeStructureNode', 3],
    ['foxhole-connector', 'FoxholeConnectorNode', 1],
    ['foxhole-spline-connector', 'FoxholeSplineConnectorNode', 1],
] as const) {
    test(`${file} skips retired settings and resumes when definitions return`, async () => {
        const { source, declaration } = parseClass(`../app/plugins/nixie/board/types/${file}.ts`, className);
        const method = declaration.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(source) === 'bindDebugOverlaySettings')!;
        const code = ts.transpileModule(`class Host { ${method.getText(source).replaceAll('import.meta.dev', 'false')} } return Host;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        const initial: Array<[string, string | number | boolean]> = [['debug', false], ['range', true], ['interval', 'hour'], ['custom', 60], ['nixie.debug.overlay', false], ['theme', 'dark']];
        const settings = reactive(new Map(initial));
        const bindings = {
            watch,
            FOXHOLE_STRUCTURE_DEBUG_OVERLAY_SETTING_IDS: ['debug'],
            FOXHOLE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS: ['debug'],
            FOXHOLE_SPLINE_CONNECTOR_DEBUG_OVERLAY_SETTING_IDS: ['debug'],
            FOXHOLE_STRUCTURE_RANGE_OVERLAY_SETTING_IDS: ['range'],
            FOXHOLE_NIGHT_RANGE_SETTING_IDS: [],
            FOXHOLE_STATS_SETTING_KEYS: { timeInterval: 'interval', customIntervalSeconds: 'custom' },
            NIXIE_COLOR_THEME_SETTING_ID: 'theme',
            resolveNxTheme: (value: unknown) => value,
            canvasHoverPopover: shallowRef(null),
            subscribeToNixieSelectionState: () => () => {},
        };
        const Host = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
        const node = new Host();
        let updates = 0;
        node.settingsStore = {
            getValue(id: string) {
                if (!settings.has(id)) {
                    throw new Error(`Unknown setting id: ${id}`);
                }
                return settings.get(id);
            },
            getValueOr(id: string, fallback: unknown) {
                return settings.has(id) ? settings.get(id) : fallback;
            },
        };
        node.getStructureRenderLayerVisibilitySignature = () => '';
        node.syncSpriteFromState = node.syncStructureRenderLayers = node.syncRangeOverlay = node.syncMarkedCargoOverlay = node.syncSocketOverlay = node.syncFromState = () => {
            updates++;
        };
        node.bindDebugOverlaySettings();
        try {
            for (const id of ['debug', 'range', 'interval', 'custom']) {
                settings.delete(id);
            }
            await nextTick();
            assert.equal(updates, 0, 'retirement must not render against missing definitions');
            for (const entry of initial) {
                settings.set(...entry);
            }
            await nextTick();
            assert.equal(updates, expectedUpdates, 'overlays resume with registered definitions');
        } finally {
            node.settingsWatcher?.();
            node.rangeSettingsWatcher?.();
            node.itemTileSettingsWatcher?.();
            node.selectionStateWatcher?.();
        }
    });
}

test('map controller tolerates retired user settings without changing saved project settings', () => {
    const { source, declaration } = parseClass('../app/plugins/foxhole/nixie/map/controller.ts', 'FoxholeMapViewportPlugin');
    const field = declaration.members.find(member => ts.isPropertyDeclaration(member) && member.name.getText(source) === 'mapSettings') as ts.PropertyDeclaration;
    const initializer = field.initializer!.getText(source).replaceAll('this.settingsStore', 'store').replaceAll('this.pluginContext.projectStore.settings', 'project');
    const create = new Function('computed', 'readFoxholeMapSettings', 'store', 'project', `return ${initializer};`);
    const definitions = reactive(new Map([[FOXHOLE_MAP_SETTING_KEYS.hourlyCasualties, false]]));
    const project = { [FOXHOLE_MAP_SETTING_KEYS.enabled]: true, [FOXHOLE_MAP_SETTING_KEYS.regionKeys]: 'DeadLandsHex' };
    const before = structuredClone(project);
    const store = {
        getValue(id: string) {
            if (!definitions.has(id)) {
                throw new Error(`Unknown setting id: ${id}`);
            }
            return definitions.get(id);
        },
        getValueOr(id: string, fallback: unknown) {
            return definitions.has(id) ? definitions.get(id) : fallback;
        },
    };
    const settings = create(computed, readFoxholeMapSettings, store, project);
    assert.equal(settings.value.hourlyCasualties, false);
    definitions.clear();
    assert.equal(settings.value.hourlyCasualties, true, 'unregistered user values use map defaults');
    assert.equal(settings.value.enabled, true);
    assert.deepEqual(project, before);
    definitions.set(FOXHOLE_MAP_SETTING_KEYS.hourlyCasualties, false);
    assert.equal(settings.value.hourlyCasualties, false, 'user preferences return when registered');
});
