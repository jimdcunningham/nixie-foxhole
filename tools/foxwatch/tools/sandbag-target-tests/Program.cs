using System.Numerics;
using System.Reflection;
using System.Text.Json;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

var passed = 0;
void Check(bool ok,string description) { if(!ok) throw new Exception(description); passed++; Console.WriteLine("PASS "+description); }
void Reject(Action action,string description) { try { action(); } catch(InvalidOperationException) { passed++; Console.WriteLine("PASS "+description); return; } throw new Exception(description); }
FoxWatchBlueprintComponentReference C(string name,string location="X=0 Y=0 Z=0",string rotation="P=0 Y=0 R=0",string scale="X=1 Y=1 Z=1",string parent="None") => new() { ComponentName=name, RelativeLocation=location,RelativeRotation=rotation,RelativeScale=scale,AttachParentName=parent };
double Length(FoxWatchManifestModificationSplineTarget target) => Math.Sqrt(target.LocalTargetCentimeters.Sum(v=>v*v));
var simple=new[]{C("Owner:Slot"),C("Owner:Target","X=480 Y=0 Z=0")};
Check(FoxWatchNativeModificationSplineTarget.Resolve(false,"Owner:Slot","Missing",simple)==null,"false override ignores target");
Check(FoxWatchNativeModificationSplineTarget.Resolve(null,"Owner:Slot","Missing",simple)==null,"absent override ignores target");
Reject(()=>FoxWatchNativeModificationSplineTarget.Resolve(true,"Owner:Slot","Missing",simple),"explicit missing target rejected");
Reject(()=>FoxWatchNativeModificationSplineTarget.Resolve(true,"Owner:Slot",null,simple),"explicit missing name rejected");
Reject(()=>FoxWatchNativeModificationSplineTarget.Resolve(true,"Owner:Slot","Target",[..simple,C("Owner:Target")]),"ambiguous owned target rejected");
Check(Math.Abs(Length(FoxWatchNativeModificationSplineTarget.Resolve(true,"Owner:Slot","Target",[..simple,C("Foreign:Target")])!)-480)<0.001,"qualified owner excludes foreign basename");
var transformed=new[]{C("Root","X=10 Y=20 Z=30","P=0 Y=90 R=0","X=2 Y=2 Z=2"),C("Slot",parent:"Root"),C("Target","X=480 Y=0 Z=0",parent:"Root")};
Check(Math.Abs(Length(FoxWatchNativeModificationSplineTarget.Resolve(true,"Slot","Target",transformed)!)-480)<0.001,"full parent rotation scale translation inverse preserves local span");
Reject(()=>FoxWatchNativeModificationSplineTarget.Resolve(true,"Slot","Target",new[]{C("Slot",parent:"Target"),C("Target",parent:"Slot")}),"attachment cycle rejected");
var socket=C("Slot");socket.AttachSocketName="UnknownBone";
Reject(()=>FoxWatchNativeModificationSplineTarget.Resolve(true,"Slot","Target",new[]{socket,C("Target","X=480 Y=0 Z=0")}),"unresolved socket pose rejected");
var connector=C("SplineConnector");
connector.SplineConnectorMeshConfigs=[new()]; connector.SplineDefaultTargetUnrealLocationCentimeters=[330,0,0];
var cached=new[]{connector};var cachedBefore=JsonSerializer.Serialize(cached);
var clone=FoxWatchNativeModificationSplineTarget.CloneTemplateWithTarget(cached,FoxWatchNativeModificationSplineTarget.Resolve(true,"Owner:Slot","Target",simple)!);
Check(JsonSerializer.Serialize(cached)==cachedBefore,"cached template remains byte-equivalent after contextual baking");
Check(clone.Single().SplineDefaultTargetUnrealLocationCentimeters!.SequenceEqual(new double[]{480,0,0}),"cloned connector receives480cm authored endpoint");
Check(!ReferenceEquals(clone[0].SplineConnectorMeshConfigs,cached[0].SplineConnectorMeshConfigs),"nested mesh configuration deeply cloned");
Check(FoxWatchNativeModificationSplineTarget.ContextKey("Sandbags","FrontDefenseModSlot")=="sandbags--slot-frontdefensemodslot","deterministic slot context key");
Reject(()=>FoxWatchNativeModificationSplineTarget.ContextKey("sandbags","Front/Defense"),"unsafe context key rejected rather than collision sanitized");
Check(FoxWatchNativeModificationSplineTarget.ContextKey("sandbags","Front")!=FoxWatchNativeModificationSplineTarget.ContextKey("sandbags","Back"),"different slots cannot share output key");

