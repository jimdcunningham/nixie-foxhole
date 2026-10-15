/**
 * Corpus status report for legacy `.plan` import.
 *
 * Imports every fixture under tests/fixtures/legacy-plans/raw and aggregates
 * hard failures vs known soft gaps so progress is visible without the
 * intentional "fully ingested" fail gate in plan-import-fixtures.test.ts.
 *
 * Usage:
 *   node --import ./tools/legacy-plans/register-nixie-imports.mjs ./tools/legacy-plans/migration-status.mjs
 *   npm run legacy:migration-status
 *   npm run legacy:migration-status -- --limit 100
 *   npm run legacy:migration-status -- --json out/migration-status.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANNER_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_RAW = path.join(PLANNER_ROOT, 'tests/fixtures/legacy-plans/raw');
const ORIENTATION_QA_PATH = path.join(__dirname, 'orientation-qa.json');
const SOCKET_QA_PATH = path.join(__dirname, 'socket-qa.json');
const ORIENTATION_MAP_PATH = path.join(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-orientation-map.ts');

/** World/decor keys that drop silently but rarely block bunker/facility migration. */
const DECORATIVE_BUILDING_KEY_RE = /^(world_|tree$|player[cw]$|tankmine$)/;

function parseArgs(argv) {
    const options = {
        limit: null,
        jsonPath: path.join(__dirname, 'migration-status-report.json'),
        concurrency: 4,
        noJson: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--limit' || arg.startsWith('--limit=')) {
            const n = Number(arg.includes('=') ? arg.split('=')[1] : argv[++i]);
            options.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        } else if (arg === '--json' || arg.startsWith('--json=')) {
            options.jsonPath = String(arg.includes('=') ? arg.slice('--json='.length) : argv[++i] ?? '').trim() || options.jsonPath;
        } else if (arg === '--no-json') {
            options.noJson = true;
        } else if (arg === '--concurrency' || arg.startsWith('--concurrency=')) {
            const n = Number(arg.includes('=') ? arg.split('=')[1] : argv[++i]);
            options.concurrency = Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
        }
    }
    return options;
}

function isDecorativeBuildingKey(key) {
    return DECORATIVE_BUILDING_KEY_RE.test(String(key));
}

function listFixtureZips(limit) {
    if (!existsSync(FIXTURES_RAW)) {
        return [];
    }
    const all = readdirSync(FIXTURES_RAW)
        .filter(name => name.endsWith('.zip') || name.endsWith('.plan'))
        .sort();
    return limit ? all.slice(0, limit) : all;
}

function bump(map, key, amount = 1) {
    map[key] = (map[key] ?? 0) + amount;
}

function topEntries(map, limit = null) {
    const entries = Object.entries(map)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count }));
    return limit == null ? entries : entries.slice(0, limit);
}

function classifyValue(value) {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

function summarizeValue(value) {
    if (Array.isArray(value)) {
        return `[${value.map(entry => summarizeValue(entry)).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().join(', ')}}`;
    }
    return JSON.stringify(value);
}

function collectProjectSettingsInventory(store, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return;
    }
    const visit = (value, pathParts) => {
        const pathKey = pathParts.join('.');
        const entry = store[pathKey] ?? { fixtures: 0, types: {}, typicalValues: {} };
        entry.fixtures += 1;
        bump(entry.types, classifyValue(value));
        bump(entry.typicalValues, summarizeValue(value));
        store[pathKey] = entry;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, child] of Object.entries(value)) {
                visit(child, [...pathParts, key]);
            }
        }
    };
    for (const [key, value] of Object.entries(settings)) {
        visit(value, [key]);
    }
}

function buildProjectSettingsInventoryReport(store) {
    return Object.entries(store)
        .map(([key, value]) => ({
            key,
            fixtures: value.fixtures,
            types: topEntries(value.types),
            typicalValues: topEntries(value.typicalValues, 12),
        }))
        .sort((left, right) => right.fixtures - left.fixtures || left.key.localeCompare(right.key));
}

function loadOrientationConfidence() {
    const src = readFileSync(ORIENTATION_MAP_PATH, 'utf8');
    const byConfidence = {};
    let total = 0;
    for (const match of src.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*\{([\s\S]*?)^\s*\},?$/gm)) {
        const confidence = match[2].match(/confidence:\s*'([^']+)'/)?.[1] ?? 'unknown';
        bump(byConfidence, confidence);
        total += 1;
    }
    return { total, byConfidence };
}

