using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse_Conversion.Textures;
using System.Diagnostics;
using System.Text.Json;
using FoxWatchService;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
public static class ImportProfile {
 public static void Run(DefaultFileProvider provider,string paks,string output){Directory.CreateDirectory(output);var all=Stopwatch.StartNew();var t=Stopwatch.StartNew();var objects=provider.LoadPackage(RegionConfig.MapPath).GetExports().ToArray();Console.WriteLine("map "+t.Elapsed.TotalSeconds);
  var material=objects.OfType<ALandscapeProxy>().First().LandscapeMaterial.Load<UMaterialInterface>()!;var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=pars.Textures.Values.OfType<UTexture2D>().DistinctBy(x=>x.GetPathName()).Take(4).ToArray();var rows=new List<object>();foreach(var texture in textures){t.Restart();var decoded=texture.Decode()!;var decode=t.Elapsed.TotalSeconds;t.Restart();var png=decoded.Encode(ETextureFormat.Png,false,out _);var slow=t.Elapsed.TotalSeconds;t.Restart();var fast=decoded.FastPng();var speed=t.Elapsed.TotalSeconds;using var a=SkiaSharp.SKBitmap.Decode(png);using var b=SkiaSharp.SKBitmap.Decode(fast);if(!a.Bytes.AsSpan().SequenceEqual(b.Bytes))throw new Exception("PNG pixels differ");var row=new{name=texture.Name.ToString(),format=texture.Format.ToString(),decoded.Width,decoded.Height,decode,slow,fast=speed,slowBytes=png.Length,fastBytes=fast.Length};rows.Add(row);Console.WriteLine(JsonSerializer.Serialize(row));}
  t.Restart();var exporter=new FoxWatchAssetMeshExporter(NullLogger<FoxWatchAssetMeshExporter>.Instance,Options.Create(new FoxWatchOptions{PakDirectoryPath=paks}));int count=0,components=0;foreach(var group in objects.Where(o=>o.ExportType.EndsWith("_C")).GroupBy(o=>o.ExportType)){var path=group.First().Class?.GetPathName();if(string.IsNullOrEmpty(path))continue;try{components+=exporter.InspectBlueprintComponentsAsync(path.Split('.')[0]+".uasset").GetAwaiter().GetResult().Count;count++;}catch(Exception e){Console.WriteLine("class warning "+e.Message);}}
  var result=new{textures=rows,blueprintClasses=count,components,blueprintSeconds=t.Elapsed.TotalSeconds,totalSeconds=all.Elapsed.TotalSeconds};File.WriteAllText(Path.Combine(output,"native-profile.json"),JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine(JsonSerializer.Serialize(result));
 }
}
