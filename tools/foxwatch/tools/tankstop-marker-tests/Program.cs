using System.Reflection;
using System.Text.Json;
using FoxWatchService;

int passed = 0;
void Check(bool condition, string description) { if (!condition) throw new Exception(description); passed++; }
var structure = new FoxWatchManifestStructure { Id = "tankstopsplinet3", Connector = new()
{
    MeshConfigs = [new() { Mode = "ESplineConnectorMeshMode::Interval", Interval = 375,
        RelativeScale = [1,1,1], RelativeLocation = [0,0,0],
        MeshPaths = Enumerable.Range(1,4).Select(i => $"War/Content/Meshes/Pickups/TankStopT3_{i}.uasset").ToList() }]
} };
var preview = new FoxWatchBlueprintSceneExtraction { Roots = [
    new() { Id="first", Name="TankStopT3_1", MeshId="mesh-tankstopt3_1" },
    new() { Id="second", Name="TankStopT3_2", MeshId="mesh-tankstopt3_2", UnrealLocationCentimeters=[375,0,0] },
] };
var flags = BindingFlags.Static | BindingFlags.NonPublic;
var idsMethod = typeof(FoxWatchRenderSceneGenerator).GetMethod("GetStandaloneStructureRenderLayerIds", flags)!;
var sceneMethod = typeof(FoxWatchRenderSceneGenerator).GetMethod("CreateTopdownStructureComponentScene", flags)!;
var ids = (IReadOnlyList<string>)idsMethod.Invoke(null, [structure])!;
Check(ids.SequenceEqual(new[]{"span","spanalt","spanalt2","spanalt3"}), "all four native layers independent of two-piece preview");
var before = JsonSerializer.Serialize(preview);
for (int i=0; i<4; i++)
{
    var scene = (FoxWatchBlueprintSceneExtraction)sceneMethod.Invoke(null, [structure, preview, ids[i]])!;
    Check(scene.Roots.Count==1 && scene.Meshes.Count==1, "one isolated native marker per layer");
    Check(scene.Roots[0].MeshId==$"mesh-tankstopt3_{i+1}", "native mesh ordering retained");
    Check(scene.Meshes[0].SourcePath==$"War/Content/Meshes/Pickups/TankStopT3_{i+1}.glb", "exact native path retained");
    Check(scene.Roots[0].Scale!.SequenceEqual(new double[]{1,1,1}), "rigid native scale retained");
    Check(scene.Roots[0].UnrealLocationCentimeters!.SequenceEqual(new double[]{0,0,0}), "independent marker origin retained");
}
Check(JsonSerializer.Serialize(preview)==before, "preview tree remains unchanged");
Check(sceneMethod.Invoke(null,[structure,preview,"spanalt4"])==null, "unknown variant cannot invent geometry");
structure.Id="minespline";
Check(((IReadOnlyList<string>)idsMethod.Invoke(null,[structure])!).SequenceEqual(new[]{"span","spanalt"}), "mine layer behavior preserved");
Console.WriteLine(JsonSerializer.Serialize(new { passed, failed=0 }));
