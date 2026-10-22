using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
public static class LodProbe {
 public static void Run(DefaultFileProvider provider,string root){
  var cache=new Dictionary<string,object>();var errors=new List<string>();
  foreach(var region in new[]{RegionConfig.Id}){
   using var world=JsonDocument.Parse(File.ReadAllText(Path.Combine(root,region,"world.json")));var rows=new Dictionary<string,object>();
   foreach(var p in world.RootElement.GetProperty("prototypes").EnumerateArray()){
    if(!p.TryGetProperty("category",out var cat)||cat.GetString() is not ("vegetation" or "structures" or "rocks")||!p.TryGetProperty("path",out var pathValue))continue;
    var path=pathValue.GetString()!;
    try{
     if(!cache.TryGetValue(path,out var row)){
      var package=path.EndsWith(".uasset")?path:path.Split('.')[0]+".uasset";
      var mesh=provider.LoadPackage(package).GetExports().OfType<UStaticMesh>().FirstOrDefault()??throw new Exception("No static mesh");
      var exporter=FastAssets.Exporter(mesh,new ExporterOptions{MeshFormat=EMeshFormat.Gltf2,ExportMaterials=false,LodFormat=ELodFormat.AllLods});
      var key=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path))).ToLowerInvariant()[..16];var lods=new List<object>();
      if(exporter.MeshLods.Count>1){Directory.CreateDirectory(Path.Combine(root,"native-lods"));for(var i=0;i<exporter.MeshLods.Count;i++){var file=$"native-lods/{key}-{i}.glb";File.WriteAllBytes(Path.Combine(root,file),exporter.MeshLods[i].FileData);lods.Add(new{index=i,file});}}
      row=new{path,lods};cache[path]=row;Console.WriteLine($"LOD {mesh.Name}: {exporter.MeshLods.Count}");
     }
     rows[p.GetProperty("file").GetString()!]=row;
    }catch(Exception e){errors.Add(path+": "+e.Message);}
   }
   File.WriteAllText(Path.Combine(root,region,"native-lods.json"),JsonSerializer.Serialize(new{version=1,region,assets=rows,errors}));
  }
  Console.WriteLine($"Native LOD inventory: {cache.Count} assets, {errors.Count} warnings");
 }
}
