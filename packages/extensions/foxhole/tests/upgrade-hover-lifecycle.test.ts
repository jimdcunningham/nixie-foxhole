import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the inspector handlers, including async completion, without a DOM host.
const file = readFileSync(new URL('../app/components/nixie/foxhole/FoxholeStructureUpgradesInspectorCard.vue', import.meta.url), 'utf8');
const script = file.slice(file.indexOf('>') + 1, file.indexOf('</script>'));
const source = ts.createSourceFile('inspector.ts', script, ts.ScriptTarget.Latest, true);
const names = ['selectTierAsset', 'showRelationshipHoverCard', 'showUpgradeHoverCard'];
const declarations = names.map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(source));
const code = ts.transpile(`const { canEdit, foxholeKey, activeExperimentalModificationGroupKey, pendingSelectionKey,
    props, asset, getTierSelectionKey, setActiveNixieStructureModificationHoverPreview,
    isSelectedRelationshipTarget, showHoverEntry, createTierHoverEntry, showTierAssetHoverCard,
    isSelectedUpgradeVariant, createUpgradeHoverEntry } = context;
    ${declarations.join('\n')}
    return { ${names.join(',')} };`, { target: ts.ScriptTarget.ES2022 });

function harness() {
    const previews: unknown[] = [];
    const context = {
        canEdit: { value: true }, foxholeKey: { value: 'fortt3' }, asset: { value: {} },
        activeExperimentalModificationGroupKey: { value: null }, pendingSelectionKey: { value: null },
        props: { node: { id: 'bunker' }, patchNode: async (_patch: unknown, _reason: string) => {} },
        getTierSelectionKey: (asset: { foxholeKey: string }) => asset.foxholeKey,
        setActiveNixieStructureModificationHoverPreview: (preview: unknown) => previews.push(preview),
        isSelectedRelationshipTarget: (_target: unknown) => true,
        showHoverEntry: (_entry: unknown) => {}, createTierHoverEntry: (asset: unknown) => asset,
        showTierAssetHoverCard: (asset: unknown) => previews.push(asset),
        isSelectedUpgradeVariant: (_slot: unknown, _variant: unknown) => true,
        createUpgradeHoverEntry: (_slot: unknown, variant: unknown) => variant,
    };
    return { context, previews, handlers: new Function('context', code)(context) };
}

test('selected conversion and facility tiles clear previews instead of previewing removal', () => {
    const { handlers, previews } = harness();
    handlers.showRelationshipHoverCard({ asset: { foxholeKey: 'atgunait3' } });
    handlers.showUpgradeHoverCard({ id: 'upgrade' }, { id: 'electric' });
    assert.deepEqual(previews, [null, null]);
});

test('conversion completion clears previews recreated by focus during the patch', async () => {
    const { context, handlers, previews } = harness();
    context.props.patchNode = async () => { previews.push({ targetAssetKey: 'fortt3' }); };
    await handlers.selectTierAsset({ foxholeKey: 'atgunait3' });
    assert.deepEqual(previews, [null, { targetAssetKey: 'fortt3' }, null]);
    assert.equal(context.pendingSelectionKey.value, null);
});

test('failed conversions also clear previews and release pending selection', async () => {
    const { context, handlers, previews } = harness();
    context.props.patchNode = async () => { throw new Error('test failure'); };
    await assert.rejects(handlers.selectTierAsset({ foxholeKey: 'atgunait3' }), /test failure/);
    assert.deepEqual(previews, [null, null]);
    assert.equal(context.pendingSelectionKey.value, null);
});
