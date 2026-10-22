using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
using System.Diagnostics;
public static class DesktopImport {
 public static void Run(DefaultFileProvider provider,string paks,string root){
  var output=Path.Combine(root,RegionConfig.Id);Directory.CreateDirectory(output);
  CUE4Parse.UE4.Assets.Exports.PropertyUtil.SearchPropertyInTemplate=true;
  var timings=new List<object>();
  void Stage(string name,Action action){Console.WriteLine("@stage "+name);Console.Out.Flush();var t=Stopwatch.StartNew();action();timings.Add(new{name,seconds=t.Elapsed.TotalSeconds,workingSetMiB=Environment.WorkingSet/1048576.0});File.WriteAllText(Path.Combine(root,"extract-timings.json"),JsonSerializer.Serialize(timings));}
  UObject[] objects=[];
  Stage("Read installed Deadlands map",()=>objects=provider.LoadPackage(RegionConfig.MapPath).GetExports().ToArray());
  Stage("Extract full terrain",()=>Terrain(objects,output));
  Stage("Extract placed scenery",()=>SceneProbe.Run(objects,output,"full"));
  File.WriteAllText(Path.Combine(output,"catalog-full.json"),"{\"prototypes\":[]}");
  Stage("Extract blueprint structures",()=>ExtraProbe.Run(objects,output,paks,provider));
  Stage("Extract skeletal bridges",()=>ExtraProbe.Run(objects,output,paks,provider,true));
  var knownNames=new List<object>();foreach(var input in new[]{"scene-full.json","scene-extra.json","scene-bridges.json"}){using var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(output,input)));foreach(var p in doc.RootElement.GetProperty("prototypes").EnumerateArray())knownNames.Add(new{name=p.GetProperty("name").GetString()});}
  File.WriteAllText(Path.Combine(output,"world.json"),JsonSerializer.Serialize(new{prototypes=knownNames}));
  Stage("Extract native road splines",()=>RoadProbe.Run(objects,output));
  Stage("Extract town road decals",()=>DecalInventoryProbe.Run(objects,output));
  Stage("Extract road tour paths",()=>RoadTourProbe.Run(objects,output));
  Stage("Extract bridge approaches",()=>BridgeApproachProbe.Run(objects,output,paks,provider));
  var extra=Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(Path.Combine(output,"scene-extra.json")));var approaches=Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(Path.Combine(output,"scene-approaches.json")));((Newtonsoft.Json.Linq.JArray)extra["prototypes"]!).Merge(approaches["prototypes"]);((Newtonsoft.Json.Linq.JArray)extra["errors"]!).Merge(approaches["errors"]);File.WriteAllText(Path.Combine(output,"scene-extra.json"),extra.ToString());
  Stage("Extract terrain weights",()=>TerrainPaint.Run(objects,output));
  Stage("Extract native terrain textures",()=>LandscapeMaterialSource.Run(provider,objects,output));
  Stage("Extract water geometry",()=>SceneProbe.Run(objects,output,"water"));
  Stage("Extract environment materials",()=>EnvironmentProbe.Run(provider,objects,output));
  Stage("Extract skies and water textures",()=>SkyWaterProbe.Run(provider,root));
  Stage("Extract original map",()=>MapImageProbe.Run(provider,root));FastAssets.SaveDeferred(output);Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(FastAssets.Stats()));
 }
 static void Terrain(UObject[] objects,string output){var clock=Stopwatch.StartNew();var components=objects.OfType<ULandscapeComponent>().ToArray();
Console.WriteLine($"Components: {components.Length}; vertices: {components.Sum(c=>(long)(c.ComponentSizeQuads+1)*(c.ComponentSizeQuads+1))}");

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
var report=new {map=RegionConfig.MapPath,components=rows,vertices=offset,min,max,errors,elapsedSeconds=clock.Elapsed.TotalSeconds,workingSetMB=Environment.WorkingSet/1048576.0};
File.WriteAllText(Path.Combine(output,"terrain.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
Console.WriteLine(JsonSerializer.Serialize(new {components=rows.Count,vertices=offset,min,max,errors,elapsedSeconds=clock.Elapsed.TotalSeconds,workingSetMB=Environment.WorkingSet/1048576.0}));


}
}
