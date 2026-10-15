using System.Reflection;
using System.Text.Json;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.UObject;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

var keepAlive = new List<ResolvedObject>();
FPackageIndex Index(UObject? value)
{
    if (value == null) return new FPackageIndex();
    var resolved = new ResolvedLoadedObject(value); keepAlive.Add(resolved);
    var index = new FPackageIndex((IPackage)null!, 1);
    typeof(FPackageIndex).GetField("_resolvedObject", BindingFlags.Instance | BindingFlags.NonPublic)!
        .SetValue(index, new WeakReference<ResolvedObject?>(resolved));
    return index;
}
void ObjectProperty(UObject target, string name, UObject? value) => target.Properties.Add(new FPropertyTag
    { Name = new FName(name), PropertyType = new FName("ObjectProperty"), Tag = new ObjectProperty(Index(value)) });
void VectorProperty(UObject target, string name, FVector value) => target.Properties.Add(new FPropertyTag
    { Name = new FName(name), PropertyType = new FName("StructProperty"), Tag = new StructProperty(new FScriptStruct(value)) });
UClass Class(string name, UObject? defaults = null, UClass? parent = null) => new()
    { Name = name, ClassDefaultObject = Index(defaults), SuperStruct = Index(parent) };
var native = Class("SkeletalMeshComponent");
var mesh = new UObject { Name = "War/Content/Meshes/Structures/SK_Test.SK_Test" };
var animation = new UObject { Name = "War/Content/Animation/ABP_Test.ABP_Test_C" };
UObject Defaults(UObject? meshValue, UObject? animationValue)
{
    var defaults = new UObject(); ObjectProperty(defaults, "SkeletalMesh", meshValue); ObjectProperty(defaults, "AnimClass", animationValue); return defaults;
}
UObject Instance(UClass? type, bool location = true)
{
    var component = new UObject { Name = "Arm", Class = type == null ? null : new ResolvedLoadedObject(type) };
    if (location) VectorProperty(component, "RelativeLocation", new FVector(12, 34, 56));
    return component;
}
var exporter = new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance, Options.Create(new FoxWatchOptions()));
var create = typeof(FoxWatchAssetMeshExporter).GetMethods(BindingFlags.Instance | BindingFlags.NonPublic)
    .Single(method => method.Name == "CreateBlueprintComponentReference" && method.GetParameters()[1].ParameterType == typeof(UObject));
