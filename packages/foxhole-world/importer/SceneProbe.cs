using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Component.SplineMesh;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Diagnostics;

public static class SceneProbe {
 static JsonSerializerOptions Json = new(){WriteIndented=true};
 record Placement(string name,string actor,float[] matrix,bool instanced,bool spline);
 record Group(string name,string path,List<Placement> placements,FPackageIndex mesh);
 static float[] Point(FVector v)=>[v.X/100f,v.Z/100f,-v.Y/100f];
 public static float[] Matrix(FTransform t){
  var o=Point(t.TransformPosition(FVector.ZeroVector));
  var basis=new[]{new FVector(100,0,0),new FVector(0,0,100),new FVector(0,-100,0)};
  var m=new float[16];for(int i=0;i<3;i++){var p=Point(t.TransformPosition(basis[i]));for(int a=0;a<3;a++)m[i*4+a]=p[a]-o[a];}
  m[12]=o[0];m[13]=o[1];m[14]=o[2];m[15]=1;return m;
 }
 // Empty instanced components are containers, never standalone mesh placements.
 public static bool HasPlacements(UStaticMeshComponent component)=>component is not UInstancedStaticMeshComponent instanced || instanced.PerInstanceSMData is {Length:>0};
 public static void Run(UObject[] objects,string output,string mode){
  Directory.CreateDirectory(output);var clock=Stopwatch.StartNew();var groups=new Dictionary<string,Group>();var errors=new List<string>();
  foreach(var c in objects.OfType<UStaticMeshComponent>())try {
   if(!HasPlacements(c))continue;
   var mesh=c.GetStaticMesh();if(mesh.IsNull)continue;var path=mesh.ResolvedObject?.GetPathName()??mesh.Name;
   if(!groups.TryGetValue(path,out var group))groups[path]=group=new Group(mesh.Name,path,[],mesh);
   var t=c.GetAbsoluteTransform();
   if(c is UInstancedStaticMeshComponent instanced)foreach(var instance in instanced.PerInstanceSMData!)group.placements.Add(new Placement(c.Name,c.Outer?.Name.ToString()??"",Matrix(instance.TransformData*t),true,false));
   else group.placements.Add(new Placement(c.Name,c.Outer?.Name.ToString()??"",Matrix(t),false,c is USplineMeshComponent));
  }catch(Exception e){errors.Add($"{c.Name}: {e.Message}");}
  var inventory=groups.Values.OrderByDescending(g=>g.placements.Count).Select(g=>new {g.name,g.path,count=g.placements.Count,category=Category(g.path),placements=g.placements}).ToArray();
  File.WriteAllText(Path.Combine(output,"scene-inventory.json"),JsonSerializer.Serialize(new {groups=inventory,errors,seconds=clock.Elapsed.TotalSeconds},Json));
  Console.WriteLine($"Inventory: {groups.Count} prototypes, {inventory.Sum(g=>g.count)} placements");
  foreach(var row in inventory.Take(35))Console.WriteLine($"{row.count} {row.category} {row.name}");
  var landscapes=objects.OfType<ALandscapeProxy>().ToArray();
  foreach(var l in landscapes){var material=l.LandscapeMaterial.Load<UMaterialInterface>();if(material!=null){
   var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);
   File.WriteAllText(Path.Combine(output,"landscape-material.json"),Newtonsoft.Json.JsonConvert.SerializeObject(new {material,parameters=pars},Newtonsoft.Json.Formatting.Indented));
  }}
  var layers=objects.OfType<ULandscapeComponent>().SelectMany(c=>c.GetWeightmapLayerAllocations()).GroupBy(a=>a.GetLayerName()).Select(g=>new {name=g.Key,components=g.Count()}).ToArray();
  File.WriteAllText(Path.Combine(output,"landscape-layers.json"),JsonSerializer.Serialize(layers,Json));
  var landmarks=objects.OfType<USceneComponent>().Where(c=>(c.Outer?.Name.ToString()??"").StartsWith("BPCoverWell",StringComparison.OrdinalIgnoreCase)).Select(c=>new{name=c.Outer?.Name.ToString(),position=Point(c.GetAbsoluteTransform().TransformPosition(FVector.ZeroVector))}).ToArray();
  File.WriteAllText(Path.Combine(output,"landmarks.json"),JsonSerializer.Serialize(landmarks,Json));
  var untyped=new List<object>();foreach(var o in objects.Where(o=>o is not UStaticMeshComponent))try{if(o.TryGetValue(out FPackageIndex value,"StaticMesh")&&!value.IsNull)untyped.Add(new{type=o.ExportType,name=o.Name,outer=o.Outer?.Name.ToString(),mesh=value.ResolvedObject?.GetPathName()});}catch{}
  File.WriteAllText(Path.Combine(output,"untyped-meshes.json"),JsonSerializer.Serialize(untyped,Json));
  var actors=new List<object>();foreach(var actor in objects.Where(o=>o.ExportType.EndsWith("_C",StringComparison.Ordinal)))try{var root=actor.GetOrDefault<FPackageIndex?>("RootComponent")?.Load<USceneComponent>();if(root!=null)actors.Add(new{name=actor.Name,type=actor.ExportType,matrix=Matrix(root.GetAbsoluteTransform())});}catch{}
  File.WriteAllText(Path.Combine(output,"blueprint-actors.json"),JsonSerializer.Serialize(actors,Json));
  if(mode=="roads"){RoadProbe.Run(objects,output);return;}
  if(mode=="water"){
   var waterObjects=objects.Where(o=>Regex.IsMatch(o.Name.ToString()+" "+o.ExportType+" "+o.Outer?.Name.ToString(),"water|ocean|river|lake|beach",RegexOptions.IgnoreCase)&&!Regex.IsMatch(o.Name.ToString()+" "+o.ExportType,"rock|sound|cue|watertower|underwater",RegexOptions.IgnoreCase)).ToArray();
   File.WriteAllText(Path.Combine(output,"water-objects.json"),Newtonsoft.Json.JsonConvert.SerializeObject(waterObjects,Newtonsoft.Json.Formatting.Indented));
   var waterMeshes=new List<object>();
   foreach(var g in groups.Values.Where(g=>(Regex.IsMatch(g.name,"^SM_WaterPlane$|^WaterHexPlane$|^River[^/]*$|^Ocean[^/]*$|^Lake[^/]*$")||g.placements.Any(p=>p.actor=="WaterMap")))){var mesh=g.mesh.Load<UStaticMesh>();if(mesh==null)continue;var exporter=FastAssets.Exporter(mesh,new ExporterOptions(){MeshFormat=EMeshFormat.Gltf2,ExportMaterials=false,LodFormat=ELodFormat.FirstLod});if(exporter.TryWriteToDir(new DirectoryInfo(Path.Combine(output,"water")),out _,out var file))waterMeshes.Add(new{g.name,file=Path.GetRelativePath(output,file).Replace('\\','/'),placements=g.placements});}
   File.WriteAllText(Path.Combine(output,"water-meshes.json"),JsonSerializer.Serialize(waterMeshes,Json));return;
  }
  if(mode=="paint"){TerrainPaint.Run(objects,output);return;}
  if(mode=="inspect")return;
  var selected=groups.Values.Where(g=>(mode=="full"||Category(g.path)!="vegetation")&&Category(g.path)!="utility"&&g.placements.Any(p=>!p.spline))
   .OrderByDescending(g=>Regex.IsMatch(g.path,"/Towns/|Barn|House|Building|Shed|Church",RegexOptions.IgnoreCase)).ThenByDescending(g=>g.placements.Count).Take(mode=="full"?int.MaxValue:mode=="sample"?64:128).ToArray();
  var exports=new List<object>();
  foreach(var group in selected)try{
   var mesh=group.mesh.Load<UStaticMesh>()??throw new Exception("Mesh not readable");
   var options=new ExporterOptions(){MeshFormat=EMeshFormat.Gltf2,ExportMaterials=false,LodFormat=ELodFormat.FirstLod};
   var exporter=FastAssets.Exporter(mesh,options);
   if(!exporter.TryWriteToDir(new DirectoryInfo(Path.Combine(output,"native")),out _,out var file))throw new Exception("No mesh exported");
   var materials=new List<object>();
   foreach(var reference in mesh.Materials)try{
    var material=reference?.Load<UMaterialInterface>();if(material==null)continue;
    var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.FirstLayer);
    UTexture? texture=null;pars.TryGetTexture2d(out texture,CMaterialParams2.Diffuse[0]);
    if(texture==null){var basic=new CMaterialParams();material.GetParams(basic);texture=basic.Diffuse as UTexture;}
    if(texture==null)texture=pars.Textures.FirstOrDefault(x=>Regex.IsMatch(x.Key,"albedo|diffuse|base.?col",RegexOptions.IgnoreCase)).Value as UTexture;
    string? SaveTexture(UTexture? t){if(t==null)return null;var f="model-textures/"+t.Name+".png";Directory.CreateDirectory(Path.Combine(output,"model-textures"));FastAssets.Defer(t,f);return f;}
    var textureFile=SaveTexture(texture);var normal=pars.Textures.FirstOrDefault(x=>Regex.IsMatch(x.Key,"normal",RegexOptions.IgnoreCase)).Value as UTexture;
    materials.Add(new{name=material.Name,diffuse=textureFile,normal=SaveTexture(normal),source=texture?.GetPathName(),parameters=pars.Textures.Keys.ToArray(),masked=Category(group.path)=="vegetation"});
   }catch(Exception e){errors.Add($"Material {reference?.Name}: {e.Message}");}
   exports.Add(new {group.name,group.path,category=Category(group.path),file=Path.GetRelativePath(output,file).Replace('\\','/'),materials,placements=group.placements.Where(p=>!p.spline).ToArray()});
   Console.WriteLine($"Exported {group.name}: {group.placements.Count} placements");Console.Out.Flush();
  }catch(Exception e){errors.Add($"{group.name}: {e.Message}");Console.WriteLine($"FAILED {group.name}: {e.Message}");}
  File.WriteAllText(Path.Combine(output,mode=="full"?"scene-full.json":"scene-export.json"),JsonSerializer.Serialize(new {prototypes=exports,errors,seconds=clock.Elapsed.TotalSeconds},Json));
 }
 static string Category(string path)=>Regex.IsMatch(path,"tree|bush|grass|foliage|leaf|reed|flower|shrub|plant|bramble|groundcover|corn|cattail|seaweed",RegexOptions.IgnoreCase)?"vegetation":Regex.IsMatch(path,"engine/|sky|sphere|plane|cloud|fog|waterplane|waterhex|debug|invisible|collision|marshy",RegexOptions.IgnoreCase)?"utility":Regex.IsMatch(path,"rock|cliff|boulder|mountain",RegexOptions.IgnoreCase)?"rocks":Regex.IsMatch(path,"road|bridge|rail|wall|fence|floor|stair|path",RegexOptions.IgnoreCase)?"infrastructure":"structures";
}
