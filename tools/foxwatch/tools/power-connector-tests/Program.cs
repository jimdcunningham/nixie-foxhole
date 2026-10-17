using System.Reflection;
using System.Text.Json;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

if (args.Length > 0) {
    using var input = JsonDocument.Parse(File.ReadAllText(args[0]));
    Environment.SetEnvironmentVariable("FOXWATCH_DECODED_INSPECTION_SNAPSHOT", Path.GetFullPath(args[0]));
    Environment.SetEnvironmentVariable("FOXWATCH_DECODED_PACKAGE_PAK_FINGERPRINT", input.RootElement.GetProperty("PakFingerprint").GetString());
}
var meshExporter = new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance, Options.Create(new FoxWatchOptions()));
var extractor = new FoxWatchRenderBlueprintSceneExtractor(meshExporter, NullLogger<FoxWatchRenderBlueprintSceneExtractor>.Instance);
var build = typeof(FoxWatchRenderBlueprintSceneExtractor).GetMethod("BuildExtraction", BindingFlags.Instance | BindingFlags.NonPublic)!;
FoxWatchBlueprintSceneExtraction Extract(IReadOnlyList<FoxWatchBlueprintComponentReference> components, string id = "test") =>
    (FoxWatchBlueprintSceneExtraction)build.Invoke(extractor, [id, id, "test.uasset", components, false])!;
IEnumerable<FoxWatchRenderSceneNode> Walk(FoxWatchRenderSceneNode node) => new[] { node }.Concat(node.Children.SelectMany(Walk));
void Check(bool pass, string message) { if (!pass) throw new Exception(message); }
List<FoxWatchBlueprintComponentReference> Fixture(bool socketVisible = false, bool connectorVisible = true,
    bool socketHidden = false, string parentType = "BuildSocketComponent", string parentMesh = "") => [
    new() { ComponentName = "StructureArrow", ComponentType = "ArrowComponent" },
    new() { ComponentName = "PowerSocket", ComponentType = parentType, AttachParentName = "StructureArrow",
        RelativeLocation = "X=-28.953 Y=489.747 Z=613.199", RelativeRotation = "P=0 Y=90 R=0",
        IsVisible = socketVisible, IsHiddenInGame = socketHidden, MeshPath = parentMesh },
    new() { ComponentName = "PowerLineConnector", ComponentType = "StaticMeshComponent", MeshType = "static",
        MeshPath = "War/Content/Meshes/Structures/PowerLineAttachment.uasset", AttachParentName = "PowerSocket",
        RelativeLocation = "X=-3.584 Y=-45.891 Z=-0.130", RelativeRotation = "P=90 Y=14.036263 R=104.03628",
        RelativeScale = "X=1 Y=1 Z=1", IsVisible = connectorVisible },
];

foreach (var visible in new[] { false, true }) {
    var source = Fixture(visible);
    var before = JsonSerializer.Serialize(source);
    var extraction = Extract(source);
    var nodes = Walk(extraction.Roots.Single()).ToArray();
    var socket = nodes.Single(node => node.Name == "PowerSocket");
    var connector = socket.Children.Single(node => node.Name == "PowerLineConnector");
    Check(socket.Visible && socket.MeshId == null && socket.MarkerSize == null, "Power socket must be a non-rendering transform, not a debug marker");
    Check(socket.UnrealLocationCentimeters!.SequenceEqual(new double[] {-28.953,489.747,613.199}), "Socket translation changed");
    Check(socket.UnrealRotationDegrees!.SequenceEqual(new double[] {0,90,0}), "Socket rotation changed");
    Check(connector.UnrealLocationCentimeters!.SequenceEqual(new double[] {-3.584,-45.891,-0.130}), "Connector local transform changed");
    Check(connector.MeshId == "mesh-powerlineattachment" && extraction.Meshes.Count == 1, "Expected exactly one source connector mesh");
    Check(JsonSerializer.Serialize(source) == before, "Extraction mutated the source socket visibility or transforms");
    Console.WriteLine($"PASS {(visible ? "visible" : "invisible")} socket retains its visible connector and exact hierarchy");
}
foreach (var fixture in new[] {Fixture(connectorVisible:false), Fixture(socketHidden:true),
    Fixture(parentType:"StaticMeshComponent", parentMesh:"War/Content/Meshes/Structures/Wall.uasset"),
    Fixture(parentMesh:"War/Content/Meshes/Structures/Wall.uasset")}) {
    Check(!Walk(Extract(fixture).Roots.Single()).Any(node => node.Name == "PowerLineConnector"), "Explicitly hidden geometry or an ordinary hidden parent was resurrected");
}
Console.WriteLine("PASS hidden connectors, hidden-in-game sockets and hidden mesh parents remain excluded");

// Optional real-data gate: use the same PAK-addressed inspection snapshot as generation.
if (args.Length > 0) {
    using var snapshot = JsonDocument.Parse(File.ReadAllText(args[0]));
    foreach (var id in new[] {"Refinery1","Refinery2","RefineryCoal","RefineryOil","FactoryAircraft","FactoryAmmo","FactorySmallArms","VehicleFactory1","Crane"}) {
        var path = $"War/Content/Blueprints/Structures/Facilities/BPFacility{id}.uasset";
        var components = snapshot.RootElement.GetProperty("BlueprintComponents").GetProperty(path)
            .Deserialize<List<FoxWatchBlueprintComponentReference>>()!;
        var before = JsonSerializer.Serialize(components);
        var result = Extract(components, "facility" + id.ToLowerInvariant());
        var socket = Walk(result.Roots.Single()).Single(node => node.Name == "PowerSocket");
        Check(socket.Children.Count(node => node.Name == "PowerLineConnector" && node.MeshId != null) == 1, $"{id} connector missing or duplicated");
        Check(result.Meshes.Count(mesh => mesh.SourcePath?.EndsWith("/PowerLineAttachment.glb") == true) == 1, $"{id} connector resource missing or duplicated");
        Check(JsonSerializer.Serialize(components) == before, $"{id} source inspection changed");
        Console.WriteLine($"PASS real Blueprint {id} retains one connector under its source socket");
    }
}