function classifyPlan(reportJson) {
    const unresolvedStructureKeys = reportJson.unresolvedBuildingKeys.filter(key => !isDecorativeBuildingKey(key));
    const unresolvedDecorKeys = reportJson.unresolvedBuildingKeys.filter(key => isDecorativeBuildingKey(key));
    const skippedStructural = Object.entries(reportJson.skippedEntityTypes)
        .filter(([type]) => type !== 'image' && type !== 'point')
        .reduce((sum, [, count]) => sum + count, 0);
    const skippedDecor = (reportJson.skippedEntityTypes.image ?? 0) + (reportJson.skippedEntityTypes.point ?? 0);

    const critical = {
        unresolvedStructureKeys: unresolvedStructureKeys.length,
        unresolvedFacilityUpgrades: reportJson.unresolvedFacilityUpgrades.length,
        unresolvedSocketIds: reportJson.unresolvedSocketIds.length,
        unmatchedModslots: reportJson.unmatchedModslots.length,
        unresolvedCargoKeys: reportJson.unresolvedCargoKeys.length,
        skippedStructural,
        unknownEntityFields: reportJson.unknownEntityFields.reduce((sum, e) => sum + e.count, 0),
        unknownProjectFields: reportJson.unknownProjectFields.reduce((sum, e) => sum + e.count, 0),
        upgradeWarnings: reportJson.upgradeWarnings.length,
    };
    const decorative = {
        unresolvedDecorKeys: unresolvedDecorKeys.length,
        skippedDecor,
        unresolvedIconKeys: reportJson.unresolvedIconKeys.length,
    };
    const soft = {
        unmappedEntityFields: reportJson.unmappedEntityFields.reduce((sum, e) => sum + e.count, 0),
        unmappedProjectFields: reportJson.unmappedProjectFields.reduce((sum, e) => sum + e.count, 0),
    };
    const criticalCount = Object.values(critical).reduce((sum, n) => sum + n, 0);
    const decorativeCount = Object.values(decorative).reduce((sum, n) => sum + n, 0);
    const softCount = Object.values(soft).reduce((sum, n) => sum + n, 0);
    let bucket = 'clean';
    if (criticalCount > 0) {
        bucket = 'critical';
    } else if (decorativeCount > 0) {
        bucket = 'decorative';
    } else if (softCount > 0) {
        bucket = 'soft';
    }
    return {
        bucket,
        critical,
        decorative,
        soft,
        criticalCount,
        decorativeCount,
        softCount,
        unresolvedStructureKeys,
        unresolvedDecorKeys,
    };
}

