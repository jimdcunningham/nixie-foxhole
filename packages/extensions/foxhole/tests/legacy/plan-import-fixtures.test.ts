import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LegacyPlanImporter } from '../../app/plugins/foxhole/legacy/plan-importer.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '../fixtures/legacy-plans');
const rawDir = join(fixturesRoot, 'raw');
const samplePath = join(fixturesRoot, 'sample-project.json');
const requireFixtures = process.env.LEGACY_PLAN_FIXTURES === '1';

function listFixtureZips(): string[] {
    if (!existsSync(rawDir)) {
        return [];
    }
    return readdirSync(rawDir)
        .filter(name => name.endsWith('.zip') || name.endsWith('.plan'))
        .map(name => join(rawDir, name))
        .sort();
}

test('importer emits board snapshots and maps connections for sample', async () => {
    const save = JSON.parse(readFileSync(samplePath, 'utf8')) as LegacyPlanSave;
    const importer = new LegacyPlanImporter({ fixtureName: 'sample-project.json' });
    const result = await importer.importSave(save);

    assert.equal(result.upgradedSave.version, '1.0.5');
    assert.equal(result.stubDocument.nodes.length, 2);
    assert.equal(result.stubDocument.nodes[0]?.resolvedKey, 'fortt1');
    assert.equal(result.stubDocument.nodes[0]?.legacyExtras.connections, undefined);
    assert.equal(result.boardSnapshots.length, 2);
    assert.equal(result.boardSnapshots[0]?.id, 'legacy-1');
    assert.equal(result.boardSnapshots[0]?.state.foxholeKey, 'fortt1');
    assert.equal(result.boardSnapshots[1]?.id, 'legacy-2');
    assert.equal(result.report.unresolvedBuildingKeys.length, 0);
    assert.equal(result.report.importedShapeCounts.text, 1);
});

test('downloaded legacy plan fixtures have no unaccounted fields', async t => {
    const zips = listFixtureZips();
    if (zips.length === 0) {
        if (requireFixtures) {
            assert.fail('No legacy plan fixtures found. Run: npm run legacy:download-presets');
        }
        t.skip('No fixtures in tests/fixtures/legacy-plans/raw — run npm run legacy:download-presets');
        return;
    }

    if (!requireFixtures) {
        t.skip(`Found ${zips.length} fixture(s); run npm run test:legacy-plans to assert unmapped fields`);
        return;
    }

    const importer = new LegacyPlanImporter();
    const failures: string[] = [];

    for (const zipPath of zips) {
        const fixtureName = zipPath.split(/[/\\]/).pop() ?? zipPath;
        const bytes = readFileSync(zipPath);
        const result = await importer.importArchive(bytes, { fixtureName });

        assert.equal(result.upgradedSave.version, '1.0.5', `${fixtureName} should upgrade to 1.0.5`);
        assert.equal(result.archive.rawZipBytes.byteLength, bytes.byteLength);

        if (result.report.hasBlockingFindings) {
            failures.push(result.report.formatSummary());
        }
    }

    assert.equal(
        failures.length,
        0,
        `Legacy plan fixtures still have unaccounted data:\n\n${failures.join('\n\n')}`,
    );
});
