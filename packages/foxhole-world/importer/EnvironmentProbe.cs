using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Textures;
using System.Text.RegularExpressions;
using System.Text.Json;
public static class EnvironmentProbe {
 public static void Run(DefaultFileProvider provider,UObject[] objects,string output){
  var environment=objects.Where(o=>Regex.IsMatch(o.ExportType,"DirectionalLight|SkyLight|PostProcessVolume|ExponentialHeightFog|AtmosphericFog|DayNight|SkySphere|WeatherControl",RegexOptions.IgnoreCase)).ToArray();
  File.WriteAllText(Path.Combine(output,"environment-objects.json"),Newtonsoft.Json.JsonConvert.SerializeObject(environment,Newtonsoft.Json.Formatting.Indented));
  var waterFiles=provider.Files.Keys.Where(p=>Regex.IsMatch(p,"water|ocean|river",RegexOptions.IgnoreCase)&&p.EndsWith(".uasset",StringComparison.OrdinalIgnoreCase)).ToArray();File.WriteAllText(Path.Combine(output,"water-files.json"),JsonSerializer.Serialize(waterFiles));
  var materials=new List<object>();var errors=new List<string>();Directory.CreateDirectory(Path.Combine(output,"water-source"));
  foreach(var file in waterFiles.Where(p=>p.Contains("/Materials/",StringComparison.OrdinalIgnoreCase)))try{
   var material=provider.LoadPackage(file).GetExports().OfType<UMaterialInterface>().FirstOrDefault();if(material==null)continue;var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=new List<object>();
   foreach(var pair in pars.Textures.Where(p=>p.Value is UTexture)){var t=(UTexture)pair.Value;var target="water-source/"+t.Name+".png";textures.Add(new{parameter=pair.Key,name=t.Name,path=t.GetPathName(),file=target,format=t.Format.ToString()});}
   materials.Add(new{name=material.Name,path=file,textures,colors=pars.Colors,scalars=pars.Scalars,switches=pars.Switches,properties=pars.Properties});
   if(Regex.IsMatch(material.Name.ToString(),"Water|Ocean|River",RegexOptions.IgnoreCase))File.WriteAllText(Path.Combine(output,"water-source",material.Name+"-material.json"),Newtonsoft.Json.JsonConvert.SerializeObject(material,Newtonsoft.Json.Formatting.Indented));
  }catch(Exception e){errors.Add(file+": "+e.Message);}
  File.WriteAllText(Path.Combine(output,"water-materials.json"),Newtonsoft.Json.JsonConvert.SerializeObject(new{materials,errors},Newtonsoft.Json.Formatting.Indented));Console.WriteLine($"Environment {environment.Length} objects; water {materials.Count} materials; {errors.Count} warnings");
 }
}