async function mapPool(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= items.length) {
                return;
            }
            results[index] = await mapper(items[index], index);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const names = listFixtureZips(options.limit);
    if (names.length === 0) {
        console.error(`No fixtures in ${FIXTURES_RAW}`);
        console.error('Run: npm run legacy:download-presets');
        process.exit(1);
    }

    const { LegacyPlanImporter } = await import(
        pathToFileURL(path.join(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-importer.ts')).href
    );

    const orientationQa = JSON.parse(readFileSync(ORIENTATION_QA_PATH, 'utf8'));
    const socketQa = JSON.parse(readFileSync(SOCKET_QA_PATH, 'utf8'));
    const orientationMap = loadOrientationConfidence();

    const totals = {
        fixtures: names.length,
        entities: 0,
        boardSnapshots: 0,
        buckets: { clean: 0, soft: 0, decorative: 0, critical: 0 },
        importErrors: 0,
        fixturesWithUnresolvedSockets: 0,
        fixturesWithUnresolvedStructures: 0,
    };

    const unresolvedBuildingKeys = {};
    const unresolvedStructureKeys = {};
    const unresolvedDecorKeys = {};
    const unresolvedFacilityUpgrades = {};
    const unresolvedSocketIds = {};
    /** @type {Record<string, { count: number; socketIds: Set<string>; }>} */
    const unresolvedSocketsByStructure = {};
    const unresolvedCargoKeys = {};
    const unresolvedIconKeys = {};
    const unmatchedModslots = {};
    const skippedEntityTypes = {};
    const unmappedEntityFields = {};
    const unmappedProjectFields = {};
    const unknownEntityFields = {};
    const unknownProjectFields = {};
    const entityKindCounts = {};
    const fromVersions = {};
    const criticalFixtureSamples = [];
    const projectSettingsInventory = {};

    const started = Date.now();
    const importer = new LegacyPlanImporter();

    process.stderr.write(`Importing ${names.length} fixtures (concurrency ${options.concurrency})…\n`);

    await mapPool(names, options.concurrency, async (name, index) => {
        if ((index + 1) % 50 === 0 || index === 0) {
            process.stderr.write(`  ${index + 1}/${names.length}\n`);
        }
        const bytes = readFileSync(path.join(FIXTURES_RAW, name));
        try {
            const result = await importer.importArchive(bytes, { fixtureName: name });
            const json = result.report.toJSON();
            const classification = classifyPlan(json);
            collectProjectSettingsInventory(projectSettingsInventory, result.upgradedSave.projectSettings);

            totals.entities += json.entityCount;
            totals.boardSnapshots += result.boardSnapshots.length;
            totals.buckets[classification.bucket] += 1;
            if (json.unresolvedSocketIds.length) {
                totals.fixturesWithUnresolvedSockets += 1;
            }
            if (classification.unresolvedStructureKeys.length) {
                totals.fixturesWithUnresolvedStructures += 1;
            }
            bump(fromVersions, json.fromVersion ?? '(missing)');

            for (const [kind, count] of Object.entries(json.entityKindCounts)) {
                bump(entityKindCounts, kind, count);
            }
            for (const key of json.unresolvedBuildingKeys) {
                bump(unresolvedBuildingKeys, key);
                if (isDecorativeBuildingKey(key)) {
                    bump(unresolvedDecorKeys, key);
                } else {
                    bump(unresolvedStructureKeys, key);
                }
            }
            for (const key of json.unresolvedFacilityUpgrades) {
                bump(unresolvedFacilityUpgrades, key);
            }
            for (const id of json.unresolvedSocketIds) {
                bump(unresolvedSocketIds, String(id));
            }
            for (const finding of json.unresolvedSocketFindings ?? []) {
                if (finding.reason === 'unresolved_local_socket') {
                    const key = finding.legacyKey || finding.foxholeKey;
                    const socketId = String(finding.legacySocketId);
                    const entry = unresolvedSocketsByStructure[key] ?? {
                        count: 0,
                        socketIds: new Set(),
                    };
                    entry.count += 1;
                    entry.socketIds.add(socketId);
                    unresolvedSocketsByStructure[key] = entry;
                }
            }
            for (const key of json.unresolvedCargoKeys) {
                bump(unresolvedCargoKeys, key);
            }
            for (const key of json.unresolvedIconKeys) {
                bump(unresolvedIconKeys, key);
            }
            for (const key of json.unmatchedModslots) {
                bump(unmatchedModslots, key);
            }
            for (const [type, count] of Object.entries(json.skippedEntityTypes)) {
                bump(skippedEntityTypes, type, count);
            }
            for (const entry of json.unmappedEntityFields) {
                bump(unmappedEntityFields, entry.field, entry.count);
            }
            for (const entry of json.unmappedProjectFields) {
                bump(unmappedProjectFields, entry.field, entry.count);
            }
            for (const entry of json.unknownEntityFields) {
                bump(unknownEntityFields, entry.field, entry.count);
            }
            for (const entry of json.unknownProjectFields) {
                bump(unknownProjectFields, entry.field, entry.count);
            }

            if (classification.bucket === 'critical' && criticalFixtureSamples.length < 40) {
                criticalFixtureSamples.push({
                    fixture: name,
                    entities: json.entityCount,
                    snapshots: result.boardSnapshots.length,
                    critical: classification.critical,
                    unresolvedStructureKeys: classification.unresolvedStructureKeys.slice(0, 8),
                    unresolvedSocketIds: json.unresolvedSocketIds.slice(0, 8),
                    unmatchedModslots: json.unmatchedModslots.slice(0, 8),
                    skippedEntityTypes: json.skippedEntityTypes,
                });
            }
        } catch (error) {
            totals.importErrors += 1;
            totals.buckets.critical += 1;
            if (criticalFixtureSamples.length < 40) {
                criticalFixtureSamples.push({
                    fixture: name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    });

    const unresolvedSocketsByStructureEntries = Object.entries(unresolvedSocketsByStructure)
        .map(([key, value]) => ({
            key,
            count: value.count,
            socketIds: [...value.socketIds].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
        }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    const elapsedMs = Date.now() - started;
    const usable = totals.buckets.clean + totals.buckets.soft + totals.buckets.decorative;
    const report = {
        generatedAt: new Date().toISOString(),
        elapsedMs,
        fixturesScanned: totals.fixtures,
        totals,
        usableWithoutCriticalIssues: usable,
        coverage: {
            orientationMapKeys: orientationMap.total,
            orientationConfidence: orientationMap.byConfidence,
            orientationQaConfirmed: orientationQa.confirmed?.length ?? 0,
            orientationQaSkipClipboard: Object.keys(orientationQa.skipClipboard ?? {}).length,
            socketQaConfirmed: socketQa.confirmed?.length ?? 0,
        },
        fromVersions,
        entityKindCounts: topEntries(entityKindCounts),
        criticalIssues: {
            unresolvedStructureKeys: topEntries(unresolvedStructureKeys),
            unresolvedFacilityUpgrades: topEntries(unresolvedFacilityUpgrades),
            unresolvedSocketIds: topEntries(unresolvedSocketIds),
            unresolvedSocketsByStructure: unresolvedSocketsByStructureEntries,
            unmatchedModslots: topEntries(unmatchedModslots),
            unresolvedCargoKeys: topEntries(unresolvedCargoKeys),
            skippedEntityTypes: topEntries(skippedEntityTypes),
            unknownEntityFields: topEntries(unknownEntityFields),
            unknownProjectFields: topEntries(unknownProjectFields),
        },
        decorativeIssues: {
            unresolvedDecorKeys: topEntries(unresolvedDecorKeys),
            unresolvedIconKeys: topEntries(unresolvedIconKeys),
        },
        softGaps: {
            unmappedEntityFields: topEntries(unmappedEntityFields),
            unmappedProjectFields: topEntries(unmappedProjectFields),
        },
        projectSettingsInventory: buildProjectSettingsInventoryReport(projectSettingsInventory),
        criticalFixtureSamples,
        uniqueCounts: {
            unresolvedBuildingKeys: Object.keys(unresolvedBuildingKeys).length,
            unresolvedStructureKeys: Object.keys(unresolvedStructureKeys).length,
            unresolvedDecorKeys: Object.keys(unresolvedDecorKeys).length,
            unresolvedFacilityUpgrades: Object.keys(unresolvedFacilityUpgrades).length,
            unresolvedSocketIds: Object.keys(unresolvedSocketIds).length,
            unresolvedSocketsByStructure: unresolvedSocketsByStructureEntries.length,
            unresolvedSocketIdPairs: unresolvedSocketsByStructureEntries.reduce(
                (sum, entry) => sum + entry.socketIds.length,
                0,
            ),
            unresolvedCargoKeys: Object.keys(unresolvedCargoKeys).length,
            unresolvedIconKeys: Object.keys(unresolvedIconKeys).length,
            unmatchedModslots: Object.keys(unmatchedModslots).length,
            skippedEntityTypes: Object.keys(skippedEntityTypes).length,
            unmappedEntityFields: Object.keys(unmappedEntityFields).length,
            unmappedProjectFields: Object.keys(unmappedProjectFields).length,
        },
    };

    const pct = n => `${((n / totals.fixtures) * 100).toFixed(1)}%`;
    const lines = [];
    lines.push('Legacy plan migration status');
    lines.push('============================');
    lines.push(`Fixtures: ${totals.fixtures}  entities: ${totals.entities}  board snapshots: ${totals.boardSnapshots}`);
    lines.push(`Snapshot yield: ${totals.entities ? ((totals.boardSnapshots / totals.entities) * 100).toFixed(1) : 0}% of entities`);
    lines.push(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s  import errors: ${totals.importErrors}`);
    lines.push('');
    lines.push('Plan buckets (per fixture)');
    lines.push(`  clean (no gaps):                 ${totals.buckets.clean}  (${pct(totals.buckets.clean)})`);
    lines.push(`  soft (known unmapped fields):    ${totals.buckets.soft}  (${pct(totals.buckets.soft)})`);
    lines.push(`  decorative only (roads/trees…):  ${totals.buckets.decorative}  (${pct(totals.buckets.decorative)})`);
    lines.push(`  critical (sockets/keys/mods…):   ${totals.buckets.critical}  (${pct(totals.buckets.critical)})`);
    lines.push(`  usable without critical issues:  ${usable}  (${pct(usable)})`);
    lines.push(`  fixtures with unresolved sockets:${totals.fixturesWithUnresolvedSockets}  (${pct(totals.fixturesWithUnresolvedSockets)})`);
    lines.push('');
    lines.push('Visual QA bookkeeping');
    lines.push(`  orientation map keys: ${orientationMap.total}  (${JSON.stringify(orientationMap.byConfidence)})`);
    lines.push(`  orientation confirmed: ${orientationQa.confirmed?.length ?? 0}`);
    lines.push(`  socket confirmed: ${socketQa.confirmed?.length ?? 0}`);
    lines.push('');
    const printAll = (title, entries) => {
        lines.push(`  ${title}: ${entries.length ? '' : '(none)'}`);
        for (const entry of entries) {
            lines.push(`    - ${entry.key} ×${entry.count}`);
        }
    };
    const printSocketGroups = (title, entries) => {
        lines.push(`  ${title}: ${entries.length ? '' : '(none)'}`);
        for (const entry of entries) {
            lines.push(`    - ${entry.key} ${JSON.stringify(entry.socketIds)} ×${entry.count}`);
        }
    };
    lines.push('Critical issues');
    printAll(`unresolved structures (${report.uniqueCounts.unresolvedStructureKeys} unique)`, report.criticalIssues.unresolvedStructureKeys);
    printSocketGroups(
        `unresolved sockets by structure (${report.uniqueCounts.unresolvedSocketsByStructure} structures, ${report.uniqueCounts.unresolvedSocketIdPairs} ids)`,
        report.criticalIssues.unresolvedSocketsByStructure,
    );
    printAll(`unmatched modslots (${report.uniqueCounts.unmatchedModslots} unique)`, report.criticalIssues.unmatchedModslots);
    printAll(`skipped entity types (${report.uniqueCounts.skippedEntityTypes} unique)`, report.criticalIssues.skippedEntityTypes);
    printAll(`unresolved cargo (${report.uniqueCounts.unresolvedCargoKeys} unique)`, report.criticalIssues.unresolvedCargoKeys);
    lines.push('');
    lines.push('Decorative drops (lower priority)');
    printAll(`unresolved decor keys (${report.uniqueCounts.unresolvedDecorKeys} unique)`, report.decorativeIssues.unresolvedDecorKeys);
    printAll(`unresolved icons (${report.uniqueCounts.unresolvedIconKeys} unique)`, report.decorativeIssues.unresolvedIconKeys);
    lines.push('');
    lines.push('Soft gaps — known fields not yet ingested');
    printAll('unmapped entity fields', report.softGaps.unmappedEntityFields);
    printAll('unmapped project fields', report.softGaps.unmappedProjectFields);
    lines.push('');
    lines.push('Project settings inventory (fixture count, types, typical values)');
    if (report.projectSettingsInventory.length === 0) {
        lines.push('  (none)');
    } else {
        for (const entry of report.projectSettingsInventory) {
            const types = entry.types.map(type => `${type.key} ×${type.count}`).join(', ');
            const values = entry.typicalValues.map(value => `${value.key} ×${value.count}`).join('; ');
            lines.push(`  ${entry.key}: ${entry.fixtures} fixtures (${types})`);
            lines.push(`    typical: ${values}`);
        }
    }
    lines.push('');
    lines.push('Suggested next work (priority)');
    if (totals.fixturesWithUnresolvedSockets > totals.fixtures * 0.2) {
        lines.push('  1. Socket id map coverage — dominant critical failure across the corpus');
    }
    if (report.uniqueCounts.unmatchedModslots > 0) {
        lines.push('  2. Modslot bridge/under mapping for trench/fort connectors');
    }
    if (report.uniqueCounts.unresolvedStructureKeys > 0) {
        lines.push('  3. Map remaining structure keys (garrison*, landingdock, …)');
    }
    if ((skippedEntityTypes.locomotive ?? 0) + (skippedEntityTypes.locomotive_undercarriage ?? 0) > 0) {
        lines.push('  4. Train/locomotive entity types (skipped today)');
    }
    if ((skippedEntityTypes.image ?? 0) > 0 || report.uniqueCounts.unresolvedDecorKeys > 0) {
        lines.push('  5. Image entities + world decor (roads/trees) if map scenery matters');
    }
    if ((unmappedProjectFields.projectSettings ?? 0) > 0) {
        lines.push('  6. Additional project settings on import');
    }
    if ((unmappedEntityFields.productionOrders ?? 0) > 0) {
        lines.push('  7. Production / train track / tint entity fields');
    }
    lines.push('  8. Continue socket visual QA (only 8 keys confirmed vs orientation 70)');
    lines.push('  9. Update MIGRATION.md — .plan import exists; remaining work is fidelity');

    const text = lines.join('\n');
    console.log(text);

    if (!options.noJson && options.jsonPath) {
        const outPath = path.isAbsolute(options.jsonPath)
            ? options.jsonPath
            : path.join(PLANNER_ROOT, options.jsonPath);
        mkdirSync(path.dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
        console.log(`\nWrote JSON report: ${outPath}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
