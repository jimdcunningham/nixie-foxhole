using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using System.Text.RegularExpressions;
static class Coverage {
 static Dictionary<string,ResolvedObject?> templates=new();
 static ResolvedObject? Find(UClass? cls,string name){if(cls==null||cls.ClassDefaultObject==null||cls.ClassDefaultObject.IsNull)return null;var key=cls.GetPathName()+"/"+name;if(templates.TryGetValue(key,out var cached))return cached;
 var cdo=cls.ClassDefaultObject.Load();var native=cdo?.GetOrDefault<FPackageIndex?>(name);if(native!=null&&!native.IsNull)return templates[key]=native.ResolvedObject;
 var pack=cls.Owner;if(pack!=null){var ix=pack.GetExportIndex(name+"_GEN_VARIABLE");if(ix<0)ix=pack.GetExportIndex(name);if(ix>=0)return templates[key]=new FPackageIndex(pack,ix+1).ResolvedObject;}
 return templates[key]=Find(cls.SuperStruct?.Load<UClass>(),name);
 }
 public static FTransform Absolute(UObject c,HashSet<UObject>? seen=null){seen??=[];if(!seen.Add(c))throw new Exception("Component attachment cycle");var local=new FTransform(c.GetOrDefault("RelativeRotation",FRotator.ZeroRotator),c.GetOrDefault("RelativeLocation",FVector.ZeroVector),c.GetOrDefault("RelativeScale3D",FVector.OneVector));var parent=c.GetOrDefault<FPackageIndex?>("AttachParent")?.Load();return parent==null?local:local*Absolute(parent,seen);}
 public static float[] Matrix(FTransform t){float[] P(FVector v)=>[v.X/100,v.Z/100,-v.Y/100];var o=P(t.TransformPosition(FVector.ZeroVector));var m=new float[16];var basis=new[]{new FVector(100,0,0),new FVector(0,0,100),new FVector(0,-100,0)};for(int i=0;i<3;i++){var p=P(t.TransformPosition(basis[i]));for(int a=0;a<3;a++)m[i*4+a]=p[a]-o[a];}m[12]=o[0];m[13]=o[1];m[14]=o[2];m[15]=1;return m;}
 public static void Run(UObject[] objects,string output,bool includeAll=false){Directory.CreateDirectory(output);PropertyUtil.SearchPropertyInTemplate=true;int assigned=0;var errors=new List<string>();
 foreach(var c in objects.Where(o=>o.Outer?.Object?.Value?.ExportType.EndsWith("_C")==true))try{var a=c.Outer!.Object!.Value;var template=Find(a.Class?.Object?.Value as UClass,c.Name);if(template!=null&&!ReferenceEquals(template.Object?.Value,c)){c.Template=template;assigned++;}}catch(Exception e){errors.Add(c.Name+": "+e.Message);}
 var decals=new List<object>();var materials=new Dictionary<string,object>();var all=new List<object>();Directory.CreateDirectory(Path.Combine(output,"decals/textures"));
 foreach(var c in objects.OfType<UDecalComponent>())try{var reference=c.GetOrDefault<FPackageIndex?>("DecalMaterial");var material=reference?.Load<UMaterialInterface>();var size=c.GetOrDefault("DecalSize",new FVector(128,256,256));var t=c.GetAbsoluteTransform();var matrix=Matrix(t);var row=new{name=c.Name,actor=c.Outer?.Name.ToString(),material=material?.GetPathName(),matrix,size=new[]{size.X,size.Y,size.Z},visible=c.GetOrDefault("bVisible",true),hidden=c.GetOrDefault("bHiddenInGame",false),sortOrder=c.GetOrDefault("SortOrder",0)};all.Add(row);
 if(material==null||(!includeAll&&!Regex.IsMatch(material.Name,"TownRail|TownRoadRail|^Rail01$|^(RoadStreakIndustrial(?:02)?|RoadPath|TownRoadPath|GravelPatch)$")))continue;decals.Add(row);if(materials.ContainsKey(material.GetPathName()))continue;
 var pars=new CMaterialParams2();material.GetParams(pars,EMaterialFormat.AllLayers);var textures=new Dictionary<string,object>();foreach(var kv in pars.Textures){if(kv.Value is not UTexture tex)continue;var file="decals/textures/"+tex.Name+".png";var full=Path.Combine(output,file);if(!File.Exists(full)){var pixels=tex.Decode()??throw new Exception("No pixels "+tex.Name);using var bitmap=pixels.ToSkBitmap();using var pixmap=bitmap.PeekPixels();using var png=pixmap.Encode(new SkiaSharp.SKPngEncoderOptions(SkiaSharp.SKPngEncoderFilterFlags.NoFilters,1));File.WriteAllBytes(full,png.ToArray());}textures[kv.Key]=new{file,source=tex.GetPathName()};}materials[material.GetPathName()]=new{textures,scalars=pars.Scalars,colors=pars.Colors,switches=pars.Switches,blend=pars.BlendMode.ToString(),native=material};
 }catch(Exception e){errors.Add(c.Outer?.Name+"/"+c.Name+": "+e.Message);}
 File.WriteAllText(Path.Combine(output,"resolved-decals.json"),JsonConvert.SerializeObject(all));File.WriteAllText(Path.Combine(output,"decals/source.json"),JsonConvert.SerializeObject(new{decals,materials,errors},Formatting.Indented));
 var rails=objects.Where(o=>Regex.IsMatch(o.ExportType,"RailTrackSpline.*_C$")).Select(o=>{var connector=o.GetOrDefault<FPackageIndex?>("SplineConnector")?.Load();var front=o.GetOrDefault<FPackageIndex?>("FrontSocket")?.Load();var back=o.GetOrDefault<FPackageIndex?>("BackSocket")?.Load();return new{name=o.Name,type=o.ExportType,front=front==null?null:Matrix(Absolute(front)),back=back==null?null:Matrix(Absolute(back)),connectorProperties=connector?.Properties.Select(p=>p.Name.Text).ToArray(),connectorTemplate=connector?.Template?.Object?.Value};});
 File.WriteAllText(Path.Combine(output,"resolved-rail-sockets.json"),JsonConvert.SerializeObject(rails,Formatting.Indented));Console.WriteLine($"Inherited templates {assigned}; decals {all.Count}; rail decals {decals.Count}; rail materials {materials.Count}; errors {errors.Count}");
 }
}

