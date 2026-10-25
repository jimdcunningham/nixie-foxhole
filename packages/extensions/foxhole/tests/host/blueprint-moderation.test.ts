import { hostSourceUrl } from "../host-source-url.mjs";
import { legacyHasPublicationContent } from '#foxhole/utils/legacy-blueprint-save.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import JSZip from 'jszip';
import { discoverySceneV2ImageIds, checkDiscoverySceneV2, discoverySceneV2HasContent } from '#nixie-internal/app/utils/discovery-scene-v2.ts';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createError } from 'h3';
import { communityTitleIssue, sceneHasPublicationContent, spreadsheetHasPublicationContent, documentHasPublicationContent } from '../../../../nixie/app/utils/community-submission.ts';
import { checkNativeDiscoveryZip, checkDiscoveryNodeTree, readCheckedZipEntry } from '../../../../nixie/app/utils/discovery-archive.ts';
import { LEGACY_BLUEPRINT_LIMITS } from '../../../../nixie/app/utils/legacy-blueprint-archive-bounds.ts';
import { blueprintModerationFlags, blueprintTextChunks, requireBlueprintModerationResult, BLUEPRINT_MODERATION_POLICY } from '../../server/utils/blueprint-moderation-policy.ts';
import { inspectBlueprintArchive, prepareBlueprintImage, BlueprintManualReviewError } from '../../server/utils/blueprint-moderation-archive.ts';
import { readBoundedBlueprintResponse } from '../../server/utils/legacy-blueprint-resolver.ts';

function loadFunction(file: string, name: string, dependencies: Record<string, unknown>) {
    const source = ts.createSourceFile('source.ts', readFileSync(hostSourceUrl(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)!;
    return new Function(...Object.keys(dependencies), `${ts.transpile(node.getText(source).replace('export ', ''), { target: ts.ScriptTarget.ES2022 })}; return ${name};`)(...Object.values(dependencies));
}
const nativeManifest = loadFunction('../../../../nixie/server/utils/nixie-registry-projects.ts', 'readProjectArchiveManifest', {
    checkNativeDiscoveryZip, checkDiscoveryNodeTree, readCheckedZipEntry, JSZip, LEGACY_BLUEPRINT_LIMITS,
    createHash, createError, sceneHasPublicationContent, spreadsheetHasPublicationContent, documentHasPublicationContent,
    discoverySceneV2ImageIds, checkDiscoverySceneV2, discoverySceneV2HasContent,
});
const review = loadFunction('../../server/utils/blueprint-moderation.ts', 'reviewBlueprintContent', { blueprintModerationFlags, BLUEPRINT_MODERATION_POLICY });

test('missing published icons do not block archive review, but other storage failures do', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ entities: [{ id: 1, type: 'text', label: 'Depot' }] }));
    const archive = await zip.generateAsync({ type: 'nodebuffer' });
    let iconStatus = 400;
    let archiveStatus = 200;
    let iconError = { code: 'NoSuchKey', error: 'not_found' };
    const calls: string[] = [];
    const load = loadFunction('../../server/utils/blueprint-moderation.ts', 'loadBlueprintModerationContent', {
        BlueprintManualReviewError, inspectBlueprintArchive, prepareBlueprintImage, LEGACY_BLUEPRINT_LIMITS, readBoundedBlueprintResponse,
        fetch: async (url: URL) => {
            calls.push(url.pathname);
            if (url.pathname.endsWith('.zip')) {
                return archiveStatus === 200 ? new Response(archive) : new Response(JSON.stringify({ code: 'NoSuchKey' }), { status: archiveStatus });
            }
            return new Response(JSON.stringify(iconError), { status: iconStatus });
        },
    });
    const client = {
        from: (table: string) => {
            const query = { select: () => query, eq: () => query, single: async () => ({ data: table === 'blueprints'
                ? { name: 'Depot', privacy: 'public', version: 'version' } : { version: '1', changelog: '' } }) };
            return query;
        },
        storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }) }) },
    };
    const job = { blueprint_id: 'blueprint', version_id: 'version', fingerprint: 'revision' };
    const content = await load(client, job);
    assert.equal(content.blank, false);
    assert.ok(content.text.join('\n').includes('Depot'));
    assert.equal(content.images.length, 0);
    assert.match(content.warnings[0], /Published icon is missing/);
    assert.equal((await review(content, async () => ({ flagged: false, categories: { sexual: false } }))).state, 'approved');
    iconStatus = 503;
    iconError = { code: 'InternalError', error: 'internal_error' };
    await assert.rejects(load(client, job), /Published icon could not be downloaded \(HTTP 503\)/);
    archiveStatus = 400;
    calls.length = 0;
    await assert.rejects(load(client, job), /Blueprint archive is missing/);
    assert.equal(calls.length, 1);
});

