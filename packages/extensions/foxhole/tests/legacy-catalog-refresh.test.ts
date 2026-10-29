import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function methodHost(file: string, className: string, methodNames: string[], bindings: Record<string, unknown>) {
    const source = ts.createSourceFile(file, readFileSync(new URL(`../app/plugins/nixie/board/types/${file}.ts`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ts.ClassDeclaration;
    const methods = declaration.members.filter(member => ts.isMethodDeclaration(member) && methodNames.includes(member.name.getText(source)))
        .map(member => member.getText(source).replaceAll('import.meta.dev', 'false')).join('\n');
    const code = ts.transpileModule(`class Host { ${methods} } return Host;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

test('mounted structures refresh artwork and overlays without changing the live pose', () => {
    const getRevision = () => 0;
    let refresh: (() => void) | undefined;
    const watch = (source: unknown, callback: () => void) => {
        if (source === getRevision) {
            refresh = callback;
        }
        return () => {};
    };
    const Host = methodHost('foxhole-structure', 'FoxholeStructureNode', ['bindDebugOverlaySettings'], {
        watch, getFoxholeManifestRevision: getRevision, subscribeToNixieSelectionState: () => () => {},
    });
    const node = new Host();
    node.boardId = 'structure';
    node.position = { x: 123, y: 456 };
    node.rotation = 0.8;
    const calls: string[] = [];
    for (const name of ['syncStructureRenderLayers', 'syncModificationOverlay', 'syncPackagedPalletOverlay', 'syncMarkedCargoOverlay', 'ensureTextureLoaded']) {
        node[name] = () => calls.push(name);
    }
    node.syncSpriteFromState = () => assert.fail('must not apply the saved transform');
    node.bindDebugOverlaySettings();
    node.markedCargoOverlayCacheKey = 'old';
    node.productionOutputOverlayCacheKey = 'old';
    assert.ok(refresh);
    refresh();
    assert.deepEqual(calls, ['syncStructureRenderLayers', 'syncModificationOverlay', 'syncPackagedPalletOverlay', 'syncMarkedCargoOverlay', 'ensureTextureLoaded']);
    assert.equal(node.markedCargoOverlayCacheKey, '');
    assert.equal(node.productionOutputOverlayCacheKey, '');
    assert.deepEqual(node.position, { x: 123, y: 456 });
    assert.equal(node.rotation, 0.8);
});

test('mounted splines refresh after generation changes without applying the saved transform', () => {
    let refresh: (() => void) | undefined;
    const Host = methodHost('foxhole-spline-connector', 'FoxholeSplineConnectorNode', ['onBoardMounted', 'syncFromState'], {
        getFoxholeManifestRevision: () => 0,
        watch: (_source: unknown, callback: () => void) => {
            refresh = callback;
            return () => {};
        },
        isTrenchConnector: () => false,
    });
    const node = new Host();
    node.boardState = { foxholeKey: 'pipe', x: 1, y: 2, start: {}, end: {} };
    node.position = { x: 123, y: 456 };
    node.rotation = 0.8;
    node.bindCanvasToolColorWatcher = node.bindDebugOverlaySettings = node.bindModificationHoverPreviewWatcher = () => {};
    node.resolveTransientPowerlinePreview = () => null;
    node.applyRenderedPowerlineTransform = () => assert.fail('must not apply the saved transform');
    const stop = new Error('reached the visual rebuild');
    node.getResolvedUpgradeHoverPreviewAlpha = () => {
        throw stop;
    };
    node.onBoardMounted();
    assert.ok(refresh);
    assert.throws(() => refresh(), error => error === stop);
    assert.deepEqual(node.position, { x: 123, y: 456 });
    assert.equal(node.rotation, 0.8);
});