FoxWatchBlueprintComponentReference Extract(UObject instance) => (FoxWatchBlueprintComponentReference)create.Invoke(exporter, ["Arm", instance, true])!;
void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
var passed = 0;
async Task Test(string name, Func<Task> test)
{
    await test(); passed++; Console.WriteLine("PASS " + name);
}
Task Sync(Action action) { action(); return Task.CompletedTask; }
var derived = Class("BPArm_C", Defaults(mesh, animation), native);
await Test("custom class inherits exact mesh and animation while keeping instance location", () => Sync(() => {
    var reference = Extract(Instance(derived));
    Check(reference.MeshPath == "War/Content/Meshes/Structures/SK_Test.uasset", "Inherited mesh missing or wrong qualified identity");
    Check(reference.AnimationClassPath == "War/Content/Animation/ABP_Test.uasset", "Inherited animation missing");
    Check(reference.RelativeLocation.Contains("12.000") && reference.RelativeLocation.Contains("56.000"), "Instance local transform lost");
}));
await Test("typed skeletal component resolves its inherited mesh and animation", () => Sync(() => {
    var instance = new CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh.USkeletalMeshComponent { Name="Arm", Class=new ResolvedLoadedObject(derived) };
    VectorProperty(instance, "RelativeLocation", new FVector(12,34,56));
    var reference = Extract(instance);
    Check(reference.MeshType == "skeletal" && reference.MeshPath.EndsWith("SK_Test.uasset") && reference.AnimationClassPath.EndsWith("ABP_Test.uasset"), "Typed skeletal inheritance failed");
}));
await Test("typed skeletal explicit null does not acquire a class default", () => Sync(() => {
    var instance = new CUE4Parse.UE4.Assets.Exports.Component.SkeletalMesh.USkeletalMeshComponent { Name="Arm", Class=new ResolvedLoadedObject(derived) };
    VectorProperty(instance, "RelativeLocation", new FVector(12,34,56)); ObjectProperty(instance, "SkeletalMesh", null);
    Check(Extract(instance).MeshPath == "", "Typed null acquired inherited geometry");
}));
await Test("nearest class defaults override a more distant class", () => Sync(() => {
    var secondMesh = new UObject { Name = "War/Content/Meshes/SK_Near.SK_Near" };
    var nearAnimation = new UObject { Name = "War/Content/Animation/ABP_Near.ABP_Near_C" };
    var nearest = Class("BPNear_C", Defaults(secondMesh, nearAnimation), derived);
    var reference = Extract(Instance(nearest));
    Check(reference.MeshPath == "War/Content/Meshes/SK_Near.uasset" && reference.AnimationClassPath == "War/Content/Animation/ABP_Near.uasset", "Nearest mesh/animation CDO did not win");
}));
await Test("two-level inheritance fills absent class properties", () => Sync(() => {
    var nearest = Class("BPNear_C", new UObject(), derived);
    var reference = Extract(Instance(nearest));
    Check(reference.MeshPath.EndsWith("SK_Test.uasset") && reference.AnimationClassPath.EndsWith("ABP_Test.uasset"), "Superclass mesh/animation not inherited");
}));
await Test("explicit instance mesh and animation override class defaults", () => Sync(() => {
    var instance = Instance(derived); var ownMesh = new UObject { Name = "War/Content/Meshes/SK_Own.SK_Own" };
    var ownAnimation = new UObject { Name = "War/Content/Animation/ABP_Own.ABP_Own_C" };
    ObjectProperty(instance, "SkeletalMesh", ownMesh); ObjectProperty(instance, "AnimClass", ownAnimation);
    var reference = Extract(instance);
    Check(reference.MeshPath.EndsWith("SK_Own.uasset") && reference.AnimationClassPath.EndsWith("ABP_Own.uasset"), "Instance mesh/animation override lost");
}));
await Test("explicit null instance properties remain cleared", () => Sync(() => {
    var instance = Instance(derived); ObjectProperty(instance, "SkeletalMesh", null); ObjectProperty(instance, "AnimClass", null);
    var reference = Extract(instance); Check(reference.MeshPath == "" && reference.AnimationClassPath == "", "Explicit null fell through to CDO");
}));
await Test("explicit null nearest CDO blocks ancestor defaults", () => Sync(() => {
    var nearest = Class("BPCleared_C", Defaults(null, null), derived); var reference = Extract(Instance(nearest));
    Check(reference.MeshPath == "" && reference.AnimationClassPath == "", "CDO clear fell through to ancestor");
}));
await Test("unresolved class and cyclic ancestry retain empty instance behavior", () => Sync(() => {
    Check(Extract(Instance(null)).MeshPath == "", "Unresolved class invented mesh");
    var a = Class("BPCycleA_C", Defaults(mesh, animation)); var b = Class("BPCycleB_C", parent:a); a.SuperStruct = Index(b);
    Check(Extract(Instance(a)).MeshPath == "", "Cyclic class graph invented inheritance");
    var skeletalCycle = Class("SkeletalMeshComponent", Defaults(mesh, animation)); skeletalCycle.SuperStruct = Index(skeletalCycle);
    Check(Extract(Instance(skeletalCycle)).MeshPath == "", "Cyclic skeletal class graph accepted defaults");
}));
await Test("non-null unloadable superclass rejects inherited defaults", () => Sync(() => {
    var missing = new FPackageIndex((IPackage)null!, 123);
    Check(!missing.IsNull && !missing.TryLoad<UClass>(out _), "Fixture must model a non-null unloadable parent");
    var unresolvedNative = Class("SkeletalMeshComponent"); unresolvedNative.SuperStruct = missing;
    var custom = Class("BPUnresolvedParent_C", Defaults(mesh, animation), unresolvedNative);
    var reference = Extract(Instance(custom));
    Check(reference.MeshPath == "" && reference.AnimationClassPath == "", "Unresolved non-null parent was treated as a true root");
}));
await Test("unloadable nearer CDO fails closed without reading farther CDOs after a source", () => Sync(() => {
    var missing = new FPackageIndex((IPackage)null!, 456);
    Check(!missing.IsNull && !missing.TryLoad<UObject>(out _), "Fixture must model a non-null unloadable CDO");
    var unreadable = Class("BPUnreadable_C", parent:derived); unreadable.ClassDefaultObject = missing;
    var blocked = Extract(Instance(unreadable));
    Check(blocked.MeshPath == "" && blocked.AnimationClassPath == "", "Unreadable nearer CDO fell through to ancestor mesh/animation defaults");
    var nullDefaults = Class("BPNullDefaults_C", parent:derived); var inherited = Extract(Instance(nullDefaults));
    Check(inherited.MeshPath.EndsWith("SK_Test.uasset") && inherited.AnimationClassPath.EndsWith("ABP_Test.uasset"), "Null CDO blocked valid ancestor defaults");
    var explicitInstance = Instance(unreadable); ObjectProperty(explicitInstance, "SkeletalMesh", mesh); ObjectProperty(explicitInstance, "AnimClass", animation);
    var explicitReference = Extract(explicitInstance);
    Check(explicitReference.MeshPath.EndsWith("SK_Test.uasset") && explicitReference.AnimationClassPath.EndsWith("ABP_Test.uasset"), "Unreadable CDO overrode explicit instance properties");
    var farther = Class("SkeletalMeshComponent"); farther.ClassDefaultObject = missing;
    var nearest = Class("BPNearReadable_C", Defaults(mesh, animation), farther);
    var resolved = Extract(Instance(nearest));
    Check(resolved.MeshPath.EndsWith("SK_Test.uasset") && resolved.AnimationClassPath.EndsWith("ABP_Test.uasset"), "Farther unreadable CDO invalidated an already resolved nearest source");
}));
await Test("non-skeletal custom class does not inherit arbitrary mesh properties", () => Sync(() => {
    var unrelated = Class("BPUnrelated_C", Defaults(mesh, animation), Class("SceneComponent"));
    Check(Extract(Instance(unrelated)).MeshPath == "", "Non-skeletal CDO was misclassified");
}));
await Test("explicit animation survives generic local-transform branch", () => Sync(() => {
    var instance = Instance(null); ObjectProperty(instance, "AnimClass", animation);
    Check(Extract(instance).AnimationClassPath.EndsWith("ABP_Test.uasset"), "Explicit AnimClass discarded");
}));
await Test("old schema 3 inspection cannot cache away inherited geometry", () => Sync(() => {
    var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid()+".crane-cache.json");
    var previous = Environment.GetEnvironmentVariable("FOXWATCH_DECODED_INSPECTION_SNAPSHOT");
    try {
        File.WriteAllText(path, JsonSerializer.Serialize(new { SchemaVersion=3, PackagePaths=new[]{"War/Old.uasset"}, BlueprintComponents=new Dictionary<string,object>{{"War/Old.uasset",new[]{new{ComponentName="stale",MeshPath=""}}}} }));
        Environment.SetEnvironmentVariable("FOXWATCH_DECODED_INSPECTION_SNAPSHOT",path);
        var fresh = new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance, Options.Create(new FoxWatchOptions()));
        var cache = (System.Collections.IDictionary)typeof(FoxWatchAssetMeshExporter).GetField("_blueprintComponentReferencesByPackagePath",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(fresh)!;
        Check(cache.Count == 0, "Stale schema 3 component references accepted");
    } finally { Environment.SetEnvironmentVariable("FOXWATCH_DECODED_INSPECTION_SNAPSHOT",previous); File.Delete(path); }
}));
await Test("exact Dry Dock override poses both arms and preserves unrelated nodes", async () => {
    var loader = new FoxWatchPoseOverrideLoader(NullLogger<FoxWatchPoseOverrideLoader>.Instance);
    var generator = new FoxWatchRenderSceneGenerator(null!,null!,exporter,loader,NullLogger<FoxWatchRenderSceneGenerator>.Instance);
    var left = new FoxWatchRenderSceneNode { Id="left", Name="BPFacilityVehicleFactory3Arm", MeshId="mesh-sk_drydockcrane", UnrealLocationCentimeters=[-1310,1248,0] };
    var right = new FoxWatchRenderSceneNode { Id="right", Name="BPFacilityVehicleFactory3Arm1", MeshId="mesh-sk_drydockcrane", UnrealLocationCentimeters=[610,1248,0] };
    var unrelated = new FoxWatchRenderSceneNode { Id="body", Name="MainMesh", MeshId="mesh-other" }; left.Children.Add(unrelated);
    var method = typeof(FoxWatchRenderSceneGenerator).GetMethod("TryApplyStructurePoseOverrideAsync",BindingFlags.Instance|BindingFlags.NonPublic)!;
    var before = JsonSerializer.Serialize(new[]{left.UnrealLocationCentimeters,right.UnrealLocationCentimeters});
    var task = (Task<bool>)method.Invoke(generator,[new FoxWatchManifestStructure{Id="facilityvehiclefactory3"},new List<FoxWatchRenderSceneNode>{left,right},new Dictionary<string,FoxWatchRenderSceneMeshAsset>(),CancellationToken.None])!;
    Check(await task, "Authored pose not applied");
    Check(left.Pose?.Profile == "drydock-authored-idle" && right.Pose?.Profile == "drydock-authored-idle", "Both exact arms must receive authored idle");
    Check(left.Pose!.Bones!.Count == 7 && !ReferenceEquals(left.Pose,right.Pose), "Pose clone/content missing");
    Check(unrelated.Pose == null && JsonSerializer.Serialize(new[]{left.UnrealLocationCentimeters,right.UnrealLocationCentimeters}) == before, "Pose application changed unrelated/local geometry");
});
GC.KeepAlive(keepAlive);
Console.WriteLine($"PASS {passed} focused native crane regressions");