test('publication rejects missing/default titles, including Unicode and numbered copies', () => {
    for (const name of ['', '  ', 'New Project', 'Untitled Project (2)', 'New Blueprint', 'new\u200b project', 'Ｎｅｗ　Ｐｒｏｊｅｃｔ']) {
        assert.ok(communityTitleIssue(name), name);
    }
    for (const name of ['New Project – Logistics', 'My New Project', 'Bunker 1', 'Untitled Depot']) {
        assert.equal(communityTitleIssue(name), null, name);
    }
});
test('blank detection allows a single useful object, text, sheet cell, or document', () => {
    assert.equal(sceneHasPublicationContent([{ i: '1', t: 'ly', c: [{ i: '2', t: 'cn', c: [] }] }]), false);
    assert.equal(sceneHasPublicationContent([{ i: '1', t: 'ly', c: [{ i: '2', t: 'tx', s: { te: '  ' } }] }]), false);
    assert.equal(sceneHasPublicationContent([{ id: '1', type: 'graphics', state: { commands: [] } }]), false);
    assert.equal(sceneHasPublicationContent([{ id: '1', type: 'layer', children: [{ id: '2', type: 'foxhole-structure' }] }]), true);
    assert.equal(sceneHasPublicationContent([{ i: '1', t: 'tx', s: { te: 'Depot' } }]), true);
    assert.equal(spreadsheetHasPublicationContent({ cells: {} }), false);
    assert.equal(spreadsheetHasPublicationContent({ cells: { A1: { raw: ' ', format: {} } } }), false);
    assert.equal(spreadsheetHasPublicationContent({ cells: { A1: { raw: '0' } } }), true);
    assert.equal(documentHasPublicationContent({ type: 'doc', content: [{ type: 'paragraph' }] }), false);
    assert.equal(documentHasPublicationContent({ type: 'doc', content: [{ type: 'text', text: 'Depot' }] }), true);
    assert.equal(legacyHasPublicationContent([{ id: 1, type: 'text', label: ' ' }]), false);
    assert.equal(legacyHasPublicationContent([{ id: 1, key: 'bunker' }]), true);
});
for (const kind of ['blank', 'scene', 'spreadsheet', 'document']) {
    test(`native publisher validates ${kind} archives before storage`, async () => {
        const zip = new JSZip();
        zip.file('project.json', JSON.stringify({ settings: {}, roots: kind === 'scene' ? [{ i: '1', t: 'ic', s: {} }] : [] }));
        if (kind === 'spreadsheet') {
            zip.file('project-files.json', JSON.stringify({ files: [{ assetType: 'spreadsheet', content: { cells: { A1: { raw: '1' } } } }] }));
        }
        if (kind === 'document') {
            zip.file('files.manifest.json', JSON.stringify({ assets: [{ kind: 'document', path: 'files/notes.nxdoc' }] }));
            zip.file('files/notes.nxdoc', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Logistics' }] }] }));
        }
        const bytes = await zip.generateAsync({ type: 'nodebuffer' });
        if (kind === 'blank') {
            await assert.rejects(nativeManifest(bytes), /Add content/);
        } else {
            assert.equal((await nativeManifest(bytes)).format, 'nixie-project-archive');
        }
    });
}
test('text review includes hidden labels, descriptions and version notes without ingesting image bytes', () => {
    const chunks = blueprintTextChunks({ name: 'Depot', entities: [{ hidden: true, label: 'Hidden label', textureData: 'data:image/png;base64,abc' }], release: { versionLabel: 'Release title', changelog: 'Notes' } });
    const text = chunks.join('\n');
    for (const value of ['Depot', 'Hidden label', 'Release title', 'Notes']) {
        assert.ok(text.includes(value));
    }
    assert.ok(!text.includes('base64'));
});
test('ordinary combat is allowed; sexual content, hate, threats and graphic violence need review', () => {
    assert.deepEqual(blueprintModerationFlags({ flagged: true, categories: { violence: true, illicit: true, sexual: false } }), []);
    for (const category of ['sexual', 'hate', 'hate/threatening', 'violence/graphic', 'harassment/threatening']) {
        assert.deepEqual(blueprintModerationFlags({ flagged: true, categories: { [category]: true } }), [category]);
    }
    assert.deepEqual(blueprintModerationFlags({ flagged: true, categories: { sexual: false } }), ['provider-flag']);
});
test('text-only or incomplete moderation responses cannot approve images', () => {
    assert.throws(() => requireBlueprintModerationResult({ flagged: false, categories: { sexual: false } }, 'image'), /did not check/);
    const required = ['sexual', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions'];
    const result = { flagged: false, categories: Object.fromEntries(required.map(key => [key, false])), category_applied_input_types: Object.fromEntries(required.map(key => [key, ['image']])) };
    assert.equal(requireBlueprintModerationResult(result, 'image').flagged, false);
    result.category_applied_input_types.sexual = ['text'];
    assert.throws(() => requireBlueprintModerationResult(result, 'image'), /did not check/);
});
test('all archive images are inspected, including unused assets, and image sources cannot point outside the ZIP', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00aaff' } }).png().toBuffer();
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ entities: [{ id: 1, type: 'text', label: 'Depot' }] }));
    zip.file('assets/unused.png', png);
    const content = await inspectBlueprintArchive(await zip.generateAsync({ type: 'nodebuffer' }), { name: 'Depot' });
    assert.equal(content.images.length, 1);
    assert.match(content.images[0].dataUrl, /^data:image\/webp;base64,/);
    zip.file('project.json', JSON.stringify({ entities: [{ id: 1, type: 'image', textureFile: 'https://example.com/asset.png' }] }));
    await assert.rejects(inspectBlueprintArchive(await zip.generateAsync({ type: 'nodebuffer' }), {}), /External Blueprint images/);
    await assert.rejects(prepareBlueprintImage('not-an-image.png', Buffer.from('not an image')), BlueprintManualReviewError);
});
test('blank archives reject without API requests and duplicate images reuse a check', async () => {
    let calls = 0;
    const check = async () => {
        calls++;
        return { flagged: false, categories: { sexual: false } };
    };
    const blank = { blank: true, text: [], images: [], archiveSha256: 'hash' };
    assert.equal((await review(blank, check)).state, 'rejected');
    assert.equal(calls, 0);
    const content = { ...blank, blank: false, text: ['Depot'], images: [{ name: 'a', sha256: 'same', dataUrl: 'data' }, { name: 'b', sha256: 'same', dataUrl: 'data' }] };
    assert.equal((await review(content, check)).state, 'approved');
    assert.equal(calls, 2);
    assert.equal((await review(content, async () => ({ flagged: true, categories: { sexual: true } }))).state, 'needs_review');
    await assert.rejects(review(content, async () => {
        throw new Error('HTTP 429');
    }), /HTTP 429/);
});
test('required moderation never approves missing credentials or malformed provider results', async () => {
    let config: unknown = null;
    let response: unknown = { results: [] };
    const get = loadFunction('../../../../nixie/server/utils/nixie-moderation.ts', 'getNixieModerationApiResult', {
        getNixieModerationApiConfig: () => config, createError, $fetch: async () => response,
        logModerationApiFailure: () => {}, getModerationServiceOrigin: () => '',
    });
    await assert.rejects(get(undefined, 'Depot', 'test', true), /not configured/);
    config = { apiKey: 'test', baseUrl: 'https://example.com/', timeoutMs: 10, model: 'moderation' };
    for (response of [{}, { results: [] }, { results: [{ flagged: false }] }]) {
        await assert.rejects(get(undefined, 'Depot', 'test', true), /incomplete result/);
    }
    response = { results: [{ flagged: false, categories: { sexual: false } }] };
    assert.equal((await get(undefined, 'Depot', 'test', true)).flagged, false);
});

