using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using System.Diagnostics;
using System.Text.Json;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Textures;

using var codecCheck = new SkiaSharp.SKBitmap(1,1);
if(args.Length==1&&args[0]=="--self-test"){Console.WriteLine("Native image codec ready");return;}
var clock = Stopwatch.StartNew();
using var provider = new DefaultFileProvider(args[0], SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE4_24), StringComparer.OrdinalIgnoreCase);
provider.Initialize(); provider.Mount();
Console.WriteLine($"Mounted {provider.Files.Count} files in {clock.Elapsed.TotalSeconds:F2}s");
if(args.Length>3&&args[1]=="placement-rules"){PlacementRules.Run(provider,args[2],args[3]);return;}
if(args.Length>3&&args[1]=="mesh-check"){MeshCheck.Run(provider,args[2],args[3]);return;}
if(args.Length>2&&args[1]=="profile"){ImportProfile.Run(provider,args[0],args[2]);return;}
if(args.Length>2&&args[1]=="fresh"){DesktopImport.Run(provider,args[0],args[2]);return;}
if(args.Length>2&&args[1]=="lods"){LodProbe.Run(provider,args[2]);return;}
if(args.Length>2&&args[1]=="material-graphs"){MaterialGraphProbe.Run(provider,args[2]);return;}
if(args.Length>2&&args[1]=="map-images"){MapImageProbe.Run(provider,args[2]);return;}
if(args.Length>2&&args[1]=="deferred-textures"){FastTextureImport.Run(provider,args[2],true);return;}
if(args.Length>2&&args[1]=="materials"){MaterialProbe.Run(provider,args[2]);return;}
if(args.Length>2&&args[1]=="material-textures"){FastTextureImport.Run(provider,args[2]);return;}
if(args.Length>2&&args[1]=="sky-water"){SkyWaterProbe.Run(provider,args[2]);return;}
if(args.Length == 1) {
  var maps=provider.Files.Keys.Where(x=>x.EndsWith(".umap",StringComparison.OrdinalIgnoreCase)).Order().ToArray();
  File.WriteAllText("maps.txt",string.Join("\n",maps));
  Console.WriteLine(string.Join("\n",maps.Take(90))); return;
}
if(args[1]=="flags"){
 var outDir=args[2];Directory.CreateDirectory(outDir);var flagRows=new List<object>();
 foreach(var entry in provider.Files.Where(e=>e.Key.EndsWith(".uasset",StringComparison.OrdinalIgnoreCase)&&e.Key.Contains("flag",StringComparison.OrdinalIgnoreCase)&&e.Key.Contains("hanging",StringComparison.OrdinalIgnoreCase)))try{
  var material=provider.LoadPackage(entry.Key).GetExports().OfType<CUE4Parse.UE4.Assets.Exports.Material.UMaterialInterface>().FirstOrDefault();if(material==null)continue;
  var pars=new CUE4Parse.UE4.Assets.Exports.Material.CMaterialParams();material.GetParams(pars);if(pars.Diffuse is not CUE4Parse.UE4.Assets.Exports.Texture.UTexture texture)continue;
  var bitmap=texture.Decode(1024);if(bitmap==null)continue;var file=material.Name+".png";File.WriteAllBytes(Path.Combine(outDir,file),bitmap.FastPng());flagRows.Add(new{material=material.Name,file,source=entry.Key});
 }catch(Exception e){Console.WriteLine(e.Message);}
 File.WriteAllText(Path.Combine(outDir,"flags.json"),JsonSerializer.Serialize(flagRows));Console.WriteLine($"Exported {flagRows.Count} flag materials");return;
}
if(args.Length>3&&args[3]=="decal-inventory")CUE4Parse.UE4.Assets.Exports.PropertyUtil.SearchPropertyInTemplate=true;
var objects = provider.LoadPackage(args[1]).GetExports().ToArray();
if(args.Length>3&&args[3]=="bridge-approaches"){BridgeApproachProbe.Run(objects,args[2],args[0],provider);return;}
if(args.Length>3&&args[3]=="landscape-material"){LandscapeMaterialSource.Run(provider,objects,args[2]);return;}
if(args.Length>3&&args[3]=="decal-inventory"){DecalInventoryProbe.Run(objects,args[2]);return;}
if(args.Length>3&&args[3]=="road-tour"){RoadTourProbe.Run(objects,args[2]);return;}
Console.WriteLine($"Loaded {objects.Length} objects in {clock.Elapsed.TotalSeconds:F2}s");
Console.WriteLine(string.Join("\n", objects.GroupBy(x=>x.GetType().Name).OrderByDescending(x=>x.Count()).Take(15).Select(x=>$"{x.Key}: {x.Count()}")));
if(args.Length>3) { if(args[3]=="environment"){EnvironmentProbe.Run(provider,objects,args[2]);return;}if(args[3] is "extra" or "bridges"){ExtraProbe.Run(objects,args[2],args[0],provider,args[3]=="bridges");return;}if(args[3] is not ("inspect" or "roads" or "water" or "paint" or "sample" or "full"))throw new ArgumentException("Unknown probe mode: "+args[3]); SceneProbe.Run(objects,args[2],args[3]); return; }
var components=objects.OfType<ULandscapeComponent>().ToArray();
Console.WriteLine($"Components: {components.Length}; vertices: {components.Sum(c=>(long)(c.ComponentSizeQuads+1)*(c.ComponentSizeQuads+1))}");
var output=args.Length>2?args[2]:"terrain";
Directory.CreateDirectory(output);
var rows=new List<object>();
var min=new double[]{double.PositiveInfinity,double.PositiveInfinity,double.PositiveInfinity};
var max=new double[]{double.NegativeInfinity,double.NegativeInfinity,double.NegativeInfinity};
var errors=new List<string>();
long offset=0;
using(var writer=new BinaryWriter(File.Create(Path.Combine(output,"terrain.bin"))))
foreach(var c in components) {
 try {
  var h=c.GetHeightmap() ?? throw new Exception("Missing heightmap");
  if(h.Format.ToString()!="PF_B8G8R8A8") throw new Exception($"Unexpected format {h.Format}");
  var mip=h.GetMip(0) ?? throw new Exception("Missing mip");
  var bytes=mip.BulkData.Data;
  var size=c.ComponentSizeQuads+1;
  var ox=(int)(h.PlatformData.SizeX*c.HeightmapScaleBias.Z);
  var oy=(int)(h.PlatformData.SizeY*c.HeightmapScaleBias.W);
  var transform=c.GetAbsoluteTransform();
  for(int y=0;y<size;y++) for(int x=0;x<size;x++) {
   var tx=x==0?0:(x-1)/c.SubsectionSizeQuads*(c.SubsectionSizeQuads+1)+(x-1)%c.SubsectionSizeQuads+1;
   var ty=y==0?0:(y-1)/c.SubsectionSizeQuads*(c.SubsectionSizeQuads+1)+(y-1)%c.SubsectionSizeQuads+1;
   var pixel=((oy+ty)*h.PlatformData.SizeX+ox+tx)*4;
   var height=((bytes[pixel+2]<<8)+bytes[pixel+1]-32768)/128f;
   if(height<c.CachedLocalBox.Min.Z-0.02 || height>c.CachedLocalBox.Max.Z+0.02) throw new Exception("Decoded height outside source bounds");
   var p=transform.TransformPosition(new FVector(x,y,height));
   float[] v=[p.X/100f,p.Z/100f,-p.Y/100f];
   for(int a=0;a<3;a++) {writer.Write(v[a]);min[a]=Math.Min(min[a],v[a]);max[a]=Math.Max(max[a],v[a]);}
  }
  rows.Add(new {name=c.Name,size,offset,sectionX=c.SectionBaseX,sectionY=c.SectionBaseY,scale=new[]{transform.Scale3D.X,transform.Scale3D.Y,transform.Scale3D.Z}});
  offset+=size*size;
 } catch(Exception e) {errors.Add($"{c.Name}: {e.Message}");}
}
var report=new {map=args[1],components=rows,vertices=offset,min,max,errors,elapsedSeconds=clock.Elapsed.TotalSeconds,workingSetMB=Environment.WorkingSet/1048576.0};
File.WriteAllText(Path.Combine(output,"terrain.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine(JsonSerializer.Serialize(new {components=rows.Count,vertices=offset,min,max,errors,elapsedSeconds=clock.Elapsed.TotalSeconds,workingSetMB=Environment.WorkingSet/1048576.0}));


