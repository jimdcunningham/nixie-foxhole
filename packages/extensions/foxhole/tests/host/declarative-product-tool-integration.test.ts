import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { createExternalDeclarativeContribution } from '../../../../nixie/desktop-extensions/contribution-adapter.ts';
import type {
    NixieCommandContext,
    NixiePrimaryToolbarContext,
    NixieSettingContext,
} from '../../../../nixie/app/plugins/nixie/registry/types.ts';

test('Planner and neutral product tool commands use host activation and fail closed outside editable Scene V2', async () => {
    for (const name of ['foxhole-planner', 'scene-v2-diagram']) {
        const source = parseNixieExtensionManifestV1(JSON.parse(readFileSync(hostSourceUrl(`../../../../../extensions/${name}/nixie.extension.json`, import.meta.url), 'utf8')));
        const calls: string[] = [];
        let available = true;
        const contribution = createExternalDeclarativeContribution(source, ['ui.toolbar'], { canActivateProductTool: () => available });
        const tools = source.contributes.experimentalProductTools!;
        assert.equal(contribution.commands!.length, tools.length);
        const context = { activeSurface: 'scene-v2', capabilities: { canEdit: true }, getActiveToolId: () => 'selection',
            activateTool: async (id: string) => {
                calls.push(id);
                return true;
            } } as unknown as NixieCommandContext;
        for (const tool of tools) {
            const toolId = `extension:${source.id}:${tool.id}`;
            const command = contribution.commands!.find(entry => entry.id === `nixie.tool.activate.${toolId}`)!;
            assert.equal(command.type, 'tool');
            assert.deepEqual(command.defaultKeybinding, tool.defaultKeybinding);
            assert.deepEqual(command.availableWhen, { when: 'project', surfaces: ['scene-v2'], capabilities: { canEdit: true }, excludeGuestPreview: true });
            assert.equal(command.enabled!(context), true);
            await command.run(context);
            assert.equal(calls.at(-1), toolId);
            for (const invalid of [{ ...context, activeSurface: 'scene' }, { ...context, capabilities: { canEdit: false } },
                { ...context, isGuestPreview: true }, { ...context, getActiveToolId: () => toolId }]) {
                const before = calls.length;
                assert.equal(command.enabled!(invalid as NixieCommandContext), false);
                await command.run(invalid as NixieCommandContext);
                assert.equal(calls.length, before);
            }
            available = false;
            assert.equal(command.enabled!(context), false);
            const before = calls.length;
            await command.run(context);
            assert.equal(calls.length, before);
            available = true;
        }
        assert.deepEqual(createExternalDeclarativeContribution(source, []).commands, []);
    }
});
