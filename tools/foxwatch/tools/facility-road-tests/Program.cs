using System.Reflection;
using System.Text.Json;
using FoxWatchService;

var passed = 0;
void Check(bool ok, string description) {
    if (!ok) throw new Exception(description);
    passed++;
    Console.WriteLine("PASS " + description);
}
FoxWatchSplineConnectorMeshConfigReference Config(string name, double z = 5) => new() {
    Mode = "ESplineConnectorMeshMode::Spline",
    MeshPaths = [$"War/Content/Meshes/Structures/{name}.uasset"],
    SplineMeshAxis = "ESplineMeshAxis::X", NativeMeshLengthCentimeters = 450,
    RelativeLocation = [0, 0, z], RelativeRotation = [0, 0, 0], RelativeScale = [1, 1, 1],
};
var reference = new FoxWatchBlueprintComponentReference {
    ComponentName = "SplineConnector", SplineDefaultTargetUnrealLocationCentimeters = [500, 0, 0],
    SplineConnectorMeshConfigs = [Config("FacilityRoad_Test"), Config("FacilityRoad_Test"), Config("FacilityRoadEnd")],
};
var original = JsonSerializer.Serialize(reference);
var append = typeof(FoxWatchRenderBlueprintSceneExtractor).GetMethod("AppendSplineConnectorNodes", BindingFlags.Static | BindingFlags.NonPublic)!;
FoxWatchRenderSceneNode Generate(string asset) {
    var root = new FoxWatchRenderSceneNode();
    append.Invoke(null, [asset, root, reference, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)]);
    return root;
}
var road = Generate("facilityroad");
Check(road.Children.Count == 2, "native duplicate road body is rendered once");
Check(road.Children[1].Id.EndsWith("spline-mesh-2"), "authored cap identity is preserved");
Check(road.Children.Select(n => n.Name).SequenceEqual(new[] {"FacilityRoad_Test", "FacilityRoadEnd"}), "authored endpoint mesh remains in the scene");
Check(road.Children.All(n => n.UnrealLocationCentimeters!.SequenceEqual(new double[] {0, 0, 5})), "native component offsets remain unchanged");
Check(road.Children.All(n => Math.Abs(n.Scale![0] - 500.0 / 450.0) < 0.000001), "existing spline deformation remains unchanged");
Check(JsonSerializer.Serialize(reference) == original, "native inspection input remains unchanged");
Check(Generate("unrelatedroad").Children.Count == 3, "unrelated asset generation remains unchanged");
reference.SplineConnectorMeshConfigs[1].RelativeLocation = [0, 0, 6];
Check(Generate("facilityroad").Children.Count == 3, "distinct road transforms are retained");
reference.SplineConnectorMeshConfigs[1].RelativeLocation = [0, 0, 5];
reference.SplineConnectorMeshConfigs[1].RelativeRotation = [0, 180, 0];
Check(Generate("facilityroad").Children.Count == 3, "distinct road rotations are retained");
reference.SplineConnectorMeshConfigs[1].RelativeRotation = [0, 0, 0];
reference.SplineConnectorMeshConfigs[1].RelativeScale = [1, 2, 1];
// Spline stretching preserves the authored cross-axis scale.
Check(Generate("facilityroad").Children.Count == 3, "distinct road scales are retained");
Console.WriteLine($"PASS {passed} assertions");

var source = new FoxWatchBlueprintSceneExtraction {
    Roots = [road],
    Meshes = [new() {Id="body",SourcePath="War/Content/Meshes/Structures/FacilityRoad_Test.glb"},
        new() {Id="cap",SourcePath="War/Content/Meshes/Structures/FacilityRoadEnd.glb"}],
};
var sourceBefore = JsonSerializer.Serialize(source);
var prototype = typeof(FoxWatchRenderSceneGenerator).GetMethod("CreateFacilityRoadPrototypeScene",BindingFlags.Static|BindingFlags.NonPublic)!;
var sections = (FoxWatchBlueprintSceneExtraction)prototype.Invoke(null,[source])!;
Check(sections.Roots.Single().Children.Select(n=>n.MeshId).SequenceEqual(new[]{"cap","body","cap"}),"native endpoint meshes stay outside the repeating body");
Check(sections.Roots.Single().Children.Select(n=>n.UnrealLocationCentimeters![0]).SequenceEqual(new double[]{450,450,900}),"450cm caps replace the first and last native intervals");
Check(sections.Roots.Single().Children.Select(n=>n.UnrealRotationDegrees![1]).SequenceEqual(new double[]{180,0,0}),"start cap reverses while the front cap keeps native direction");
Check(sections.Roots.Single().Children.All(n=>n.Scale!.SequenceEqual(new double[]{1,1,1})),"450cm body tile preserves native UV density");
Check(JsonSerializer.Serialize(source)==sourceBefore,"prototype assembly preserves the inspected native source");
Console.WriteLine($"PASS {passed} assertions");

if (args.Length == 2)
{
    var exporter = new FoxWatchAssetMeshExporter(
        Microsoft.Extensions.Logging.Abstractions.NullLogger<FoxWatchAssetMeshExporter>.Instance,
        Microsoft.Extensions.Options.Options.Create(new FoxWatchOptions { PakDirectoryPath = args[0] }));
    var components = await exporter.InspectBlueprintComponentsAsync("War/Content/Blueprints/Structures/Facilities/BPFacilityRoad.uasset");
    var native = components.Single(c => c.ComponentName == "SplineConnector").SplineConnectorMeshConfigs;
    Check(native[0].SplineMaterialScaling is {Count: 2}, "native typed Vector2D material scaling is preserved");
    Check(Math.Abs(native[0].SplineMaterialScaling![1] - 0.002222) < 0.000000001, "native road body retains authored longitudinal UV scaling");
    Check(native.Last().SplineMaterialScaling!.SequenceEqual(new double[] {0,0}), "native cap keeps unit UVs without length-dependent scaling");
    File.WriteAllText(args[1], JsonSerializer.Serialize(native, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine($"PASS {passed} assertions including fresh native PAK inspection");
}
