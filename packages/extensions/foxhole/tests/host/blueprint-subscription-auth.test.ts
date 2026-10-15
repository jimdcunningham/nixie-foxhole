import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent } from 'h3';

const alice = '00000000-0000-0000-0000-000000000011';
const bob = '00000000-0000-0000-0000-000000000012';
function fixture() {
    return {
        config: { public: { legacyBlueprintDiscoveryEnabled: true, legacyBlueprintLibraryEnabled: true, nativeDiscoveryEnabled: true, nativeDiscoverySubscriptionsEnabled: true, supabase: { url: 'https://fixture.invalid', key: 'public-fixture' } } },
        actor: { id: alice, is_anonymous: false } as { id: string; is_anonymous: boolean; } | null,
        user: { id: alice, is_anonymous: false } as { id: string; is_anonymous: boolean; } | null,
        authError: null as Error | null,
        clientCalls: 0,
    };
}
let state = fixture();
Object.defineProperty(globalThis, '__blueprintAuthFixture', { configurable: true, get: () => state });
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/server/utils/')) {
        let code = '';
        if (specifier === '#imports') {
            code = 'export const useRuntimeConfig = () => globalThis.__blueprintAuthFixture.config;';
        }
        if (specifier === '#supabase/server') {
            code = `
            export const serverSupabaseServiceRole = () => { throw new Error('No service-role subscription access'); };
            export const serverSupabaseClient = async () => {
                globalThis.__blueprintAuthFixture.clientCalls++;
                return { auth: { getUser: async () => ({ data: { user: globalThis.__blueprintAuthFixture.user }, error: globalThis.__blueprintAuthFixture.authError }) } };
            };`;
        }
        if (specifier === './nixie-auth.ts' && context.parentURL.endsWith('/nixie-subscription-auth.ts')) {
            code = 'export const readNixieBearerToken = () => ""; export const resolveNixieSupabaseUser = async () => globalThis.__blueprintAuthFixture.actor;';
        }
        if (code) {
            return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
        }
    }
    return nextResolve(specifier, context);
} });
const { registerNixieInternalBlueprintServices } = await import('../../../../nixie/server/utils/internal-blueprint-services.ts');
const legacy = await import('../../server/utils/legacy-blueprints.ts');
const { foxholeBlueprintSubscriptionStore } = await import('../../server/utils/blueprint-subscription-store.ts');
registerNixieInternalBlueprintServices({ requireFeature: legacy.requireFoxholeLegacyBlueprintFeature, get: legacy.getFoxholeLegacyBlueprint, search: legacy.searchFoxholeLegacyBlueprints, subscriptions: foxholeBlueprintSubscriptionStore, uploads: async () => { throw new Error('No upload access expected'); } });
const { requireBlueprintSubscriptions } = await import('../../../../nixie/server/utils/blueprint-subscriptions.ts');
const { requireNativeDiscoverySubscriptions } = await import('../../../../nixie/server/utils/native-discovery-subscriptions.ts');
hooks.deregister();
function event() {
    const request = new IncomingMessage(new Socket());
    return createEvent(request, new ServerResponse(request));
}

test('subscription feature gates fail before opening a user client', async () => {
    state = fixture();
    state.config.public.legacyBlueprintLibraryEnabled = false;
    const disabled = event();
    await assert.rejects(requireBlueprintSubscriptions(disabled), { statusCode: 404 });
    assert.equal(disabled.node.res.getHeader('Cache-Control'), 'private, no-store');
    state.config.public.legacyBlueprintLibraryEnabled = true;
    state.config.public.legacyBlueprintDiscoveryEnabled = false;
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 404 });
    assert.equal(state.clientCalls, 0);
});
test('anonymous, missing and mismatched accounts never receive a subscription store', async () => {
    state = fixture();
    state.actor = null;
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
    state.actor = { id: alice, is_anonymous: true };
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
    assert.equal(state.clientCalls, 0);
    state.actor.is_anonymous = false;
    state.user = { id: bob, is_anonymous: false };
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
    state.user = null;
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
    state.user = { id: alice, is_anonymous: true };
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
});
test('a validated same-account client is required, including Auth failures', async () => {
    state = fixture();
    state.authError = new Error('Auth unavailable');
    await assert.rejects(requireBlueprintSubscriptions(event()), { statusCode: 401 });
    state.authError = null;
    const store = await requireBlueprintSubscriptions(event());
    assert.equal(typeof store.subscribe, 'function');
    assert.equal(typeof store.unsubscribe, 'function');
    assert.equal(state.clientCalls, 2);
});

test('native and legacy subscriptions use the configured account without a mapping setting', async () => {
    state = fixture();
    state.config.public.nativeDiscoveryEnabled = false;
    await assert.rejects(requireNativeDiscoverySubscriptions(event()), { statusCode: 404 });
    state.config.public.nativeDiscoveryEnabled = true;
    state.config.public.nativeDiscoverySubscriptionsEnabled = false;
    await assert.rejects(requireNativeDiscoverySubscriptions(event()), { statusCode: 404 });
    assert.equal(state.clientCalls, 0);
    state.config.public.nativeDiscoverySubscriptionsEnabled = true;
    const { store } = await requireNativeDiscoverySubscriptions(event());
    assert.equal(typeof store.subscribe, 'function');
    assert.equal(state.clientCalls, 1);
    const legacyStore = await requireBlueprintSubscriptions(event());
    assert.equal(typeof legacyStore.subscribe, 'function');
    assert.equal(state.clientCalls, 2);
});
