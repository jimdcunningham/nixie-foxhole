using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion;
using System.Text.Json;
using CUE4Parse_Conversion.Textures;
public static class MaterialProbe {
 public static void Textures(DefaultFileProvider provider,string output){
  var paths=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(output,"material-texture-requests.json")))!;Directory.CreateDirectory(Path.Combine(output,"material-source"));var rows=new List<object>();
  foreach(var path in paths)try{var file="material-source/"+Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(path))).ToLowerInvariant()+".png";if(!File.Exists(Path.Combine(output,file))){var texture=provider.LoadPackage(path.Split('.')[0]).GetExports().OfType<UTexture>().First();var bitmap=texture.Decode(1024)??throw new Exception("No pixels");File.WriteAllBytes(Path.Combine(output,file),bitmap.FastPng());}rows.Add(new{path,file});}catch(Exception e){Console.WriteLine(path+": "+e.Message);}
  File.WriteAllText(Path.Combine(output,"material-source.json"),JsonSerializer.Serialize(rows));Console.WriteLine($"Exported {rows.Count}/{paths.Length} source textures");
 }
 public static void Run(DefaultFileProvider provider,string output){
  var wanted=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(output,"material-names.json")))!.ToHashSet(StringComparer.OrdinalIgnoreCase);
  var rows=new List<object>();var errors=new List<string>();
  foreach(var entry in provider.Files.Where(e=>e.Key.EndsWith(".uasset",StringComparison.OrdinalIgnoreCase)&&wanted.Contains(Path.GetFileNameWithoutExtension(e.Key))))try{
   var material=provider.LoadPackage(entry.Key).GetExports().OfType<UMaterialInterface>().FirstOrDefault();if(material==null)continue;
   var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);
   rows.Add(new{name=material.Name,path=entry.Key,blend=pars.BlendMode.ToString(),shading=pars.ShadingModel.ToString(),textures=pars.Textures.ToDictionary(k=>k.Key,k=>k.Value is UTexture t?new{name=t.Name,path=t.GetPathName(),format=t.Format.ToString()}:null),colors=pars.Colors,scalars=pars.Scalars,switches=pars.Switches,properties=pars.Properties});
   if(System.Text.RegularExpressions.Regex.IsMatch(material.Name.ToString(),"Window|Lantern|TreeBirchTrunk|TreeSilverBirchTrunk|PineBark",System.Text.RegularExpressions.RegexOptions.IgnoreCase)){
    Directory.CreateDirectory(Path.Combine(output,"material-raw"));UUnrealMaterial? chain=material;var seen=new HashSet<string>();
    while(chain!=null&&seen.Add(chain.GetPathName())){File.WriteAllText(Path.Combine(output,"material-raw",chain.Name+".json"),Newtonsoft.Json.JsonConvert.SerializeObject(chain,Newtonsoft.Json.Formatting.Indented));File.WriteAllText(Path.Combine(output,"material-raw",chain.Name+"-expressions.json"),Newtonsoft.Json.JsonConvert.SerializeObject(provider.LoadPackage(chain.GetPathName().Split('.')[0]).GetExports().Where(x=>x.ExportType.StartsWith("MaterialExpression")),Newtonsoft.Json.Formatting.Indented));chain=chain is UMaterialInstanceConstant instance?instance.Parent:null;}
   }
  }catch(Exception e){errors.Add(entry.Key+": "+e.Message);}
  File.WriteAllText(Path.Combine(output,"material-inspection.json"),Newtonsoft.Json.JsonConvert.SerializeObject(new{materials=rows,errors},Newtonsoft.Json.Formatting.Indented));Console.WriteLine($"Inspected {rows.Count}/{wanted.Count} material names, {errors.Count} errors");
 }
}