// Exercise the production scene-detachment path with two different slot contexts.
var scene = new FoxWatchBlueprintSceneExtraction { Roots = [
    new() { Id="fort:Front", Name="FrontDefenseModSlot", UnrealLocationCentimeters=[230,-230,150], Children=[new(){Id="fort:upgrade:sandbags:front",Name="front150"}] },
    new() { Id="fort:Angle", Name="AngleDefenseModSlot", UnrealLocationCentimeters=[-90,230,150], Children=[new(){Id="fort:upgrade:sandbags:angle",Name="angle482"}] },
] };
var detach = typeof(FoxWatchRenderSceneGenerator).GetMethod("CreateGlobalModificationScene",BindingFlags.Static|BindingFlags.NonPublic)!;
FoxWatchBlueprintSceneExtraction Detached(string slot) => (FoxWatchBlueprintSceneExtraction)detach.Invoke(null,new object?[]{scene,"fort","sandbags",slot})!;
Check(Detached("FrontDefenseModSlot").Roots.Single().Name=="front150","production detachment selects exact Front context");
Check(Detached("AngleDefenseModSlot").Roots.Single().Name=="angle482","production detachment selects exact Angle context");
Check(Detached("FrontDefenseModSlot").Roots.Single().UnrealLocationCentimeters==null,"detached context excludes host slot translation");
scene.Roots.Add(new(){Id="fort:Duplicate",Name="FrontDefenseModSlot"});
try { Detached("FrontDefenseModSlot");throw new Exception("ambiguous scene slot accepted"); }
catch(TargetInvocationException error) when(error.InnerException is InvalidOperationException) { passed++;Console.WriteLine("PASS production detachment rejects ambiguous slot"); }
scene.Roots.RemoveAt(scene.Roots.Count-1);
Check(scene.Roots[0].Children.Single().Name=="front150","production scene detachment preserves input graph");

var fixtures=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"native-targets.json")));
foreach(var family in fixtures.RootElement.EnumerateArray()) {
    string V(JsonElement e,string k) => (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k,out var value) ? value.GetDouble() : 0).ToString(System.Globalization.CultureInfo.InvariantCulture);
    string Position(JsonElement e)=>$"X={V(e,"X")} Y={V(e,"Y")} Z={V(e,"Z")}";
    string Rotation(JsonElement e)=>$"P={V(e,"Pitch")} Y={V(e,"Yaw")} R={V(e,"Roll")}";
    var refs=new Dictionary<string,FoxWatchBlueprintComponentReference>(StringComparer.OrdinalIgnoreCase);
    foreach(var slot in family.GetProperty("slots").EnumerateArray()) {
        var name=slot.GetProperty("slot").GetString()!;
        refs[name]=C(name,Position(slot.GetProperty("startLocal")),Rotation(slot.GetProperty("startRotation")));
    }
    foreach(var slot in family.GetProperty("slots").EnumerateArray()) {
        var name=slot.GetProperty("targetName").GetString()!;
        refs.TryAdd(name,C(name,Position(slot.GetProperty("endLocal")),Rotation(slot.GetProperty("endRotation"))));
    }
    foreach(var slot in family.GetProperty("slots").EnumerateArray()) {
        var name=slot.GetProperty("slot").GetString()!;
        var binding=FoxWatchNativeModificationSplineTarget.Resolve(true,name,slot.GetProperty("targetName").GetString(),refs.Values.ToList())!;
        Check(Math.Abs(Length(binding)-slot.GetProperty("lengthLocalCm").GetDouble())<0.001,"owned fixture "+family.GetProperty("package").GetString()+":"+name);
    }
}

// Resolve all13 real owned targets against fresh native inspection, not a cached target model.
if(args.Length>=2) {
    var matrix=JsonDocument.Parse(File.ReadAllText(args[0]));
    var pakPath=Environment.GetEnvironmentVariable("FOXWATCH_TEST_PAK_PATH")
        ?? throw new InvalidOperationException("Native replay requires FOXWATCH_TEST_PAK_PATH.");
    var exporter=new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance,Options.Create(new FoxWatchOptions{PakDirectoryPath=pakPath}));
    var evidence=new List<object>();
    foreach(var family in matrix.RootElement.EnumerateArray()) {
        var package=family.GetProperty("package").GetString()!;
        var refs=await exporter.InspectBlueprintComponentsAsync("War/Content/Blueprints/Structures/Forts/"+package.Replace(".json",".uasset"));
        foreach(var slot in family.GetProperty("slots").EnumerateArray()) {
            var name=slot.GetProperty("slot").GetString()!;
            var binding=FoxWatchNativeModificationSplineTarget.Resolve(true,name,slot.GetProperty("targetName").GetString(),refs)!;
            var expected=slot.GetProperty("lengthLocalCm").GetDouble();
            Check(Math.Abs(Length(binding)-expected)<0.001,"native "+package+":"+name+" span="+Length(binding));
            evidence.Add(new{package,name,expected,actual=Length(binding),binding});
        }
    }
    await exporter.WriteInspectionSnapshotAsync();
    File.WriteAllText(args[1],JsonSerializer.Serialize(new{passed,evidence},new JsonSerializerOptions{WriteIndented=true}));
}
Console.WriteLine($"PASS {passed} assertions");
