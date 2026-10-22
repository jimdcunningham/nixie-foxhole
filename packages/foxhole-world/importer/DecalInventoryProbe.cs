using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Actor;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse_Conversion.Textures;
using System.Text.Json;
public static class DecalInventoryProbe {
 public static void Run(UObject[] objects,string output){
  var rows=new List<object>();var roadRows=new List<object>();var materials=new Dictionary<string,object>();Directory.CreateDirectory(Path.Combine(output,"roads/decal-textures"));foreach(var c in objects.OfType<UDecalComponent>()){
   var t=c.GetAbsoluteTransform();var p=t.Translation;var material=c.GetDecalMaterial();
   var size=c.DecalSize??default;if(size.Y<=0&&c.Outer?.Object?.Value is ADecalActor actor)size=actor.DecalSize;
   var row=new{name=c.Name.ToString(),actor=c.Outer?.Name.ToString(),material=material?.GetPathName(),matrix=SceneProbe.Matrix(t),size=new[]{size.X,size.Y,size.Z},position=new[]{p.X/100,p.Z/100,-p.Y/100}};rows.Add(row);
   if(material==null||!System.Text.RegularExpressions.Regex.IsMatch(material.Name.ToString(),"^(RoadStreakIndustrial(?:02)?|RoadPath|TownRoadPath|GravelPatch)$"))continue;
   roadRows.Add(row);var key=material.GetPathName();if(materials.ContainsKey(key))continue;
   var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=new Dictionary<string,object>();foreach(var item in pars.Textures){if(item.Value is not UTexture texture)continue;var file="roads/decal-textures/"+texture.Name+".png";if(!File.Exists(Path.Combine(output,file))){var pixels=texture.Decode()??throw new Exception("No decal pixels");File.WriteAllBytes(Path.Combine(output,file),pixels.FastPng());}textures[item.Key]=new{file,source=texture.GetPathName()};}
   materials[key]=new{textures,scalars=pars.Scalars,colors=pars.Colors,switches=pars.Switches};
  }
  File.WriteAllText(Path.Combine(output,"decal-inventory.json"),JsonSerializer.Serialize(rows));Console.WriteLine($"Inspected {rows.Count} decal components");
  File.WriteAllText(Path.Combine(output,"roads/decal-source.json"),JsonSerializer.Serialize(new{decals=roadRows,materials}));Console.WriteLine($"Exported {roadRows.Count} road decals / {materials.Count} materials");
 }
}

