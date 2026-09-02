namespace FoxWatchService;

using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

internal static class FoxWatchVehicleBodyFrameResolver
{
    internal const double QuarterTurnYawDegrees = 270.0;

    private const string SignedFloatPattern = @"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?";
    private static readonly Regex VectorPattern = new($@"X=(?<x>{SignedFloatPattern})\s+Y=(?<y>{SignedFloatPattern})\s+Z=(?<z>{SignedFloatPattern})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex RotatorPattern = new($@"P=(?<pitch>{SignedFloatPattern})\s+Y=(?<yaw>{SignedFloatPattern})\s+R=(?<roll>{SignedFloatPattern})", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    internal static bool ShouldDetachNavalBodyFromCollision(string? meshPath, string? attachParentName)
    {
        return IsCollisionBodyParent(attachParentName) && IsNavalBodyMesh(meshPath);
    }

    internal static bool ShouldQuarterTurnDetachedNavalBody(
        string? meshPath,
        string? attachParentName,
        string? relativeRotation)
    {
        return ShouldQuarterTurnDetachedNavalBody(meshPath, attachParentName, HasMeaningfulRotation(relativeRotation));
    }

    internal static bool ShouldQuarterTurnDetachedNavalBody(
        string? meshPath,
        string? attachParentName,
        bool hasMeaningfulRotation)
    {
        return ShouldDetachNavalBodyFromCollision(meshPath, attachParentName) && !hasMeaningfulRotation;
    }

    internal static bool ShouldQuarterTurnKnownCollisionBody(
        string? meshPath,
        string? attachParentName,
        bool hasMeaningfulRotation)
    {
        if (hasMeaningfulRotation || !IsCollisionBodyParent(attachParentName))
        {
            return false;
        }

        var meshFileName = Path.GetFileNameWithoutExtension(meshPath ?? string.Empty);
        return string.Equals(meshFileName, "SK_Motorcycle", StringComparison.OrdinalIgnoreCase) ||
            meshFileName.StartsWith("SK_Ambulance", StringComparison.OrdinalIgnoreCase) ||
            meshFileName.StartsWith("SK_AircraftScout2", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool TryResolveQuarterTurnVehicleBodyYawOffset(
        IReadOnlyList<FoxWatchBlueprintComponentReference> componentReferences,
        out string bodyComponentName,
        out double yawOffsetDegrees)
    {
        bodyComponentName = string.Empty;
        yawOffsetDegrees = 0;

        var componentLookup = componentReferences
            .Where(reference => !string.IsNullOrWhiteSpace(reference.ComponentName))
            .GroupBy(reference => NormalizeName(reference.ComponentName), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var prioritizedBodyName in new[] { "CharacterMesh0", "DestroyedMesh" })
        {
            var bodyReference = componentReferences.FirstOrDefault(reference =>
                string.Equals(
                    NormalizeName(reference.ComponentName),
                    NormalizeName(prioritizedBodyName),
                    StringComparison.OrdinalIgnoreCase));
            if (bodyReference == null)
            {
                continue;
            }

            var hasMeaningfulRotation = HasMeaningfulRotation(bodyReference.RelativeRotation);

            if (ShouldQuarterTurnDetachedNavalBody(
                    bodyReference.MeshPath,
                    bodyReference.AttachParentName,
                    hasMeaningfulRotation) ||
                ShouldQuarterTurnKnownCollisionBody(
                    bodyReference.MeshPath,
                    bodyReference.AttachParentName,
                    hasMeaningfulRotation))
            {
                bodyComponentName = bodyReference.ComponentName;
                yawOffsetDegrees = QuarterTurnYawDegrees;
                return true;
            }

            var allowsDetachedTrackedFrame = string.IsNullOrWhiteSpace(NormalizeName(bodyReference.AttachParentName))
                && componentReferences.Any(IsDetachedTrackedVehicleBodyReference);
            if ((!allowsDetachedTrackedFrame && !IsCollisionBodyParent(bodyReference.AttachParentName)) ||
                hasMeaningfulRotation ||
                !TryResolvePlanarTransform(bodyReference, componentLookup, new HashSet<string>(StringComparer.OrdinalIgnoreCase), out var bodyTransform) ||
                !ShouldQuarterTurnAxisInferredBody(bodyReference, bodyTransform, componentLookup))
            {
                continue;
            }

            bodyComponentName = bodyReference.ComponentName;
            yawOffsetDegrees = QuarterTurnYawDegrees;
            return true;
        }

        return false;
    }

    private static bool IsNavalBodyMesh(string? meshPath)
    {
        var meshFileName = Path.GetFileNameWithoutExtension(meshPath ?? string.Empty);
        if (string.IsNullOrWhiteSpace(meshFileName))
        {
            return false;
        }

        return meshFileName.Contains("ship", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("boat", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("destroyer", StringComparison.OrdinalIgnoreCase)
            || meshFileName.Contains("submarine", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsCollisionBodyParent(string? attachParentName)
    {
        var normalized = NormalizeName(attachParentName);
        return string.Equals(normalized, "collisioncylinder", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "collision", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "shipcollision", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalized, "vehiclecollision", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsVehicleBodyReference(FoxWatchBlueprintComponentReference componentReference)
    {
        var normalizedName = NormalizeName(componentReference.ComponentName);
        return string.Equals(normalizedName, "charactermesh0", StringComparison.OrdinalIgnoreCase)
            || string.Equals(normalizedName, "destroyedmesh", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDetachedTrackedVehicleBodyReference(FoxWatchBlueprintComponentReference componentReference)
    {
        return string.IsNullOrWhiteSpace(NormalizeName(componentReference.AttachParentName))
            && IsPrimaryTrackedVehicleBodyReference(componentReference);
    }

    private static bool IsPrimaryTrackedVehicleBodyReference(FoxWatchBlueprintComponentReference componentReference)
    {
        if (string.IsNullOrWhiteSpace(componentReference.MeshPath))
        {
            return false;
        }

        if (string.Equals(componentReference.ComponentName, "MainBody", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(componentReference.ComponentName, "Mainbody", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(componentReference.ComponentName, "Chassis", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var fileName = Path.GetFileNameWithoutExtension(componentReference.MeshPath);
        return fileName.Contains("chassis", StringComparison.OrdinalIgnoreCase) ||
            fileName.Contains("body", StringComparison.OrdinalIgnoreCase) ||
            fileName.Contains("hull", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldQuarterTurnAxisInferredBody(
        FoxWatchBlueprintComponentReference bodyReference,
        PlanarTransform bodyTransform,
        IReadOnlyDictionary<string, FoxWatchBlueprintComponentReference> componentLookup)
    {
        var cueCount = 0;
        var xScore = 0.0;
        var yScore = 0.0;
        var normalizedBodyName = NormalizeName(bodyReference.ComponentName);

        foreach (var componentReference in componentLookup.Values)
        {
            var normalizedComponentName = NormalizeName(componentReference.ComponentName);
            if (string.IsNullOrWhiteSpace(normalizedComponentName) ||
                string.Equals(normalizedComponentName, normalizedBodyName, StringComparison.OrdinalIgnoreCase) ||
                !IsForwardCueComponent(componentReference) ||
                !TryResolvePlanarTransform(componentReference, componentLookup, new HashSet<string>(StringComparer.OrdinalIgnoreCase), out var componentTransform))
            {
                continue;
            }

            var deltaX = componentTransform.X - bodyTransform.X;
            var deltaY = componentTransform.Y - bodyTransform.Y;
            var absX = Math.Abs(deltaX);
            var absY = Math.Abs(deltaY);
            var dominantAxis = Math.Max(absX, absY);
            if (dominantAxis < 20.0)
            {
                continue;
            }

            var weight = IsSpotlightCue(componentReference) ? 1.25 : 1.0;
            xScore += absX * weight;
            yScore += absY * weight;
            var yawAxisScore = ResolveCueYawAxisScore(componentTransform.YawDegrees);
            xScore += yawAxisScore.X * weight;
            yScore += yawAxisScore.Y * weight;
            cueCount += 1;
        }

        return cueCount >= 2 && yScore > (xScore * 1.1) && (yScore - xScore) > 40.0;
    }

    private static PlanarAxisScore ResolveCueYawAxisScore(double yawDegrees)
    {
        var normalizedYaw = NormalizeDegrees(yawDegrees);
        var xAlignment = Math.Max(
            ComputeAxisAlignment(normalizedYaw, 0.0),
            ComputeAxisAlignment(normalizedYaw, 180.0));
        var yAlignment = Math.Max(
            ComputeAxisAlignment(normalizedYaw, 90.0),
            ComputeAxisAlignment(normalizedYaw, 270.0));

        return new PlanarAxisScore(xAlignment * 75.0, yAlignment * 75.0);
    }

    private static double ComputeAxisAlignment(double yawDegrees, double targetYawDegrees)
    {
        var deltaDegrees = Math.Abs(NormalizeDegrees(yawDegrees - targetYawDegrees));
        var wrappedDeltaDegrees = Math.Min(deltaDegrees, 360.0 - deltaDegrees);
        return Math.Max(0.0, 1.0 - (wrappedDeltaDegrees / 45.0));
    }

    private static double NormalizeDegrees(double degrees)
    {
        var normalized = degrees % 360.0;
        return normalized < 0 ? normalized + 360.0 : normalized;
    }

    private static bool IsForwardCueComponent(FoxWatchBlueprintComponentReference componentReference)
    {
        var normalizedType = NormalizeName(componentReference.ComponentType);
        if (normalizedType.Contains("vehicleseatcomponent", StringComparison.OrdinalIgnoreCase) ||
            normalizedType.Contains("spotlightcomponent", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var normalizedName = NormalizeName(componentReference.ComponentName);
        return normalizedName.Contains("headlight", StringComparison.OrdinalIgnoreCase)
            || normalizedName.Contains("spotlight", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSpotlightCue(FoxWatchBlueprintComponentReference componentReference)
    {
        var normalizedType = NormalizeName(componentReference.ComponentType);
        if (normalizedType.Contains("spotlightcomponent", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var normalizedName = NormalizeName(componentReference.ComponentName);
        return normalizedName.Contains("headlight", StringComparison.OrdinalIgnoreCase)
            || normalizedName.Contains("spotlight", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasMeaningfulRotation(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return TryParseRotator(value, out var parsedRotator)
            && parsedRotator.Any(component => Math.Abs(component) > 0.001);
    }

    private static bool TryParseRotator(string value, out double[] parsedValues)
    {
        parsedValues = [];

        var match = RotatorPattern.Match(value);
        if (!match.Success)
        {
            return false;
        }

        var values = new double[3];
        var labels = new[] { "pitch", "yaw", "roll" };
        for (var index = 0; index < labels.Length; index += 1)
        {
            if (!double.TryParse(match.Groups[labels[index]].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedValue))
            {
                return false;
            }

            values[index] = parsedValue;
        }

        parsedValues = values;
        return true;
    }

    private static bool TryParseVector(string value, out double[] parsedValues)
    {
        parsedValues = [];

        var match = VectorPattern.Match(value);
        if (!match.Success)
        {
            return false;
        }

        var values = new double[3];
        var labels = new[] { "x", "y", "z" };
        for (var index = 0; index < labels.Length; index += 1)
        {
            if (!double.TryParse(match.Groups[labels[index]].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedValue))
            {
                return false;
            }

            values[index] = parsedValue;
        }

        parsedValues = values;
        return true;
    }

    private static bool TryResolvePlanarTransform(
        FoxWatchBlueprintComponentReference componentReference,
        IReadOnlyDictionary<string, FoxWatchBlueprintComponentReference> componentLookup,
        ISet<string> ancestry,
        out PlanarTransform transform)
    {
        transform = default;

        var normalizedComponentName = NormalizeName(componentReference.ComponentName);
        if (string.IsNullOrWhiteSpace(normalizedComponentName) || !ancestry.Add(normalizedComponentName))
        {
            return false;
        }

        try
        {
            var relativeLocation = TryParseVector(componentReference.RelativeLocation, out var parsedLocation)
                ? parsedLocation
                : [0.0, 0.0, 0.0];
            var relativeRotation = TryParseRotator(componentReference.RelativeRotation, out var parsedRotation)
                ? parsedRotation
                : [0.0, 0.0, 0.0];
            var localTransform = new PlanarTransform(relativeLocation[0], relativeLocation[1], relativeRotation[1]);

            var normalizedParentName = NormalizeName(componentReference.AttachParentName);
            if (string.IsNullOrWhiteSpace(normalizedParentName) ||
                ancestry.Contains(normalizedParentName) ||
                !componentLookup.TryGetValue(normalizedParentName, out var parentReference) ||
                !TryResolvePlanarTransform(parentReference, componentLookup, ancestry, out var parentTransform))
            {
                transform = localTransform;
                return true;
            }

            var radians = parentTransform.YawDegrees * (Math.PI / 180.0);
            transform = new PlanarTransform(
                parentTransform.X + (relativeLocation[0] * Math.Cos(radians)) - (relativeLocation[1] * Math.Sin(radians)),
                parentTransform.Y + (relativeLocation[0] * Math.Sin(radians)) + (relativeLocation[1] * Math.Cos(radians)),
                parentTransform.YawDegrees + relativeRotation[1]);
            return true;
        }
        finally
        {
            ancestry.Remove(normalizedComponentName);
        }
    }

    private static string NormalizeName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || string.Equals(value, "None", StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }

        return string.Concat(value
            .Where(char.IsLetterOrDigit)
            .Select(char.ToLowerInvariant));
    }

    private readonly record struct PlanarTransform(double X, double Y, double YawDegrees);

    private readonly record struct PlanarAxisScore(double X, double Y);
}