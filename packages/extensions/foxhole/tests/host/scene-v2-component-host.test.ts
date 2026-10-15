import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalSceneV2DocumentV1 } from '@nixie/extension-sdk';
import {
    NixieSceneV2ComponentHost,
    NixieSceneV2ComponentHostError,
} from '../../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { createNixieSceneV2ExtensionCatalogEntries } from '../../../../nixie/desktop-extensions/scene-v2-extension-catalog.ts';
import type { NixieDesktopExtensionDiagnostics } from '../../../../nixie/desktop-extensions/runtime.ts';

function productionContribution() {
    return {
        contractVersion: 1,
        components: [{
            id: 'production',
            displayName: 'Production',
            version: 1,
            schema: {
                type: 'object',
                properties: {
                    progress: { type: 'number', minimum: 0, maximum: 1 },
                    orders: {
                        type: 'array',
                        maxItems: 64,
                        items: {
                            type: 'object',
                            properties: { recipeId: { type: 'string', minLength: 1, maxLength: 128 } },
                            required: ['recipeId'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['progress', 'orders'],
                additionalProperties: false,
            },
        }],
    };
}

function statsContribution() {
    return {
        contractVersion: 1,
        components: [{
            id: 'stats',
            displayName: 'Stats',
            version: 1,
            schema: {
                type: 'object',
                properties: { hitPoints: { type: 'number', integer: true, minimum: 0 } },
                required: ['hitPoints'],
                additionalProperties: false,
            },
        }],
    };
}

test('parsed document matching compares the complete live graph without exporting a second snapshot', () => {
    const host = new NixieSceneV2ComponentHost();
    const source = {
        type: 'scene-v2' as const, contractVersion: 1 as const,
        entities: ['a', 'b'].map(entityId => ({ entityId, revision: 2, components: [
            { ownerId: 'unknown.extension', componentId: 'opaque', version: 4,
                data: { scalar: 0, nested: { first: [1, null, { enabled: false }], second: 'preserve' } } },
            { ownerId: 'other.extension', componentId: 'opaque', version: 7, data: { values: [2, 3] } },
        ] })),
    };
    host.replaceDocument(source);
    const before = host.exportDocument();
    const equivalent = structuredClone(source);
    equivalent.entities.reverse();
    equivalent.entities.forEach(entity => entity.components.reverse());
    equivalent.entities[0]!.components[1]!.data = {
        nested: { second: 'preserve', first: [1, null, { enabled: false }] }, scalar: -0,
    };
    let exports = 0;
    const originalExport = host.exportDocument.bind(host);
    host.exportDocument = () => {
        exports += 1;
        return originalExport();
    };
    assert.equal(host.matchesParsedDocument(parseNixieExperimentalSceneV2DocumentV1(equivalent)), true, 'entity, component and object-key order do not change the document');
    for (const change of [
        (value: typeof source) => {
            value.entities[0]!.revision += 1;
        },
        (value: typeof source) => {
            value.entities[0]!.components[0]!.data.nested!.second = 'changed';
        },
        (value: typeof source) => {
            value.entities[0]!.components[0]!.ownerId = 'other.owner';
        },
        (value: typeof source) => {
            value.entities[0]!.components[0]!.version += 1;
        },
        (value: typeof source) => {
            value.entities[0]!.components.pop();
        },
        (value: typeof source) => {
            value.entities.pop();
        },
        (value: typeof source) => {
            value.entities[0]!.components[1]!.data.values!.reverse();
        },
    ]) {
        const changed = structuredClone(source);
        change(changed);
        assert.equal(host.matchesParsedDocument(parseNixieExperimentalSceneV2DocumentV1(changed)), false);
    }
    assert.equal(exports, 0);
    assert.deepEqual(originalExport(), before);
});

test('stores only qualified component references and entity-local data', () => {
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.foxhole-planner', productionContribution());
    host.instantiateProduct('facility-1', {
        contractVersion: 1,
        id: 'facility.ammo-factory',
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'production',
            version: 1,
            data: { progress: 0, orders: [{ recipeId: 'recipe.120mm' }] },
        }],
    });
    const persisted = host.exportDocument();
    assert.deepEqual(persisted.entities[0]?.components[0], {
        ownerId: 'nixie.foxhole-planner',
        componentId: 'production',
        version: 1,
        data: { progress: 0, orders: [{ recipeId: 'recipe.120mm' }] },
    });
    assert.equal(JSON.stringify(persisted).includes('facility.ammo-factory'), false);
    assert.equal(JSON.stringify(persisted).includes('schema'), false);
});

test('preserves unresolved component data until its definition returns', () => {
    const host = new NixieSceneV2ComponentHost();
    host.replaceDocument({
        type: 'scene-v2', contractVersion: 1,
        entities: [{
            entityId: 'character-1', revision: 3,
            components: [{ ownerId: 'example.ttrpg', componentId: 'stats', version: 1, data: { hitPoints: 12 } }],
        }],
    });
    assert.equal(host.readEntity('character-1').components[0]?.definitionAvailable, false);
    assert.deepEqual(host.exportDocument().entities[0]?.components[0]?.data, { hitPoints: 12 });
    host.registerExtension('example.ttrpg', statsContribution());
    assert.equal(host.readEntity('character-1').components[0]?.definitionAvailable, true);
});

test('repeated dense snapshots and qualified queries do not revalidate unchanged stored components', () => {
    const host = new NixieSceneV2ComponentHost();
    const owners = ['example.production', 'example.other-production'];
    let schemaReads = 0;
    for (const owner of owners) {
        host.registerExtension(owner, productionContribution());
        // Count validation at its schema boundary without changing its result.
        const registrations = Reflect.get(host, 'extensions') as Map<string, { contribution: ReturnType<typeof productionContribution>; }>;
        const definition = registrations.get(owner)!.contribution.components[0]!;
        const schema = definition.schema;
        Object.defineProperty(definition, 'schema', { get: () => {
            schemaReads++;
            return schema;
        } });
    }
    host.replaceDocument({ type: 'scene-v2', contractVersion: 1, entities: Array.from({ length: 100 }, (_, index) => ({
        entityId: `facility-${String(index).padStart(3, '0')}`, revision: 2,
        components: [
            ...owners.map(ownerId => ({ ownerId, componentId: 'production', version: 1, data: { progress: 0, orders: [] } })),
            { ownerId: 'example.missing', componentId: 'production', version: 1, data: { opaque: [index] } },
        ],
    })) });
    const first = host.listEntities();
    assert.equal(schemaReads, 200);
    assert.deepEqual(host.listEntities(), first);
    assert.deepEqual(host.query(owners[0], { all: owners.map(ownerId => ({ ownerId, componentId: 'production' })) }),
        first.map(entity => ({ ...entity, components: entity.components.filter(component => owners.includes(component.ownerId)) })));
    assert.equal(schemaReads, 200, 'repeated reads retain schema validation results for unchanged owned data');
    first[0]!.components.find(component => component.ownerId === owners[0])!.data.progress = 99;
    assert.equal(host.readEntity('facility-000').components.find(component => component.ownerId === owners[0])!.data.progress, 0);
    assert.equal(schemaReads, 200, 'caller-owned snapshots cannot mutate stored data or invalidate its validation result');
    const before = host.exportDocument();
    const changed = host.applyEditorComponentPatches(first.map(entity => ({ entityId: entity.entityId,
        ownerId: owners[0]!, componentId: 'production', expectedRevision: 2,
        set: { progress: 0.5, orders: [{ recipeId: 'recipe.changed' }] },
    })));
    const after = host.exportDocument();
    assert.equal(schemaReads, 400, 'edits validate changed values without revalidating another owner\'s unchanged components');
    (changed[0]!.components.find(component => component.ownerId === owners[0])!.data.orders as { recipeId: string; }[])[0]!.recipeId = 'caller mutation';
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    host.redo();
    assert.deepEqual(host.exportDocument(), after, 'public transaction results cannot mutate retained history values');
    assert.equal(schemaReads, 400, 'history reuses the validated stored values without exposing them');
});

test('component availability follows edits, history, document replacement and registration changes', () => {
    const host = new NixieSceneV2ComponentHost();
    const ownerId = 'example.production';
    const document = { type: 'scene-v2', contractVersion: 1, entities: [{
        entityId: 'facility', revision: 7,
        components: [{ ownerId, componentId: 'production', version: 1, data: { progress: 0.5, orders: [] } }],
    }] };
    host.replaceDocument(document);
    const available = () => host.readEntity('facility').components[0]!.definitionAvailable;
    assert.equal(available(), false);
    const registered = productionContribution();
    host.registerExtension(ownerId, registered);
    assert.equal(available(), true);
    registered.components[0]!.schema.properties.progress.maximum = 0.1;
    assert.equal(available(), true, 'caller-owned registration input cannot mutate the host schema');
    const stricter = productionContribution();
    stricter.components[0]!.schema.properties.progress.maximum = 0.25;
    host.registerExtension(ownerId, stricter);
    assert.equal(available(), false, 'same-version schema replacement invalidates the previous result');
    host.registerExtension(ownerId, productionContribution());
    assert.equal(available(), true);
    host.unregisterExtension(ownerId);
    assert.equal(available(), false);
    host.registerExtension(ownerId, productionContribution());
    assert.equal(available(), true);
    host.applyEditorComponentPatch({ entityId: 'facility', ownerId, componentId: 'production', expectedRevision: 7, set: { progress: 0.75 } });
    assert.equal(available(), true);
    host.undo();
    assert.equal(host.readEntity('facility').components[0]!.data.progress, 0.5);
    assert.equal(available(), true);
    host.redo();
    assert.equal(host.readEntity('facility').components[0]!.data.progress, 0.75);
    assert.equal(available(), true);
    document.entities[0]!.components[0]!.data.progress = 2;
    host.replaceDocument(document);
    assert.equal(available(), false, 'same-ID/revision replacement with invalid data is checked anew');
    host.applyEditorComponentPatch({ entityId: 'facility', ownerId, componentId: 'production', expectedRevision: 7, set: { progress: 0.25 } });
    assert.equal(available(), true);
    host.undo();
    assert.equal(available(), false, 'Undo restores the unresolved invalid record rather than a stale valid result');
    host.redo();
    assert.equal(available(), true);
    document.entities[0]!.components[0]!.version = 2;
    document.entities[0]!.components[0]!.data.progress = 0.5;
    host.replaceDocument(document);
    assert.equal(available(), false);
    const nextVersion = productionContribution();
    nextVersion.components[0]!.version = 2;
    host.registerExtension(ownerId, nextVersion);
    assert.equal(available(), true);
});

for (const captureSnapshot of [false, true]) {
    test(`parsed document storage and staging forks${captureSnapshot ? ' with rollback snapshots' : ''} keep nested data, registrations and history isolated`, () => {
        const host = new NixieSceneV2ComponentHost();
        host.registerExtension('example.production', productionContribution());
        const input = { type: 'scene-v2', contractVersion: 1, entities: [{
            entityId: 'facility', revision: 7, components: [
                { ownerId: 'example.production', componentId: 'production', version: 1,
                    data: { progress: 0, orders: [{ recipeId: 'recipe.original' }] } },
                { ownerId: 'example.missing', componentId: 'opaque', version: 9,
                    data: { nested: { values: [{ label: 'Original' }] } } },
            ],
        }] };
        const returned = host.replaceDocument(input);
        const before = host.exportDocument();
        input.entities[0]!.components[0]!.data.orders![0]!.recipeId = 'recipe.input-mutation';
        (returned.entities[0]!.components.find(component => component.componentId === 'opaque')!.data.nested as { values: { label: string; }[]; }).values[0]!.label = 'Returned Mutation';
        assert.deepEqual(host.exportDocument(), before, 'neither the input nor returned replacement data aliases stored state');

        const capture = captureSnapshot ? host.forkWithSnapshot() : undefined;
        const fork = capture?.host ?? host.fork();
        assert.deepEqual(fork.exportDocument(), before);
        assert.deepEqual(fork.undo(), [], 'staging starts with independent empty history');
        const exported = fork.exportDocument();
        (exported.entities[0]!.components.find(component => component.componentId === 'opaque')!.data.nested as { values: { label: string; }[]; }).values[0]!.label = 'Export Mutation';
        const snapshot = fork.readEntity('facility');
        (snapshot.components.find(component => component.componentId === 'production')!.data.orders as { recipeId: string; }[])[0]!.recipeId = 'recipe.snapshot-mutation';
        assert.deepEqual(fork.exportDocument(), before);
        fork.applyEditorComponentPatch({ entityId: 'facility', ownerId: 'example.production', componentId: 'production',
            expectedRevision: 7, set: { orders: [{ recipeId: 'recipe.staged' }] } });
        const staged = fork.exportDocument();
        if (capture) {
            assert.deepEqual(capture.snapshot, before, 'staging does not edit its rollback snapshot');
            (capture.snapshot.entities[0]!.components.find(component => component.componentId === 'opaque')!.data.nested as { values: { label: string; }[]; }).values[0]!.label = 'Rollback Mutation';
            capture.snapshot.entities[0]!.components.pop();
            capture.snapshot.entities[0]!.revision = 999;
            assert.deepEqual(fork.exportDocument(), staged, 'mutable rollback data does not alias staging');
        }
        assert.deepEqual(host.exportDocument(), before, 'staging changes do not edit the live document');
        host.applyTransaction('example.production', { contractVersion: 1, transactionId: 'live-progress', operations: [
            { op: 'patch', entityId: 'facility', componentId: 'production', expectedRevision: 7, set: { progress: 0.5 } },
        ] });
        const live = host.exportDocument();
        assert.deepEqual(fork.exportDocument(), staged, 'later live changes do not edit an existing fork');
        fork.undo();
        assert.deepEqual(fork.exportDocument(), before);
        fork.redo();
        assert.deepEqual(fork.exportDocument(), staged);
        assert.deepEqual(host.exportDocument(), live, 'fork history cannot undo live edits');
        fork.unregisterExtension('example.production');
        assert.equal(fork.readEntity('facility').components.find(component => component.componentId === 'production')!.definitionAvailable, false);
        assert.equal(host.readEntity('facility').components.find(component => component.componentId === 'production')!.definitionAvailable, true);
        fork.replaceDocument({ type: 'scene-v2', contractVersion: 1, entities: [] });
        assert.deepEqual(fork.listEntities(), []);
        assert.deepEqual(host.exportDocument(), live);
    });
}

test('staging with rollback captures the graph once and retains complete-document budget validation', () => {
    const host = new NixieSceneV2ComponentHost();
    host.createEditorEntity({ entityId: 'a', components: [] });
    const originalExport = host.exportDocument.bind(host);
    let exports = 0;
    host.exportDocument = () => {
        exports++;
        return originalExport();
    };
    const captured = host.forkWithSnapshot();
    assert.equal(exports, 1);
    assert.deepEqual(captured.host.exportDocument(), captured.snapshot);
    // Each addition fits the document budget, but their combined graph does not.
    for (let batch = 0; batch < 2; batch++) {
        host.createEditorEntities(Array.from({ length: 70 }, (_, index) => ({
            entityId: `large-${batch}-${index}`,
            components: [{ ownerId: 'example.unresolved', componentId: 'payload', version: 1, definitionAvailable: false, data: { value: 'x'.repeat(32_768) } }],
        })));
    }
    assert.throws(() => host.forkWithSnapshot(), /4194304-byte limit/);
    assert.equal(host.listEntities().length, 141, 'a rejected capture does not alter source storage');
    host.undo();
    assert.equal(host.listEntities().length, 71, 'a rejected capture does not clear live history');
    assert.equal(captured.host.listEntities().length, 1);
});

test('enforces owner-local mutation and commits transactions atomically', () => {
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.foxhole-planner', productionContribution());
    host.registerExtension('example.ttrpg', statsContribution());
    host.applyTransaction('nixie.foxhole-planner', {
        contractVersion: 1, transactionId: 'add-production',
        operations: [{ op: 'add', entityId: 'shared-entity', componentId: 'production', data: { progress: 0.25, orders: [] } }],
    });
    host.applyTransaction('example.ttrpg', {
        contractVersion: 1, transactionId: 'add-stats',
        operations: [{ op: 'add', entityId: 'shared-entity', componentId: 'stats', expectedRevision: 1, data: { hitPoints: 10 } }],
    });
    assert.throws(() => host.applyTransaction('nixie.foxhole-planner', {
        contractVersion: 1, transactionId: 'cross-owner-write',
        operations: [{ op: 'patch', entityId: 'shared-entity', componentId: 'stats', set: { hitPoints: 0 } }],
    }), error => error instanceof NixieSceneV2ComponentHostError && error.code === 'component_not_declared');
    assert.throws(() => host.applyTransaction('nixie.foxhole-planner', {
        contractVersion: 1, transactionId: 'invalid-batch',
        operations: [
            { op: 'patch', entityId: 'shared-entity', componentId: 'production', expectedRevision: 2, set: { progress: 0.75 } },
            { op: 'add', entityId: 'second-entity', componentId: 'production', expectedRevision: 0, data: { progress: 2, orders: [] } },
        ],
    }), /must be at most 1/);
    assert.equal(host.readEntity('shared-entity').components.find(component => component.componentId === 'production')?.data.progress, 0.25);
    assert.equal(host.readEntity('second-entity').components.length, 0);
    host.undo();
    assert.deepEqual(host.readEntity('shared-entity').components.map(component => component.componentId), ['production']);
    host.redo();
    assert.deepEqual(host.readEntity('shared-entity').components.map(component => component.componentId), ['stats', 'production']);
});

test('permits qualified cross-extension queries without cross-owner writes', () => {
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.foxhole-planner', productionContribution());
    host.registerExtension('example.ttrpg', statsContribution());
    host.applyTransaction('nixie.foxhole-planner', {
        contractVersion: 1, transactionId: 'add-production',
        operations: [{ op: 'add', entityId: 'facility-1', componentId: 'production', data: { progress: 0.5, orders: [] } }],
    });
    const matches = host.query('example.ttrpg', {
        all: [{ ownerId: 'nixie.foxhole-planner', componentId: 'production' }],
    });
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0]?.components.map(component => `${component.ownerId}:${component.componentId}`), [
        'nixie.foxhole-planner:production',
    ]);
});

