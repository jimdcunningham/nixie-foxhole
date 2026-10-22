using System.Reflection;
using FoxWatchService;
var bind = typeof(FoxWatchRenderSceneGenerator).GetMethod("ApplyNativeIvyMaterialBindings", BindingFlags.Static | BindingFlags.NonPublic)!;
void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
FoxWatchRenderSceneMeshAsset Mesh(string path) => new() { Id = "test", SourcePath = path };
var meshes = new[] { Mesh("War/Content/Meshes/Environment/Foliage/Ivy07.glb"), Mesh("War/Content/Meshes/Environment/Foliage/Ivy15.glb"), Mesh("War/Content/Meshes/Environment/Foliage/Ivy03.glb"), Mesh("Other/Ivy07.glb") };
bind.Invoke(null, [meshes]);
foreach (var mesh in meshes.Take(2)) Check(mesh.MaterialSidecarNameOverridesByVariant!["default"][0] == "War/Content/Materials/Environment/Props/Ivy.uasset", "House ivy lost its native material identity");
Check(meshes[2].MaterialSidecarNameOverridesByVariant!["default"].Count == 2 && meshes[2].MaterialSidecarNameOverridesByVariant!["default"][1].EndsWith("IVy2.uasset"), "Two-slot atlas ivy was conflated with Props/Ivy");
Check(meshes[3].MaterialSidecarNameOverridesByVariant == null, "Unrelated same-basename mesh was rebound");
meshes[0].MaterialSidecarNameOverridesByVariant!["default"][0] = "Authored/Override.uasset";
meshes[0].MaterialSidecarNameOverridesByVariant!["snow"] = new() { [0] = "Authored/Snow.uasset" };
bind.Invoke(null, [meshes]);
Check(meshes[0].MaterialSidecarNameOverridesByVariant!["default"][0] == "Authored/Override.uasset" && meshes[0].MaterialSidecarNameOverridesByVariant!["snow"][0] == "Authored/Snow.uasset", "Explicit slot or variant override was replaced");
Check(meshes[0].MaterialPackagePathsByVariant!["default"].SequenceEqual(new[] { "Authored/Override.uasset" }), "Export dependencies differ from selected slot bindings");
Console.WriteLine("PASS native ivy bindings across buildings, exact paths, multi-slot meshes and authored overrides");
