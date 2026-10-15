using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Objects.UObject;

namespace FoxWatchService;

/// <summary>Authored local-light defaults; transforms remain in the component scene hierarchy.</summary>
public sealed record FoxWatchRenderSceneLight
{
    public string Type { get; init; } = "point";
    public bool Enabled { get; init; } = true;
    public double Intensity { get; init; }
    public string IntensityUnits { get; init; } = "Unitless";
    public List<double> Color { get; init; } = [1, 1, 1];
    public double AttenuationRadius { get; init; }
    public double InnerConeAngle { get; init; }
    public double OuterConeAngle { get; init; }
    public bool UseInverseSquaredFalloff { get; init; } = true;
    public double LightFalloffExponent { get; init; } = 8;
    public double SourceRadius { get; init; }
    public double SoftSourceRadius { get; init; }
    public double SourceLength { get; init; }
    public bool UseTemperature { get; init; }
    public double Temperature { get; init; } = 6500;
    public bool CastShadows { get; init; }
}

public static class FoxWatchBlueprintLights
{
    // Resolve each property independently: an explicit zero/false overrides every ancestor.
    private static IEnumerable<UObject> Sources(UObject component)
    {
        var visited = new HashSet<UObject>();
        var queue = new Queue<UObject>(); queue.Enqueue(component);
        while (queue.Count > 0 && visited.Count < 128)
        {
            var current = queue.Dequeue();
            if (!visited.Add(current)) continue;
            yield return current;
            UObject? template = null;
            try { template = current.Template?.Object?.Value; } catch { }
            if (template != null) queue.Enqueue(template);
        }
        var type = component.Class?.TryLoad<UClass>(out var loaded) == true ? loaded : null;
        var classes = new HashSet<UClass>();
        while (type != null && classes.Add(type) && classes.Count < 128)
        {
            if (type.ClassDefaultObject?.TryLoad<UObject>(out var defaults) == true && visited.Add(defaults)) yield return defaults;
            type = type.SuperStruct?.TryLoad<UClass>(out var parent) == true ? parent : null;
        }
    }

    public static FoxWatchRenderSceneLight? Extract(UObject component)
    {
        var type = component.Class?.TryLoad<UClass>(out var loaded) == true ? loaded : null;
        var names = new List<string> { component.ExportType };
        var visited = new HashSet<UClass>();
        while (type != null && visited.Add(type) && visited.Count < 128)
        {
            names.Add(type.Name);
            type = type.SuperStruct?.TryLoad<UClass>(out var parent) == true ? parent : null;
        }
        var spot = names.Any(n => n.Contains("SpotLightComponent", StringComparison.OrdinalIgnoreCase));
        if (!spot && !names.Any(n => n.Contains("PointLightComponent", StringComparison.OrdinalIgnoreCase))) return null;
        var sources = Sources(component).ToArray();
        T Read<T>(string name, T fallback)
        {
            var source = sources.FirstOrDefault(s => s.Properties.Any(p => string.Equals(p.Name.Text, name, StringComparison.OrdinalIgnoreCase)));
            return source == null ? fallback : source.GetOrDefault(name, fallback);
        }
        var color = Read("LightColor", new FColor(255, 255, 255, 255));
        var inverse = Read("bUseInverseSquaredFalloff", true);
        return new FoxWatchRenderSceneLight
        {
            Type = spot ? "spot" : "point",
            Enabled = Read("bVisible", true) && !Read("bHiddenInGame", false) && Read("bAffectsWorld", true),
            Intensity = Read("Intensity", Read("Brightness", 1f)),
            IntensityUnits = (inverse ? Read("IntensityUnits", ELightUnits.Unitless) : ELightUnits.Unitless).ToString(),
            Color = [color.R / 255.0, color.G / 255.0, color.B / 255.0],
            AttenuationRadius = Read("AttenuationRadius", 1000f),
            InnerConeAngle = Read("InnerConeAngle", 0f), OuterConeAngle = Read("OuterConeAngle", 44f),
            UseInverseSquaredFalloff = inverse, LightFalloffExponent = Read("LightFalloffExponent", 8f),
            SourceRadius = Read("SourceRadius", 0f), SoftSourceRadius = Read("SoftSourceRadius", 0f), SourceLength = Read("SourceLength", 0f),
            UseTemperature = Read("bUseTemperature", false), Temperature = Read("Temperature", 6500f), CastShadows = Read("CastShadows", true),
        };
    }
}