test('rejects invalid editor patches without changing data, revision, or history', () => {
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.foxhole-planner', productionContribution());
    host.instantiateProduct('facility-1', {
        contractVersion: 1,
        id: 'facility.ammo-factory',
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'production',
            version: 1,
            data: { progress: 0.25, orders: [] },
        }],
    });

    assert.throws(() => host.applyEditorComponentPatch({
        entityId: 'facility-1',
        ownerId: 'nixie.foxhole-planner',
        componentId: 'production',
        expectedRevision: 1,
        set: { progress: 2 },
    }), /must be at most 1/);
    assert.equal(host.readEntity('facility-1').revision, 1);
    assert.equal(
        host.readEntity('facility-1').components[0]?.data.progress,
        0.25,
    );

    host.undo();
    assert.equal(host.readEntity('facility-1').components.length, 0);
});

test('first editor attachment validates the full component and joins atomic undo history', () => {
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('example.ttrpg', statsContribution());
    host.registerExtension('nixie.foxhole-planner', productionContribution());
    host.applyTransaction('example.ttrpg', { contractVersion: 1, transactionId: 'seed', operations: [
        { op: 'add', entityId: 'one', componentId: 'stats', data: { hitPoints: 10 } },
    ] });
    const before = host.exportDocument();
    const attach = { entityId: 'one', ownerId: 'nixie.foxhole-planner', componentId: 'production',
        expectedRevision: 1, createIfMissing: true, set: { progress: 0.5, orders: [] } };
    assert.throws(() => host.applyEditorComponentPatches([
        { entityId: 'one', ownerId: 'example.ttrpg', componentId: 'stats', set: { hitPoints: 8 } },
        { ...attach, set: { progress: 2, orders: [] } },
    ]), /must be at most 1/);
    assert.deepEqual(host.exportDocument(), before);
    assert.throws(() => host.applyEditorComponentPatch({ ...attach, createIfMissing: false }), /does not have component/);
    assert.throws(() => host.applyEditorComponentPatch({ ...attach, set: { progress: 0.5 } }), /orders/);
    host.applyEditorComponentPatches([
        { entityId: 'one', ownerId: 'example.ttrpg', componentId: 'stats', expectedRevision: 1, set: { hitPoints: 8 } },
        attach,
    ]);
    assert.equal(host.readEntity('one').revision, 2);
    assert.equal(host.readEntity('one').components.length, 2);
    host.undo();
    assert.deepEqual(host.exportDocument(), before);
    host.redo();
    assert.equal(host.readEntity('one').components.find(component => component.componentId === 'production')?.data.progress, 0.5);
});

