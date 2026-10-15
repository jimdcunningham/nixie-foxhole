using System.Reflection;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;

var keepAlive = new List<ResolvedObject>();
FPackageIndex Index(UObject value) {
    var resolved = new ResolvedLoadedObject(value); keepAlive.Add(resolved);
    var index = new FPackageIndex((IPackage)null!, 1);
    typeof(FPackageIndex).GetField("_resolvedObject", BindingFlags.Instance|BindingFlags.NonPublic)!.SetValue(index,new WeakReference<ResolvedObject?>(resolved)); return index;
}
void Float(UObject o,string n,float v)=>o.Properties.Add(new FPropertyTag{Name=new FName(n),PropertyType=new FName("FloatProperty"),Tag=new FloatProperty(v)});
void Bool(UObject o,string n,bool v)=>o.Properties.Add(new FPropertyTag{Name=new FName(n),PropertyType=new FName("BoolProperty"),Tag=new BoolProperty(v)});
void Check(bool pass,string message){if(!pass)throw new Exception(message);}
var defaults = new UObject(); Float(defaults,"Intensity",2400); Float(defaults,"AttenuationRadius",1200); Float(defaults,"OuterConeAngle",35); Float(defaults,"InnerConeAngle",15);
var native = new UClass{Name="SpotLightComponent"};
var derived = new UClass{Name="BPAnyFixture_C",SuperStruct=Index(native),ClassDefaultObject=Index(defaults)};
var component = new UObject{Name="CeilingLamp",Class=new ResolvedLoadedObject(derived)};
var light = FoxWatchBlueprintLights.Extract(component)!;
Check(light.Type=="spot"&&light.Intensity==2400&&light.AttenuationRadius==1200&&light.OuterConeAngle==35,"Inherited fixture data missing");
Float(component,"Intensity",0); Bool(component,"bVisible",false);
var disabled=FoxWatchBlueprintLights.Extract(component)!;
Check(!disabled.Enabled&&disabled.Intensity==0,"Explicit zero and false must survive inheritance");
var template = new UObject(); Float(template,"Intensity",123); Bool(template,"CastShadows",false);
var templated = new UObject{Name="Templated",Class=new ResolvedLoadedObject(derived),Template=new ResolvedLoadedObject(template)};
Check(FoxWatchBlueprintLights.Extract(templated) is {Intensity:123,CastShadows:false},"Component archetype did not override class defaults");
var point = new UObject{Name="Bulb",Class=new ResolvedLoadedObject(new UClass{Name="PointLightComponent"})};
Check(FoxWatchBlueprintLights.Extract(point)?.Type=="point","Point component missing");
Check(FoxWatchBlueprintLights.Extract(new UObject{Name="Mesh"})==null,"Ordinary component became a light");
var extractor=new FoxWatchRenderBlueprintSceneExtractor(null!,NullLogger<FoxWatchRenderBlueprintSceneExtractor>.Instance);
var method=typeof(FoxWatchRenderBlueprintSceneExtractor).GetMethod("BuildExtraction",BindingFlags.Instance|BindingFlags.NonPublic)!;
var fixture=new List<FoxWatchBlueprintComponentReference>{
    new(){ComponentName="Fixture",ComponentType="SceneComponent",RelativeLocation="X=100 Y=200 Z=300",RelativeRotation="P=-30 Y=90 R=0"},
    new(){ComponentName="Lamp",ComponentType="PointLightComponent",AttachParentName="Fixture",RelativeLocation="X=0 Y=0 Z=50",Light=disabled,IsVisible=false},
};
var arguments=method.GetParameters().Select(p=>p.Name switch {
    "nodeIdPrefix"=> (object)"test", "rootNodeName"=>"Test", "blueprintPackagePath"=>"test.uasset", "componentReferences"=>fixture,
    _=>p.HasDefaultValue?p.DefaultValue:throw new Exception("Unknown argument "+p.Name)
}).ToArray();
var extraction=method.Invoke(extractor,arguments)!;
var json=System.Text.Json.JsonSerializer.Serialize(extraction);
Check(json.Contains("\"Light\"")&&json.Contains("\"Enabled\":false")&&json.Contains("Lamp"),"Disabled light dropped from the nested scene");
Console.WriteLine("PASS blueprint light inheritance, archetypes, explicit off/zero, point/spot types and nested scene preservation");
