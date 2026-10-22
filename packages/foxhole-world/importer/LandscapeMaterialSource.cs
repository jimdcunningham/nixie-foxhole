using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Textures;
public static class LandscapeMaterialSource {
 public static void Run(DefaultFileProvider provider,UObject[] objects,string output){
  var material=objects.OfType<ALandscapeProxy>().First().LandscapeMaterial.Load<UMaterialInterface>()!;var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);
  var function=provider.LoadPackage("War/Content/Materials/Functions/LandscapeLayer.uasset").GetExports().ToArray();
  var mapping=function.First(x=>x.ExportType=="MaterialExpressionLandscapeLayerCoords").GetOrDefault<float>("MappingScale",1);
  var noise=function.Where(x=>x.ExportType=="MaterialExpressionTextureSample").Select(x=>x.GetOrDefault<FPackageIndex>("Texture")?.Load<UTexture>()).First(x=>x?.Name.ToString()=="TilingNoises01")!;
  var pixels=noise.Decode()!;var file="paint/"+noise.Name+".png";File.WriteAllBytes(Path.Combine(output,file),pixels.FastPng());
  var colors=pars.Colors.ToDictionary(x=>x.Key,x=>new[]{x.Value.R,x.Value.G,x.Value.B,x.Value.A});
  Directory.CreateDirectory(Path.Combine(output,"paint/native"));var nativeTextures=new List<object>();
  foreach(var item in pars.Textures.Where(x=>x.Key.Contains("Albedo")||x.Key.Contains("Normal"))){if(item.Value is not UTexture2D texture)continue;var decoded=texture.Decode()!;var nativeFile="paint/native/"+texture.Name+".png";File.WriteAllBytes(Path.Combine(output,nativeFile),decoded.FastPng());nativeTextures.Add(new{key=item.Key,file=nativeFile,width=decoded.Width,height=decoded.Height,source=texture.GetPathName(),format=texture.Format.ToString()});}
  foreach(var name in new[]{"TerrainSnow4_A","TerrainSnow4_N","SnowM"}){var t=provider.LoadPackage("War/Content/Textures/Environment/"+name+".uasset").GetExports().OfType<UTexture2D>().First();var decoded=t.Decode()!;var nativeFile="paint/native/"+name+".png";File.WriteAllBytes(Path.Combine(output,nativeFile),decoded.FastPng());nativeTextures.Add(new{key="Weather-"+name,file=nativeFile,width=decoded.Width,height=decoded.Height,source=t.GetPathName(),format=t.Format.ToString()});}
  File.WriteAllText(Path.Combine(output,"paint/weather-control.json"),Newtonsoft.Json.JsonConvert.SerializeObject(provider.LoadPackage("War/Content/Materials/Collections/WeatherControl.uasset").GetExports(),Newtonsoft.Json.Formatting.Indented));
  var result=new{material=material.GetPathName(),function="War/Content/Materials/Functions/LandscapeLayer",mappingScale=mapping,noise=new{file,source=noise.GetPathName()},scalars=pars.Scalars,switches=pars.Switches,colors,textures=nativeTextures};
  File.WriteAllText(Path.Combine(output,"paint/material-source.json"),System.Text.Json.JsonSerializer.Serialize(result,new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));Console.WriteLine($"{material.GetPathName()}: mapping {mapping}; {pars.Switches.Count} switches; {noise.Name}");
 }
}