function workerFixture(options: { texts?: string[]; providerError?: boolean; stale?: boolean; title?: string; configured?: boolean; order?: string; } = {}) {
    const cache = new Map<string, unknown>();
    const decisions: { p_state: string; p_evidence: { retryKind?: string; }; }[] = [];
    const claimArgs: { p_limit: number; p_order: string; }[] = [];
    let claims = 0;
    let requests = 0;
    const job = { blueprint_id: 'id', version_id: 'version', fingerprint: 'revision', lease_token: 'lease', attempts: 1 };
    const client = {
        from: (table: string) => {
            let key = '';
            const request = {
                select: () => request, gte: () => request,
                eq: (_column: string, value: string) => {
                    key = value;
                    return request;
                },
                maybeSingle: async () => ({ data: cache.has(key) ? { result: cache.get(key) } : null }),
                single: async () => ({ data: { name: options.title || 'Depot' } }),
                upsert: async (row: { id: string; result: unknown; }) => {
                    assert.equal(table, 'nixie_blueprint_moderation_checks');
                    cache.set(row.id, row.result);
                    return {};
                },
            };
            return request;
        },
        rpc: async (name: string, args: any) => {
            if (name === 'nixie_claim_blueprint_moderation') {
                claimArgs.push(args);
                return { data: ++claims === 1 ? [job] : [] };
            }
            assert.equal(name, 'nixie_finish_blueprint_moderation');
            decisions.push(args);
            return { data: !options.stale };
        },
    };
    class BudgetError extends Error {}
    const process = loadFunction('../../server/utils/blueprint-moderation.ts', 'processBlueprintModerationBatch', {
        useRuntimeConfig: () => ({ nixieBlueprintModerationEnabled: true, nixieBlueprintModerationOrder: options.order, nixieChatModerationApiKey: options.configured === false ? '' : 'test', nixieChatModerationModel: 'omni-moderation-latest' }),
        createNixieServiceRoleClient: () => client, createHash, BLUEPRINT_MODERATION_POLICY, requireBlueprintModerationResult, createError,
        BlueprintModerationBudgetError: BudgetError, BlueprintManualReviewError, communityTitleIssue,
        wait: async () => {}, reviewBlueprintContent: review,
        loadBlueprintModerationContent: async () => ({ archiveSha256: 'hash', blank: false, text: options.texts || ['Depot'], images: [] }),
        requireNixieModerationApiResult: async () => {
            requests++;
            if (options.providerError) {
                throw new Error('HTTP 429');
            }
            const categories = ['sexual', 'sexual/minors', 'hate', 'hate/threatening', 'harassment', 'harassment/threatening', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions'];
            return { flagged: false, categories: Object.fromEntries(categories.map(key => [key, false])), category_applied_input_types: Object.fromEntries(categories.map(key => [key, ['text']])) };
        },
    });
    return { process, cache, decisions, claimArgs, requests: () => requests, resetClaim: () => {
        claims = 0;
    } };
}
test('worker defaults to oldest first and passes the configured order to every claim', async () => {
    for (const [order, expected] of [[undefined, 'oldest'], ['oldest', 'oldest'], ['newest', 'newest'], [' NEWEST ', 'newest'], ['', 'oldest'], ['invalid', 'oldest']]) {
        const worker = workerFixture({ order });
        const result = await worker.process();
        assert.equal(result.order, expected);
        assert.equal(result.counts.approved, 1);
        assert.deepEqual(worker.claimArgs, [{ p_limit: 1, p_order: expected }, { p_limit: 1, p_order: expected }]);
    }
});
test('worker resumes cached partial checks instead of restarting or approving an incomplete upload', async () => {
    const worker = workerFixture({ texts: Array.from({ length: 13 }, (_, index) => `Label ${index}`) });
    const first = await worker.process();
    assert.equal(first.requests, 12);
    assert.equal(worker.cache.size, 12);
    assert.equal(worker.decisions[0].p_state, 'retry');
    assert.equal(worker.decisions[0].p_evidence.retryKind, 'budget');
    worker.resetClaim();
    const second = await worker.process();
    assert.equal(second.requests, 1);
    assert.equal(worker.decisions[1].p_state, 'approved');
    assert.equal(worker.requests(), 13);
});
test('worker backs off on provider failure and records a changed decision without claiming approval', async () => {
    const failed = workerFixture({ providerError: true });
    assert.equal((await failed.process()).counts.retry, 1);
    assert.equal(failed.decisions[0].p_state, 'retry');
    assert.equal(failed.cache.size, 0);
    const stale = workerFixture({ stale: true });
    assert.deepEqual((await stale.process()).counts, { changed: 1 });
});
test('worker rejects default titles without reading files and makes no claims when unconfigured', async () => {
    const defaultTitle = workerFixture({ title: 'New Project' });
    assert.equal((await defaultTitle.process()).counts.rejected, 1);
    assert.equal(defaultTitle.requests(), 0);
    const missing = workerFixture({ configured: false });
    assert.equal((await missing.process()).processed, 0);
    assert.equal(missing.decisions.length, 0);
});
