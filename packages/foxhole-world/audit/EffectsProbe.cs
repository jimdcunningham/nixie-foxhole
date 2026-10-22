using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using System.Text.RegularExpressions;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Meshes;
static class EffectsProbe {
 public static void Run(DefaultFileProvider provider,UObject[] objects,string output){
  var particles=objects.Where(o=>o.ExportType=="ParticleSystemComponent").ToArray();var materials=new Dictionary<string,object>();var systems=new Dictionary<string,object>();var errors=new List<string>();
  var utility=objects.OfType<UStaticMeshComponent>().Where(c=>Regex.IsMatch(c.GetStaticMesh().Name,"StaticDecalPlane|PuddlePlane")).ToArray();
  File.WriteAllText(Path.Combine(output,"utility-planes.json"),JsonConvert.SerializeObject(utility,Formatting.Indented));
  var utilityRows=new List<object>();var utilityMaterials=new Dictionary<string,object>();var meshFiles=new Dictionary<string,string>();
  foreach(var component in utility){var mesh=component.GetStaticMesh().Load<UStaticMesh>();if(mesh==null)continue;var meshPath=mesh.GetPathName();if(!meshFiles.TryGetValue(meshPath,out var file)){var exporter=new MeshExporter(mesh,new ExporterOptions{MeshFormat=EMeshFormat.Gltf2,ExportMaterials=false,LodFormat=ELodFormat.FirstLod});if(!exporter.TryWriteToDir(new DirectoryInfo(Path.Combine(output,"utility")),out _,out var exported))continue;meshFiles[meshPath]=file=Path.GetRelativePath(output,exported).Replace('\\','/');}var refs=component.GetOrDefault<FPackageIndex[]>("OverrideMaterials")?.Select(r=>r.ResolvedObject).ToArray()??mesh.Materials;var keys=new List<string>();foreach(var reference in refs){var material=reference?.Load<UMaterialInterface>();if(material==null)continue;keys.Add(material.GetPathName());if(utilityMaterials.ContainsKey(material.GetPathName()))continue;var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=new Dictionary<string,object>();foreach(var kv in pars.Textures){if(kv.Value is not UTexture tex)continue;var image="decals/textures/"+tex.Name+".png";if(!File.Exists(Path.Combine(output,image))){using var bitmap=tex.Decode()!.ToSkBitmap();using var pixmap=bitmap.PeekPixels();using var png=pixmap.Encode(new SkiaSharp.SKPngEncoderOptions(SkiaSharp.SKPngEncoderFilterFlags.NoFilters,1));File.WriteAllBytes(Path.Combine(output,image),png.ToArray());}textures[kv.Key]=new{file=image,source=tex.GetPathName()};}utilityMaterials[material.GetPathName()]=new{textures,scalars=pars.Scalars,colors=pars.Colors,switches=pars.Switches,native=material};}utilityRows.Add(new{name=component.Name,actor=component.Outer?.Name.ToString(),file,matrix=Coverage.Matrix(Coverage.Absolute(component)),materials=keys});}
  Directory.CreateDirectory(Path.Combine(output,"utility"));File.WriteAllText(Path.Combine(output,"utility/source.json"),JsonConvert.SerializeObject(new{placements=utilityRows,materials=utilityMaterials},Formatting.Indented));
  File.WriteAllText(Path.Combine(output,"particle-components.json"),JsonConvert.SerializeObject(particles,Formatting.Indented));
  File.WriteAllText(Path.Combine(output,"particle-placements.json"),JsonConvert.SerializeObject(particles.Select(c=>new{name=c.Name,actor=c.Outer?.Name.ToString(),system=c.GetOrDefault<FPackageIndex?>("Template")?.ResolvedObject?.GetPathName(),matrix=Coverage.Matrix(Coverage.Absolute(c)),visible=c.GetOrDefault("bVisible",true),hidden=c.GetOrDefault("bHiddenInGame",false),autoActivate=c.GetOrDefault("bAutoActivate",true)}),Formatting.Indented));
  foreach(var component in particles)try{var system=component.GetOrDefault<FPackageIndex?>("Template")?.Load();if(system==null||systems.ContainsKey(system.GetPathName()))continue;var exports=provider.LoadPackage(system.GetPathName().Split('.')[0]).GetExports().ToArray();systems[system.GetPathName()]=exports;
   foreach(var obj in exports){var material=obj.GetOrDefault<FPackageIndex?>("Material")?.Load<UMaterialInterface>();if(material==null||materials.ContainsKey(material.GetPathName()))continue;var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=new Dictionary<string,object>();foreach(var kv in pars.Textures){if(kv.Value is not UTexture tex)continue;var file="decals/textures/"+tex.Name+".png";if(!File.Exists(Path.Combine(output,file))){using var bitmap=tex.Decode()!.ToSkBitmap();using var pixmap=bitmap.PeekPixels();using var png=pixmap.Encode(new SkiaSharp.SKPngEncoderOptions(SkiaSharp.SKPngEncoderFilterFlags.NoFilters,1));File.WriteAllBytes(Path.Combine(output,file),png.ToArray());}textures[kv.Key]=new{file,source=tex.GetPathName()};}materials[material.GetPathName()]=new{textures,scalars=pars.Scalars,colors=pars.Colors,switches=pars.Switches,blend=pars.BlendMode.ToString(),native=material};}
  }catch(Exception e){errors.Add(component.Name+": "+e.Message);}
  File.WriteAllText(Path.Combine(output,"particle-systems.json"),JsonConvert.SerializeObject(systems,Formatting.Indented));File.WriteAllText(Path.Combine(output,"particle-materials.json"),JsonConvert.SerializeObject(new{materials,errors},Formatting.Indented));Console.WriteLine($"Particles {particles.Length}, systems {systems.Count}, materials {materials.Count}, utility planes {utility.Length}, errors {errors.Count}");
 }
}

