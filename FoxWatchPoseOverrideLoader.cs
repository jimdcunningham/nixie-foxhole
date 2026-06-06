namespace FoxWatchService;

using System.Text.Json;

public sealed class FoxWatchPoseOverrideLoader
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly ILogger<FoxWatchPoseOverrideLoader> _logger;

    public FoxWatchPoseOverrideLoader(ILogger<FoxWatchPoseOverrideLoader> logger)
    {
        _logger = logger;
    }

    public string GetDefaultPoseOverridePath(string structureId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(structureId);

        return Path.Combine(
            FoxWatchWorkspace.OverrideRoot,
            structureId,
            "default.pose.json");
    }

    public string GetLegacyDefaultPoseOverridePath(string structureId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(structureId);

        return Path.Combine(
            FoxWatchWorkspace.LegacyPoseOverrideRoot,
            structureId,
            "default.pose.json");
    }

    public async Task<FoxWatchRenderScenePose?> TryLoadDefaultPoseAsync(string structureId, CancellationToken cancellationToken = default)
    {
        var filePath = ResolveExistingPoseOverridePath(structureId);
        if (!File.Exists(filePath))
        {
            return null;
        }

        try
        {
            await using var stream = File.OpenRead(filePath);
            var pose = await JsonSerializer.DeserializeAsync<FoxWatchRenderScenePose>(stream, SerializerOptions, cancellationToken);
            if (pose == null)
            {
                _logger.LogWarning("Pose override file {OverridePath} was empty for {StructureId}", filePath, structureId);
                return null;
            }

            if (!string.Equals(pose.Type, "foxhole-bone-pose", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "Pose override file {OverridePath} for {StructureId} used unsupported type {PoseType}; expected foxhole-bone-pose",
                    filePath,
                    structureId,
                    pose.Type);
                return null;
            }

            if (pose.Bones == null || pose.Bones.Count == 0)
            {
                _logger.LogWarning("Pose override file {OverridePath} for {StructureId} contained no bones", filePath, structureId);
                return null;
            }

            return pose;
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Failed to parse pose override file {OverridePath} for {StructureId}", filePath, structureId);
            return null;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to read pose override file {OverridePath} for {StructureId}", filePath, structureId);
            return null;
        }
    }

    private string ResolveExistingPoseOverridePath(string structureId)
    {
        var primaryPath = GetDefaultPoseOverridePath(structureId);
        if (File.Exists(primaryPath))
        {
            return primaryPath;
        }

        return GetLegacyDefaultPoseOverridePath(structureId);
    }
}