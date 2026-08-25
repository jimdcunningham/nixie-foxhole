using FoxWatchService;

try
{
	if (args.Length > 0 && string.Equals(args[0], "generate-map-data", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunGenerateMapDataAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "generate-manifest", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunGenerateManifestAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "extract-ui-assets", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunExtractUiAssetsAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "generate-render-scenes", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunGenerateRenderScenesAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "prepare-regen", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunPrepareRegenAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "probe-mesh-export", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunProbeMeshExportAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "find-mesh-assets", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunFindMeshAssetsAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "find-assets", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunFindAssetsAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "inspect-blueprint", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunInspectBlueprintAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "compare-animation-reference-pose", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunCompareAnimationReferencePoseAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "export-mesh", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunExportMeshAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "export-mesh-dir", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunExportMeshDirectoryAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "dump-package-files", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunDumpPackageFilesAsync(args[1..]);
		return;
	}

	if (args.Length > 0 && string.Equals(args[0], "dump-matching-packages", StringComparison.OrdinalIgnoreCase))
	{
		Environment.ExitCode = await FoxWatchCli.RunDumpMatchingPackagesAsync(args[1..]);
		return;
	}
}
catch (ArgumentException exception)
{
	Console.Error.WriteLine(exception.Message);
	Environment.ExitCode = 1;
	return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddFoxWatchOptions(builder.Configuration);
builder.Services.AddFoxWatchCoreServices();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.RunAsync();
