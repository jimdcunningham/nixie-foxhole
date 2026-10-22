using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Objects.UObject;
using System.Text.Json;

// Preserve the native actor selection rules omitted by legacy prepared world recipes.
public static class PlacementRules {
 public static void Run(DefaultFileProvider provider,string map,string output){
  var objects=provider.LoadPackage("War/Content/Maps/Master/"+map+".umap").GetExports().ToArray();
  var rules=new Dictionary<string,object>();var layers=objects.Where(c=>c.ExportType=="StructureLayerComponent"&&c.Outer!=null).GroupBy(c=>c.Outer!.Name.ToString()).ToDictionary(g=>g.Key,g=>g.First());
  foreach(var actor in objects.Where(o=>o.ExportType.EndsWith("_C")||layers.ContainsKey(o.Name.ToString()))){
   var name=actor.Name.ToString();layers.TryGetValue(name,out var layer);
   var include=Convert.ToInt32(layer?.Properties.FirstOrDefault(p=>p.Name.Text=="IncludedInLayers")?.Tag?.GenericValue??0);var exclude=Convert.ToInt32(layer?.Properties.FirstOrDefault(p=>p.Name.Text=="ExcludedByLayers")?.Tag?.GenericValue??0);
   var root=actor.GetOrDefault<FPackageIndex?>("RootComponent")?.Load<USceneComponent>();var parent=root?.GetAttachParent()?.Outer?.Name.ToString();if(parent==name)parent=null;
   if(include!=0||exclude!=0||parent!=null||actor.GetOrDefault("bHidden",false))rules[name]=new{include,exclude,parent,hidden=actor.GetOrDefault("bHidden",false),type=actor.ExportType,position=root!=null?SceneProbe.Matrix(root.GetAbsoluteTransform()).Skip(12).Take(3).ToArray():null};
  }
  Directory.CreateDirectory(Path.GetDirectoryName(output)!);File.WriteAllText(output,JsonSerializer.Serialize(new{version=1,map,actors=rules},new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine(map+": "+rules.Count+" native placement rules");
 }
}
