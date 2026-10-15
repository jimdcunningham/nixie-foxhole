namespace FoxWatchService;

using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using CUE4Parse.UE4.Objects.Core.Math;

/// <summary>Owned native target binding for a static authored-span catalog render.</summary>
public static class FoxWatchNativeModificationSplineTarget
{
    public static FoxWatchManifestModificationSplineTarget? Resolve(
        bool? overridesTarget, string slotName, string? targetName,
        IReadOnlyList<FoxWatchBlueprintComponentReference> components)
    {
        if (overridesTarget != true) return null;
        if (string.IsNullOrWhiteSpace(targetName) || targetName.Equals("None", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Native spline override '{slotName}' has no target component.");
        var slot = Unique(components, slotName);
        var separator = slot.ComponentName.LastIndexOf(':');
        var qualifiedTarget = separator >= 0 && !targetName.Contains(':')
            ? slot.ComponentName[..(separator + 1)] + targetName : targetName;
        var target = Unique(components, qualifiedTarget);
        var slotWorld = World(slot, components, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        var targetWorld = World(target, components, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
        if (!Matrix4x4.Invert(slotWorld, out var inverse))
            throw new InvalidOperationException($"Native spline slot '{slotName}' has a singular transform.");
        var local = Vector3.Transform(Vector3.Transform(Vector3.Zero, targetWorld), inverse);
        if (!float.IsFinite(local.X) || !float.IsFinite(local.Y) || !float.IsFinite(local.Z) || local.LengthSquared() < 0.000001f)
            throw new InvalidOperationException($"Native spline target '{targetName}' is invalid or zero length.");
        return new FoxWatchManifestModificationSplineTarget
        {
            SlotComponentName = slot.ComponentName,
            TargetComponentName = target.ComponentName,
            LocalTargetCentimeters = [local.X, local.Y, local.Z],
        };
    }

    public static List<FoxWatchBlueprintComponentReference> CloneTemplateWithTarget(
        IReadOnlyList<FoxWatchBlueprintComponentReference> cachedTemplate,
        FoxWatchManifestModificationSplineTarget target)
    {
        var clone = JsonSerializer.Deserialize<List<FoxWatchBlueprintComponentReference>>(JsonSerializer.Serialize(cachedTemplate))!;
        var endpoint = new Vector3((float)target.LocalTargetCentimeters[0], (float)target.LocalTargetCentimeters[1], (float)target.LocalTargetCentimeters[2]);
        var connectors = clone.Where(component => component.SplineConnectorMeshConfigs.Count > 0).ToList();
        if (connectors.Count == 0) throw new InvalidOperationException("Authored Sandbags target has no template spline connector.");
        foreach (var connector in connectors)
        {
            if (!Matrix4x4.Invert(World(connector, clone, new HashSet<string>(StringComparer.OrdinalIgnoreCase)), out var inverse))
                throw new InvalidOperationException("Sandbags template connector has a singular transform.");
            var local = Vector3.Transform(endpoint, inverse);
            connector.SplineDefaultTargetUnrealLocationCentimeters = [local.X, local.Y, local.Z];
        }
        return clone;
    }

    public static string ContextKey(string variantId, string slotName)
    {
        var variant = variantId.Trim().ToLowerInvariant();
        var slot = slotName.Trim().ToLowerInvariant();
        if (!Regex.IsMatch(variant, "^[a-z0-9_-]+$") || !Regex.IsMatch(slot, "^[a-z0-9_]+$"))
            throw new InvalidOperationException("Unsafe native modification render context key.");
        return $"{variant}--slot-{slot}";
    }

    private static FoxWatchBlueprintComponentReference Unique(IReadOnlyList<FoxWatchBlueprintComponentReference> components, string name)
    {
        var matches = components.Where(component => string.Equals(component.ComponentName, name, StringComparison.OrdinalIgnoreCase)
            || (!name.Contains(':') && string.Equals(component.ComponentName.Split(':').Last(), name, StringComparison.OrdinalIgnoreCase))).ToList();
        if (matches.Count != 1) throw new InvalidOperationException($"Native spline component '{name}' resolved {matches.Count} times.");
        return matches[0];
    }

    private static Matrix4x4 World(FoxWatchBlueprintComponentReference component,
        IReadOnlyList<FoxWatchBlueprintComponentReference> components, HashSet<string> ancestry)
    {
        if (!ancestry.Add(component.ComponentName) || ancestry.Count > 128)
            throw new InvalidOperationException("Native spline component attachment cycle.");
        if (!string.IsNullOrWhiteSpace(component.AttachSocketName) && !component.AttachSocketName.Equals("None", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Native spline socket attachment requires an authored pose; refusing an approximation.");
        try
        {
            // Existing inspection output already includes full inherited native TRS.
            if (!string.IsNullOrWhiteSpace(component.AbsoluteLocation) && !string.IsNullOrWhiteSpace(component.AbsoluteRotation)
                && !string.IsNullOrWhiteSpace(component.AbsoluteScale))
                return Matrix(component.AbsoluteLocation, component.AbsoluteRotation, component.AbsoluteScale);
            var local = Matrix(component.RelativeLocation, component.RelativeRotation, component.RelativeScale);
            var parentName = component.AttachParentName;
            if (string.IsNullOrWhiteSpace(parentName) || parentName.Equals("None", StringComparison.OrdinalIgnoreCase)) return local;
            if (!parentName.Contains(':') && component.ComponentName.Contains(':'))
                parentName = component.ComponentName[..(component.ComponentName.LastIndexOf(':') + 1)] + parentName;
            return local * World(Unique(components, parentName), components, ancestry);
        }
        finally { ancestry.Remove(component.ComponentName); }
    }

    private static Matrix4x4 Matrix(string position, string rotation, string scale)
    {
        static float Value(string text, string key, float fallback)
        {
            if (string.IsNullOrWhiteSpace(text)) return fallback;
            var match = Regex.Match(text, $@"\b{key}\s*=\s*([-+0-9.eE]+)");
            if (!match.Success || !float.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || !float.IsFinite(value))
                throw new InvalidOperationException($"Invalid native transform '{text}'.");
            return value;
        }
        var native = new FRotator(Value(rotation, "P", 0), Value(rotation, "Y", 0), Value(rotation, "R", 0)).Quaternion();
        return Matrix4x4.CreateScale(Value(scale, "X", 1), Value(scale, "Y", 1), Value(scale, "Z", 1))
            * Matrix4x4.CreateFromQuaternion(new Quaternion((float)native.X, (float)native.Y, (float)native.Z, (float)native.W))
            * Matrix4x4.CreateTranslation(Value(position, "X", 0), Value(position, "Y", 0), Value(position, "Z", 0));
    }
}
