using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
public static class SkyWaterProbe {
 public static void Run(DefaultFileProvider provider,string output){
  Directory.CreateDirectory(Path.Combine(output,"sky-source"));Directory.CreateDirectory(Path.Combine(output,"water-graph"));var skies=new List<object>();
  foreach(var name in new[]{"NoonSky","EveningSky","NightSky"}){var t=provider.LoadPackage("War/Content/Textures/Cubemaps/"+name).GetExports().OfType<UTexture>().First();var pixels=t.Decode()??throw new Exception("No sky pixels");var bytesPerPixel=pixels.Data.Length/(pixels.Width*pixels.Height);File.WriteAllBytes(Path.Combine(output,"sky-source",name+".bin"),pixels.Data);skies.Add(new{name,path=t.GetPathName(),width=pixels.Width,height=pixels.Height,format=pixels.PixelFormat.ToString(),sourceFormat=t.Format.ToString(),srgb=t.SRGB,faceHeight=pixels.Height/6,bytesPerPixel,bytes=pixels.Data.Length});}
  File.WriteAllText(Path.Combine(output,"sky-source/skies.json"),JsonSerializer.Serialize(skies));
  var curves=new[]{"LightCurve","SkylightPower","ReflectionCurveSnow2","ReflectionCurve01","MoonColorCurveSnow2"}.Select(n=>new{name=n,exports=provider.LoadPackage("War/Content/Curves/"+n).GetExports().ToArray()}).ToArray();File.WriteAllText(Path.Combine(output,"sky-source/curves.json"),Newtonsoft.Json.JsonConvert.SerializeObject(curves,Newtonsoft.Json.Formatting.Indented));
  var seen=new HashSet<string>();var rows=new List<object>();var textures=new List<object>();
  void Graph(string path){path=path.Split('.')[0];if(!seen.Add(path))return;var exports=provider.LoadPackage(path).GetExports().ToArray();rows.Add(new{path,exports});foreach(var o in exports){if(o.TryGetValue(out FPackageIndex reference,"Texture")&&reference.Load<UTexture>() is UTexture t){var file="water-graph/"+t.Name+".png";if(!File.Exists(Path.Combine(output,file))){var bitmap=t.Decode()!;File.WriteAllBytes(Path.Combine(output,file),bitmap.FastPng());}textures.Add(new{name=t.Name,path=t.GetPathName(),file,owner=path,expression=o.Name});}if(o.TryGetValue(out FPackageIndex function,"MaterialFunction")&&!function.IsNull)Graph(function.ResolvedObject!.GetPathName());}}
  Graph("War/Content/Materials/Water2");File.WriteAllText(Path.Combine(output,"water-graph/graph.json"),Newtonsoft.Json.JsonConvert.SerializeObject(rows,Newtonsoft.Json.Formatting.Indented));File.WriteAllText(Path.Combine(output,"water-graph/textures.json"),JsonSerializer.Serialize(textures));Console.WriteLine($"Extracted {skies.Count} sky cubes, {seen.Count} water graph packages and {textures.Count} texture references");
 }
}

