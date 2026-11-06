using System.Reflection;
using CUE4Parse.UE4.Objects.Engine;
using FoxWatchService;
using Newtonsoft.Json.Linq;

void Check(bool value, string message) { if (!value) throw new Exception(message); }
var type = typeof(FoxWatchManifestAssetExtractor);
var flags = BindingFlags.NonPublic | BindingFlags.Static;
var eligible = type.GetMethod("IsStructureVolumeComponent", flags)!;
var category = type.GetMethod("ClassifyStructureVolumeCategory", flags)!;
var property = type.GetMethod("GetNamedValue", flags)!;
var temp = Path.Combine(Path.GetTempPath(), "foxwatch-volumes-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try {
    var extractor = new FoxWatchManifestAssetExtractor(temp);
    var extract = type.GetMethod("ExtractStructureVolume", BindingFlags.NonPublic | BindingFlags.Instance)!;
    var blueprint = new UBlueprintGeneratedClass { Name = "Fixture_C" };
    JObject Component(string componentType, string name = "Generic") => new() {
        ["Type"] = componentType, ["Name"] = name,
        ["Properties"] = new JObject {
            ["BoxExtent"] = new JObject { ["X"] = 300, ["Y"] = 300, ["Z"] = 300 },
            ["RelativeLocation"] = new JObject { ["X"] = 0, ["Y"] = 0, ["Z"] = 300 }
        }
    };
    foreach (var (componentType, expected) in new[] {
        ("SeatTriggerComponent", "seatTrigger"), ("RailSwitchUseComponent", "useArea"),
        ("BPStructureInteriorArea_C", "interiorArea"), ("BPKillVolume_C", "killVolume"),
        ("DockComponent", "docking"), ("BPLoadingAreaBox_C", "loadingArea"),
        ("BPNoBuildBoxComponent_C", "noBuild"), ("TemperatureModifierBoxComponent", "temperature"),
        ("BPIceBlockerBoxComponent_C", "iceBlocker"), ("BoatHullComponent", "other")
    }) {
        var component = Component(componentType);
        Check((bool)eligible.Invoke(null, [component])!, $"Dropped authored box: {componentType}");
        Check((string)category.Invoke(null, ["Generic", componentType])! == expected, $"Wrong category: {componentType}");
        var volume = (FoxWatchManifestStructureVolume)extract.Invoke(extractor,
            [new object[] {component}, blueprint, component, new Dictionary<string, object>()])!;
        Check(volume.Category == expected && volume.Width == 300 && volume.Length == 300 && volume.Height == 300 && volume.Z == 300,
            $"Lost geometry or category: {componentType}");
    }
    var crane = Component("SeatTriggerComponent", "CraneOccupiableComponentTrigger_GEN_VARIABLE");
    var craneVolume = (FoxWatchManifestStructureVolume)extract.Invoke(extractor,
        [new object[] {crane}, blueprint, crane, new Dictionary<string, object>()])!;
    Check(craneVolume.Label == "Seat Trigger" && craneVolume.Category == "seatTrigger", "Crane entry trigger lost its label");
    Check(!(bool)eligible.Invoke(null, [Component("BPBuildFootprintBoxComponent_C")])!, "Duplicated dedicated build footprints");
    var missing = new JObject { ["Type"] = "SeatTriggerComponent", ["Name"] = "Missing" };
    Check(!(bool)eligible.Invoke(null, [missing])!, "Invented native trigger extents");
    Check((string)category.Invoke(null, ["UseAreaBox", "BoxComponent"])! == "useArea", "Changed existing use-area category");
    Console.WriteLine("Structure-volume extraction checks passed (10 component classes, crane geometry, missing extents, footprint exclusion).");
    // Optional audit against a decoded bundle. Report source records, not distinct shipped assets.
    if (args.Length > 0) {
        var counts = new SortedDictionary<string, int>();
        var missingCounts = new SortedDictionary<string, int>();
        foreach (var path in Directory.EnumerateFiles(args[0], "*.json", SearchOption.AllDirectories)) {
            if (JToken.Parse(File.ReadAllText(path)) is not JArray objects) continue;
            foreach (var component in objects.OfType<JObject>()) {
                var componentType = (string?)component["Type"] ?? "";
                if ((bool)eligible.Invoke(null, [component])! && !componentType.Contains("BoxComponent", StringComparison.OrdinalIgnoreCase))
                    counts[componentType] = counts.GetValueOrDefault(componentType) + 1;
                if (componentType == "SeatTriggerComponent" && property.Invoke(null, [component, "BoxExtent"]) == null)
                    missingCounts[componentType] = missingCounts.GetValueOrDefault(componentType) + 1;
            }
        }
        Console.WriteLine("Previously excluded explicit boxes: " + JObject.FromObject(counts));
        Console.WriteLine("Unresolved native/default extents: " + JObject.FromObject(missingCounts));
    }
} finally { Directory.Delete(temp, true); }
