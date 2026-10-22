using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
using System.Diagnostics;
public static class TerrainPaint{
 public static void Run(UObject[] objects,string output){
  var clock=Stopwatch.StartNew();var directory=Path.Combine(output,"paint");Directory.CreateDirectory(directory);TextureDecoder.UseAssetRipperTextureDecoder=true;
  var material=objects.OfType<ALandscapeProxy>().First().LandscapeMaterial.Load<UMaterialInterface>()!;
  var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);
  var textureRows=new List<object>();var errors=new List<string>();
  foreach(var (key,value) in pars.Textures.Where(pair=>pair.Key.Contains("Albedo",StringComparison.OrdinalIgnoreCase)||pair.Key.Contains("Normal",StringComparison.OrdinalIgnoreCase)))try{
   if(value is not UTexture2D texture)continue;
   var decoded=texture.Decode(1024)??throw new Exception("Cannot decode");var file=texture.Name+".png";
   File.WriteAllBytes(Path.Combine(directory,file),decoded.FastPng());
   textureRows.Add(new{key,file,width=decoded.Width,height=decoded.Height,source=texture.GetPathName()});
  }catch(Exception e){errors.Add($"{key}: {e.Message}");}
  var rows=new List<object>();long offset=0;
  using(var stream=File.Create(Path.Combine(directory,"weights.bin")))foreach(var c in objects.OfType<ULandscapeComponent>())try{
   if(c.NumSubsections!=1)throw new Exception("Multiple subsections require explicit remapping");
   var textures=c.GetWeightmapTextures();var layers=new List<object>();
   var size=c.ComponentSizeQuads+1;var t=c.GetAbsoluteTransform();var origin=t.TransformPosition(FVector.ZeroVector);
   foreach(var allocation in c.GetWeightmapLayerAllocations()){
    using var bitmap=(textures[allocation.WeightmapTextureIndex].Decode()??throw new Exception("Weight decode failed")).ToSkBitmap();
    if(bitmap.Width!=size||bitmap.Height!=size)throw new Exception($"Weightmap extent {bitmap.Width}x{bitmap.Height} differs from component {size}");
    var bytes=new byte[size*size];for(int y=0;y<size;y++)for(int x=0;x<size;x++){var color=bitmap.GetPixel(x,y);bytes[y*size+x]=allocation.WeightmapTextureChannel switch{0=>color.Red,1=>color.Green,2=>color.Blue,_=>color.Alpha};}
    stream.Write(bytes);var layerName=allocation.GetLayerName();if(allocation.LayerInfo.Load<UObject>() is {} layerInfo&&layerInfo.TryGetValue(out CUE4Parse.UE4.Objects.UObject.FName declaredName,"LayerName"))layerName=declaredName.Text;layers.Add(new{name=layerName,offset});offset+=bytes.Length;
   }
   rows.Add(new{name=c.Name,size,origin=new[]{origin.X/100f,origin.Z/100f,-origin.Y/100f},scale=new[]{t.Scale3D.X/100f,t.Scale3D.Z/100f,t.Scale3D.Y/100f},layers});
  }catch(Exception e){errors.Add($"{c.Name}: {e.Message}");}
  File.WriteAllText(Path.Combine(directory,"paint.json"),JsonSerializer.Serialize(new{textures=textureRows,components=rows,scalars=pars.Scalars,errors,seconds=clock.Elapsed.TotalSeconds},new JsonSerializerOptions{WriteIndented=true}));
  Console.WriteLine($"Paint: {textureRows.Count} albedo entries, {rows.Count} components, {offset} weight bytes, {errors.Count} errors, {clock.Elapsed.TotalSeconds:F2}s");
 }
}
