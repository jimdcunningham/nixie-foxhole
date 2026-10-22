using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
public static class MaterialGraphProbe {
 public static void Run(DefaultFileProvider provider,string output){
  var paths=System.Text.Json.JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(output,"material-graph-paths.json")))!;
  var directory=Path.Combine(output,"material-graphs");Directory.CreateDirectory(directory);
  foreach(var path in paths){if(path.Contains("/Functions/")){var exports=provider.LoadPackage(path.Split('.')[0]).GetExports().ToArray();File.WriteAllText(Path.Combine(directory,Path.GetFileNameWithoutExtension(path)+".json"),Newtonsoft.Json.JsonConvert.SerializeObject(exports,Newtonsoft.Json.Formatting.Indented));Console.WriteLine(path+": "+exports.Length+" exports");continue;}UUnrealMaterial? material=path.EndsWith(".umap")?provider.LoadPackage(path).GetExports().OfType<CUE4Parse.UE4.Assets.Exports.Actor.ALandscapeProxy>().First().LandscapeMaterial.Load<UMaterialInterface>():provider.LoadPackage(path.Split('.')[0]).GetExports().OfType<UMaterialInterface>().First();var seen=new HashSet<string>();
   while(material!=null&&seen.Add(material.GetPathName())){
    File.WriteAllText(Path.Combine(directory,material.Name+".json"),Newtonsoft.Json.JsonConvert.SerializeObject(material,Newtonsoft.Json.Formatting.Indented));
    var objects=provider.LoadPackage(material.GetPathName().Split('.')[0]).GetExports().ToArray();
    File.WriteAllText(Path.Combine(directory,material.Name+"-expressions.json"),Newtonsoft.Json.JsonConvert.SerializeObject(objects.Where(x=>x.ExportType.StartsWith("MaterialExpression")),Newtonsoft.Json.Formatting.Indented));
    Console.WriteLine($"{material.GetPathName()}: {objects.Length} exports");material=material is UMaterialInstanceConstant instance?instance.Parent:null;
   }
  }
 }
}


