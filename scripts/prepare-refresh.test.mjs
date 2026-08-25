import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');

describe('FoxWatch combined refresh preparation', () => {
    it('has no standalone regen command or C# preparation path', async () => {
        const runnerSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs'), 'utf8');
        const programSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'Program.cs'), 'utf8');
        const cliSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchCli.cs'), 'utf8');
        const publisherSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'scripts', 'publish-manifest.mjs'), 'utf8');

        assert.doesNotMatch(runnerSource, /command === 'regen'|runRegen\(/);
        assert.match(runnerSource, /Unknown FoxWatch command/);
        assert.match(runnerSource, /const knownCommands = new Set/);
        assert.doesNotMatch(programSource, /prepare-regen|RunPrepareRegenAsync/);
        assert.doesNotMatch(cliSource, /RunPrepareRegenAsync|EnrichRegenPlanAsync/);
        assert.match(publisherSource, /FoxWatch regen has been removed/);
    });

    it('routes refresh through prepare-refresh instead of two C# processes', async () => {
        const source = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs'), 'utf8');
        const refreshBranch = source.match(/if \(command === 'refresh'\) \{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
        assert.ok(refreshBranch, 'refresh command branch must exist');
        assert.match(refreshBranch, /'prepare-refresh'/);
        assert.match(refreshBranch, /--raw-cache-key/);
        assert.match(refreshBranch, /--strict/);
        assert.doesNotMatch(refreshBranch, /'generate-manifest'/);
        assert.doesNotMatch(refreshBranch, /'generate-render-scenes'/);
    });

    it('builds once and passes the same manifest to both writers', async () => {
        const source = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchCli.cs'), 'utf8');
        const method = source.match(/RunPrepareRefreshAsync\(string\[\] args\)(?<body>[\s\S]*?)\n    public static async Task<int> RunSnapshotPakAsync/)?.groups?.body;
        assert.ok(method, 'RunPrepareRefreshAsync must exist before RunSnapshotPakAsync');
        assert.equal((method.match(/manifestGenerator\.BuildManifest\(/g) ?? []).length, 1);
        assert.match(method, /manifestGenerator\.WriteAsync\(manifest,/);
        assert.match(method, /renderSceneGenerator\.GenerateAsync\(\s*manifest,/);
        assert.match(method, /meshExporter\.WriteInspectionSnapshotAsync\(\)/);
        assert.match(method, /rawCacheKey: parsedArguments\.GetValueOrDefault\("raw-cache-key"\)/);
    });

    it('defers deep asset exports to staged workers before committing cache provenance', async () => {
        const runnerSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs'), 'utf8');
        const refreshBranch = runnerSource.match(/if \(command === 'refresh'\) \{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
        assert.ok(refreshBranch, 'refresh command branch must exist');
        assert.match(refreshBranch, /--asset-export-plan/);
        assert.ok(
            refreshBranch.indexOf('runDeepAssetCacheExport') < refreshBranch.indexOf('commitDeepExtractionCache'),
            'staged asset exports must finish before cache provenance is committed',
        );
        assert.match(runnerSource, /Asset cache workers produced different bytes/);

        const cliSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchCli.cs'), 'utf8');
        assert.match(cliSource, /RunExportAssetCacheAsync/);
        assert.match(cliSource, /assetExportPlanPath: parsedArguments\.GetValueOrDefault\("asset-export-plan"\)/);
    });

    it('keys the decoded deep package snapshot only to the PAK inventory', async () => {
        const runnerSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs'), 'utf8');
        const packageSnapshotMethod = runnerSource.match(/async function prepareDeepPackageSnapshots(?<body>[\s\S]*?)\n\}/)?.groups?.body;
        assert.ok(packageSnapshotMethod, 'prepareDeepPackageSnapshots must exist');
        assert.match(packageSnapshotMethod, /'snapshot-decoded-packages'/);
        assert.match(packageSnapshotMethod, /pakDirectory/);
        assert.doesNotMatch(packageSnapshotMethod, /'snapshot-pak'/);
        assert.doesNotMatch(packageSnapshotMethod, /extractorFingerprint|buildProvenance/);
        assert.match(runnerSource, /createDecodedAssetBundlePaths\(decodedAssetBundleRoot, pakInventory\.fingerprint\)/);
        assert.match(runnerSource, /bundlePaths\.packageSnapshotRoot/);

        const refreshBranch = runnerSource.match(/if \(command === 'refresh'\) \{(?<body>[\s\S]*?)\n\}/)?.groups?.body;
        assert.ok(refreshBranch, 'refresh command branch must exist');
        assert.match(refreshBranch, /FOXWATCH_DECODED_PACKAGE_SNAPSHOT/);
        assert.match(refreshBranch, /FOXWATCH_DECODED_PACKAGE_PAK_FINGERPRINT/);
        assert.match(refreshBranch, /FOXWATCH_DECODED_INSPECTION_SNAPSHOT/);
        assert.match(refreshBranch, /FoxWatch__IconOutputDirectory/);
        assert.match(refreshBranch, /deepExtractionCache\.pakDirectory/);

        const decodedSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchDecodedPackageSource.cs'), 'utf8');
        assert.match(decodedSource, /packageMetadata\.PakFingerprint, metadata\.PakFingerprint/);
        assert.match(decodedSource, /PakFingerprintEnvironmentVariableName/);
        assert.match(decodedSource, /decoded packages require either a matching immutable raw package snapshot/i);
    });

    it('deduplicates mesh dependencies into material metadata and texture export phases', async () => {
        const runnerSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs'), 'utf8');
        assert.match(runnerSource, /--mesh-geometry-only/);
        assert.match(runnerSource, /referencedMaterialPackagePaths/);
        assert.match(runnerSource, /--material-metadata-only/);
        assert.match(runnerSource, /referencedTexturePackagePaths/);
        assert.match(runnerSource, /texture-export-plan\.v1\.json/);
        assert.match(runnerSource, /FOXWATCH_TEXTURE_WORKERS/);
        assert.match(runnerSource, /--claim-dir/);
        assert.match(runnerSource, /assertAssetWorkerCompletion/);
        assert.match(runnerSource, /os\.freemem\(\) >= 12 \* 1024 \*\* 3/);

        const cliSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchCli.cs'), 'utf8');
        assert.match(cliSource, /exportReferencedTextures: !materialMetadataOnly/);
        assert.match(cliSource, /ExportTextureAsync\(job\.PackagePath, outputDirectory\)/);
        assert.match(cliSource, /EnsureCanonicalMeshOutput\(job\.PackagePath, outputDirectory, result\.SavedFilePath\)/);

        const exporterSource = await fs.readFile(path.join(repositoryRoot, 'tools', 'foxwatch', 'FoxWatchAssetMeshExporter.cs'), 'utf8');
        assert.match(exporterSource, /ReferencedTexturePackagePaths/);
        assert.match(exporterSource, /public Task ExportTextureAsync/);
    });
});
