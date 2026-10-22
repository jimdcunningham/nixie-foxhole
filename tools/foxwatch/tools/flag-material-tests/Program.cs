using FoxWatchService;
const string plane = "War/Content/Meshes/Measurement/Plane.uasset";
foreach (var name in new[] { "Flag", "Flag2", "Flag12", "flag3" })
    if (!FoxWatchFlagMaterialPolicy.IsAuthoredPlane(name, plane)) throw new Exception($"Authored cloth override lost for {name}");
foreach (var name in new[] { "Flagship", "Flagship2", "OtherFlag", "Plane" })
    if (FoxWatchFlagMaterialPolicy.IsAuthoredPlane(name, plane)) throw new Exception($"Unrelated component matched: {name}");
if (FoxWatchFlagMaterialPolicy.IsAuthoredPlane("Flag2", "Other/Plane.uasset")) throw new Exception("Unrelated mesh matched");
Console.WriteLine("PASS numbered flag materials retain exact native plane identity");
