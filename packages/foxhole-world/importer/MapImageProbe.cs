using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
public static class MapImageProbe {
 public static void Run(DefaultFileProvider provider,string output){
  foreach(var row in new[]{(region:RegionConfig.Id,key:System.Environment.GetEnvironmentVariable("FOX_MAP_TEXTURE") ?? "Map"+RegionConfig.Map)}){
   var path="War/Content/Textures/UI/HexMaps/Processed/"+row.key;
   var file=provider.Files.Keys.Single(k=>k.Equals(path+".uasset",StringComparison.OrdinalIgnoreCase));
   var texture=provider.LoadPackage(file).GetExports().OfType<UTexture>().First();
   var pixels=texture.Decode()??throw new Exception("Map texture decode failed: "+path);
   var directory=Path.Combine(output,row.region,"map");Directory.CreateDirectory(directory);
   File.WriteAllBytes(Path.Combine(directory,"foxhole-original.png"),pixels.FastPng());
   var info=new{region=row.region,source=file,objectPath=texture.GetPathName(),width=pixels.Width,height=pixels.Height,declaredWidth=texture.PlatformData.SizeX,declaredHeight=texture.PlatformData.SizeY,firstMip=texture.GetFirstMipIndex(),sourceFormat=texture.Format.ToString(),note="First available cooked mip decoded to PNG; no resizing, filtering or sharpening"};
   File.WriteAllText(Path.Combine(directory,"foxhole-original.json"),JsonSerializer.Serialize(info,new JsonSerializerOptions{WriteIndented=true}));Console.WriteLine(JsonSerializer.Serialize(info));
  }
 }
}
