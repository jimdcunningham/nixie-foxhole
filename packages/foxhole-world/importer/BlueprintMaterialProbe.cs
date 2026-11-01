using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using System.Text.Json;
public static class BlueprintMaterialProbe {
 public static void Run(DefaultFileProvider provider,string pak,string output){
  var names=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(output,"blueprint-names.json")))!.ToHashSet(StringComparer.OrdinalIgnoreCase);
  var exporter=new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance,Options.Create(new FoxWatchOptions{PakDirectoryPath=pak}));
  var rows=new List<object>();
  foreach(var entry in provider.Files.Keys.Where(p=>p.EndsWith(".uasset",StringComparison.OrdinalIgnoreCase)&&names.Contains(Path.GetFileNameWithoutExtension(p)))){
   var exports=provider.LoadPackage(entry).GetExports().ToArray();
   File.WriteAllText(Path.Combine(output,Path.GetFileNameWithoutExtension(entry)+"-exports.json"),Newtonsoft.Json.JsonConvert.SerializeObject(exports,Newtonsoft.Json.Formatting.Indented));
   var components=exporter.InspectBlueprintComponentsAsync(entry).GetAwaiter().GetResult();
   var assignments=new List<object>();
   foreach(var component in components.Where(c=>c.MeshType=="static"&&!string.IsNullOrEmpty(c.MeshPath))){
    var mesh=provider.LoadPackage(component.MeshPath).GetExports().OfType<UStaticMesh>().First();
    var materials=ExtraProbe.ResolveMaterials(provider,component,mesh.Materials.Select(m=>m?.Load<UMaterialInterface>()));
    assignments.Add(new{component=component.ComponentName,materials=materials.Select(m=>m?.GetPathName())});
   }
   rows.Add(new{path=entry,components,assignments});Console.WriteLine(entry+": "+components.Count+" components");
  }
  File.WriteAllText(Path.Combine(output,"blueprint-materials.json"),JsonSerializer.Serialize(rows));
 }
}
