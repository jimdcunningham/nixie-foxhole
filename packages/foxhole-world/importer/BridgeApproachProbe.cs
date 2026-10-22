using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.FileProvider;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using System.Text.Json;
using System.Text.RegularExpressions;
public static class BridgeApproachProbe{
 static FVector Vector(string s,FVector fallback){var v=Regex.Matches(s??"",@"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?").Select(m=>float.Parse(m.Value,System.Globalization.CultureInfo.InvariantCulture)).ToArray();return v.Length>=3?new FVector(v[0],v[1],v[2]):fallback;}
 static FTransform Local(FoxWatchBlueprintComponentReference c){var r=Vector(c.RelativeRotation,FVector.ZeroVector);return new FTransform(new FRotator(r.X,r.Y,r.Z).Quaternion(),Vector(c.RelativeLocation,FVector.ZeroVector),Vector(c.RelativeScale,new FVector(1,1,1)));}
 public static void Run(UObject[] objects,string output,string paks,DefaultFileProvider provider,bool bridges=false){
  var exporter=new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance,Options.Create(new FoxWatchOptions{PakDirectoryPath=paks}));
  var known=new HashSet<string>();using(var j=JsonDocument.Parse(File.ReadAllText(Path.Combine(output,"scene-full.json"))))foreach(var p in j.RootElement.GetProperty("prototypes").EnumerateArray())foreach(var a in p.GetProperty("placements").EnumerateArray())known.Add(a.GetProperty("actor").GetString()??"");using(var j=JsonDocument.Parse(File.ReadAllText(Path.Combine(output,"catalog-full.json"))))foreach(var p in j.RootElement.GetProperty("prototypes").EnumerateArray())foreach(var a in p.GetProperty("placements").EnumerateArray())known.Add(a.GetProperty("name").GetString()??"");
  var knownParts=System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(File.ReadAllText(Path.Combine(output,"world.json"))).GetProperty("prototypes").EnumerateArray().Select(x=>x.GetProperty("name").GetString()??"").ToHashSet();
  File.WriteAllText(Path.Combine(output,"bridge-instance-properties.json"),Newtonsoft.Json.JsonConvert.SerializeObject(objects.Where(o=>o.ExportType.Contains("Bridge",StringComparison.OrdinalIgnoreCase)||((o.Outer?.Name.ToString()??"").Contains("Drawbridge"))),Newtonsoft.Json.Formatting.Indented));
  var prototypes=new List<object>();var errors=new List<string>();var inspected=new List<object>();int id=0;
  foreach(var group in objects.Where(o=>o.ExportType.EndsWith("_C")&&o.ExportType.Contains("Bridge",StringComparison.OrdinalIgnoreCase)).GroupBy(o=>o.ExportType))try{
   var actor=group.First();var classPath=actor.Class?.GetPathName();if(string.IsNullOrEmpty(classPath))continue;var components=exporter.InspectBlueprintComponentsAsync(classPath.Split('.')[0]+".uasset").GetAwaiter().GetResult();inspected.Add(new{type=group.Key,components});var byName=components.GroupBy(c=>c.ComponentName).ToDictionary(g=>g.Key,g=>g.First());
   FTransform Absolute(FoxWatchBlueprintComponentReference c,HashSet<string> seen){var local=Local(c);if(!seen.Add(c.ComponentName))return local;return byName.TryGetValue(c.AttachParentName,out var parent)?local*Absolute(parent,seen):local;}
   var placements=new List<object>();foreach(var a in group){var root=a.GetOrDefault<FPackageIndex?>("RootComponent")?.Load<USceneComponent>();if(root!=null)placements.Add(new{name=a.Name.ToString(),actor=a.Name.ToString(),matrix=SceneProbe.Matrix(root.GetAbsoluteTransform())});}
   if(placements.Count==0)continue;
   foreach(var c in components.Where(c=>c.MeshType=="static"&&!knownParts.Contains(group.Key+"/"+c.ComponentName)&&!string.IsNullOrEmpty(c.MeshPath)&&c.IsVisible&&!c.IsHiddenInGame&&!Regex.IsMatch(c.MeshPath,"/Measurement/|Engine/|collision|lightbeam",RegexOptions.IgnoreCase)))try{
    var pack=provider.LoadPackage(c.MeshPath);var mesh=pack.GetExports().OfType<UStaticMesh>().FirstOrDefault();var skeletal=pack.GetExports().OfType<USkeletalMesh>().FirstOrDefault();var options=new ExporterOptions{MeshFormat=EMeshFormat.Gltf2,ExportMaterials=false,LodFormat=ELodFormat.FirstLod};var export=bridges&&skeletal!=null?FastAssets.Exporter(skeletal,options):mesh!=null?FastAssets.Exporter(mesh,options):null;if(export==null)continue;if(!export.TryWriteToDir(new DirectoryInfo(Path.Combine(output,"approaches")),out _,out var file))continue;
    var references=bridges?skeletal!.Materials.Select(m=>m?.Load<UMaterialInterface>()):mesh!.Materials.Select(m=>m?.Load<UMaterialInterface>());
    var materials=new List<object>();foreach(var material in references){if(material==null)continue;var pars=new CMaterialParams();material.GetParams(pars);string? texFile=null;if(pars.Diffuse is UTexture texture){texFile="model-textures/"+texture.Name+".png";FastAssets.Defer(texture,texFile);}materials.Add(new{name=material.Name,diffuse=texFile,masked=false});}
    prototypes.Add(new{name=group.Key+"/"+c.ComponentName,path=c.MeshPath,category=bridges?"infrastructure":"structures",kind="environment",file=Path.GetRelativePath(output,file).Replace('\\','/'),materials,placements,localMatrix=SceneProbe.Matrix(Absolute(c,[]))});Console.WriteLine($"Extra {group.Key}/{c.ComponentName}: {placements.Count}");id++;
   }catch(Exception e){errors.Add(group.Key+"/"+c.ComponentName+": "+e.Message);}
  }catch(Exception e){errors.Add(group.Key+": "+e.Message);}
  File.WriteAllText(Path.Combine(output,"bridge-approach-inventory.json"),JsonSerializer.Serialize(inspected));File.WriteAllText(Path.Combine(output,"scene-approaches.json"),JsonSerializer.Serialize(new{prototypes,errors}));Console.WriteLine($"Extra {id} prototypes; {errors.Count} warnings");
 }
}



