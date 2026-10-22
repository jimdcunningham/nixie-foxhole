using System.Diagnostics;
using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
public static class FastTextureImport {
 public static void Run(DefaultFileProvider provider,string root,bool deferredOnly=false){
  var clock=Stopwatch.StartNew();var jobs=new List<(string source,string file,UTexture texture)>();var rows=new List<object>();
  if(deferredOnly){
   var region=Path.Combine(root,RegionConfig.Id);var needed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var f in Directory.GetFiles(Path.Combine(region,"ready"),"*.gltf")){using var doc=JsonDocument.Parse(File.ReadAllText(f));if(!doc.RootElement.TryGetProperty("images",out var images))continue;foreach(var image in images.EnumerateArray())if(image.TryGetProperty("uri",out var uri)&&!uri.GetString()!.StartsWith("data:"))needed.Add(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(f)!,uri.GetString()!)));}
   using var deferred=JsonDocument.Parse(File.ReadAllText(Path.Combine(region,"deferred-textures.json")));foreach(var entry in deferred.RootElement.EnumerateArray()){var file=Path.Combine(region,entry.GetProperty("file").GetString()!);if(!needed.Contains(Path.GetFullPath(file)))continue;var source=entry.GetProperty("source").GetString()!;jobs.Add((source,file,provider.LoadPackage(source.Split('.')[0]).GetExports().OfType<UTexture>().First()));}
  }else{
   var paths=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(root,"material-texture-requests.json")))!;foreach(var source in paths){var file="material-source/"+Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source))).ToLowerInvariant()+".png";jobs.Add((source,Path.Combine(root,file),provider.LoadPackage(source.Split('.')[0]).GetExports().OfType<UTexture>().First()));rows.Add(new{path=source,file});}
  }
  var readSeconds=clock.Elapsed.TotalSeconds;
  Parallel.ForEach(jobs,new ParallelOptions{MaxDegreeOfParallelism=4},job=>{Directory.CreateDirectory(Path.GetDirectoryName(job.file)!);var pixels=job.texture.Decode(1024)??throw new Exception("Texture decode failed: "+job.source);File.WriteAllBytes(job.file,pixels.FastPng());});
  if(!deferredOnly)File.WriteAllText(Path.Combine(root,"material-source.json"),JsonSerializer.Serialize(rows));Console.WriteLine(JsonSerializer.Serialize(new{mode=deferredOnly?"deferred":"material-textures",count=jobs.Count,readSeconds,totalSeconds=clock.Elapsed.TotalSeconds}));
 }
}
