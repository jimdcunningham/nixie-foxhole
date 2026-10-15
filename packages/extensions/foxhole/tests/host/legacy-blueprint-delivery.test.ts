import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent } from 'h3';

const actorId = '00000000-0000-0000-0000-000000000011';
let actor: { id: string; is_anonymous: boolean; } | null = { id: actorId, is_anonymous: false };
const config = { public: { legacyBlueprintCopyEnabled: true, legacyBlueprintInsertEnabled: false }, legacyBlueprintImportUserIds: actorId };
Object.defineProperty(globalThis, '__blueprintDeliveryFixture', { configurable: true, get: () => ({ actor, config }) });
const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.includes('/server/utils/')) {
        let code = '';
        if (specifier === '#imports') {
            code = 'export const useRuntimeConfig = () => globalThis.__blueprintDeliveryFixture.config;';
        }
        if (specifier === '#supabase/server') {
            code = 'export const serverSupabaseServiceRole = () => { throw new Error("No storage access expected"); };';
        }
        if (specifier === '#nixie-internal/server/utils/nixie-auth.ts' && context.parentURL.endsWith('/legacy-blueprint-delivery.ts')) {
            code = 'export const resolveNixieSupabaseUser = async () => globalThis.__blueprintDeliveryFixture.actor;';
        }
        if (specifier === '#nixie-internal/server/utils/discovery-metrics.ts' && context.parentURL.endsWith('/legacy-blueprint-delivery.ts')) {
            code = 'export const issueDiscoveryReuseReceipt = async () => {};';
        }
        if (code) {
            return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
        }
    }
    return next(specifier, context);
} });
const { requireLegacyBlueprintImportActor } = await import('../../server/utils/legacy-blueprint-delivery.ts');
hook.deregister();
function event() {
    const request = new IncomingMessage(new Socket());
    return createEvent(request, new ServerResponse(request));
}

test('copy and insert have independent fail-closed feature gates', async () => {
    const request = event();
    await assert.rejects(requireLegacyBlueprintImportActor(request, 'Insert'), { statusCode: 404 });
    assert.equal(request.node.res.getHeader('Cache-Control'), 'private, no-store');
    assert.equal(await requireLegacyBlueprintImportActor(event(), 'Copy'), actorId);
});
test('guests can download public Blueprint copies while inserts still require an account', async () => {
    config.public.legacyBlueprintInsertEnabled = true;
    actor = null;
    assert.equal(await requireLegacyBlueprintImportActor(event(), 'Copy'), null);
    await assert.rejects(requireLegacyBlueprintImportActor(event(), 'Insert'), { statusCode: 401 });
    actor = { id: actorId, is_anonymous: true };
    assert.equal(await requireLegacyBlueprintImportActor(event(), 'Copy'), null);
    await assert.rejects(requireLegacyBlueprintImportActor(event(), 'Insert'), { statusCode: 401 });
    actor.is_anonymous = false;
});
test('authenticated Blueprint reuse works outside development without an account rollout gate', async () => {
    config.legacyBlueprintImportUserIds = '';
    assert.equal(await requireLegacyBlueprintImportActor(event(), 'Copy'), actorId);
    config.public.legacyBlueprintInsertEnabled = true;
    assert.equal(await requireLegacyBlueprintImportActor(event(), 'Insert'), actorId);
});