test('builds the catalog from the last active manifest after a failed reload', () => {
    const manifest = (version: string, componentId: string): NixieDesktopExtensionDiagnostics['manifest'] => ({
        schemaVersion: 1 as const,
        id: 'nixie.foxhole-planner',
        name: 'Foxhole Planner',
        version,
        engines: { nixie: '^0.4.0' },
        entry: 'dist/index.html',
        capabilities: [],
        contributes: {
            panels: [], settings: [], primaryToolbarItems: [], commands: [], menus: [], menuBars: [], settingsPageSections: [],
            experimentalComponents: {
                contractVersion: 1 as const,
                components: [{
                    id: componentId,
                    displayName: componentId,
                    version: 1,
                    schema: { type: 'object' as const, properties: {}, additionalProperties: false as const },
                }],
            },
        },
    });
    const activeManifest = manifest('0.1.0', 'production');
    const failedCandidate = manifest('0.2.0', 'broken-candidate');
    const entries = createNixieSceneV2ExtensionCatalogEntries([{
        sourcePath: 'C:/extensions/foxhole',
        dependencyLock: null,
        manifest: failedCandidate,
        activeManifest,
        state: 'error',
        enabledForActiveProject: true,
        runtimeAvailable: true,
        generationHash: 'last-good-generation',
        declaredCapabilities: [],
        approvedCapabilities: [],
        pendingCapabilities: [],
        activationDurationMs: null,
        reloadDurationMs: null,
        lastError: 'candidate activation failed',
        lastSuccessfulReload: '2026-09-04T00:00:00.000Z',
        console: [],
    } satisfies NixieDesktopExtensionDiagnostics]);
    assert.equal(entries[0]?.revision, 'last-good-generation:0.1.0');
    assert.equal(entries[0]?.contribution.components[0]?.id, 'production');
});
